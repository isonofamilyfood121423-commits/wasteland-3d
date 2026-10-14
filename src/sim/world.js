// ゲームロジックの状態（地面平面 x,z 上のシミュレーション）。描画には依存しない
import { Rng } from '../core/rng.js';
import { slopeAt } from './terrain.js';
import { findSpawn } from './worldgen.js';
import { walkable } from './pathfind.js';
import { clearTask, planPath, replan, stopPerson } from './move.js';
import { emptyEquip } from './equip.js';
import { newFight, stepFight, stepCombatTask, followCarrier, dropCarried, fleeFromFights } from './combat.js';
import { stepSquads, makeEnemy } from './squads.js';
import { bindWorld, stepFactions, onDeath, onTreatOther } from './factions.js';
import { ensureTownObstacles, allTowns } from './towns.js';
import { stepBase, stepWork, freeBed, defaultJobs, refreshBlocking } from './base.js';
import { resetBlocked } from './pathfind.js';
import { ROLES, TRADE } from '../data/world.js';
import { QUALITY_MUL } from '../data/items.js';
import {
  pickRace, initHealth, mobility, bodyTick, gainXp, loadRatio, addItem, partsNeedingAid, findAidItem,
  treatPart, treatHours, armsUsable, totalBleed, damage as hurt,
} from './body.js';
import { TIME, CROWD, PALETTE, PARTY, NAMES } from '../data/config.js';
export { stopPerson } from './move.js';
import { RACES, HEALTH, GROWTH, ITEMS, PARTS } from '../data/body.js';

function makeLook(r, party, raceId) {
  const race = RACES[raceId];
  const skins = race.skin || PALETTE.skin;
  return {
    skin: Math.floor(r.next() * skins.length),
    cloth: Math.floor(r.next() * PALETTE.cloth.length),
    pants: Math.floor(r.next() * PALETTE.cloth.length),
    hat: race.shape.head === 'horn' ? false : party ? r.next() < 0.6 : r.next() < 0.45,
    pack: party ? true : r.next() < 0.35,
    height: (0.92 + r.next() * 0.16) * race.shape.height,
    bulk: (0.9 + r.next() * 0.25) * race.shape.bulk,
    accent: party ? PARTY.clothColor : null,
  };
}

function uniqueName(w, r) {
  const used = new Set(w.people.filter((p) => p.kind === 'party').map((p) => p.name));
  for (let i = 0; i < 20; i++) { const n = r.pick(NAMES.first); if (!used.has(n)) return n; }
  return r.pick(NAMES.first);
}

function makePerson(w, kind, x, z, faction) {
  const r = w.rng;
  const race = pickRace(r);
  const p = {
    id: w.nextId++,
    kind,
    race,
    name: kind === 'party' ? uniqueName(w, r) : r.pick(NAMES.first),
    surname: r.pick(NAMES.last),
    x, z, heading: r.next() * 6.28,
    speed: 0,
    maxSpeed: kind === 'party' ? PARTY.runSpeed : r.range(CROWD.walkSpeed[0], CROWD.walkSpeed[1]),
    phase: r.next() * 6.28,
    path: [], goal: null, stuck: 0, replans: 0,
    homeX: x, homeZ: z,
    idle: r.next() * 3,
    look: makeLook(r, kind === 'party', race),
    task: null,
    inv: [],
    faction: faction || (kind === 'party' ? 'player' : 'drifter'),
    equip: emptyEquip(),
    fight: newFight(),
    money: 0,
  };
  initHealth(p, r);
  dressFromLook(p);
  return p;
}

// 見た目の設定（帽子・背負い袋）を装備として持たせる
export function dressFromLook(p) {
  if (p.look.hat) p.equip.head = { id: 'straw_hat', q: 1 };
  if (p.look.pack) p.equip.back = { id: 'backpack', q: 1 };
  p.equip.body = { id: 'rag_shirt', q: 1 };
  p.equip.feet = { id: 'sandals', q: 1 };
  p.equipVer = 1;
}

function giveStartingItems(p, rich) {
  if (RACES[p.race].eats) { addItem(p, 'dried_meat', 2); addItem(p, 'hardtack', 2); }
  addItem(p, RACES[p.race].aid === 'repair' ? 'repair_kit' : 'bandage', 3);
  if (rich) addItem(p, 'aidkit', 1);
}

export function createWorld(seed) {
  const w = {
    seed,
    rng: new Rng(seed),
    nextId: 1,
    spawn: findSpawn(),
    hour: TIME.startHour,
    day: 1,
    timeScale: 1,
    debugFast: false,
    money: PARTY.startMoney,
    people: [],
    squads: [],
    time: 0,          // ゲーム内の経過秒（1x で現実の秒と同じ）
    banditsOn: true,  // 盗賊の出現（設定で切り替え）
    log: [],
  };
  attachRuntime(w);
  w.spawnTimer = (2 / 24) * w.daySeconds; // 最初の盗賊はゲーム内2時間後から
  const sp = w.spawn;
  for (let i = 0; i < PARTY.size; i++) {
    let x = sp.x + 14 + i * 1.6, z = sp.z + 10 + (i % 2) * 1.2;
    for (let t = 0; t < 20 && !walkable(x, z); t++) x += 2;
    const p = makePerson(w, 'party', x, z);
    p.jobs = defaultJobs();
    giveStartingItems(p, i === 0);
    // 仕様判断：序盤は無力。まともな武器は1本だけ、2人目は粗悪な鉄棍、3人目は素手
    if (i === 0) p.equip.weapon = { id: 'rusty_blade', q: 1 };
    if (i === 1) p.equip.weapon = { id: 'iron_club', q: 0 };
    w.people.push(p);
  }
  for (let i = 0; i < CROWD.count; i++) {
    const a = w.rng.next() * 6.28, r = Math.sqrt(w.rng.next()) * CROWD.spawnRadius + 8;
    let x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
    if (!walkable(x, z)) { x += 4; z += 4; }
    const p = makePerson(w, 'drifter', x, z);
    if (RACES[p.race].eats) addItem(p, 'hardtack', 2);
    w.people.push(p);
  }
  populateTowns(w);
  addLog(w, 'あなたの一団は廃墟のそばで目を覚ました。北東の方角に、町の煙が見える。');
  return w;
}

// 保存しない実行時の関数をつなぐ（新規作成・ロードの両方で呼ぶ）
export function attachRuntime(w) {
  w.addLogFn = (text, quiet) => addLog(w, text, quiet);
  w.daySeconds = TIME.realSecondsPerDay;
  w.events = w.events || [];
  w.squads = w.squads || [];
  w.time = w.time || 0;
  w.onDeathFn = (p) => onDeath(w, p);
  w.onTreatFn = (m, pt) => onTreatOther(w, m, pt);
  resetBlocked();
  ensureTownObstacles(true);
  bindWorld(w);
  refreshBlocking(w);
}

// ======================= 町の人々 =======================
function roleDef(role, faction) { return role === 'guard' ? ROLES.guard[faction] : ROLES[role]; }

export function makeTownPerson(w, town, role, x, z) {
  const def = roleDef(role, town.faction);
  const r = w.rng;
  const p = makePerson(w, 'npc', x, z, town.faction);
  p.role = role; p.town = town.id; p.title = def.label;
  for (const k of Object.keys(p.skills)) p.skills[k].lv = Math.max(1, Math.round(r.range(def.skill[0], def.skill[1]) * (0.6 + r.next() * 0.6)));
  p.equip = emptyEquip();
  for (const [slot, list] of Object.entries(def.gear)) { const id = r.pick(list); if (id) p.equip[slot] = { id, q: Math.round(r.range(def.q[0], def.q[1])) }; }
  p.equipVer = 1;
  p.look.hat = false; p.look.pack = false;
  // 派閥の差し色（衛兵・役人は派閥色の服）
  const acc = { merchant: 0x3f6f8f, holy: 0xd8d0b8, bandit: 0x7e3a2c, eater: 0x4e5e34 }[town.faction];
  p.look.accent = role === 'guard' || role === 'police' || town.faction === 'bandit' || town.faction === 'eater' ? acc : null;
  p.maxSpeed = role === 'guard' ? 2.8 : 1.5 + r.next() * 0.4;
  p.money = Math.round(r.range(5, 40));
  if (def.bounty) p.bounty = Math.round(r.range(def.bounty[0], def.bounty[1]) / 10) * 10;
  if (role === 'recruit') {
    p.hirePrice = r.next() < 0.3 ? 0 : Math.round(r.range(TRADE.recruitPrice[0], TRADE.recruitPrice[1]) * (0.5 + Object.values(p.skills).reduce((a, s) => a + s.lv, 0) / 200) / 50) * 50;
  }
  return p;
}

export function populateTowns(w) {
  for (const L of allTowns()) {
    const t = L.town;
    const add = (role, x, z) => { if (!walkable(x, z)) { x = t.x + (w.rng.next() - 0.5) * 6; z = t.z + (w.rng.next() - 0.5) * 6; } const p = makeTownPerson(w, t, role, x, z); w.people.push(p); return p; };
    // 店主・酒場・役人は入口の前に立つ
    for (const b of L.buildings.filter((bb) => bb.type === 'shop')) {
      const role = b.shop === 'bar' ? 'bartender' : b.shop === 'police' ? 'police' : 'shopkeeper';
      const p = add(role, b.door.x, b.door.z);
      p.shop = b.shop; p.station = { x: b.door.x, z: b.door.z };
      p.heading = Math.atan2(t.x - b.door.x, t.z - b.door.z);
      if (b.shop === 'bar') {
        const n = 1 + Math.floor(w.rng.next() * 3);
        for (let i = 0; i < n; i++) { const q = add('recruit', b.door.x + (i - 1) * 1.6, b.door.z + 2.4); q.station = { x: q.x, z: q.z }; }
      }
    }
    for (let i = 0; i < t.guards; i++) {
      const pt = L.patrol[i % L.patrol.length];
      const g = add('guard', pt.x, pt.z);
      g.patrolIdx = i % L.patrol.length;
      // 半分は持ち場（広場）に立つ
      if (i % 2 === 1) g.station = { x: pt.x, z: pt.z };
    }
    for (let i = 0; i < t.folk; i++) {
      const a = w.rng.next() * Math.PI * 2, rr = w.rng.next() * t.r * 0.6;
      add('folk', t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr);
    }
    if (t.boss) { const b = add('boss', t.x, t.z); b.station = { x: t.x, z: t.z }; b.title = ROLES.boss.label; }
  }
}

export function partyOf(w) { return w.people.filter((p) => p.kind === 'party'); }
export function personById(w, id) { return w.people.find((p) => p.id === id); }

export function addLog(w, text, quiet = false) {
  w.log.push({ day: w.day, hour: w.hour, text });
  if (w.log.length > 80) w.log.shift();
  if (!quiet) w.onLog?.(text);
}

// ======================= 指示 =======================
export function orderMove(w, ids, gx, gz) {
  const movers = ids.map((id) => personById(w, id)).filter((p) => p && p.state === 'ok');
  const n = movers.length;
  movers.forEach((p, i) => {
    clearTask(p);
    p.retreat = false;
    p.fight.target = null; p.fight.ordered = false;
    let tx = gx, tz = gz;
    if (n > 1) {
      const ring = i === 0 ? 0 : Math.ceil(i / 6);
      const a = (i / Math.min(6, n - 1)) * Math.PI * 2;
      tx += Math.cos(a) * ring * PARTY.formationGap;
      tz += Math.sin(a) * ring * PARTY.formationGap;
    }
    planPath(w, p, tx, tz);
  });
  const down = ids.map((id) => personById(w, id)).filter((p) => p && p.state !== 'ok');
  if (down.length && !n) addLog(w, `${down[0].name}は動けない。`);
}

export function orderRest(w, ids) {
  for (const id of ids) {
    const p = personById(w, id);
    if (!p || p.state !== 'ok') continue;
    stopPerson(p);
    const bed = freeBed(w, p);
    p.task = bed ? { kind: 'rest', bed: bed.id } : { kind: 'rest' };
    p.resting = !bed;
  }
}

// 治療：治療役（複数可）が患者のそばへ行き、悪い部位から順に処置する
export function orderTreat(w, medicIds, patientId) {
  const patient = personById(w, patientId);
  if (!patient || patient.state === 'dead') return;
  if (!partsNeedingAid(patient).length) { addLog(w, `${patient.name}は治療の必要がない。`); return; }
  let started = 0;
  for (const id of medicIds) {
    const m = personById(w, id);
    if (!m || m.state !== 'ok') continue;
    if (!armsUsable(m)) { addLog(w, `${m.name}は腕が使えず、治療できない。`); continue; }
    stopPerson(m);
    m.task = { kind: 'treat', target: patientId, t: 0, replan: 0 };
    started++;
  }
  if (!started && medicIds.length) addLog(w, '治療できる仲間がいない。');
}

// ======================= 時間経過 =======================
export function stepWorld(w, dt) {
  const scale = w.timeScale * (w.debugFast ? TIME.debugFastForward : 1);
  if (scale <= 0) return;
  const gdt = dt * scale;

  w.time += gdt;
  w.hour += (gdt / TIME.realSecondsPerDay) * 24;
  while (w.hour >= 24) { w.hour -= 24; w.day++; }

  const sub = Math.min(20, Math.max(1, Math.ceil(gdt / 0.1)));
  const h = gdt / sub;
  const hours = (h / TIME.realSecondsPerDay) * 24;
  for (let s = 0; s < sub; s++) {
    for (const p of w.people) {
      bodyTick(w, p, hours);
      if (p.far) continue; // 遠くの人は動かさない（簡易シミュレーション）
      if (p.carriedBy) { followCarrier(w, p); continue; }
      if (p.carrying && p.state !== 'ok') dropCarried(w, p);
      if (p.state !== 'ok') { if (p.fight) p.fight.act = null; p.speed = 0; continue; }
      const busy = stepCombatTask(w, p, hours) || stepWork(w, p, h);
      if (!busy) stepTask(w, p, hours);
      const fight = busy || p.task?.kind === 'treat' ? null : stepFight(w, p, h);
      if (fight === 'hold') { p.speed = Math.max(0, p.speed - h * 8); p.moveMode = 'run'; continue; }
      stepPerson(w, p, h);
    }
    separate(w.near || w.people, h);
  }
  stepSquads(w, makePerson, gdt);
  stepBase(w, gdt);
  w.lodTimer = (w.lodTimer || 0) - gdt;
  if (w.lodTimer <= 0) { w.lodTimer = 1; updateLod(w); stepFactions(w); }
  w.fleeTimer = (w.fleeTimer || 0) - gdt;
  if (w.fleeTimer <= 0) { w.fleeTimer = 1; for (const p of w.people) fleeFromFights(w, p); }
  // 仲間が自動で応急処置（出血している仲間が近くにいて、手が空いているとき）
  w.autoAidTimer = (w.autoAidTimer || 0) - gdt;
  if (w.autoAidTimer <= 0) { w.autoAidTimer = 2; autoAid(w); }
}

function autoAid(w) {
  const party = partyOf(w);
  const bleeding = party.filter((p) => p.state !== 'dead' && totalBleed(p) > 0.3 && !party.some((m) => m.task?.kind === 'treat' && m.task.target === p.id));
  for (const patient of bleeding) {
    const medic = party
      .filter((m) => m.state === 'ok' && !m.task && !m.path.length && !m.fight?.target && !m.carrying && armsUsable(m) && Math.hypot(m.x - patient.x, m.z - patient.z) < 20 && findAidItem(m, patient))
      .sort((a, b) => Math.hypot(a.x - patient.x, a.z - patient.z) - Math.hypot(b.x - patient.x, b.z - patient.z))[0];
    if (medic) { medic.task = { kind: 'treat', target: patient.id, t: 0, replan: 0, auto: true }; }
  }
}

function stepTask(w, p, hours) {
  const t = p.task;
  if (!t || p.state !== 'ok') { if (p.state !== 'ok') p.task = null; return; }
  if (t.kind === 'rest') {
    if (t.bed && !p.inBed) {
      const bed = w.base?.buildings.find((b) => b.id === t.bed);
      if (!bed) { t.bed = null; p.resting = true; return; }
      if (Math.hypot(bed.x - p.x, bed.z - p.z) > 1.2) { if (!p.goal) planPath(w, p, bed.x, bed.z, true); return; }
      p.inBed = bed.id; p.x = bed.x; p.z = bed.z; p.heading = (bed.rot || 0) * Math.PI / 2;
    }
    p.resting = true; return;
  }
  if (t.kind === 'treat') {
    const pt = personById(w, t.target);
    // 自動の応急処置は止血だけ。指示された治療はHPも戻す
    let need = pt && pt.state !== 'dead' ? partsNeedingAid(pt) : [];
    if (t.auto) need = need.filter((n) => n.b.bleed > 0.05);
    if (!need.length) { if (pt && pt.state !== 'dead' && !t.auto) addLog(w, `${p.name}が${pt === p ? '自分' : pt.name}の手当てを終えた。`); p.task = null; return; }
    const dist = Math.hypot(pt.x - p.x, pt.z - p.z);
    if (dist > HEALTH.treatRange) {
      t.replan -= hours;
      if (!p.goal || t.replan <= 0) { t.replan = 0.05; planPath(w, p, pt.x, pt.z); if (!p.goal) { p.task = null; } }
      return;
    }
    p.path = []; p.goal = null;
    if (pt !== p) p.heading = Math.atan2(pt.x - p.x, pt.z - p.z);
    if (pt.path.length && pt.kind === 'party' && pt.state === 'ok' && !pt.goal) pt.path = [];
    const item = findAidItem(p, pt);
    if (!item) {
      addLog(w, `${p.name}：${RACES[pt.race].aid === 'repair' ? '修理キット' : '包帯'}がない。`);
      p.task = null; return;
    }
    t.t += hours;
    if (t.t >= treatHours(p, item.id)) {
      t.t = 0;
      const label = treatPart(w, p, pt, need[0].id, item.id, item.owner);
      if (label) w.onTreatFn?.(p, pt);
      if (label) addLog(w, `${p.name}が${pt === p ? '自分' : pt.name}の${label}を手当てした（${ITEMS[item.id].label}）。`, true);
    }
  }
}

function steerToward(p, tx, tz, dt, speedMul, mob) {
  const dx = tx - p.x, dz = tz - p.z;
  const want = Math.atan2(dx, dz);
  let d = want - p.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  p.heading += Math.max(-dt * 6, Math.min(dt * 6, d));
  const slow = 1 / (1 + slopeAt(p.x, p.z) * 1.2);
  const base = mob.mode === 'crawl' ? HEALTH.crawlSpeed : p.maxSpeed * mob.mul;
  const target = base * slow * speedMul * (Math.abs(d) > 1.3 ? 0.25 : 1);
  p.speed += (target - p.speed) * Math.min(1, dt * 4);
  const nx = p.x + Math.sin(p.heading) * p.speed * dt;
  const nz = p.z + Math.cos(p.heading) * p.speed * dt;
  const ox = p.x, oz = p.z;
  if (walkable(nx, nz)) { p.x = nx; p.z = nz; }
  else if (walkable(nx, p.z)) p.x = nx;
  else if (walkable(p.x, nz)) p.z = nz;
  else { p.speed *= 0.5; return 0; }
  return Math.hypot(p.x - ox, p.z - oz);
}

function stepPerson(w, p, dt) {
  const mob = mobility(p);
  p.moveMode = mob.mode;
  if (mob.mode === 'none') { p.speed = 0; return; }
  let moved = 0;
  if (p.path.length) {
    const wp = p.path[0];
    const dist = Math.hypot(wp.x - p.x, wp.z - p.z);
    const last = p.path.length === 1;
    if (dist < (last ? 0.35 : 0.9)) {
      p.path.shift();
      if (!p.path.length && p.goal) {
        const left = Math.hypot(p.goal.x - p.x, p.goal.z - p.z);
        if (p.partial && left > 2 && p.replans < 30 && left < p.lastPlanDist - 1) {
          p.replans++; p.lastPlanDist = left; replan(w, p);
        } else {
          if (p.partial && left > 2 && p.kind === 'party' && !p.task && !p.quietPath) addLog(w, `${p.name}：これ以上は進めない。`);
          p.goal = null;
          p.retreat = false;
        }
      }
    } else {
      moved = steerToward(p, wp.x, wp.z, dt, last && dist < 2 ? 0.5 : 1, mob);
      p.stuck = moved > 0 && p.speed > 0.15 ? 0 : p.stuck + dt;
      if (p.stuck > 1.5 && p.goal) { p.stuck = 0; replan(w, p); }
    }
  } else if (p.role && !p.task && !p.fight?.target && roleIdle(w, p, dt, mob)) {
    // 町の人の決まった動き（roleIdle が処理済み）
  } else if ((p.kind === 'drifter' || p.role === 'folk') && !p.task && !p.fight?.target) {
    if (p.idle > 0) {
      p.idle -= dt;
      p.speed = Math.max(0, p.speed - dt * 3);
      if (p.idle <= 0) pickWander(w, p);
    } else if (p.tx === undefined || Math.hypot(p.tx - p.x, p.tz - p.z) < 0.6) {
      p.idle = w.rng.range(CROWD.idleTime[0], CROWD.idleTime[1]);
      p.tx = undefined;
    } else {
      moved = steerToward(p, p.tx, p.tz, dt, p.fleeing ? 2 : 1, mob);
      if (p.fleeing && Math.hypot(p.tx - p.x, p.tz - p.z) < 1) p.fleeing = false;
      if (!moved) { p.tx = undefined; p.idle = 0.5; }
    }
  } else {
    p.speed = Math.max(0, p.speed - dt * 6);
  }
  // 歩幅の位相（走り・這うで速さが違う）
  p.phase += p.speed * dt * (mob.mode === 'crawl' ? 5 : p.speed > 2.2 ? 2.4 : 3.2);

  // 使うと上がる：走ると敏捷、重い荷物を持って歩くと筋力
  if (moved > 0 && p.kind === 'party') {
    if (p.speed > 2.2) gainXp(w, p, 'agi', moved * GROWTH.agiXpPerMeter);
    const lr = loadRatio(p);
    if (lr > GROWTH.strLoadRatio) gainXp(w, p, 'str', moved * GROWTH.strXpPerMeter * lr);
    // 忍び歩き：敵の近くほど隠密が伸びる
    if (p.sneak) gainXp(w, p, 'stealth', moved * (w.people.some((o) => o.squadHunting === false && o.faction === 'bandit' && Math.abs(o.x - p.x) < 50 && Math.abs(o.z - p.z) < 50) ? 0.5 : 0.15));
  }
}

// 一団とカメラから遠い人は簡易シミュレーション（移動・戦闘・押し合いを省く）
function updateLod(w) {
  const anchors = w.people.filter((p) => p.kind === 'party' && p.state !== 'dead').map((p) => [p.x, p.z]);
  if (w.focus) anchors.push([w.focus.x, w.focus.z]);
  const R = 200;
  w.near = [];
  for (const p of w.people) {
    const far = p.kind !== 'party' && !p.squadHunting && !p.carriedBy && !anchors.some(([x, z]) => Math.abs(p.x - x) < R && Math.abs(p.z - z) < R);
    if (far && !p.far) { p.path = []; p.goal = null; p.speed = 0; }
    p.far = far;
    if (!far) w.near.push(p);
  }
}

// 町の人：持ち場に戻る・巡回する。処理したら true
function roleIdle(w, p, dt, mob) {
  if (p.role === 'folk') return false;
  const home = p.station;
  if (home) {
    const d = Math.hypot(home.x - p.x, home.z - p.z);
    if (d > 1.2) { if (!p.goal) planPath(w, p, home.x, home.z, true); return false; }
    p.speed = Math.max(0, p.speed - dt * 4);
    return true;
  }
  if (p.role === 'guard') {
    const L = allTowns().find((t) => t.town.id === p.town);
    if (!L) return true;
    p.idle = (p.idle || 0) - dt;
    if (p.idle > 0) { p.speed = Math.max(0, p.speed - dt * 4); return true; }
    p.patrolIdx = ((p.patrolIdx || 0) + 1) % L.patrol.length;
    const pt = L.patrol[p.patrolIdx];
    planPath(w, p, pt.x, pt.z, true);
    p.idle = 6 + w.rng.next() * 10;
    return false;
  }
  return true;
}

function pickWander(w, p) {
  const rad = p.role === 'folk' ? 18 : CROWD.wanderRadius;
  for (let i = 0; i < 6; i++) {
    const a = w.rng.next() * 6.28, r = 4 + w.rng.next() * rad;
    const x = p.homeX + Math.cos(a) * r, z = p.homeZ + Math.sin(a) * r;
    if (walkable(x, z)) { p.tx = x; p.tz = z; return; }
  }
  p.tx = p.homeX; p.tz = p.homeZ;
}

function separate(people, dt) {
  const R = 0.7;
  for (let i = 0; i < people.length; i++) {
    const a = people[i];
    if (a.state !== 'ok') continue; // 倒れている人は押し合いに参加しない
    for (let j = i + 1; j < people.length; j++) {
      const b = people[j];
      if (b.state !== 'ok') continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d >= R) continue;
      // 治療中の2人は離さない
      if ((a.task?.kind === 'treat' && a.task.target === b.id) || (b.task?.kind === 'treat' && b.task.target === a.id)) continue;
      const push = (R - d) * 0.5 * Math.min(1, dt * 8);
      const ux = dx / d, uz = dz / d;
      const wa = a.speed > b.speed ? 0.3 : 0.7;
      const ax = a.x - ux * push * wa * 2, az = a.z - uz * push * wa * 2;
      const bx = b.x + ux * push * (1 - wa) * 2, bz = b.z + uz * push * (1 - wa) * 2;
      if (walkable(ax, az)) { a.x = ax; a.z = az; }
      if (walkable(bx, bz)) { b.x = bx; b.z = bz; }
    }
  }
}

// ======================= 義肢 =======================
export function attachProsthetic(w, p, partId, itemId) {
  const b = p.body[partId];
  if (!b.lost || b.prosthetic) return false;
  const it = ITEMS[itemId];
  if (!it?.limb) return false;
  const i = p.inv.find((s) => s.id === itemId);
  if (!i) return false;
  i.qty--; if (i.qty <= 0) p.inv.splice(p.inv.indexOf(i), 1);
  b.prosthetic = itemId;
  b.hp = it.limb.hp;
  b.bleed = 0;
  addLog(w, `${p.name}に${it.label}を取り付けた。`);
  return true;
}

// ======================= 検証用（戦闘ができるまでの確認手段） =======================
export const debug = {
  hurt(w, p) {
    const part = PARTS[Math.floor(w.rng.next() * PARTS.length)];
    hurt(w, p, part.id, 18 + w.rng.next() * 30, { cut: true });
  },
  heavy(w, p) { hurt(w, p, 'chest', 70 + w.rng.next() * 20, { cut: true }); },
  loseLeg(w, p) { const id = p.body.legL.lost ? 'legR' : 'legL'; hurt(w, p, id, 400, { cut: true }); },
  starve(w, p) { p.hunger = 60; },
  bandits(w, p) {
    // 近くに盗賊の一団を呼ぶ（すぐに襲ってくる）
    const sq = { id: w.nextId++, members: [], mode: 'hunt', cooldownUntil: 0, t: 0 };
    ['thug', 'starved', 'starved'].forEach((type, i) => {
      let x = p.x + 18 + i * 1.5, z = p.z + 6;
      for (let k = 0; k < 10 && !walkable(x, z); k++) { x -= 3; }
      const e = makeEnemy(w, makePerson, type, x, z);
      e.squad = sq.id; w.people.push(e); sq.members.push(e.id);
    });
    w.squads.push(sq);
    addLog(w, '盗賊の一団が現れた！（検証用）');
  },
  giveLimb(w, p) { addItem(p, 'limb_crude', 1); addLog(w, `${p.name}に粗末な義肢を持たせた（検証用）。`); },
};
