// 拠点への襲撃（ロジック層）：予告 → 出現 → 進軍 → 壁・門を壊す → 戦う → 略奪して撤収
import { RAID, RAID_FREQ, BUILDING_HP } from '../data/events.js';
import { BUILDINGS } from '../data/build.js';
import { ITEMS } from '../data/items.js';
import { walkable } from './pathfind.js';
import { planPath } from './move.js';
import { makeEnemy } from './squads.js';
import { hostile } from './factions.js';
import { ensureBase, demolish, parseKey, stockTake } from './base.js';

const H = (w, hours) => (hours / 24) * w.daySeconds;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function raidFreq(w) { return RAID_FREQ[w.raidFreq || 'normal'] ? (w.raidFreq || 'normal') : 'normal'; }
export function baseScore(w) {
  const base = ensureBase(w);
  return base.founded ? base.buildings.filter((b) => b.done).length : 0;
}

// 次の襲撃の時刻を決める（頻度の設定と拠点の規模から）
function schedule(w, fromNow = true) {
  const f = RAID_FREQ[raidFreq(w)];
  if (!isFinite(f.days)) { w.raid = { next: Infinity }; return; }
  const days = f.days * (0.7 + w.rng.next() * 0.6);
  w.raid = { next: (fromNow ? w.time : 0) + H(w, days * 24) };
}

export function ensureRaid(w) {
  if (!w.raid || w.raid.next === null || w.raid.next === undefined) {
    w.raid = { next: Infinity };
  }
  return w.raid;
}

// 設定が変わったときに予定を立て直す
export function resetRaidSchedule(w) {
  const r = ensureRaid(w);
  if (r.active) return;
  schedule(w);
  r.notice = false;
}

function pickKind(w) {
  const list = RAID.kinds.filter((k) => !k.cond || (k.cond === 'hostile' && hostile({ faction: k.faction, state: 'ok' }, { faction: 'player', state: 'ok' })));
  const tot = list.reduce((a, k) => a + k.w, 0);
  let x = w.rng.next() * tot;
  for (const k of list) { x -= k.w; if (x <= 0) return k; }
  return list[0];
}

// 1秒ごと
export function stepRaids(w, makePerson, gsec) {
  w.raidClock = (w.raidClock || 0) + gsec;
  if (w.raidClock < 1) return;
  w.raidClock = 0;
  cleanupRaids(w);
  const r = ensureRaid(w);
  const base = ensureBase(w);
  if (r.active) { stepActive(w, r); return; }
  if (!base.founded || raidFreq(w) === 'off') { r.next = Infinity; r.notice = false; return; }
  if (!isFinite(r.next)) {
    // 拠点ができて、ある程度育ったら予定を立てる
    if (baseScore(w) >= RAID.minBuildings) {
      schedule(w);
      r.next = Math.max(r.next, (base.foundedAt || 0) + H(w, RAID.firstDelayDays * 24));
    }
    return;
  }
  if (baseScore(w) < RAID.minBuildings) return;
  // 予告
  if (!r.notice && w.time >= r.next - H(w, RAID.noticeHours)) {
    const k = pickKind(w);
    r.notice = true; r.kind = k.id;
    w.addLogFn?.(`【襲撃の予告】${k.label}が拠点へ向かっているという知らせが届いた。およそ${RAID.noticeHours}時間後に着く。`);
    w.onRaid?.('notice', k);
  }
  if (w.time >= r.next) begin(w, r, makePerson);
}

// 去った襲撃隊を片付ける（倒れた者・縛られた者は残す）
function cleanupRaids(w) {
  const party = w.people.filter((p) => p.kind === 'party' && p.state !== 'dead');
  for (const sq of w.squads) {
    if (sq.kind !== 'raidLeft') continue;
    const mem = sq.members.map((id) => w.people.find((p) => p.id === id)).filter(Boolean);
    const gone = mem.filter((m) => m.state === 'ok' && !m.bound && !m.carriedBy && !m.caged && party.every((p) => dist(p, m) > 300));
    const rest = mem.filter((m) => !gone.includes(m) && m.state !== 'dead');
    if (gone.length) w.people = w.people.filter((p) => !gone.includes(p));
    if (!rest.some((m) => m.state === 'ok' && !m.bound)) { sq.members = rest.map((m) => m.id); if (!sq.members.length || rest.every((m) => m.state !== 'ok' || m.bound)) sq.mode = 'removed'; }
  }
  w.squads = w.squads.filter((s) => s.mode !== 'removed');
}

export function raidCountdownHours(w) {
  const r = ensureRaid(w);
  if (r.active || !r.notice || !isFinite(r.next)) return null;
  return Math.max(0, ((r.next - w.time) / w.daySeconds) * 24);
}

// 襲撃を始める（検証用に直接呼ぶこともできる）
export function begin(w, r, makePerson, kindId) {
  const base = ensureBase(w);
  r = r || ensureRaid(w);
  const k = RAID.kinds.find((x) => x.id === (kindId || r.kind)) || pickKind(w);
  const n = Math.min(RAID.maxSize, RAID.baseSize + Math.floor(baseScore(w) / RAID.perBuildings));
  // 出現位置：拠点から離れた歩ける場所
  let sx = null, sz = null;
  for (let t = 0; t < 24; t++) {
    const a = w.rng.next() * Math.PI * 2;
    const x = base.x + Math.cos(a) * RAID.spawnDist, z = base.z + Math.sin(a) * RAID.spawnDist;
    if (walkable(x, z)) { sx = x; sz = z; break; }
  }
  if (sx === null) { schedule(w); r.notice = false; return null; }
  const sq = { id: w.nextId++, kind: 'raid', raidKind: k.id, members: [], mode: 'march', t: 0, start: w.time };
  for (let i = 0; i < n; i++) {
    let px = sx + (i % 4) * 1.5, pz = sz + Math.floor(i / 4) * 1.5;
    if (!walkable(px, pz)) { px = sx; pz = sz; }
    const e = makeEnemy(w, makePerson, k.members[i % k.members.length], px, pz);
    e.squad = sq.id; e.raider = true; e.squadHunting = false;
    if (k.faction !== 'bandit') e.bounty = e.bounty || 0;
    w.people.push(e);
    sq.members.push(e.id);
  }
  w.squads.push(sq);
  r.active = sq.id; r.notice = false; r.kind = k.id; r.label = k.label;
  w.addLogFn?.(`${k.label}（${n}人）が拠点に攻めてきた！`);
  w.onRaid?.('start', k);
  w.onAlarm?.();
  return sq;
}

function stepActive(w, r) {
  const sq = w.squads.find((s) => s.id === r.active);
  const base = ensureBase(w);
  if (!sq) { finish(w, r); return; }
  const mem = sq.members.map((id) => w.people.find((p) => p.id === id)).filter(Boolean);
  const alive = mem.filter((p) => p.state === 'ok' && !p.bound && !p.carriedBy);
  if (!alive.length || alive.length < mem.length * RAID.giveUpRatio) {
    if (sq.mode !== 'leave') { w.addLogFn?.('襲撃隊は退いていった！拠点を守りきった。'); w.onRaid?.('repelled'); }
    leave(w, sq, alive, base);
    finish(w, r);
    return;
  }
  const defenders = w.people.filter((p) => p.kind === 'party' && p.state === 'ok' && !p.carriedBy && dist(p, base) < 120);
  const inBase = alive.filter((p) => dist(p, base) < 70);
  if (sq.mode === 'march') {
    // 拠点へ向かう。見つけた守り手とは戦う
    if (inBase.length || alive.some((a) => defenders.some((d) => dist(a, d) < 30))) sq.mode = 'attack';
    for (const m of alive) {
      if (m.siege) continue;
      if (!m.goal && !m.fight?.target) {
        planPath(w, m, base.x + (w.rng.next() - 0.5) * 10, base.z + (w.rng.next() - 0.5) * 10, true);
        if (m.partial || !m.goal) trySiege(w, m, base);
      }
    }
  }
  if (sq.mode === 'attack') {
    alive.forEach((m) => { m.squadHunting = true; m.maxSpeed = 3.0; });
    // 守り手がいなければ倉庫をあさって引き上げる
    const standing = defenders.filter((d) => dist(d, base) < 100);
    if (!standing.length) {
      plunder(w, base, r);
      leave(w, sq, alive, base);
      finish(w, r);
      return;
    }
    for (const m of alive) {
      // 壁にはばまれたら壊しにかかる
      if (!m.fight?.target && !m.siege && (m.partial || !m.goal) && dist(m, base) > 12) {
        const tgt = standing.sort((a, b) => dist(a, m) - dist(b, m))[0];
        planPath(w, m, tgt.x, tgt.z, true);
        if (m.partial || !m.goal) trySiege(w, m, base);
      }
    }
  }
  // 壁・門を壊す
  for (const m of alive) {
    if (!m.siege) continue;
    const b = base.buildings.find((x) => x.id === m.siege);
    if (!b) { m.siege = null; continue; }
    if (m.fight?.target) { m.siege = null; continue; } // 戦いを優先
    if (dist(m, b) > 4.5) { if (!m.goal) planPath(w, m, b.x, b.z, true); if (dist(m, b) > 8) continue; }
    m.path = []; m.goal = null;
    m.heading = Math.atan2(b.x - m.x, b.z - m.z);
    if (m.fight) { m.fight.swing = 0.28; m.fight.swingType = 'blunt'; }
    b.hp = (b.hp ?? BUILDING_HP[b.type] ?? 100) - RAID.siegeDps;
    w.events?.push({ kind: 'siege', x: b.x, z: b.z, fx: m.x, fz: m.z });
    if (b.hp <= 0) {
      w.addLogFn?.(`${BUILDINGS[b.type].label}が壊された！`);
      b.paid = false; // 材料は戻らない
      demolish(w, b);
      for (const o of alive) if (o.siege === b.id) o.siege = null;
      w.events?.push({ kind: 'collapse', x: b.x, z: b.z, fx: b.x, fz: b.z });
    }
  }
  if (w.time - sq.start > H(w, RAID.timeoutHours)) {
    w.addLogFn?.('襲撃隊はあきらめて引き上げていった。');
    leave(w, sq, alive, base);
    finish(w, r);
  }
}

// 近くの壊せる建物（壁・門・塔）を狙う
function trySiege(w, m, base) {
  let best = null, bd = 14;
  for (const b of base.buildings) {
    if (!b.done || !(b.type in BUILDING_HP)) continue;
    const d = dist(m, b);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) {
    // 遠い場合は、拠点にいちばん近い壁を目指す
    best = base.buildings.filter((b) => b.done && b.type in BUILDING_HP).sort((a, b) => dist(a, m) - dist(b, m))[0];
  }
  if (best) { m.siege = best.id; best.hp = best.hp ?? BUILDING_HP[best.type]; }
}

function plunder(w, base, r) {
  const took = [];
  for (const key of Object.keys(base.stock)) {
    const k = parseKey(key);
    const have = base.stock[key];
    const n = Math.floor(have * RAID.lootRatio);
    if (n > 0 && stockTake(w, k.id, n, k.q)) took.push(`${ITEMS[k.id].label}${n}`);
  }
  const money = Math.floor(w.money * RAID.moneyRatio);
  w.money -= money;
  w.addLogFn?.(`${r.label || '襲撃隊'}は拠点をあさって去っていった。奪われた物：${took.slice(0, 5).join('・') || 'なし'}${took.length > 5 ? 'ほか' : ''}／${money}錆貨`);
  w.onRaid?.('plundered');
}

function leave(w, sq, alive, base) {
  sq.mode = 'leave';
  for (const m of alive) {
    m.squadHunting = false; m.siege = null; m.raider = false;
    if (m.fight) { m.fight.target = null; m.fight.act = null; }
    const dx = m.x - base.x, dz = m.z - base.z, l = Math.hypot(dx, dz) || 1;
    planPath(w, m, m.x + (dx / l) * 200, m.z + (dz / l) * 200, true);
  }
  // 去っていく襲撃隊は、一団から十分離れたら片付ける（cleanupRaids）
  sq.kind = 'raidLeft';
}

function finish(w, r) {
  r.active = null;
  schedule(w);
}
