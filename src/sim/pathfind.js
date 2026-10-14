// 地面グリッド上の A* 経路探索（ロジック層）
// ・傾斜を通行コストに反映し、急な崖は通行不可
// ・廃墟の柱や大岩の占有範囲は通行不可
// ・建物の配置/撤去時は invalidateArea() で該当範囲だけ作り直す
import { heightAt, roadDist } from './terrain.js';
import { ROAD } from '../data/world.js';
import { chunkSolids } from './worldgen.js';
import { WORLD, PATH } from '../data/config.js';

const CELL = PATH.cell;
const S = WORLD.chunkSize;
const heightCache = new Map();
const cellCache = new Map();
const chunkBlocked = new Map();
const extraBlocked = new Set(); // 建物など（Phase 5）

const k2 = (ix, iz) => ix + ',' + iz;

function vh(ix, iz) {
  const k = k2(ix, iz);
  let h = heightCache.get(k);
  if (h === undefined) {
    h = heightAt(ix * CELL, iz * CELL);
    heightCache.set(k, h);
    if (heightCache.size > 250000) heightCache.clear();
  }
  return h;
}

function blockedSetForChunk(cx, cz) {
  const k = k2(cx, cz);
  let set = chunkBlocked.get(k);
  if (set) return set;
  set = new Set();
  const { bigRocks, ruins } = chunkSolids(cx, cz);
  const feet = [];
  for (const r of bigRocks) feet.push(r.foot);
  for (const r of ruins) if (r.foot) feet.push(r.foot);
  for (const f of feet) {
    const rad = f.kind === 'circle' ? f.r : Math.hypot(f.hx, f.hz);
    const x0 = Math.floor((f.x - rad) / CELL), x1 = Math.floor((f.x + rad) / CELL);
    const z0 = Math.floor((f.z - rad) / CELL), z1 = Math.floor((f.z + rad) / CELL);
    const c = Math.cos(-f.ry || 0), s = Math.sin(-f.ry || 0);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const px = (ix + 0.5) * CELL - f.x, pz = (iz + 0.5) * CELL - f.z;
      let inside;
      if (f.kind === 'circle') inside = px * px + pz * pz <= f.r * f.r;
      else {
        // Three.js の Y 回転と同じ向きでボックス座標へ変換
        const lx = px * c + pz * s, lz = -px * s + pz * c;
        inside = Math.abs(lx) <= f.hx + CELL * 0.35 && Math.abs(lz) <= f.hz + CELL * 0.35;
      }
      if (inside) set.add(k2(ix, iz));
    }
  }
  chunkBlocked.set(k, set);
  if (chunkBlocked.size > 800) chunkBlocked.delete(chunkBlocked.keys().next().value);
  return set;
}

function solidAt(ix, iz) {
  const k = k2(ix, iz);
  if (extraBlocked.has(k)) return true;
  // 占有範囲はチャンクをまたぐことがあるので周囲のチャンクも見る
  const cx = Math.floor(((ix + 0.5) * CELL) / S), cz = Math.floor(((iz + 0.5) * CELL) / S);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (blockedSetForChunk(cx + dx, cz + dz).has(k)) return true;
  }
  return false;
}

// セル情報：{ blocked, cost }
export function cell(ix, iz) {
  const k = k2(ix, iz);
  let c = cellCache.get(k);
  if (c) return c;
  const h00 = vh(ix, iz), h10 = vh(ix + 1, iz), h01 = vh(ix, iz + 1), h11 = vh(ix + 1, iz + 1);
  const slope = Math.max(Math.abs(h00 - h11), Math.abs(h10 - h01), Math.abs(h00 - h10), Math.abs(h00 - h01), Math.abs(h11 - h10), Math.abs(h11 - h01)) / CELL;
  const blocked = slope > PATH.maxSlope || solidAt(ix, iz);
  // 道の上は歩きやすい（遠くへの移動は自然と道を通る）
  const onRoad = roadDist(cellCenter(ix), cellCenter(iz)) < ROAD.width;
  c = { blocked, cost: (1 + slope * PATH.slopeCost) * (onRoad ? ROAD.pathCost : 1) };
  cellCache.set(k, c);
  if (cellCache.size > 200000) cellCache.clear();
  return c;
}

export const toCell = (v) => Math.floor(v / CELL);
export const cellCenter = (i) => (i + 0.5) * CELL;
export function walkable(x, z) { return !cell(toCell(x), toCell(z)).blocked; }

// 建物の配置・撤去時：範囲内のセルだけ作り直す
export function setBlocked(x0, z0, x1, z1, on) {
  for (let iz = toCell(z0); iz <= toCell(z1); iz++) for (let ix = toCell(x0); ix <= toCell(x1); ix++) {
    const k = k2(ix, iz);
    if (on) extraBlocked.add(k); else extraBlocked.delete(k);
  }
  invalidateArea(x0, z0, x1, z1);
}
export function invalidateArea(x0, z0, x1, z1) {
  for (let iz = toCell(z0) - 1; iz <= toCell(z1) + 1; iz++) for (let ix = toCell(x0) - 1; ix <= toCell(x1) + 1; ix++) cellCache.delete(k2(ix, iz));
}

export function nearestFree(ix, iz, maxR = 8) {
  if (!cell(ix, iz).blocked) return [ix, iz];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (!cell(ix + dx, iz + dz).blocked) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = [ix + dx, iz + dz]; } }
    }
    if (best) return best;
  }
  return null;
}

// ---- 二分ヒープ ----
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a; let i = a.length; a.push(n);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= n.f) break; a[i] = a[p]; i = p; }
    a[i] = n;
  }
  pop() {
    const a = this.a, top = a[0], x = a.pop();
    if (a.length) {
      let i = 0; const n = a.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let c = l;
        if (l >= n) break;
        if (r < n && a[r].f < a[l].f) c = r;
        if (a[c].f >= x.f) break;
        a[i] = a[c]; i = c;
      }
      a[i] = x;
    }
    return top;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// 戻り値：{ points:[{x,z}...], reached:bool }（到達できないときは最も近づける地点まで）
export function findPath(sx, sz, gx, gz, maxNodes = PATH.maxNodes) {
  let s = [toCell(sx), toCell(sz)];
  if (cell(s[0], s[1]).blocked) s = nearestFree(s[0], s[1], 3) || s;
  const g = nearestFree(toCell(gx), toCell(gz), 10);
  if (!g) return null;
  const goalExact = g[0] === toCell(gx) && g[1] === toCell(gz);
  const h = (ix, iz) => { const dx = Math.abs(ix - g[0]), dz = Math.abs(iz - g[1]); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };

  const open = new Heap();
  const nodes = new Map();
  const start = { ix: s[0], iz: s[1], g: 0, f: h(s[0], s[1]), parent: null, closed: false };
  nodes.set(k2(s[0], s[1]), start);
  open.push(start);
  let best = start, bestH = start.f, count = 0, found = null;

  while (open.size) {
    const n = open.pop();
    if (n.closed) continue;
    n.closed = true;
    if (n.ix === g[0] && n.iz === g[1]) { found = n; break; }
    if (++count > maxNodes) break;
    const hn = n.f - n.g;
    if (hn < bestH) { bestH = hn; best = n; }
    for (const [dx, dz, w] of DIRS) {
      const ix = n.ix + dx, iz = n.iz + dz;
      const c = cell(ix, iz);
      if (c.blocked) continue;
      if (dx && dz && (cell(n.ix + dx, n.iz).blocked || cell(n.ix, n.iz + dz).blocked)) continue; // 角抜け禁止
      const ng = n.g + w * c.cost;
      const k = k2(ix, iz);
      let m = nodes.get(k);
      if (m && (m.closed || m.g <= ng)) continue;
      if (!m) { m = { ix, iz, g: 0, f: 0, parent: null, closed: false }; nodes.set(k, m); }
      m.g = ng; m.f = ng + h(ix, iz) * 1.05; m.parent = n;
      open.push(m);
    }
  }
  const end = found || best;
  const cells = [];
  for (let n = end; n; n = n.parent) cells.push([n.ix, n.iz]);
  cells.reverse();
  const pts = smooth(cells).map(([ix, iz]) => ({ x: cellCenter(ix), z: cellCenter(iz) }));
  // 到達できた場合は最後の点を正確な目的地に
  if (found && goalExact && pts.length) { pts[pts.length - 1] = { x: gx, z: gz }; }
  if (pts.length && toCell(sx) === cells[0][0] && toCell(sz) === cells[0][1]) pts.shift();
  return { points: pts, reached: !!found, explored: count };
}

// 見通しが通る点を飛ばして経路をなめらかにする
function lineClear(a, b) {
  let x0 = a[0], z0 = a[1];
  const x1 = b[0], z1 = b[1];
  const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  const baseCost = cell(x0, z0).cost;
  for (;;) {
    const c = cell(x0, z0);
    if (c.blocked || c.cost > baseCost + 1.2) return false;
    if (x0 === x1 && z0 === z1) return true;
    const e2 = err * 2;
    if (e2 > -dz && e2 < dx) { // 斜め移動時は両隣も確認
      if (cell(x0 + sx, z0).blocked || cell(x0, z0 + sz).blocked) return false;
    }
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
}
function smooth(cells) {
  if (cells.length < 3) return cells;
  const out = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineClear(cells[i], cells[j])) j--;
    out.push(cells[j]);
    i = j;
  }
  return out;
}
