// チャンクごとの配置物（岩・草・遺構）を決定論的に生成する（ロジック層）
// 後のフェーズで当たり判定・経路探索・遺跡探索がこのデータを参照する
import { hash2, mulberry32 } from '../core/rng.js';
import { heightAt, slopeAt, regionAt, roadDist } from './terrain.js';
import { TOWNS } from '../data/world.js';

// 町の中と道の上には岩や廃墟を置かない
const clearSpot = (x, z, pad = 12) => roadDist(x, z) > 6 && !TOWNS.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + pad);
import { WORLD } from '../data/config.js';

const solidCache = new Map();
const decorCache = new Map();

export function chunkKey(cx, cz) { return cx + ',' + cz; }

// ---- 当たり判定に関わる配置物（画質に依存しない。経路探索・当たり判定が参照） ----
// 各要素は描画用の姿勢と、地面平面上の占有形状 foot（box: 中心・半幅・回転 / circle: 半径）を持つ
export function chunkSolids(cx, cz) {
  const key = chunkKey(cx, cz);
  const hit = solidCache.get(key);
  if (hit) return hit;
  const S = WORLD.chunkSize;
  const ox = cx * S, oz = cz * S;
  const rnd = mulberry32(Math.floor(hash2(cx, cz, WORLD.seed + 11) * 2 ** 31));
  const bigRocks = [], ruins = [];
  let cache = null;

  // 大岩（斜面に多い）
  for (let i = 0; i < 4; i++) {
    const x = ox + rnd() * S, z = oz + rnd() * S;
    const sl = slopeAt(x, z);
    const roll = rnd();
    if (roll > 0.08 + sl * 0.35 || !clearSpot(x, z)) continue;
    const s = 2.2 + rnd() * 3;
    bigRocks.push({ x, z, y: heightAt(x, z) - s * 0.25, s, sy: 0.5 + rnd() * 0.6, ry: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.4, tone: rnd(), foot: { kind: 'circle', x, z, r: s * 0.85 } });
  }

  // 小規模な廃墟（約12%のチャンク）
  if (isRuinChunk(cx, cz) && clearSpot(ox + S / 2, oz + S / 2, 50)) {
    const px = ox + S * (0.3 + rnd() * 0.4), pz = oz + S * (0.3 + rnd() * 0.4);
    const baseY = heightAt(px, pz);
    const rot = rnd() * 6.28;
    const n = 3 + Math.floor(rnd() * 4);
    const box = (o) => { o.foot = { kind: 'box', x: o.x, z: o.z, hx: o.sx / 2 + 0.2, hz: o.sz / 2 + 0.2, ry: o.ry }; ruins.push(o); };
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * 6.28;
      const r = 5 + rnd() * 4;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      const h = 3 + rnd() * 8;
      box({ x, z, y: heightAt(x, z) - 0.5 + h / 2, sx: 1.2 + rnd() * 0.8, sy: h, sz: 1.2 + rnd() * 0.8, ry: a, rx: (rnd() - 0.5) * 0.25, rz: (rnd() - 0.5) * 0.25, rust: rnd() < 0.4 });
    }
    // 遺物の箱（Phase 6）：梁の脇に置く。調べると遺物が見つかる
    {
      const cr = mulberry32(Math.floor(hash2(cx, cz, WORLD.seed + 31) * 2 ** 31));
      // 梁の横方向（ボックスの z 軸＝Three.js の Y 回転で (sin, cos)）へずらす
      const sg = cr() < 0.5 ? 1 : -1, ry = rot + 0.6;
      const x = px + Math.sin(ry) * 2.6 * sg, z = pz + Math.cos(ry) * 2.6 * sg;
      cache = { key: chunkKey(cx, cz), x, z, y: heightAt(x, z), ry: rot + 0.6 };
    }
    // 崩れた梁
    box({ x: px, z: pz, y: baseY + 0.6, sx: 9 + rnd() * 4, sy: 0.9, sz: 1.3, ry: rot + 0.6, rx: 0.08, rz: 0.12, rust: true });
    // 瓦礫（小さいものは通り抜けられる）
    for (let i = 0; i < 6; i++) {
      const x = px + (rnd() - 0.5) * 14, z = pz + (rnd() - 0.5) * 14;
      const s = 0.6 + rnd() * 1.4;
      const o = { x, z, y: heightAt(x, z) + s * 0.2, sx: s, sy: s * 0.6, sz: s * 1.2, ry: rnd() * 6.28, rx: rnd() * 0.6, rz: rnd() * 0.6, rust: rnd() < 0.3 };
      if (s > 1.3) box(o); else ruins.push(o);
    }
  }
  // 資源の鉱脈・石切り場（Phase 5）：錆の荒地ほど鉄鉱石が多い。掘っても尽きない
  const nodes = [];
  const nr = mulberry32(Math.floor(hash2(cx, cz, WORLD.seed + 23) * 2 ** 31));
  for (let i = 0; i < 2; i++) {
    const x = ox + 6 + nr() * (S - 12), z = oz + 6 + nr() * (S - 12);
    const reg = regionAt(x, z);
    const roll = nr();
    if (roll > 0.28 || !clearSpot(x, z, 20) || slopeAt(x, z) > 0.5) continue;
    const type = nr() < 0.25 + reg.rust * 0.5 ? 'ore' : 'stone';
    nodes.push({ type, x, z, y: heightAt(x, z), s: 1.6 + nr() * 0.6, ry: nr() * 6.28, foot: { kind: 'circle', x, z, r: 1.4 } });
  }
  const out = { bigRocks, ruins, nodes, cache };
  solidCache.set(key, out);
  if (solidCache.size > 600) solidCache.delete(solidCache.keys().next().value);
  return out;
}

// ---- 見た目だけの小物（画質で密度が変わる。当たり判定なし） ----
function chunkDecor(cx, cz, density) {
  const key = chunkKey(cx, cz) + '|' + density.rockPerChunk + '|' + density.grassPerChunk;
  const hit = decorCache.get(key);
  if (hit) return hit;
  const S = WORLD.chunkSize;
  const ox = cx * S, oz = cz * S;
  const rnd = mulberry32(Math.floor(hash2(cx, cz, WORLD.seed) * 2 ** 31));
  const rocks = [], grass = [];
  for (let i = 0; i < density.rockPerChunk; i++) {
    const x = ox + rnd() * S, z = oz + rnd() * S;
    const sl = slopeAt(x, z);
    if (rnd() > 0.35 + sl * 0.8 || !clearSpot(x, z, 2)) continue;
    const s = 0.3 + rnd() * 0.9;
    rocks.push({ x, z, y: heightAt(x, z) - s * 0.25, s, sy: 0.5 + rnd() * 0.7, ry: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.5, tone: rnd() });
  }
  for (let i = 0; i < density.grassPerChunk; i++) {
    const x = ox + rnd() * S, z = oz + rnd() * S;
    const reg = regionAt(x, z);
    if (slopeAt(x, z) > 0.5) continue;
    if (rnd() > 0.25 + reg.sand * 0.4) continue;
    grass.push({ x, z, y: heightAt(x, z), s: 0.35 + rnd() * 0.5, ry: rnd() * 6.28 });
  }
  const out = { rocks, grass };
  decorCache.set(key, out);
  if (decorCache.size > 400) decorCache.delete(decorCache.keys().next().value);
  return out;
}

// 描画用：当たり判定のある物＋小物をまとめて返す
export function chunkProps(cx, cz, density) {
  const sol = chunkSolids(cx, cz);
  const dec = chunkDecor(cx, cz, density);
  const nodes = sol.nodes.map((n) => ({ x: n.x, z: n.z, y: n.y - 0.3, s: n.s, sy: 0.8, ry: n.ry, tilt: 0.1, tone: 0.5, nodeType: n.type }));
  return { rocks: sol.bigRocks.concat(dec.rocks, nodes), grass: dec.grass, ruins: sol.ruins };
}

// 地平線のシルエットを作る巨大遺構（常時表示）
export function landmarks() {
  const rnd = mulberry32(WORLD.seed * 7 + 3);
  const list = [];
  const kinds = ['ring', 'tower', 'ribs', 'ring', 'tower', 'ribs', 'slab'];
  for (let i = 0; i < kinds.length; i++) {
    const a = (i / kinds.length) * 6.28 + rnd() * 0.5;
    const r = 420 + rnd() * 700;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    list.push({ kind: kinds[i], x, z, y: heightAt(x, z), scale: 0.8 + rnd() * 0.7, ry: rnd() * 6.28 });
  }
  return list;
}

export function isRuinChunk(cx, cz) { return hash2(cx, cz, WORLD.seed + 7) < 0.12; }

// 開始地点：原点に最も近い廃墟チャンクの中心（最初の画面に見どころを入れる）
// 仕様判断：Phase 4 で町が実装されたら、開始地点は町の近くへ変更する
export function findSpawn() {
  let best = null, bd = Infinity;
  for (let cz = -8; cz <= 8; cz++) for (let cx = -8; cx <= 8; cx++) {
    if (!isRuinChunk(cx, cz) || !clearSpot((cx + 0.5) * WORLD.chunkSize, (cz + 0.5) * WORLD.chunkSize, 50)) continue;
    const d = cx * cx + cz * cz;
    if (d < bd) { bd = d; best = { cx, cz }; }
  }
  const S = WORLD.chunkSize;
  return best ? { x: (best.cx + 0.5) * S, z: (best.cz + 0.5) * S } : { x: 0, z: 0 };
}
