// 盗賊団（敵の一団）の発生・巡回・襲撃・略奪・撤収（ロジック層）
import { SQUADS as S, ENEMY_TYPES, FACTION_ACCENT } from '../data/combat.js';
import { ITEMS } from '../data/items.js';
import { walkable } from './pathfind.js';
import { planPath } from './move.js';
import { addItem, effSkill } from './body.js';
import { hostile } from './combat.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function partyCenter(w) {
  const party = w.people.filter((p) => p.kind === 'party' && p.state !== 'dead');
  if (!party.length) return null;
  return { x: party.reduce((a, p) => a + p.x, 0) / party.length, z: party.reduce((a, p) => a + p.z, 0) / party.length, party };
}

// 敵1人を作る（人物の生成は world 側の makePerson を使う）
export function makeEnemy(w, makePerson, typeId, x, z) {
  const T = ENEMY_TYPES[typeId];
  const r = w.rng;
  const p = makePerson(w, 'npc', x, z, T.faction || 'bandit');
  p.enemyType = typeId;
  p.title = T.label;
  for (const k of Object.keys(p.skills)) p.skills[k].lv = Math.max(1, Math.round(r.range(T.skill[0], T.skill[1]) * (0.6 + r.next() * 0.6)));
  p.maxSpeed = 3.0 + r.next() * 0.4;
  for (const [slot, list] of Object.entries(T.gear)) {
    const id = r.pick(list);
    if (!id) continue;
    p.equip[slot] = { id, q: Math.round(r.range(T.q[0], T.q[1])) };
  }
  p.look.hat = false; p.look.pack = false;
  p.money = Math.round(r.range(T.money[0], T.money[1]));
  p.inv = [];
  const food = Math.round(r.range(T.food[0], T.food[1]));
  if (food) addItem(p, 'hardtack', food);
  if (T.bounty) p.bounty = Math.round(r.range(T.bounty[0], T.bounty[1]) / 10) * 10;
  p.look.accent = FACTION_ACCENT[T.faction || 'bandit']; // 陣営の差し色
  p.equipVer = 1;
  return p;
}

function pickMakeup(r) {
  const tot = S.makeup.reduce((a, m) => a + m.w, 0);
  let x = r.next() * tot;
  for (const m of S.makeup) { x -= m.w; if (x <= 0) return m.members; }
  return S.makeup[0].members;
}

function spawnSquad(w, makePerson, center) {
  const r = w.rng;
  for (let tries = 0; tries < 12; tries++) {
    const a = r.next() * Math.PI * 2, d = r.range(S.spawnDist[0], S.spawnDist[1]);
    const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
    if (!walkable(x, z)) continue;
    const sq = { id: w.nextId++, members: [], mode: 'roam', cooldownUntil: 0, wx: x, wz: z, t: 0 };
    for (const [i, type] of pickMakeup(r).entries()) {
      let px = x + (i % 3) * 1.4, pz = z + Math.floor(i / 3) * 1.4;
      if (!walkable(px, pz)) { px = x; pz = z; }
      const e = makeEnemy(w, makePerson, type, px, pz);
      e.squad = sq.id;
      w.people.push(e);
      sq.members.push(e.id);
    }
    w.squads.push(sq);
    return sq;
  }
  return null;
}

// 1秒（ゲーム内の経過秒）ごとに呼ぶ
export function stepSquads(w, makePerson, gsec) {
  w.squadClock = (w.squadClock || 0) + gsec;
  if (w.squadClock < 1) return;
  const dt = w.squadClock; w.squadClock = 0;
  const center = partyCenter(w);
  if (!center) return;

  // 補充（設定でオフにできる）
  w.spawnTimer = (w.spawnTimer || 0) - dt;
  const active = w.squads.filter((s) => s.mode !== 'gone' && !s.kind);
  if (w.banditsOn !== false && w.spawnTimer <= 0 && active.length < S.max) {
    w.spawnTimer = (S.spawnEvery / 24) * w.daySeconds;
    spawnSquad(w, makePerson, center);
  }

  for (const sq of w.squads) {
    if (sq.kind) continue; // 襲撃隊は raids.js が動かす
    const mem = sq.members.map((id) => w.people.find((p) => p.id === id)).filter(Boolean);
    const alive = mem.filter((p) => p.state === 'ok' && !p.bound && !p.carriedBy);
    if (!alive.length) { sq.mode = 'gone'; continue; }
    const lead = alive[0];
    const near = (p, r) => center.party.filter((m) => dist(m, p) < r);
    const ok = (m) => m.state === 'ok' && !m.carriedBy;

    if (sq.mode === 'roam') {
      // 忍び歩き中の仲間は、隠密が高いほど見つかりにくい
      const seen = (a) => center.party.some((m) => ok(m) && dist(a, m) < S.sight * (w.weatherSight ?? 1) * (m.sneak ? 1 - Math.min(0.7, effSkill(m, 'stealth') * 0.015) : 1));
      if (w.banditsOn !== false && w.time > sq.cooldownUntil && alive.some(seen)) {
        sq.mode = 'hunt';
        w.addLogFn?.(`${alive.some((a) => a.enemyType === 'boss') ? '砂鼠団の頭目が率いる一団' : '盗賊の一団'}が襲ってきた！`);
        w.onAlarm?.();
      } else if (!lead.goal) {
        // 一団のまわりをうろつく（一団の方へ少し寄っていく）
        const a = w.rng.next() * Math.PI * 2;
        const bias = 0.25;
        let tx = lead.x + Math.cos(a) * 40 + (center.x - lead.x) * bias, tz = lead.z + Math.sin(a) * 40 + (center.z - lead.z) * bias;
        if (!walkable(tx, tz)) continue;
        alive.forEach((m, i) => { m.maxSpeed = 1.6; planPath(w, m, tx + (i % 3) * 1.5, tz + Math.floor(i / 3) * 1.5, true); });
      }
    }

    if (sq.mode === 'hunt') {
      alive.forEach((m) => { m.squadHunting = true; m.maxSpeed = 3.1; });
      const standing = center.party.filter((m) => ok(m) && alive.some((a) => dist(a, m) < S.giveUp));
      const lost = alive.length < mem.length * 0.4;
      if (lost) {
        retreat(w, sq, alive, center, 1);
        w.addLogFn?.('盗賊たちは逃げていった。');
      } else if (!standing.length) {
        const victims = center.party.filter((m) => m.state !== 'ok' && alive.some((a) => dist(a, m) < 30));
        if (victims.length) rob(w, victims);
        retreat(w, sq, alive, center, victims.length ? S.cooldownHours : 0.5);
      }
    }

    if (sq.mode === 'leave') {
      alive.forEach((m) => { m.squadHunting = false; });
      if (alive.every((m) => dist(m, center) > 120)) sq.mode = 'roam';
      else if (!lead.goal) retreat(w, sq, alive, center, 0);
    }
  }

  // 遠くへ離れた、誰も残っていない一団は片付ける（戦利品を回収できるよう、近くの倒れた敵は残す）
  const far = (p) => dist(p, center) > S.despawnDist;
  for (const sq of w.squads) {
    if (sq.kind) continue;
    const mem = sq.members.map((id) => w.people.find((p) => p.id === id)).filter(Boolean);
    if (mem.every((p) => far(p) && !p.bound && !p.carriedBy)) {
      w.people = w.people.filter((p) => !sq.members.includes(p.id));
      sq.mode = 'removed';
    }
  }
  w.squads = w.squads.filter((s) => s.mode !== 'removed');
}

function retreat(w, sq, alive, center, cooldown) {
  sq.mode = 'leave';
  if (cooldown) sq.cooldownUntil = w.time + (cooldown / 24) * w.daySeconds;
  const lead = alive[0];
  const dx = lead.x - center.x, dz = lead.z - center.z, l = Math.hypot(dx, dz) || 1;
  const tx = lead.x + (dx / l) * 150, tz = lead.z + (dz / l) * 150;
  alive.forEach((m, i) => {
    m.squadHunting = false;
    if (m.fight) { m.fight.target = null; m.fight.act = null; }
    m.maxSpeed = 2.6;
    planPath(w, m, tx + (i % 3) * 1.5, tz + Math.floor(i / 3) * 1.5, true);
  });
}

// 倒れた一団から食料と金を奪う（命までは取らない）
function rob(w, victims) {
  let food = 0;
  for (const v of victims) {
    for (const s of [...v.inv]) if (ITEMS[s.id].food) { food += s.qty; v.inv.splice(v.inv.indexOf(s), 1); }
  }
  const money = Math.floor(w.money * S.stealMoneyRatio);
  w.money -= money;
  w.addLogFn?.(`盗賊たちは食料${food}個と${money}錆貨を奪って去っていった。`);
}

export function isAggressive(p) { return p.faction === 'bandit' && p.squadHunting; }
export { hostile };
