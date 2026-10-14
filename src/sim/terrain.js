// 地形の高さ・地域をシード値から決定論的に求める（ロジック層。描画は参照するだけ）
import { makeSimplex, smoothstep, lerp, clamp } from '../core/rng.js';
import { WORLD } from '../data/config.js';

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

export function heightAt(x, z) {
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

// 傾斜（0=平坦）
export function slopeAt(x, z) {
  const e = 1.0;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}
