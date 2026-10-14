// 町の配置（建物・店の入口・衛兵の巡回点）を決定論的に作る（ロジック層。描画も同じ結果を使う）
import { TOWNS, ROADS, FACTIONS } from '../data/world.js';
import { Rng, hash2 } from '../core/rng.js';
import { setBlocked } from './pathfind.js';
import { townBaseHeight } from './terrain.js';

const TOWN_BY_ID = Object.fromEntries(TOWNS.map((t) => [t.id, t]));
export const townById = (id) => TOWN_BY_ID[id];

const SHOP_SIZE = { general: [9, 8], weapons: [8, 8], armor: [8, 8], bar: [12, 10], police: [10, 9] };
const SIGN = { general: 0xc9a24f, weapons: 0x8f4a32, armor: 0x7b7570, bar: 0xc77a3a, police: 0x3f6f8f };
export const SHOP_SIGN = SIGN;

function overlaps(list, b, gap) {
  return list.some((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + gap && Math.abs(o.z - b.z) < (o.d + b.d) / 2 + gap);
}

// 建物の入口：町の中心を向く面の前
function doorOf(t, b) {
  const dx = t.x - b.x, dz = t.z - b.z;
  if (Math.abs(dx) > Math.abs(dz)) return { x: b.x + Math.sign(dx) * (b.w / 2 + 1.6), z: b.z, face: dx > 0 ? 'e' : 'w' };
  return { x: b.x, z: b.z + Math.sign(dz) * (b.d / 2 + 1.6), face: dz > 0 ? 's' : 'n' };
}

// 道が町に入ってくる方向（城壁の門の位置に使う）
function roadAngles(t) {
  const out = [];
  for (const [a, b] of ROADS) {
    const o = a === t.id ? TOWN_BY_ID[b] : b === t.id ? TOWN_BY_ID[a] : null;
    if (o) out.push(Math.atan2(o.z - t.z, o.x - t.x));
  }
  return out;
}

const layouts = new Map();
export function townLayout(t) {
  if (layouts.has(t.id)) return layouts.get(t.id);
  const r = new Rng(Math.floor(hash2(t.x | 0, t.z | 0, 77) * 2 ** 31));
  const camp = t.kind === 'camp';
  const buildings = [];
  const place = (b, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const a = r.next() * Math.PI * 2;
      const dist = b.ringMin + r.next() * (b.ringMax - b.ringMin);
      const c = { ...b, x: t.x + Math.cos(a) * dist, z: t.z + Math.sin(a) * dist };
      if (Math.hypot(c.x - t.x, c.z - t.z) + Math.max(c.w, c.d) / 2 > t.r - 2) continue;
      if (overlaps(buildings, c, camp ? 2.5 : 3.5)) continue;
      c.door = doorOf(t, c);
      buildings.push(c);
      return c;
    }
    return null;
  };
  // 店（広場の近く）
  for (const s of t.shops) {
    const [w, d] = SHOP_SIZE[s];
    place({ type: 'shop', shop: s, w, d, h: 4.2 + r.next(), ringMin: 13, ringMax: t.r * 0.55, sign: SIGN[s] });
  }
  // 家
  for (let i = 0; i < t.houses; i++) {
    const w = camp ? 4.5 + r.next() * 2 : 6 + r.next() * 5, d = camp ? 4.5 + r.next() * 2 : 6 + r.next() * 4;
    place({ type: camp ? 'tent' : 'house', w, d, h: camp ? 3 : 3.6 + r.next() * 2.4, ringMin: camp ? 8 : 16, ringMax: t.r * 0.85 });
  }
  // 見張り塔
  if (!camp) for (let i = 0; i < 2; i++) place({ type: 'tower', w: 3.5, d: 3.5, h: 9, ringMin: t.r * 0.7, ringMax: t.r * 0.9 });

  // 城壁（都のみ）：四角い壁に、道の来る方向へ門を開ける
  const walls = [];
  if (t.kind === 'capital') {
    const R = t.r - 1, seg = 8, gates = roadAngles(t);
    const gateOpen = (x, z) => gates.some((a) => Math.hypot(x - (t.x + Math.cos(a) * R), z - (t.z + Math.sin(a) * R)) < 9);
    for (let s = -R; s < R; s += seg) {
      const c = s + seg / 2;
      for (const [x, z, w, d] of [[t.x + c, t.z - R, seg, 1.6], [t.x + c, t.z + R, seg, 1.6], [t.x - R, t.z + c, 1.6, seg], [t.x + R, t.z + c, 1.6, seg]]) {
        if (gateOpen(x, z)) continue;
        walls.push({ type: 'wall', x, z, w, d, h: 6.5 });
      }
    }
  }

  // 衛兵の巡回点（広場と町の縁）
  const patrol = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const rr = i % 2 ? t.r * 0.35 : t.r * 0.8;
    patrol.push({ x: t.x + Math.cos(a) * rr, z: t.z + Math.sin(a) * rr });
  }
  const shopDoors = Object.fromEntries(buildings.filter((b) => b.type === 'shop').map((b) => [b.shop, b.door]));
  const out = { town: t, buildings, walls, patrol, shopDoors, base: townBaseHeight(t.id), faction: FACTIONS[t.faction] };
  layouts.set(t.id, out);
  return out;
}

// 建物と城壁を通行不可に（1回だけ）
let blocked = false;
export function ensureTownObstacles(force = false) {
  if (blocked && !force) return;
  blocked = true;
  for (const t of TOWNS) {
    const L = townLayout(t);
    for (const b of [...L.buildings, ...L.walls]) setBlocked(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, true);
  }
}

export function allTowns() { return TOWNS.map((t) => townLayout(t)); }

// いちばん近い町（距離つき）
export function nearestTown(x, z, pred = () => true) {
  let best = null, bd = Infinity;
  for (const t of TOWNS) {
    if (!pred(t)) continue;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < bd) { bd = d; best = t; }
  }
  return best ? { town: best, dist: bd } : null;
}
