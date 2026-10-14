// チャンクごとの配置物（岩・草・遺構）を決定論的に生成する（ロジック層）
// 後のフェーズで当たり判定・経路探索・遺跡探索がこのデータを参照する
import { hash2, mulberry32 } from '../core/rng.js';
import { heightAt, slopeAt, regionAt } from './terrain.js';
import { WORLD } from '../data/config.js';

const cache = new Map();

export function chunkKey(cx, cz) { return cx + ',' + cz; }

export function chunkProps(cx, cz, density) {
  const key = chunkKey(cx, cz) + '|' + density.rockPerChunk + '|' + density.grassPerChunk;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = WORLD.chunkSize;
  const ox = cx * S, oz = cz * S;
  const rnd = mulberry32(Math.floor(hash2(cx, cz, WORLD.seed) * 2 ** 31));
  const rocks = [], grass = [], ruins = [];

  for (let i = 0; i < density.rockPerChunk; i++) {
    const x = ox + rnd() * S, z = oz + rnd() * S;
    const sl = slopeAt(x, z);
    if (rnd() > 0.35 + sl * 0.8) continue; // 斜面ほど岩が多い
    const big = rnd() < 0.12;
    const s = big ? 2.5 + rnd() * 3 : 0.4 + rnd() * 1.2;
    rocks.push({ x, z, y: heightAt(x, z) - s * 0.25, s, sy: 0.5 + rnd() * 0.7, ry: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.5, tone: rnd() });
  }

  for (let i = 0; i < density.grassPerChunk; i++) {
    const x = ox + rnd() * S, z = oz + rnd() * S;
    const reg = regionAt(x, z);
    if (slopeAt(x, z) > 0.5) continue;
    if (rnd() > 0.25 + reg.sand * 0.4) continue;
    grass.push({ x, z, y: heightAt(x, z), s: 0.35 + rnd() * 0.5, ry: rnd() * 6.28 });
  }

  // 小規模な廃墟（約12%のチャンク）
  if (isRuinChunk(cx, cz)) {
    const px = ox + S * (0.3 + rnd() * 0.4), pz = oz + S * (0.3 + rnd() * 0.4);
    const baseY = heightAt(px, pz);
    const rot = rnd() * 6.28;
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * 6.28;
      const r = 5 + rnd() * 4;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      const h = 3 + rnd() * 8;
      ruins.push({ x, z, y: heightAt(x, z) - 0.5 + h / 2, sx: 1.2 + rnd() * 0.8, sy: h, sz: 1.2 + rnd() * 0.8, ry: a, rx: (rnd() - 0.5) * 0.25, rz: (rnd() - 0.5) * 0.25, rust: rnd() < 0.4 });
    }
    // 崩れた梁
    ruins.push({ x: px, z: pz, y: baseY + 0.6, sx: 9 + rnd() * 4, sy: 0.9, sz: 1.3, ry: rot + 0.6, rx: 0.08, rz: 0.12, rust: true });
    // 瓦礫
    for (let i = 0; i < 6; i++) {
      const x = px + (rnd() - 0.5) * 14, z = pz + (rnd() - 0.5) * 14;
      const s = 0.6 + rnd() * 1.4;
      ruins.push({ x, z, y: heightAt(x, z) + s * 0.2, sx: s, sy: s * 0.6, sz: s * 1.2, ry: rnd() * 6.28, rx: rnd() * 0.6, rz: rnd() * 0.6, rust: rnd() < 0.3 });
    }
  }

  const out = { rocks, grass, ruins };
  cache.set(key, out);
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return out;
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
    if (!isRuinChunk(cx, cz)) continue;
    const d = cx * cx + cz * cz;
    if (d < bd) { bd = d; best = { cx, cz }; }
  }
  const S = WORLD.chunkSize;
  return best ? { x: (best.cx + 0.5) * S, z: (best.cz + 0.5) * S } : { x: 0, z: 0 };
}
