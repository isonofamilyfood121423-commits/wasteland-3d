// 拠点（ロジック層）：建物の配置と建設・倉庫・電力・畑・作業台・研究・防衛塔・檻・寝床・仕事の自動割り当て
import { BUILDINGS, START_BUILDINGS, TECHS, RECIPES, JOBS, BASE } from '../data/build.js';
import { ITEMS } from '../data/items.js';
import { heightAt, townAt, roadDist } from './terrain.js';
import { walkable, setBlocked, invalidateArea, cell, toCell } from './pathfind.js';
import { chunkSolids } from './worldgen.js';
import { WORLD } from '../data/config.js';
import { addItem, removeItem, gainXp, effSkill, loadRatio, damage, countItem } from './body.js';
import { armorFor } from './equip.js';
import { planPath, chase } from './move.js';
import { hostile } from './factions.js';

const G = BASE.grid;
const snap = (v) => Math.round(v / G) * G;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function ensureBase(w) {
  w.base = w.base || { founded: false, x: 0, z: 0, buildings: [], stock: {}, research: { current: null, progress: 0, done: [] }, nextId: 1, queues: { forge: [], armorer: [] } };
  w.base.queues = w.base.queues || { forge: [], armorer: [] };
  return w.base;
}

// ======================= 倉庫 =======================
const skey = (id, q) => (q !== undefined && q !== 1 ? `${id}|${q}` : id);
export const parseKey = (k) => { const [id, q] = k.split('|'); return { id, q: q === undefined ? 1 : +q }; };
export function stockAdd(w, id, qty = 1, q = 1) { const b = ensureBase(w); const k = skey(id, q); b.stock[k] = (b.stock[k] || 0) + qty; }
export function stockCount(w, id) { const b = ensureBase(w); let n = 0; for (const [k, v] of Object.entries(b.stock)) if (parseKey(k).id === id) n += v; return n; }
export function stockTake(w, id, qty = 1, q) {
  const b = ensureBase(w);
  const keys = Object.keys(b.stock).filter((k) => { const pk = parseKey(k); return pk.id === id && (q === undefined || pk.q === q); });
  let need = qty;
  for (const k of keys) { const t = Math.min(need, b.stock[k]); b.stock[k] -= t; need -= t; if (!b.stock[k]) delete b.stock[k]; if (!need) break; }
  return qty - need;
}

// 拠点の中にいる仲間の持ち物も材料に使える
function nearbyParty(w) { const b = ensureBase(w); return w.people.filter((p) => p.kind === 'party' && p.state !== 'dead' && (!b.founded || Math.hypot(p.x - b.x, p.z - b.z) < BASE.radius)); }
export function available(w, id) { return stockCount(w, id) + nearbyParty(w).reduce((a, p) => a + countItem(p, id), 0); }
function consume(w, id, qty) {
  let need = qty - stockTake(w, id, qty);
  for (const p of nearbyParty(w)) { while (need > 0 && removeItem(p, id, 1)) need--; if (!need) break; }
  return need === 0;
}
export function missingFor(w, cost) { return Object.entries(cost).filter(([id, n]) => available(w, id) < n).map(([id, n]) => `${ITEMS[id].label} ${available(w, id)}/${n}`); }

// ======================= 研究と解放 =======================
export function unlocked(w, type) { const t = BUILDINGS[type].tech; return !t || ensureBase(w).research.done.includes(t); }
export function techAvailable(w, id) { const r = ensureBase(w).research; return !r.done.includes(id) && TECHS[id].requires.every((q) => r.done.includes(q)); }
export function buildableTypes(w) { return Object.keys(BUILDINGS).filter((t) => unlocked(w, t) && (START_BUILDINGS.includes(t) || BUILDINGS[t].tech)); }

// ======================= 配置 =======================
export function footprint(type, x, z, rot) {
  const B = BUILDINGS[type];
  const swap = rot % 2 === 1;
  return { x, z, w: swap ? B.d : B.w, d: swap ? B.w : B.d };
}
export function snapPos(type, x, z, rot) {
  const fp = footprint(type, 0, 0, rot);
  // 偶数幅は格子線に、奇数幅は格子の中心に合わせる
  const sx = (fp.w / G) % 2 === 0 ? snap(x) : snap(x - G / 2) + G / 2;
  const sz = (fp.d / G) % 2 === 0 ? snap(z) : snap(z - G / 2) + G / 2;
  return { x: sx, z: sz };
}
function overlapsBuilding(w, type, fp) {
  for (const b of ensureBase(w).buildings) {
    if (b.wallSeg && BUILDINGS[type].wall) { if (Math.hypot(b.x - fp.x, b.z - fp.z) < 1.2) return true; continue; }
    const o = footprint(b.type, b.x, b.z, b.rot);
    if (b.wallSeg) { if (Math.abs(b.x - fp.x) < fp.w / 2 + 0.8 && Math.abs(b.z - fp.z) < fp.d / 2 + 0.8) return true; continue; }
    const hit = Math.abs(o.x - fp.x) < (o.w + fp.w) / 2 - 0.01 && Math.abs(o.z - fp.z) < (o.d + fp.d) / 2 - 0.01;
    if (!hit) continue;
    // 家具は小屋の中に置ける
    if ((b.type === 'hut' && BUILDINGS[type].furniture) || (type === 'hut' && BUILDINGS[b.type].furniture)) continue;
    return true;
  }
  return false;
}
export function oreUnder(x, z) {
  const cx = Math.floor(x / WORLD.chunkSize), cz = Math.floor(z / WORLD.chunkSize);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    for (const n of chunkSolids(cx + dx, cz + dz).nodes) if (Math.hypot(n.x - x, n.z - z) < 2.5) return n;
  }
  return null;
}

export function canPlace(w, type, x, z, rot) {
  const fp = footprint(type, x, z, rot);
  const B = BUILDINGS[type];
  if (townAt(x, z)) return { ok: false, reason: '町の中には建てられません' };
  if (roadDist(x, z) < 4) return { ok: false, reason: '道の上には建てられません' };
  const base = ensureBase(w);
  if (base.founded && Math.hypot(x - base.x, z - base.z) > BASE.radius) return { ok: false, reason: `拠点の範囲（中心から${BASE.radius}m）の外です` };
  if (B.onOre) { if (!oreUnder(x, z)) return { ok: false, reason: '鉱脈の上に建ててください' }; }
  let hmin = Infinity, hmax = -Infinity;
  for (let ix = -fp.w / 2 + 0.5; ix <= fp.w / 2 - 0.5 + 1e-6; ix += 1) for (let iz = -fp.d / 2 + 0.5; iz <= fp.d / 2 - 0.5 + 1e-6; iz += 1) {
    const px = x + ix, pz = z + iz;
    const h = heightAt(px, pz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
    if (!B.onOre && cell(toCell(px), toCell(pz)).blocked) return { ok: false, reason: '岩・崖・建物があります' };
  }
  if (hmax - hmin > BASE.maxSlope) return { ok: false, reason: '地面の傾きが大きすぎます' };
  if (overlapsBuilding(w, type, fp)) return { ok: false, reason: 'ほかの建物と重なっています' };
  return { ok: true, fp, hmin, hmax };
}

function blockRect(b, on) {
  if (b.wallSeg) {
    // 斜めの壁：線に沿って1mごとにふさぐ
    const n = Math.ceil(b.len);
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5;
      const px = b.x + Math.cos(b.angle) * b.len * t, pz = b.z + Math.sin(b.angle) * b.len * t;
      setBlocked(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5, on);
    }
    return;
  }
  const fp = footprint(b.type, b.x, b.z, b.rot);
  setBlocked(fp.x - fp.w / 2 + 0.05, fp.z - fp.d / 2 + 0.05, fp.x + fp.w / 2 - 0.05, fp.z + fp.d / 2 - 0.05, on);
}
function shouldBlock(b) {
  const B = BUILDINGS[b.type];
  if (!B.blocks) return false;
  if (B.gate) return !b.open;
  return true;
}
export function refreshBlocking(w) { for (const b of ensureBase(w).buildings) blockRect(b, shouldBlock(b)); }

export function placeBuilding(w, type, x, z, rot = 0) {
  const base = ensureBase(w);
  const chk = canPlace(w, type, x, z, rot);
  if (!chk.ok) return chk;
  if (!base.founded) { base.founded = true; base.x = x; base.z = z; base.foundedAt = w.time; w.addLogFn?.('ここを拠点にした。'); }
  // 仕様判断：土台は高い側に合わせ、低い側は土台ブロックが地面まで伸びて隙間を埋める
  const b = { id: base.nextId++, type, x, z, rot, done: false, progress: 0, paid: false, open: true, ground: chk.hmax };
  if (BUILDINGS[type].gate) b.open = true;
  if (type === 'farm') b.crop = { stage: 'empty', t: 0 };
  if (BUILDINGS[type].onOre) b.node = oreUnder(x, z)?.type || 'ore';
  base.buildings.push(b);
  blockRect(b, shouldBlock(b));
  return { ok: true, building: b };
}

// 壁：始点から終点まで 2m ごとの区画を並べる（斜めも可）
export function placeWall(w, x0, z0, x1, z1) {
  const base = ensureBase(w);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2));
  const ang = Math.atan2(z1 - z0, x1 - x0);
  const placed = []; let fail = null;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    if (townAt(x, z) || roadDist(x, z) < 4) { fail = '町の中・道の上には建てられません'; continue; }
    if (base.founded && Math.hypot(x - base.x, z - base.z) > BASE.radius) { fail = '拠点の範囲外です'; continue; }
    if (!walkable(x, z)) { fail = '岩や建物がある所は飛ばしました'; continue; }
    if (base.buildings.some((b) => b.wallSeg && Math.hypot(b.x - x, b.z - z) < 1.2)) continue;
    if (!base.founded) { base.founded = true; base.x = x; base.z = z; base.foundedAt = w.time; w.addLogFn?.('ここを拠点にした。'); }
    const b = { id: base.nextId++, type: 'wall', wallSeg: true, x, z, rot: 0, angle: ang, len: len / n, done: false, progress: 0, paid: false, ground: heightAt(x, z) };
    base.buildings.push(b);
    blockRect(b, true);
    placed.push(b);
  }
  return { ok: placed.length > 0, count: placed.length, reason: fail };
}

export function demolish(w, b) {
  const base = ensureBase(w);
  blockRect(b, false);
  base.buildings = base.buildings.filter((o) => o !== b);
  // 建設済みなら材料の半分、未完成で支払い済みなら全部を返す
  if (b.paid) for (const [id, n] of Object.entries(BUILDINGS[b.type].cost)) stockAdd(w, id, b.done ? Math.floor(n / 2) : n);
  for (const p of w.people) if (p.task?.buildingId === b.id) p.task = null;
  refreshBlocking(w);
}

export function toggleGate(w, b) {
  b.open = !b.open;
  blockRect(b, shouldBlock(b));
  invalidateArea(b.x - 3, b.z - 3, b.x + 3, b.z + 3);
}

// 建物のまわりで、人が立って作業できる地点
export function standPoint(b, from) {
  const cands = [];
  if (b.wallSeg) {
    // 壁は線の両側に立つ
    for (const sgn of [1, -1]) for (const r of [1.3, 2]) {
      const x = b.x - Math.sin(b.angle) * r * sgn, z = b.z + Math.cos(b.angle) * r * sgn;
      if (walkable(x, z)) cands.push({ x, z });
    }
    cands.sort((a, c) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(c.x - from.x, c.z - from.z));
    return cands[0] || null;
  }
  const fp = footprint(b.type, b.x, b.z, b.rot);
  const r = 1.1;
  for (const [ox, oz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    const x = fp.x + ox * (fp.w / 2 + r), z = fp.z + oz * (fp.d / 2 + r);
    if (walkable(x, z)) cands.push({ x, z });
  }
  if (!BUILDINGS[b.type].blocks || (BUILDINGS[b.type].gate && b.open)) cands.push({ x: fp.x, z: fp.z });
  cands.sort((a, c) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(c.x - from.x, c.z - from.z));
  return cands[0] || null;
}

// ======================= 電力 =======================
export function powerState(w) {
  let sup = 0, dem = 0;
  for (const b of ensureBase(w).buildings) { if (!b.done) continue; const p = BUILDINGS[b.type].power || 0; if (p > 0) sup += p; else dem -= p; }
  return { supply: sup, demand: dem, ok: sup >= dem };
}

// ======================= 仕事 =======================
export const defaultJobs = () => Object.fromEntries(JOBS.map((j) => [j.id, j.id === 'build' ? 1 : 0]));
const rate = (p, skill) => BASE.workRate * (0.5 + effSkill(p, skill) / 25);
const done = (w, type) => ensureBase(w).buildings.filter((b) => b.done && b.type === type);

function findJob(w, p, job) {
  const base = ensureBase(w);
  const by = (list) => list.sort((a, c) => dist(a, p) - dist(c, p))[0];
  if (job === 'build') {
    const sites = base.buildings.filter((b) => !b.done && !(b.skipUntil > w.time) && (b.paid || !missingFor(w, BUILDINGS[b.type].cost).length) && !w.people.some((o) => o !== p && o.task?.buildingId === b.id && !b.wallSeg));
    const t = by(sites);
    return t && { job, buildingId: t.id };
  }
  if (job === 'mine') {
    if (!done(w, 'storage').length) return null;
    const nodes = [];
    const cx = Math.floor(base.x / WORLD.chunkSize), cz = Math.floor(base.z / WORLD.chunkSize);
    const R = Math.ceil(BASE.radius / WORLD.chunkSize);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) for (const n of chunkSolids(cx + dx, cz + dz).nodes) if (Math.hypot(n.x - base.x, n.z - base.z) < BASE.radius && !(base.skipNodes?.[`${Math.round(n.x)},${Math.round(n.z)}`] > w.time) && !base.buildings.some((b) => b.type === 'mine' && Math.hypot(b.x - n.x, b.z - n.z) < 2.5)) nodes.push(n);
    // 鉄鉱石を優先するのは、石材が足りているとき
    const want = stockCount(w, 'stone') > 30 ? 'ore' : null;
    const pick = by(nodes.filter((n) => !want || n.type === want)) || by(nodes);
    return pick && { job, node: { x: pick.x, z: pick.z, type: pick.type } };
  }
  if (job === 'farm') {
    const farms = done(w, 'farm').filter((b) => !(b.skipUntil > w.time) && (b.crop.stage === 'empty' || b.crop.stage === 'ripe') && !w.people.some((o) => o !== p && o.task?.buildingId === b.id));
    const t = by(farms);
    return t && { job, buildingId: t.id };
  }
  if (job === 'cook' || job === 'craft') {
    const types = job === 'cook' ? ['cookstove'] : ['smelter', 'forge', 'armorer'];
    const benches = base.buildings.filter((b) => b.done && !(b.skipUntil > w.time) && types.includes(b.type) && !w.people.some((o) => o !== p && o.task?.buildingId === b.id) && (b.current || nextRecipe(w, b)));
    const t = by(benches);
    return t && { job, buildingId: t.id };
  }
  if (job === 'research') {
    if (!base.research.current) return null;
    const t = by(done(w, 'research').filter((b) => !w.people.some((o) => o !== p && o.task?.buildingId === b.id)));
    return t && { job, buildingId: t.id };
  }
  return null;
}

function nextRecipe(w, b) {
  const list = RECIPES[b.type] || [];
  // 武器・防具は予約したものだけ作る。精錬・調理は材料があれば自動
  const q = ensureBase(w).queues?.[b.type];
  const queue = b.type === 'forge' || b.type === 'armorer' ? (q || []).map((id) => list.find((r) => r.id === id)).filter(Boolean) : list;
  return queue.find((r) => Object.entries(r.in).every(([id, n]) => stockCount(w, id) >= n)) || null;
}

// 手が空いている仲間に仕事を割り当てる（1秒ごと）
function assignWork(w) {
  const base = ensureBase(w);
  if (!base.founded) return;
  for (const p of w.people) {
    if (p.kind !== 'party' || p.state !== 'ok' || p.task || p.goal || p.path.length || p.fight?.target || p.carrying || p.retreat || p.jailUntil || p.bound) continue;
    if (Math.hypot(p.x - base.x, p.z - base.z) > BASE.radius) continue;
    p.jobs = p.jobs || defaultJobs();
    let found = null;
    for (const level of [1, 2, 3]) {
      for (const j of JOBS) if (p.jobs[j.id] === level) { found = findJob(w, p, j.id); if (found) break; }
      if (found) break;
    }
    if (found) p.task = { kind: 'work', ...found, phase: 'go', t: 0, carried: 0 };
  }
}

// 仕事を進める。戻り値 true＝この人の移動は仕事が制御した
export function stepWork(w, p, dt) {
  const t = p.task;
  if (!t || t.kind !== 'work') { p.working = false; return false; }
  const base = ensureBase(w);
  const b = t.buildingId ? base.buildings.find((x) => x.id === t.buildingId) : null;
  // 近づく。たどり着けない・時間がかかりすぎるときは、その仕事をしばらく後回しにする
  t.age = (t.age || 0) + dt;
  const giveUp = () => { if (b) b.skipUntil = w.time + 40; if (t.node) (base.skipNodes = base.skipNodes || {})[`${Math.round(t.node.x)},${Math.round(t.node.z)}`] = w.time + 60; p.task = null; p.path = []; p.goal = null; };
  const goTo = (pt) => {
    if (Math.hypot(pt.x - p.x, pt.z - p.z) > 1.3) {
      chase(w, p, pt.x, pt.z);
      if (!p.goal || t.age > 45) { giveUp(); }
      return true;
    }
    p.path = []; p.goal = null; return false;
  };
  const face = (x, z) => { p.heading = Math.atan2(x - p.x, z - p.z); };
  p.working = false;

  if (t.job === 'mine') {
    if (t.phase === 'haul') {
      const st = done(w, 'storage').sort((a, c) => dist(a, p) - dist(c, p))[0];
      if (!st) { p.task = null; return false; }
      const ssp = standPoint(st, p);
      if (!ssp) { p.task = null; return false; }
      if (goTo(ssp)) return true;
      for (const id of ['stone', 'iron_ore']) { const n = countItem(p, id); if (n) { removeItem(p, id, n); stockAdd(w, id, n); } }
      p.task = null;
      return true;
    }
    const n = t.node;
    const sp = { x: n.x + Math.sign(p.x - n.x || 1) * 1.9, z: n.z + Math.sign(p.z - n.z || 1) * 0.6 };
    if (Math.hypot(n.x - p.x, n.z - p.z) > 2.8) { if (!p.goal) planPath(w, p, sp.x, sp.z, true); if (!p.goal || t.age > 60) giveUp(); return true; }
    p.path = []; p.goal = null; face(n.x, n.z); p.working = 'mine';
    t.t += dt;
    if (t.t >= BASE.mineTime / (0.6 + effSkill(p, 'labor') / 30)) {
      t.t = 0;
      addItem(p, n.type === 'ore' ? 'iron_ore' : 'stone', 1);
      gainXp(w, p, 'labor', 2); gainXp(w, p, 'str', 0.5);
      t.carried++;
      if (t.carried >= BASE.mineCarry || loadRatio(p) > 0.95) t.phase = 'haul';
    }
    return true;
  }

  if (!b) { p.task = null; return false; }
  const sp = standPoint(b, p);
  if (!sp) { giveUp(); return true; }
  if (goTo(sp)) return true;
  face(b.x, b.z);
  p.working = t.job;

  if (t.job === 'build') {
    if (b.done) { p.task = null; return true; }
    if (!b.paid) {
      const cost = BUILDINGS[b.type].cost;
      if (missingFor(w, cost).length) { p.task = null; return true; }
      for (const [id, n] of Object.entries(cost)) consume(w, id, n);
      b.paid = true;
    }
    b.progress += rate(p, 'labor') * dt;
    gainXp(w, p, 'labor', 0.25 * dt);
    if (b.progress >= BUILDINGS[b.type].work) {
      b.done = true; b.progress = BUILDINGS[b.type].work;
      w.events?.push({ kind: 'built', x: b.x, z: b.z, fx: b.x, fz: b.z });
      if (!b.wallSeg) w.addLogFn?.(`${BUILDINGS[b.type].label}が完成した。`);
      p.task = null;
    }
    return true;
  }
  if (t.job === 'farm') {
    t.t += rate(p, 'farm') * dt;
    gainXp(w, p, 'farm', 0.3 * dt);
    if (t.t >= 6) {
      if (b.crop.stage === 'empty') { b.crop.stage = 'growing'; b.crop.t = 0; }
      else if (b.crop.stage === 'ripe') {
        const n = Math.round(BASE.farmYield * (1 + effSkill(p, 'farm') / 50));
        stockAdd(w, 'grain', n); b.crop.stage = 'empty';
        w.addLogFn?.(`${p.name}が穀物を${n}収穫した。`, true);
      }
      p.task = null;
    }
    return true;
  }
  if (t.job === 'cook' || t.job === 'craft') {
    if (!b.current) {
      const r = nextRecipe(w, b);
      if (!r) { p.task = null; return true; }
      for (const [id, n] of Object.entries(r.in)) stockTake(w, id, n);
      b.current = r.id; b.work = 0;
      const q = base.queues?.[b.type];
      if (q && (b.type === 'forge' || b.type === 'armorer')) q.splice(q.indexOf(r.id), 1);
    }
    const r = (RECIPES[b.type] || []).find((x) => x.id === b.current);
    if (!r) { b.current = null; p.task = null; return true; }
    b.work = (b.work || 0) + rate(p, r.skill) * dt;
    gainXp(w, p, r.skill, 0.3 * dt);
    if (b.work >= r.work) {
      const q = r.quality ? craftQuality(w, p) : 1;
      stockAdd(w, r.out, 1, q);
      w.addLogFn?.(`${p.name}が${ITEMS[r.out].label}${r.quality ? `（${['粗悪', '普通', '上質', '逸品'][q]}）` : ''}を作った。`, true);
      b.current = null; b.work = 0;
      p.task = null;
    }
    return true;
  }
  if (t.job === 'research') {
    const r = base.research;
    if (!r.current) { p.task = null; return true; }
    const pw = powerState(w).ok && powerState(w).supply > 0 ? BASE.researchPowerMul : 1;
    r.progress += BASE.researchPerSec * (1 + effSkill(p, 'research') / 10) * pw * dt;
    gainXp(w, p, 'research', 0.3 * dt);
    if (r.progress >= TECHS[r.current].cost) {
      r.done.push(r.current);
      w.addLogFn?.(`研究「${TECHS[r.current].label}」が完了した！`);
      r.current = null; r.progress = 0;
      p.task = null;
    }
    // ときどき休憩を挟む（ほかの仕事に回れるように）
    t.t += dt; if (t.t > 30) p.task = null;
    return true;
  }
  p.task = null;
  return false;
}

function craftQuality(w, p) {
  const lvl = effSkill(p, 'smith') + (ensureBase(w).research.done.includes('mastery') ? 12 : 0);
  const x = Math.random();
  if (lvl < 10) return x < 0.6 ? 0 : 1;
  if (lvl < 25) return x < 0.2 ? 0 : x < 0.85 ? 1 : 2;
  if (lvl < 45) return x < 0.6 ? 1 : x < 0.95 ? 2 : 3;
  return x < 0.3 ? 1 : x < 0.8 ? 2 : 3;
}

// ======================= 時間で進むもの（1秒ごと） =======================
export function stepBase(w, gsec) {
  const base = ensureBase(w);
  if (!base.founded) return;
  w.baseClock = (w.baseClock || 0) + gsec;
  if (w.baseClock < 1) return;
  const dt = w.baseClock; w.baseClock = 0;
  const hours = (dt / w.daySeconds) * 24;
  const pw = powerState(w);
  const wells = done(w, 'well');
  for (const b of base.buildings) {
    if (!b.done) continue;
    if (b.type === 'farm' && b.crop.stage === 'growing') {
      const wet = wells.some((wl) => dist(wl, b) < 30);
      b.crop.t += hours / 24 / (BASE.farmGrowDays * (wet ? 0.5 : 1));
      if (b.crop.t >= 1) b.crop.stage = 'ripe';
    }
    if (b.type === 'mine' && pw.ok) {
      b.acc = (b.acc || 0) + BASE.mineAutoPerHour * hours;
      while (b.acc >= 1) { b.acc -= 1; stockAdd(w, b.node === 'stone' ? 'stone' : 'iron_ore', 1); }
    }
    if (b.type === 'tower') {
      b.cd = (b.cd || 0) - dt;
      if (b.cd <= 0) {
        const foe = w.people.find((o) => o.state === 'ok' && !o.bound && !o.carriedBy && o.kind !== 'party' && hostile(o, { faction: 'player', state: 'ok', id: -1 }) && Math.hypot(o.x - b.x, o.z - b.z) < BASE.towerRange);
        if (foe) {
          b.cd = BASE.towerInterval;
          w.events?.push({ kind: 'arrow', x: foe.x, z: foe.z, fx: b.x, fz: b.z, fy: 6 });
          const parts = ['chest', 'stomach', 'armL', 'armR', 'legL', 'legR', 'head'];
          const part = parts[Math.floor(Math.random() * parts.length)];
          let dmg = BASE.towerDamage * (0.85 + Math.random() * 0.3);
          for (const ar of armorFor(foe, part)) if (Math.random() < ar.cover) dmg *= 1 - ar.cut;
          damage(w, foe, part, dmg, { cut: true });
          w.events?.push({ kind: 'hit', x: foe.x, z: foe.z, fx: b.x, fz: b.z });
        }
      }
    }
  }
  // 拠点にいる空腹の仲間は倉庫の食料を取る
  for (const p of w.people) {
    if (p.kind !== 'party' || p.state === 'dead' || Math.hypot(p.x - base.x, p.z - base.z) > BASE.radius) continue;
    if (p.hunger < 170 && !p.inv.some((s) => ITEMS[s.id].food)) {
      const food = Object.keys(base.stock).map(parseKey).find((k) => ITEMS[k.id]?.food);
      if (food && stockTake(w, food.id, 1)) addItem(p, food.id, 1);
    }
  }
  assignWork(w);
}

// ======================= 寝床・檻 =======================
export function freeBed(w, p) {
  const base = ensureBase(w);
  if (!base.founded || Math.hypot(p.x - base.x, p.z - base.z) > BASE.radius) return null;
  return done(w, 'bed').filter((b) => !w.people.some((o) => o !== p && (o.inBed === b.id || o.task?.bed === b.id))).sort((a, c) => dist(a, p) - dist(c, p))[0] || null;
}

export function cagePrisoner(w, carrier, cage) {
  const t = w.people.find((o) => o.id === carrier.carrying);
  if (!t) return false;
  carrier.carrying = null; t.carriedBy = null;
  t.x = cage.x; t.z = cage.z; t.caged = cage.id; t.bound = true;
  w.addLogFn?.(`${t.name}を檻に入れた。`);
  return true;
}
export function releaseCage(w, cage) {
  const t = w.people.find((o) => o.caged === cage.id);
  if (!t) return null;
  t.caged = null;
  const sp = standPoint(cage, t); t.x = sp.x; t.z = sp.z;
  return t;
}

export { BUILDINGS, TECHS, RECIPES, JOBS, BASE };
