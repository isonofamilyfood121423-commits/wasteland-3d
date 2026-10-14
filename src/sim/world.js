// ゲームロジックの状態（地面平面 x,z 上のシミュレーション）。描画には依存しない
import { Rng } from '../core/rng.js';
import { slopeAt } from './terrain.js';
import { findSpawn } from './worldgen.js';
import { findPath, walkable } from './pathfind.js';
import {
  pickRace, initHealth, mobility, bodyTick, gainXp, loadRatio, addItem, partsNeedingAid, findAidItem,
  treatPart, treatHours, armsUsable, totalBleed, damage as hurt,
} from './body.js';
import { TIME, CROWD, PALETTE, PARTY, NAMES } from '../data/config.js';
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

function makePerson(w, kind, x, z) {
  const r = w.rng;
  const race = pickRace(r);
  const p = {
    id: w.nextId++,
    kind,
    race,
    name: r.pick(NAMES.first),
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
  };
  initHealth(p, r);
  return p;
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
    log: [],
  };
  attachRuntime(w);
  const sp = w.spawn;
  for (let i = 0; i < PARTY.size; i++) {
    let x = sp.x + 14 + i * 1.6, z = sp.z + 10 + (i % 2) * 1.2;
    for (let t = 0; t < 20 && !walkable(x, z); t++) x += 2;
    const p = makePerson(w, 'party', x, z);
    giveStartingItems(p, i === 0);
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
  addLog(w, 'あなたの一団は廃墟のそばで目を覚ました。');
  return w;
}

// 保存しない実行時の関数をつなぐ（新規作成・ロードの両方で呼ぶ）
export function attachRuntime(w) {
  w.addLogFn = (text, quiet) => addLog(w, text, quiet);
}

export function partyOf(w) { return w.people.filter((p) => p.kind === 'party'); }
export function personById(w, id) { return w.people.find((p) => p.id === id); }

export function addLog(w, text, quiet = false) {
  w.log.push({ day: w.day, hour: w.hour, text });
  if (w.log.length > 80) w.log.shift();
  if (!quiet) w.onLog?.(text);
}

// ======================= 指示 =======================
function clearTask(p) {
  p.task = null;
  p.resting = false;
}

export function orderMove(w, ids, gx, gz) {
  const movers = ids.map((id) => personById(w, id)).filter((p) => p && p.state === 'ok');
  const n = movers.length;
  movers.forEach((p, i) => {
    clearTask(p);
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
    stopPerson(p); p.task = { kind: 'rest' }; p.resting = true;
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

function planPath(w, p, gx, gz) {
  p.goal = { x: gx, z: gz };
  p.replans = 0;
  p.lastPlanDist = Infinity;
  replan(w, p);
}

function replan(w, p) {
  const res = findPath(p.x, p.z, p.goal.x, p.goal.z);
  if (!res || !res.points.length) {
    if (p.kind === 'party' && Math.hypot(p.goal.x - p.x, p.goal.z - p.z) > 2 && !p.task) addLog(w, `${p.name}：そこへは行けない。`);
    p.path = []; p.goal = null;
    return;
  }
  p.path = res.points;
  p.partial = !res.reached;
}

export function stopPerson(p) { p.path = []; p.goal = null; clearTask(p); }

// ======================= 時間経過 =======================
export function stepWorld(w, dt) {
  const scale = w.timeScale * (w.debugFast ? TIME.debugFastForward : 1);
  if (scale <= 0) return;
  const gdt = dt * scale;

  w.hour += (gdt / TIME.realSecondsPerDay) * 24;
  while (w.hour >= 24) { w.hour -= 24; w.day++; }

  const sub = Math.min(20, Math.max(1, Math.ceil(gdt / 0.1)));
  const h = gdt / sub;
  const hours = (h / TIME.realSecondsPerDay) * 24;
  for (let s = 0; s < sub; s++) {
    for (const p of w.people) {
      bodyTick(w, p, hours);
      stepTask(w, p, hours);
      stepPerson(w, p, h);
    }
    separate(w.people, h);
  }
  // 仲間が自動で応急処置（出血している仲間が近くにいて、手が空いているとき）
  w.autoAidTimer = (w.autoAidTimer || 0) - gdt;
  if (w.autoAidTimer <= 0) { w.autoAidTimer = 2; autoAid(w); }
}

function autoAid(w) {
  const party = partyOf(w);
  const bleeding = party.filter((p) => p.state !== 'dead' && totalBleed(p) > 0.3 && !party.some((m) => m.task?.kind === 'treat' && m.task.target === p.id));
  for (const patient of bleeding) {
    const medic = party
      .filter((m) => m.state === 'ok' && !m.task && !m.path.length && armsUsable(m) && Math.hypot(m.x - patient.x, m.z - patient.z) < 20 && findAidItem(m, patient))
      .sort((a, b) => Math.hypot(a.x - patient.x, a.z - patient.z) - Math.hypot(b.x - patient.x, b.z - patient.z))[0];
    if (medic) { medic.task = { kind: 'treat', target: patient.id, t: 0, replan: 0, auto: true }; }
  }
}

function stepTask(w, p, hours) {
  const t = p.task;
  if (!t || p.state !== 'ok') { if (p.state !== 'ok') p.task = null; return; }
  if (t.kind === 'rest') { p.resting = true; return; }
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
          if (p.partial && left > 2 && p.kind === 'party' && !p.task) addLog(w, `${p.name}：これ以上は進めない。`);
          p.goal = null;
        }
      }
    } else {
      moved = steerToward(p, wp.x, wp.z, dt, last && dist < 2 ? 0.5 : 1, mob);
      p.stuck = moved > 0 && p.speed > 0.15 ? 0 : p.stuck + dt;
      if (p.stuck > 1.5 && p.goal) { p.stuck = 0; replan(w, p); }
    }
  } else if (p.kind === 'drifter' && !p.task) {
    if (p.idle > 0) {
      p.idle -= dt;
      p.speed = Math.max(0, p.speed - dt * 3);
      if (p.idle <= 0) pickWander(w, p);
    } else if (p.tx === undefined || Math.hypot(p.tx - p.x, p.tz - p.z) < 0.6) {
      p.idle = w.rng.range(CROWD.idleTime[0], CROWD.idleTime[1]);
      p.tx = undefined;
    } else {
      moved = steerToward(p, p.tx, p.tz, dt, 1, mob);
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
  }
}

function pickWander(w, p) {
  for (let i = 0; i < 6; i++) {
    const a = w.rng.next() * 6.28, r = 6 + w.rng.next() * CROWD.wanderRadius;
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
  giveLimb(w, p) { addItem(p, 'limb_crude', 1); addLog(w, `${p.name}に粗末な義肢を持たせた（検証用）。`); },
};
