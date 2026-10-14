// 隊商と巡回部隊（ロジック層）
// ・遠くにいる間は道（町と町を結ぶ直線）の上の位置だけを進める（抽象的な移動）
// ・一団やカメラに近づくと人物を出して詳しく動かし、離れたら人物をしまって抽象的な移動に戻す
import { TRAFFIC } from '../data/events.js';
import { TOWNS, ROADS, ROLES } from '../data/world.js';
import { walkable } from './pathfind.js';
import { planPath } from './move.js';
import { addItem } from './body.js';

const TOWN = Object.fromEntries(TOWNS.map((t) => [t.id, t]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SAFE = (id) => TOWN[id].faction === 'merchant' || TOWN[id].faction === 'holy';
// 隊商・巡回が通る道（盗賊や人食いの巣へ向かう道は通らない）
const SAFE_ROADS = ROADS.map((r, i) => ({ i, a: r[0], b: r[1] })).filter((r) => SAFE(r.a) && SAFE(r.b));

function segOf(t) {
  const r = ROADS[t.road];
  const from = TOWN[t.dir > 0 ? r[0] : r[1]], to = TOWN[t.dir > 0 ? r[1] : r[0]];
  const len = dist(from, to);
  return { from, to, len, ux: (to.x - from.x) / len, uz: (to.z - from.z) / len, start: from.r + 8, end: len - to.r - 8 };
}
export function trafficPos(t) {
  const g = segOf(t);
  return { x: g.from.x + g.ux * t.s, z: g.from.z + g.uz * t.s };
}

function newEntry(w, kind) {
  const r = w.rng.pick(SAFE_ROADS);
  const t = { id: w.nextId++, kind, road: r.i, dir: w.rng.next() < 0.5 ? 1 : -1, s: 0, members: null };
  const g = segOf(t);
  t.s = g.start + w.rng.next() * (g.end - g.start);
  const ends = [TOWN[r.a], TOWN[r.b]];
  t.faction = kind === 'caravan' ? 'merchant' : (ends.find((x) => x.faction === 'holy') ? 'holy' : 'merchant');
  return t;
}

// 町に着いたら、そこから出ている別の道へ進む（行き止まりなら引き返す）
function nextRoad(w, t) {
  const g = segOf(t);
  const here = g.to.id;
  const opts = SAFE_ROADS.filter((r) => r.i !== t.road && (r.a === here || r.b === here));
  if (opts.length) {
    const r = w.rng.pick(opts);
    t.road = r.i; t.dir = r.a === here ? 1 : -1;
  } else t.dir = -t.dir;
  t.s = segOf(t).start;
}

function anchors(w) {
  const a = w.people.filter((p) => p.kind === 'party' && p.state !== 'dead').map((p) => ({ x: p.x, z: p.z }));
  if (w.focus) a.push({ x: w.focus.x, z: w.focus.z });
  return a;
}

// ---- 人物を出す・しまう ----
function spawnPeople(w, t, mk) {
  const g = segOf(t);
  const pos = trafficPos(t);
  const list = [];
  const town = g.to;
  const at = (i) => {
    // 道の後ろ側へ一列に並べる
    let x = pos.x - g.ux * i * 1.8 + (i % 2 ? 0.9 : -0.9) * g.uz, z = pos.z - g.uz * i * 1.8 - (i % 2 ? 0.9 : -0.9) * g.ux;
    if (!walkable(x, z)) { x = pos.x; z = pos.z; }
    return [x, z];
  };
  const add = (role, i) => {
    const [x, z] = at(i);
    const base = role === 'escort' ? 'guard' : role;
    const p = mk(w, { ...town, faction: t.faction }, base, x, z);
    p.role = role; p.town = role === 'trader' ? town.id : null; p.station = null;
    p.title = role === 'escort' ? (t.kind === 'caravan' ? '隊商の護衛' : ROLES.guard[t.faction].label.replace('衛兵', '巡回兵').replace('用心棒', '巡回兵')) : ROLES[role].label;
    p.traffic = t.id;
    p.maxSpeed = 1.6;
    p.heading = Math.atan2(g.ux, g.uz);
    if (role === 'porter') { p.look.pack = true; p.equip.back = { id: 'backpack', q: 1 }; p.equipVer = (p.equipVer || 0) + 1; addItem(p, 'trade_salt', 3); }
    w.people.push(p);
    list.push(p.id);
  };
  if (t.kind === 'caravan') {
    const C = TRAFFIC.caravan;
    const ne = C.escorts[0] + Math.floor(w.rng.next() * (C.escorts[1] - C.escorts[0] + 1));
    const np = C.porters[0] + Math.floor(w.rng.next() * (C.porters[1] - C.porters[0] + 1));
    let i = 0;
    add('escort', i++);
    add('trader', i++);
    for (let k = 0; k < np; k++) add('porter', i++);
    for (let k = 1; k < ne; k++) add('escort', i++);
  } else {
    const P = TRAFFIC.patrol;
    const n = P.size[0] + Math.floor(w.rng.next() * (P.size[1] - P.size[0] + 1));
    for (let i = 0; i < n; i++) add('escort', i);
  }
  t.members = list;
}

function hidePeople(w, t, alive) {
  w.people = w.people.filter((p) => !alive.includes(p));
  t.members = null;
}

// 1秒ごと
export function stepTraffic(w, makeTownPerson, gsec) {
  w.trafficClock = (w.trafficClock || 0) + gsec;
  if (w.trafficClock < 1) return;
  const dt = w.trafficClock; w.trafficClock = 0;
  if (!SAFE_ROADS.length) return;
  w.traffic = w.traffic || [];
  // 数を保つ（いなくなった分は、どこかの道に新しく現れる）
  const count = (k) => w.traffic.filter((t) => t.kind === k).length;
  while (count('caravan') < TRAFFIC.caravans) w.traffic.push(newEntry(w, 'caravan'));
  while (count('patrol') < TRAFFIC.patrols) w.traffic.push(newEntry(w, 'patrol'));
  const an = anchors(w);
  const near = (pos, d) => an.some((a) => Math.abs(a.x - pos.x) < d && Math.abs(a.z - pos.z) < d && dist(a, pos) < d);

  for (const t of w.traffic) {
    const g = segOf(t);
    if (!t.members) {
      // 抽象的な移動
      t.s += TRAFFIC.speed * dt;
      if (t.s >= g.end) nextRoad(w, t);
      const pos = trafficPos(t);
      if (near(pos, TRAFFIC.showDist)) spawnPeople(w, t, makeTownPerson);
      continue;
    }
    const mem = t.members.map((id) => w.people.find((p) => p.id === id)).filter(Boolean);
    const alive = mem.filter((p) => p.state === 'ok' && !p.bound && !p.carriedBy && !p.caged && p.kind !== 'party');
    if (!alive.length) {
      // 全滅・捕縛された：この隊はいなくなる（倒れた人はその場に残る）
      t.members = []; t.dead = true;
      continue;
    }
    // 離れたらしまう
    if (alive.every((p) => !near(p, TRAFFIC.hideDist))) {
      const lead = alive[0];
      t.s = Math.max(g.start, Math.min(g.end, (lead.x - g.from.x) * g.ux + (lead.z - g.from.z) * g.uz));
      hidePeople(w, t, alive);
      t.members = null;
      continue;
    }
    // 先頭が道の先を目指し、ほかの者は先頭についていく
    const fighting = alive.some((p) => p.fight?.target);
    const lead = alive.find((p) => p.role === 'escort') || alive[0];
    const s = (lead.x - g.from.x) * g.ux + (lead.z - g.from.z) * g.uz;
    t.s = Math.max(g.start, Math.min(g.end, s));
    if (t.s >= g.end - 2) { nextRoad(w, t); continue; }
    if (fighting) continue;
    // 話しかけられている者がいれば、隊ごと立ち止まる
    const held = Math.max(...alive.map((p) => p.holdUntil || 0));
    if (held > w.time) { for (const p of alive) p.holdUntil = held; continue; }
    if (!lead.goal) {
      const ts = Math.min(g.end, t.s + TRAFFIC.leadAhead);
      const x = g.from.x + g.ux * ts, z = g.from.z + g.uz * ts;
      if (walkable(x, z)) planPath(w, lead, x, z, true);
    }
    alive.forEach((p, i) => {
      if (p === lead || p.fight?.target) return;
      const back = (i + 1) * 1.8, side = i % 2 ? 0.9 : -0.9;
      const fx = lead.x - Math.sin(lead.heading) * back + side * Math.cos(lead.heading);
      const fz = lead.z - Math.cos(lead.heading) * back - side * Math.sin(lead.heading);
      if (dist(p, { x: fx, z: fz }) > 2.5 && (!p.goal || dist(p.goal, { x: fx, z: fz }) > 4)) planPath(w, p, fx, fz, true);
    });
  }
  w.traffic = w.traffic.filter((t) => !t.dead);
}

// 地図に描く用：位置と種類
export function trafficMarks(w) {
  return (w.traffic || []).map((t) => {
    if (t.members?.length) {
      const p = t.members.map((id) => w.people.find((q) => q.id === id)).find((q) => q && q.state === 'ok');
      if (p) return { x: p.x, z: p.z, kind: t.kind, faction: t.faction };
    }
    return { ...trafficPos(t), kind: t.kind, faction: t.faction };
  });
}
