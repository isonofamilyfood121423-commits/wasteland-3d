// 廃墟の探索（ロジック層）：遺物の箱を調べて、遺物（研究素材）や道具を見つける
import { RUIN } from '../data/events.js';
import { ITEMS } from '../data/items.js';
import { WORLD } from '../data/config.js';
import { chunkSolids } from './worldgen.js';
import { planPath, clearTask } from './move.js';
import { addItem, gainXp, armsUsable } from './body.js';
import { Rng, hash2 } from '../core/rng.js';

const S = WORLD.chunkSize;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function ensureRuins(w) { w.ruins = w.ruins || {}; return w.ruins; }
export const cacheState = (w, key) => ensureRuins(w)[key] || 0; // 0＝未発見 1＝発見 2＝調べた

// 位置のまわりの遺物の箱
export function cachesNear(x, z, r) {
  const out = [];
  const c0x = Math.floor((x - r) / S), c1x = Math.floor((x + r) / S);
  const c0z = Math.floor((z - r) / S), c1z = Math.floor((z + r) / S);
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
    const c = chunkSolids(cx, cz).cache;
    if (c && Math.hypot(c.x - x, c.z - z) < r) out.push(c);
  }
  return out;
}
export function cacheByKey(key) {
  const [cx, cz] = key.split(',').map(Number);
  return chunkSolids(cx, cz).cache;
}

// 調べるよう指示する
export function orderSearch(w, p, cache) {
  if (p.state !== 'ok') return false;
  if (!armsUsable(p)) { w.addLogFn?.(`${p.name}は腕が使えず、調べられない。`); return false; }
  if (cacheState(w, cache.key) === 2) { w.addLogFn?.('この箱はもう空だ。'); return false; }
  clearTask(p);
  p.task = { kind: 'search', key: cache.key, t: 0 };
  planPath(w, p, cache.x, cache.z, true);
  return true;
}

// 調べる作業を進める（戻り値 true＝この人の動きは作業が決めた）
export function stepSearch(w, p, hours) {
  const t = p.task;
  if (!t || t.kind !== 'search') return false;
  const c = cacheByKey(t.key);
  if (!c || cacheState(w, t.key) === 2) { p.task = null; return false; }
  if (dist(p, c) > 2.6) {
    if (!p.goal) {
      planPath(w, p, c.x, c.z, true);
      if (!p.goal || (p.partial && dist(p, c) > 3)) { if (!p.goal || !p.path.length) { w.addLogFn?.(`${p.name}：箱のところまで行けない。`); p.task = null; } }
    }
    return false;
  }
  p.path = []; p.goal = null; p.speed = 0;
  p.heading = Math.atan2(c.x - p.x, c.z - p.z);
  p.working = 'farm'; // しゃがんで箱をあさる
  t.t += hours;
  if (t.t < RUIN.searchHours) return true;
  p.task = null;
  loot(w, p, c);
  return true;
}

function loot(w, p, c) {
  ensureRuins(w)[c.key] = 2;
  const r = new Rng(Math.floor(hash2(c.x | 0, c.z | 0, WORLD.seed + 77) * 2 ** 31));
  const tot = RUIN.loot.reduce((a, l) => a + l.w, 0);
  const n = RUIN.rolls[0] + Math.floor(r.next() * (RUIN.rolls[1] - RUIN.rolls[0] + 1));
  const got = {};
  for (let i = 0; i < n; i++) {
    let x = r.next() * tot;
    const l = RUIN.loot.find((e) => (x -= e.w) <= 0) || RUIN.loot[0];
    const qty = l.qty[0] + Math.floor(r.next() * (l.qty[1] - l.qty[0] + 1));
    const q = l.q ? l.q[0] + Math.floor(r.next() * (l.q[1] - l.q[0] + 1)) : undefined;
    addItem(p, l.id, qty, q);
    got[l.id] = (got[l.id] || 0) + qty;
  }
  const money = Math.round(RUIN.money[0] + r.next() * (RUIN.money[1] - RUIN.money[0]));
  w.money += money;
  gainXp(w, p, 'research', 6);
  w.addLogFn?.(`${p.name}が廃墟の箱を調べた：${Object.entries(got).map(([id, n]) => `${ITEMS[id].label}×${n}`).join('・')}・${money}錆貨`);
  w.onFound?.();
}

// 近くの廃墟を地図に載せる（1秒ごと）
export function stepRuins(w, gsec) {
  w.ruinClock = (w.ruinClock || 0) + gsec;
  if (w.ruinClock < 1) return;
  w.ruinClock = 0;
  const R = ensureRuins(w);
  for (const p of w.people) {
    if (p.kind !== 'party' || p.state === 'dead') continue;
    for (const c of cachesNear(p.x, p.z, RUIN.seeDist)) {
      if (!R[c.key]) { R[c.key] = 1; w.addLogFn?.('廃墟を見つけた。中に古い箱がある。（長押しで「調べる」）', false); }
    }
  }
}
