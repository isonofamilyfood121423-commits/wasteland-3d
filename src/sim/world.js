// ゲームロジックの状態（地面平面 x,z 上のシミュレーション）。描画には依存しない
import { Rng } from '../core/rng.js';
import { slopeAt } from './terrain.js';
import { findSpawn } from './worldgen.js';
import { findPath, walkable } from './pathfind.js';
import { TIME, CROWD, PALETTE, PARTY, NAMES } from '../data/config.js';

function makeLook(r, party) {
  return {
    skin: Math.floor(r.next() * PALETTE.skin.length),
    cloth: Math.floor(r.next() * PALETTE.cloth.length),
    pants: Math.floor(r.next() * PALETTE.cloth.length),
    hat: party ? r.next() < 0.6 : r.next() < 0.45,
    pack: party ? true : r.next() < 0.35,
    height: 0.92 + r.next() * 0.16,
    bulk: 0.9 + r.next() * 0.25,
    accent: party ? PARTY.clothColor : null,
  };
}

function makePerson(w, kind, x, z) {
  const r = w.rng;
  const p = {
    id: w.nextId++,
    kind,
    name: r.pick(NAMES.first),
    surname: r.pick(NAMES.last),
    x, z, heading: r.next() * 6.28,
    speed: 0,
    maxSpeed: kind === 'party' ? PARTY.runSpeed : r.range(CROWD.walkSpeed[0], CROWD.walkSpeed[1]),
    phase: r.next() * 6.28,
    path: [],
    goal: null,
    stuck: 0,
    replans: 0,
    homeX: x, homeZ: z,
    idle: r.next() * 3,
    look: makeLook(r, kind === 'party'),
  };
  return p;
}

export function createWorld(seed) {
  const w = {
    seed,
    rng: new Rng(seed),
    nextId: 1,
    spawn: findSpawn(),
    hour: TIME.startHour,
    day: 1,
    timeScale: 1,      // 0=一時停止
    debugFast: false,
    money: PARTY.startMoney,
    people: [],
    log: [],
  };
  const sp = w.spawn;
  // プレイヤーの一団：廃墟の少し外側に寄り添って立つ
  for (let i = 0; i < PARTY.size; i++) {
    let x = sp.x + 14 + i * 1.6, z = sp.z + 10 + (i % 2) * 1.2;
    for (let t = 0; t < 20 && !walkable(x, z); t++) { x += 2; }
    w.people.push(makePerson(w, 'party', x, z));
  }
  // 流れ者（世界側の人々。Phase 4 で派閥に所属させる）
  for (let i = 0; i < CROWD.count; i++) {
    const a = w.rng.next() * 6.28, r = Math.sqrt(w.rng.next()) * CROWD.spawnRadius + 8;
    let x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
    if (!walkable(x, z)) { x += 4; z += 4; }
    w.people.push(makePerson(w, 'drifter', x, z));
  }
  addLog(w, 'あなたの一団は廃墟のそばで目を覚ました。');
  return w;
}

export function partyOf(w) { return w.people.filter((p) => p.kind === 'party'); }
export function personById(w, id) { return w.people.find((p) => p.id === id); }

export function addLog(w, text) {
  w.log.push({ day: w.day, hour: w.hour, text });
  if (w.log.length > 80) w.log.shift();
  w.onLog?.(text);
}

// ---- 移動指示 ----
// 複数人へ同じ地点を指示したときは、円形に少しずらして並ばせる
export function orderMove(w, ids, gx, gz) {
  const n = ids.length;
  ids.forEach((id, i) => {
    const p = personById(w, id);
    if (!p) return;
    let tx = gx, tz = gz;
    if (n > 1) {
      const ring = i === 0 ? 0 : Math.ceil(i / 6);
      const a = (i / Math.min(6, n - 1)) * Math.PI * 2;
      tx += Math.cos(a) * ring * PARTY.formationGap;
      tz += Math.sin(a) * ring * PARTY.formationGap;
    }
    planPath(w, p, tx, tz);
  });
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
    if (p.kind === 'party' && Math.hypot(p.goal.x - p.x, p.goal.z - p.z) > 2) addLog(w, `${p.name}：そこへは行けない。`);
    p.path = []; p.goal = null;
    return;
  }
  p.path = res.points;
  p.partial = !res.reached;
}

export function stopPerson(p) { p.path = []; p.goal = null; }

// dt: 現実の経過秒
export function stepWorld(w, dt) {
  const scale = w.timeScale * (w.debugFast ? TIME.debugFastForward : 1);
  if (scale <= 0) return;
  const gdt = dt * scale;

  w.hour += (gdt / TIME.realSecondsPerDay) * 24;
  while (w.hour >= 24) { w.hour -= 24; w.day++; }

  const sub = Math.min(20, Math.max(1, Math.ceil(gdt / 0.1)));
  const h = gdt / sub;
  for (let s = 0; s < sub; s++) {
    for (const p of w.people) stepPerson(w, p, h);
    separate(w.people, h);
  }
}

function steerToward(p, tx, tz, dt, speedMul = 1) {
  const dx = tx - p.x, dz = tz - p.z;
  const want = Math.atan2(dx, dz);
  let d = want - p.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  p.heading += Math.max(-dt * 6, Math.min(dt * 6, d));
  // 斜面では速度を落とす（経路コストと同じ考え方）
  const slow = 1 / (1 + slopeAt(p.x, p.z) * 1.2);
  const target = p.maxSpeed * slow * speedMul * (Math.abs(d) > 1.3 ? 0.25 : 1);
  p.speed += (target - p.speed) * Math.min(1, dt * 4);
  const nx = p.x + Math.sin(p.heading) * p.speed * dt;
  const nz = p.z + Math.cos(p.heading) * p.speed * dt;
  // 通行不可マスには入らない（片方の軸だけでも動けるなら滑らせる）
  if (walkable(nx, nz)) { p.x = nx; p.z = nz; return true; }
  if (walkable(nx, p.z)) { p.x = nx; return true; }
  if (walkable(p.x, nz)) { p.z = nz; return true; }
  p.speed *= 0.5;
  return false;
}

function stepPerson(w, p, dt) {
  if (p.path.length) {
    const wp = p.path[0];
    const dist = Math.hypot(wp.x - p.x, wp.z - p.z);
    const last = p.path.length === 1;
    if (dist < (last ? 0.35 : 0.9)) {
      p.path.shift();
      if (!p.path.length && p.goal) {
        const left = Math.hypot(p.goal.x - p.x, p.goal.z - p.z);
        // 遠い目的地：到達できた所から再探索（進めなくなったら諦める）
        if (p.partial && left > 2 && p.replans < 30 && left < p.lastPlanDist - 1) {
          p.replans++; p.lastPlanDist = left; replan(w, p);
        } else {
          if (p.partial && left > 2 && p.kind === 'party') addLog(w, `${p.name}：これ以上は進めない。`);
          p.goal = null;
        }
      }
    } else {
      const ok = steerToward(p, wp.x, wp.z, dt, last && dist < 2 ? 0.5 : 1);
      p.stuck = ok && p.speed > 0.2 ? 0 : p.stuck + dt;
      if (p.stuck > 1.5 && p.goal) { p.stuck = 0; replan(w, p); }
    }
  } else if (p.kind === 'drifter') {
    if (p.idle > 0) {
      p.idle -= dt;
      p.speed = Math.max(0, p.speed - dt * 3);
      if (p.idle <= 0) pickWander(w, p);
    } else if (p.tx === undefined || Math.hypot(p.tx - p.x, p.tz - p.z) < 0.6) {
      p.idle = w.rng.range(CROWD.idleTime[0], CROWD.idleTime[1]);
      p.tx = undefined;
    } else if (!steerToward(p, p.tx, p.tz, dt)) {
      p.tx = undefined; p.idle = 0.5;
    }
  } else {
    p.speed = Math.max(0, p.speed - dt * 6);
  }
  p.phase += p.speed * dt * (p.speed > 2.2 ? 2.4 : 3.2);
}

function pickWander(w, p) {
  for (let i = 0; i < 6; i++) {
    const a = w.rng.next() * 6.28, r = 6 + w.rng.next() * CROWD.wanderRadius;
    const x = p.homeX + Math.cos(a) * r, z = p.homeZ + Math.sin(a) * r;
    if (walkable(x, z)) { p.tx = x; p.tz = z; return; }
  }
  p.tx = p.homeX; p.tz = p.homeZ;
}

// 人同士が重ならないよう押し離す
function separate(people, dt) {
  const R = 0.7;
  for (let i = 0; i < people.length; i++) {
    const a = people[i];
    for (let j = i + 1; j < people.length; j++) {
      const b = people[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d >= R) continue;
      const push = (R - d) * 0.5 * Math.min(1, dt * 8);
      const ux = dx / d, uz = dz / d;
      // 止まっている側を優先して動かす（歩いている人が押しのける）
      const wa = a.speed > b.speed ? 0.3 : 0.7;
      const ax = a.x - ux * push * wa * 2, az = a.z - uz * push * wa * 2;
      const bx = b.x + ux * push * (1 - wa) * 2, bz = b.z + uz * push * (1 - wa) * 2;
      if (walkable(ax, az)) { a.x = ax; a.z = az; }
      if (walkable(bx, bz)) { b.x = bx; b.z = bz; }
    }
  }
}
