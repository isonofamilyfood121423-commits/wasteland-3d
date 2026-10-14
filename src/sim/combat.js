// 戦闘（ロジック層）：敵対関係・攻撃/防御/回避の判定・部位ダメージ・退却・担ぐ・縛る
import { COMBAT as C } from '../data/combat.js';
import { GROWTH } from '../data/body.js';
import { damage, gainXp, effSkill, armsUsable, lv } from './body.js';
import { weaponOf, armorFor } from './equip.js';
import { walkable } from './pathfind.js';
import { planPath, chase, clearTask } from './move.js';

export function newFight() { return { target: null, cd: 0, act: null, ordered: false, lastHitBy: null, lastHitT: -99 }; }

// ======================= 敵対関係 =======================
const FACTION_HOSTILE = { bandit: { player: true } };
export function hostile(a, b) {
  if (a === b || a.state === 'dead' || b.state === 'dead') return false;
  if (FACTION_HOSTILE[a.faction]?.[b.faction] || FACTION_HOSTILE[b.faction]?.[a.faction]) return true;
  return !!(a.angryAt?.includes(b.faction) || b.angryAt?.includes(a.faction));
}
export const canFight = (p) => p.state === 'ok' && !p.bound && !p.carrying && armsUsable(p);
const valid = (t) => t && t.state === 'ok' && !t.bound && !t.carriedBy;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ======================= 指示 =======================
export function orderAttack(w, attackers, target) {
  for (const p of attackers) {
    if (p.state !== 'ok' || p === target) continue;
    clearTask(p);
    p.retreat = false;
    p.fight.target = target.id;
    p.fight.ordered = true;
    p.path = []; p.goal = null;
  }
  // 中立の相手を攻撃すると、その相手はこちらの陣営を敵とみなす
  if (!hostile(attackers[0], target) && target.faction !== attackers[0].faction) {
    target.angryAt = [...new Set([...(target.angryAt || []), attackers[0].faction])];
  }
}

export function orderRetreat(w, people) {
  for (const p of people) {
    if (p.state !== 'ok') continue;
    const foes = w.people.filter((o) => hostile(p, o) && o.state === 'ok' && dist(p, o) < 45);
    let dx = 0, dz = 0;
    for (const f of foes) { dx += p.x - f.x; dz += p.z - f.z; }
    if (!foes.length) { dx = Math.sin(p.heading + Math.PI); dz = Math.cos(p.heading + Math.PI); }
    const l = Math.hypot(dx, dz) || 1;
    let tx = p.x + (dx / l) * C.retreatDistance, tz = p.z + (dz / l) * C.retreatDistance;
    for (let i = 0; i < 8 && !walkable(tx, tz); i++) { tx += (Math.random() - 0.5) * 12; tz += (Math.random() - 0.5) * 12; }
    clearTask(p);
    p.fight.target = null; p.fight.ordered = false; p.fight.act = null;
    p.retreat = true;
    planPath(w, p, tx, tz, true);
  }
}

// 担ぐ・縛る・解放する：対象のそばへ行ってから行う作業として登録
export function orderCarry(w, p, target) {
  if (p.state !== 'ok' || target === p) return false;
  if (target.state === 'ok' && !target.bound) { w.addLogFn?.(`${target.name}は自分で歩ける。`); return false; }
  if (target.carriedBy) return false;
  if (p.carrying) dropCarried(w, p);
  clearTask(p);
  p.task = { kind: 'carry', target: target.id };
  return true;
}
export function orderBind(w, p, target) {
  if (p.state !== 'ok' || target.state === 'dead' || target.bound) return false;
  if (target.state === 'ok') { w.addLogFn?.(`${target.name}は起きているので縛れない。気絶させてから縛る。`); return false; }
  clearTask(p);
  p.task = { kind: 'bind', target: target.id, t: 0 };
  return true;
}
export function orderRelease(w, p, target) {
  if (p.state !== 'ok' || !target.bound) return false;
  clearTask(p);
  p.task = { kind: 'release', target: target.id, t: 0 };
  return true;
}

export function dropCarried(w, p) {
  const t = w.people.find((o) => o.id === p.carrying);
  p.carrying = null;
  if (!t) return;
  t.carriedBy = null;
  // 担いでいた人の横に降ろす
  const nx = p.x + Math.cos(p.heading) * 0.8, nz = p.z - Math.sin(p.heading) * 0.8;
  if (walkable(nx, nz)) { t.x = nx; t.z = nz; } else { t.x = p.x; t.z = p.z; }
}

// 作業（担ぐ・縛る・解放）を進める。戻り値 true＝この人の移動は作業が制御した
export function stepCombatTask(w, p, hours) {
  const t = p.task;
  if (!t || !['carry', 'bind', 'release'].includes(t.kind)) return false;
  const target = w.people.find((o) => o.id === t.target);
  if (!target || target.carriedBy && target.carriedBy !== p.id) { p.task = null; return false; }
  if (dist(p, target) > 1.4) { chase(w, p, target.x, target.z); return true; }
  p.path = []; p.goal = null;
  p.heading = Math.atan2(target.x - p.x, target.z - p.z);
  if (t.kind === 'carry') {
    p.carrying = target.id; target.carriedBy = p.id; p.task = null;
    target.path = []; target.goal = null;
    w.addLogFn?.(`${p.name}が${target.name}を担いだ。`, true);
    return true;
  }
  t.t += hours;
  if (t.t < 0.035) return true; // 縛る・ほどくのにかかる時間（ゲーム内約2分）
  if (t.kind === 'bind') { target.bound = true; if (target.fight) target.fight.target = null; w.addLogFn?.(`${p.name}が${target.name}を縛り上げた。`); }
  else { target.bound = false; w.addLogFn?.(`${p.name}が${target.name}の縄をほどいた。`); }
  p.task = null;
  return true;
}

// 担がれている人は担いでいる人と一緒に動く
export function followCarrier(w, p) {
  const c = w.people.find((o) => o.id === p.carriedBy);
  if (!c || c.carrying !== p.id) { p.carriedBy = null; return; }
  if (c.state !== 'ok') { dropCarried(w, c); return; }
  // 目を覚ましたら（縛られていなければ）自分で降りる
  if (p.state === 'ok' && !p.bound) { dropCarried(w, c); return; }
  p.x = c.x; p.z = c.z; p.heading = c.heading; p.speed = 0;
}

// ======================= 戦闘の進行 =======================
// 戻り値：'move'＝戦闘のために移動中（経路は設定済み）／'hold'＝その場で戦闘中／null＝戦闘していない
export function stepFight(w, p, dt) {
  const f = p.fight;
  if (!f) return null;
  if (f.act) {
    f.act.t += dt;
    if (f.act.kind === 'attack' && f.act.t >= f.act.dur) { const tgt = w.people.find((o) => o.id === f.act.target); f.swingType = f.act.weapon; f.act = null; f.swing = 0.28; if (tgt) resolveAttack(w, p, tgt); f.cd = attackInterval(p); }
    else if (f.act && f.act.kind !== 'attack' && f.act.t >= f.act.dur) f.act = null;
  }
  f.cd -= dt;
  if (f.swing > 0) f.swing -= dt;
  if (!canFight(p) || p.retreat) { if (f.act?.kind === 'attack') f.act = null; return null; }

  let t = w.people.find((o) => o.id === f.target);
  if (!valid(t) || (!f.ordered && !hostile(p, t))) { t = null; f.target = null; f.ordered = false; }
  if (!t) {
    t = pickTarget(w, p);
    if (!t) return null;
    f.target = t.id;
  }
  const wp = weaponOf(p);
  const d = dist(p, t);
  const reach = wp.cat.reach + 0.25;
  if (d > reach) {
    if (f.act?.kind === 'attack' && d > reach + 1) f.act = null;
    chase(w, p, t.x, t.z);
    return 'move';
  }
  p.path = []; p.goal = null;
  p.heading = Math.atan2(t.x - p.x, t.z - p.z);
  if (!f.act && f.cd <= 0) {
    const short = Math.max(0, wp.reqStr - lv(p, 'str'));
    f.act = { kind: 'attack', t: 0, dur: wp.cat.windup * (1 + short * C.reqStrPenalty), target: t.id, weapon: wp.type };
  }
  return 'hold';
}

function attackInterval(p) {
  const wp = weaponOf(p);
  const short = Math.max(0, wp.reqStr - lv(p, 'str'));
  const skill = effSkill(p, wp.cat.skill);
  return wp.cat.interval * (1 + short * C.reqStrPenalty) * (1.15 - Math.min(0.35, skill / 200)) * (0.85 + Math.random() * 0.3);
}

// 自動で戦う相手を選ぶ
function pickTarget(w, p) {
  const recent = w.time - p.fight.lastHitT < 4;
  if (p.kind === 'party') {
    // 移動を指示されている間は、攻撃されない限り戦わない
    if (p.goal && !recent) return null;
    if (recent) { const a = w.people.find((o) => o.id === p.fight.lastHitBy); if (valid(a) && dist(p, a) < 15) return a; }
    return nearest(w, p, (o) => valid(o) && hostile(p, o) && o.fight?.target && w.people.find((x) => x.id === o.fight.target)?.kind === 'party', C.autoDefendRange);
  }
  if (p.faction === 'bandit') {
    if (!p.squadHunting) return recent ? w.people.find((o) => o.id === p.fight.lastHitBy && valid(o)) || null : null;
    return nearest(w, p, (o) => valid(o) && hostile(p, o), 80);
  }
  // 流れ者：怒らせた相手の陣営を狙う
  if (p.angryAt?.length) return nearest(w, p, (o) => valid(o) && hostile(p, o), 25);
  return null;
}

export function nearest(w, p, pred, maxD) {
  let best = null, bd = maxD;
  for (const o of w.people) {
    if (o === p || !pred(o)) continue;
    const d = dist(p, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function pickPart(w) {
  const tot = Object.values(C.hitWeights).reduce((a, b) => a + b, 0);
  let x = w.rng.next() * tot;
  for (const [id, wt] of Object.entries(C.hitWeights)) { x -= wt; if (x <= 0) return id; }
  return 'chest';
}

function resolveAttack(w, a, d) {
  const wp = weaponOf(a);
  const isBow = wp.type === 'bow';
  const ev = (kind) => w.events?.push({ kind, x: d.x, z: d.z, fx: a.x, fz: a.z, attacker: a.id, target: d.id });
  if (!valid(d) && d.state !== 'ko') return;
  if (dist(a, d) > wp.cat.reach + 1) return; // 離れられた：空振り
  const atkLv = effSkill(a, wp.cat.skill);
  gainXp(w, a, wp.cat.skill, isBow ? GROWTH.rangedXpPerShot : GROWTH.meleeXpPerSwing);
  if (isBow) ev('arrow');
  // 中立の相手に攻撃されたら怒る
  if (!hostile(d, a) && d.faction !== a.faction) d.angryAt = [...new Set([...(d.angryAt || []), a.faction])];
  d.fight.lastHitBy = a.id; d.fight.lastHitT = w.time;

  // 防御側の反応（相手の方を向いていて、動ける状態のとき）
  const toA = Math.atan2(a.x - d.x, a.z - d.z);
  let diff = toA - d.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const facing = Math.abs(diff) < 1.4;
  const ready = canFight(d) && d.fight.act?.kind !== 'hit' && (d.fight.act?.kind !== 'attack' || w.rng.next() < 0.3);
  if (ready && facing) {
    const dodge = Math.min(C.dodgeMax, Math.max(C.dodgeMin, C.dodgeBase + (effSkill(d, 'dodge') - atkLv) * C.dodgePerLv + effSkill(d, 'agi') * C.dodgeAgiPerLv)) * (isBow ? C.bowDodgeMul : 1);
    if (w.rng.next() < dodge) {
      const side = w.rng.next() < 0.5 ? 1 : -1;
      d.fight.act = { kind: 'dodge', t: 0, dur: C.defendTime, side };
      // 横へ一歩ずれる
      const sx = d.x + Math.cos(d.heading) * 0.45 * side, sz = d.z - Math.sin(d.heading) * 0.45 * side;
      if (walkable(sx, sz)) { d.x = sx; d.z = sz; }
      gainXp(w, d, 'dodge', GROWTH.dodgeXpPerDodge);
      ev('dodge');
      return;
    }
    if (!isBow) {
      const block = Math.min(C.blockMax, Math.max(C.blockMin, C.blockBase + (effSkill(d, 'defense') - atkLv) * C.blockPerLv));
      if (w.rng.next() < block) {
        d.fight.act = { kind: 'block', t: 0, dur: C.defendTime };
        gainXp(w, d, 'defense', GROWTH.defenseXpPerBlock);
        const leak = (wp.cut + wp.blunt * 2) * wp.mul * C.blockLeak * 0.5;
        if (leak > 0.5) damage(w, d, w.rng.next() < 0.5 ? 'armL' : 'armR', leak, { cut: false });
        ev('block');
        return;
      }
    }
  }

  // 命中：部位・防具・威力
  const part = pickPart(w);
  const sk = C.skillDamage(atkLv);
  let cut = wp.cut * wp.mul * sk;
  let blunt = wp.blunt * wp.mul * sk * (wp.type === 'blunt' || wp.type === 'fist' ? C.strBluntBonus(effSkill(a, 'str')) : 1);
  for (const ar of armorFor(d, part)) {
    if (w.rng.next() < ar.cover) { cut *= 1 - ar.cut; blunt *= 1 - ar.blunt; }
  }
  const total = (cut + blunt) * (0.85 + w.rng.next() * 0.3);
  const bleedMul = total > 0 ? (cut / (cut + blunt)) * wp.cat.bleedMul : 0;
  const event = damage(w, d, part, total, { cut: bleedMul > 0.05, bleedMul });
  gainXp(w, a, wp.cat.skill, GROWTH.meleeXpPerHit);
  if (wp.type === 'blunt') gainXp(w, a, 'str', GROWTH.strXpPerBluntHit);
  if (d.state === 'ok') d.fight.act = { kind: 'hit', t: 0, dur: C.staggerTime };
  ev(event === 'lost' ? 'sever' : 'hit');
  if (d.kind === 'party') w.onPartyHit?.(d);
}

// 流れ者は近くの戦いから逃げる
export function fleeFromFights(w, p) {
  if (p.faction !== 'drifter' || p.angryAt?.length || p.state !== 'ok' || p.bound) return false;
  const danger = w.people.find((o) => o.fight?.act?.kind === 'attack' && dist(o, p) < C.fleeRange && o !== p);
  if (!danger) return false;
  const dx = p.x - danger.x, dz = p.z - danger.z, l = Math.hypot(dx, dz) || 1;
  const tx = p.x + (dx / l) * 30, tz = p.z + (dz / l) * 30;
  if (walkable(tx, tz)) { p.tx = tx; p.tz = tz; p.idle = 0; p.fleeing = true; }
  return true;
}
