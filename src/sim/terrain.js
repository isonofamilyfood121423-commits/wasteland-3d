// 地形の高さ・地域をシード値から決定論的に求める（ロジック層。描画は参照するだけ）
import { makeSimplex, smoothstep, lerp, clamp } from '../core/rng.js';
import { WORLD } from '../data/config.js';
import { TOWNS, ROADS, ROAD } from '../data/world.js';

const nA = makeSimplex(WORLD.seed);
const nB = makeSimplex(WORLD.seed + 101);
const nC = makeSimplex(WORLD.seed + 202);
const nD = makeSimplex(WORLD.seed + 303);

function fbm(n, x, z, oct) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f, z * f);
    norm += a; a *= 0.5; f *= 2.03;
  }
  return s / norm;
}

// 地域タイプ：0=砂原 1=錆の荒地 2=灰の高地（境界は連続値で返す）
export function regionAt(x, z) {
  const r = nD(x / 1400, z / 1400);
  const rust = smoothstep(0.05, 0.35, r);
  const ash = smoothstep(0.05, 0.35, -r);
  return { rust, ash, sand: 1 - Math.max(rust, ash) };
}

function rawHeight(x, z) {
  const reg = fbm(nA, x / 900, z / 900, 3);           // 広域の起伏
  const hills = fbm(nB, x / 170, z / 170, 3) * 13;      // 丘
  let h0 = reg * 30 + hills;

  // 段丘（崖の段差）
  const step = 9;
  const f = h0 / step;
  const fl = Math.floor(f);
  const terr = (fl + smoothstep(0.38, 0.62, f - fl)) * step;
  const ter = regionAt(x, z);
  const terraceMix = 0.35 + 0.5 * ter.rust;            // 錆の荒地ほど段差が強い
  let h = lerp(h0, terr, terraceMix);

  // 台地（メサ）：縁が急な崖になる
  const m = nC(x / 260, z / 260);
  h += smoothstep(0.42, 0.47, m) * 16 * (0.4 + ter.rust * 0.6 + ter.ash * 0.4);

  // 砂丘のさざ波
  const d = 1 - Math.abs(nB(x / 48 + 31, z / 70 - 17));
  h += d * d * 2.2 * ter.sand;

  return clamp(h, -30, WORLD.maxHeight);
}

// なめらかな起伏だけ（道を通すときに使う）
function smoothHeight(x, z) {
  return fbm(nA, x / 900, z / 900, 3) * 30 + fbm(nB, x / 170, z / 170, 2) * 5;
}

// ---- 町と道 ----
const townBase = TOWNS.map((t) => ({ ...t, base: Math.max(rawHeight(t.x, t.z), smoothHeight(t.x, t.z)) }));
const TOWN_BY_ID = Object.fromEntries(townBase.map((t) => [t.id, t]));
const roadSegs = ROADS.map(([a, b]) => ({ a: TOWN_BY_ID[a], b: TOWN_BY_ID[b] }));

// 道までの距離（m）
export function roadDist(x, z) {
  let best = Infinity;
  for (const { a, b } of roadSegs) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// 町の中心からの距離（いちばん近い町）
export function townAt(x, z) {
  for (const t of townBase) if (Math.hypot(x - t.x, z - t.z) < t.r) return t;
  return null;
}
export const townBaseHeight = (id) => TOWN_BY_ID[id]?.base ?? 0;

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  // 道：なめらかな起伏に寄せて、崖を切り通す
  const rd = roadDist(x, z);
  if (rd < ROAD.width + 10) {
    const k = smoothstep(ROAD.width + 10, ROAD.width * 0.5, rd);
    h = lerp(h, smoothHeight(x, z), k);
  }
  // 町：平らにならす
  for (const t of townBase) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r + 30) h = lerp(h, t.base, smoothstep(t.r + 30, t.r - 4, d));
  }
  return h;
}

// 傾斜（0=平坦）
export function slopeAt(x, z) {
  const e = 1.0;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}
