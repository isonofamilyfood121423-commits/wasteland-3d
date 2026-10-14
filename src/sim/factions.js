// 派閥：好感度・敵対関係・指名手配・犯罪・賞金・通行料・連行（ロジック層）
import { FACTIONS, REP, TOWNS } from '../data/world.js';
import { townAt } from './terrain.js';
import { townLayout } from './towns.js';

let W = null; // 敵対判定で参照する世界（attachRuntime で結びつける）
export function bindWorld(w) {
  W = w;
  w.rep = w.rep || { merchant: 0, holy: 0, bandit: -100, eater: -100, drifter: 0 };
  w.wanted = w.wanted || {};       // 派閥 → { level, until(日) }
  w.tollPaid = w.tollPaid || {};   // 町 → 日
  w.tollRefused = w.tollRefused || {};
  w.discovered = w.discovered || {};
}

const enemiesOf = (f) => FACTIONS[f]?.enemies || [];
const factionEnemies = (a, b) => enemiesOf(a).includes(b) || enemiesOf(b).includes(a);

export function isWanted(f) { const x = W?.wanted?.[f]; return !!(x && x.level > 0); }

// a から見て b は敵か
export function hostile(a, b) {
  if (a === b || a.state === 'dead' || b.state === 'dead') return false;
  if (a.angryAt?.includes(b.faction) || b.angryAt?.includes(a.faction)) return true;
  if (a.faction === b.faction) return false;
  const [pl, other] = a.faction === 'player' ? [a, b] : b.faction === 'player' ? [b, a] : [null, null];
  if (pl) {
    const f = other.faction;
    if (factionEnemies('player', f)) return true;
    if (!W) return false;
    if ((W.rep[f] ?? 0) < REP.hostileBelow) return true;
    if (other.role === 'guard' || other.role === 'police' || other.role === 'escort') {
      if (isWanted(f)) return true;
      if (other.town && W.tollRefused[other.town] === W.day) return true;
      // 教団の衛兵は自分の町の中にいる錆骨を許さない
      const hate = FACTIONS[f]?.hatesRace;
      if (hate && pl.race === hate && townAt(pl.x, pl.z)?.faction === f) return true;
    }
    return false;
  }
  return factionEnemies(a.faction, b.faction);
}

export function changeRep(w, f, delta, reason) {
  if (!(f in w.rep) || f === 'player') return;
  const before = w.rep[f];
  w.rep[f] = Math.max(REP.min, Math.min(REP.max, before + delta));
  if (Math.round(before / 10) !== Math.round(w.rep[f] / 10) && Math.abs(delta) >= 5 && FACTIONS[f]?.label) {
    w.addLogFn?.(`${FACTIONS[f].label}からの評判が${delta > 0 ? '上がった' : '下がった'}（${reason}）。`, delta > 0);
  }
}

export function makeWanted(w, f, severity = 1, reason = '') {
  if (!FACTIONS[f]?.style || f === 'bandit' || f === 'eater') return;
  const x = w.wanted[f] || { level: 0, until: 0 };
  x.level += severity;
  x.until = w.day + REP.wantedDays;
  w.wanted[f] = x;
  w.addLogFn?.(`${FACTIONS[f].label}に指名手配された！（${reason}）`);
  w.onAlarm?.();
}

// 攻撃したとき：その派閥の評判が下がり、町中や衛兵の前なら指名手配
export function onAttack(w, attacker, victim) {
  if (attacker.faction !== 'player' || victim.faction === 'player') return;
  const f = victim.faction;
  if (factionEnemies('player', f) || (w.rep[f] ?? 0) < REP.hostileBelow) return;
  if (victim.provokedBy?.includes(attacker.id)) return; // 2回目以降は数えない
  victim.provokedBy = [...(victim.provokedBy || []), attacker.id];
  changeRep(w, f, REP.attack, '攻撃した');
  const inTown = townAt(victim.x, victim.z)?.faction === f;
  const witness = w.people.some((o) => o.faction === f && (o.role === 'guard' || o.role === 'police') && o.state === 'ok' && Math.hypot(o.x - victim.x, o.z - victim.z) < 30);
  if (inTown || witness) makeWanted(w, f, 1, `${victim.name}を襲った`);
}

export function onDeath(w, p) {
  const killer = w.people.find((o) => o.id === p.fight?.lastHitBy);
  if (killer?.faction === 'player' && p.faction !== 'player') changeRep(w, p.faction, REP.kill, '殺した');
}

export function onTreatOther(w, medic, patient) {
  if (medic.faction !== 'player' || patient.faction === 'player') return;
  if (patient.treatedBy?.includes(medic.id)) return;
  patient.treatedBy = [...(patient.treatedBy || []), medic.id];
  changeRep(w, patient.faction, REP.rescue, '手当てした');
}

// 1秒ごと：指名手配の期限、町への出入り、通行料、連行、拘留の終わり
export function stepFactions(w) {
  for (const [f, x] of Object.entries(w.wanted)) if (x.level > 0 && w.day >= x.until) { x.level = 0; w.addLogFn?.(`${FACTIONS[f].label}の指名手配が解けた。`); }
  const party = w.people.filter((p) => p.kind === 'party');
  for (const t of TOWNS) {
    const near = party.filter((p) => p.state === 'ok' && !p.jailUntil && Math.hypot(p.x - t.x, p.z - t.z) < t.r + 10);
    // 町を見つけた
    if (!w.discovered[t.id] && party.some((p) => Math.hypot(p.x - t.x, p.z - t.z) < 260)) {
      w.discovered[t.id] = true;
      w.addLogFn?.(`${t.name}（${FACTIONS[t.faction].label}）を見つけた。`, true);
    }
    // 町に入った
    const inside = near.length > 0;
    if (inside && !w.inTown?.[t.id]) {
      w.inTown = { ...(w.inTown || {}), [t.id]: true };
      w.addLogFn?.(`${t.name}に入った。${t.desc || ''}`);
      if (t.toll && w.tollPaid[t.id] !== w.day && w.tollRefused[t.id] !== w.day && !w.pendingToll) {
        w.pendingToll = t.id;
        w.onToll?.(t);
      }
    } else if (!inside && w.inTown?.[t.id] && !party.some((p) => Math.hypot(p.x - t.x, p.z - t.z) < t.r + 25)) {
      w.inTown = { ...w.inTown, [t.id]: false };
    }
  }
  // 連行：敵対している町の衛兵に倒された仲間は、牢へ運ばれる
  for (const p of party) {
    if (p.state !== 'ko' || p.jailUntil || p.carriedBy) continue;
    const t = townAt(p.x, p.z) || TOWNS.find((tt) => Math.hypot(p.x - tt.x, p.z - tt.z) < tt.r + 40);
    if (!t || !['merchant', 'holy'].includes(t.faction)) continue;
    const guard = w.people.find((o) => o.faction === t.faction && o.role === 'guard' && o.state === 'ok' && hostile(o, p) && Math.hypot(o.x - p.x, o.z - p.z) < 25);
    if (!guard) continue;
    jail(w, p, t.faction);
  }
  for (const p of party) {
    if (p.jailUntil && w.time >= p.jailUntil) {
      p.jailUntil = 0; p.bound = false;
      w.addLogFn?.(`${p.name}は牢から釈放された。`);
    }
  }
}

export function jailOf(f) {
  const t = TOWNS.find((tt) => tt.faction === f && tt.kind === 'capital') || TOWNS.find((tt) => tt.faction === f && tt.shops.includes('police'));
  if (!t) return null;
  const L = townLayout(t);
  const d = L.shopDoors.police || { x: t.x, z: t.z };
  return { town: t, x: d.x + 1.5, z: d.z + 1.5 };
}

export function jail(w, p, f) {
  const j = jailOf(f);
  if (!j) return;
  p.x = j.x + (Math.random() - 0.5) * 2; p.z = j.z + (Math.random() - 0.5) * 2;
  p.path = []; p.goal = null; p.task = null;
  p.bound = true;
  p.jailUntil = w.time + REP.jailDays * w.daySeconds;
  // 牢に入ったことで罪は償ったとみなす（釈放後に再び襲われないように）
  if (w.wanted[f]) w.wanted[f].level = 0;
  for (const t of TOWNS) if (t.faction === f) w.tollRefused[t.id] = -1;
  w.addLogFn?.(`${p.name}は${FACTIONS[f].label}に捕らえられ、${j.town.name}の牢へ連行された。（${REP.jailDays}日間）`);
}

// 罰金：払うと指名手配が解ける
export function fineFor(w, f) { const x = w.wanted[f]; return x?.level ? Math.round(x.level * REP.fineMul * 100) : 0; }
export function payFine(w, f) {
  const fine = fineFor(w, f);
  if (!fine || w.money < fine) return false;
  w.money -= fine; w.wanted[f].level = 0;
  w.addLogFn?.(`罰金${fine}錆貨を払い、${FACTIONS[f].label}の指名手配が解けた。`);
  return true;
}

// 賞金首・保護した者の引き渡し（警備所の前 8m 以内にいる、縛られた生きた者）
export function handoverCandidates(w, police) {
  return w.people.filter((p) => p.bound && p.state !== 'dead' && !p.jailUntil && p.kind !== 'party'
    && Math.hypot(p.x - police.x, p.z - police.z) < 8 && (p.bounty || p.faction === police.faction));
}
export function handOver(w, police, p) {
  // 担がれていれば降ろす
  const carrier = w.people.find((o) => o.carrying === p.id);
  if (carrier) { carrier.carrying = null; p.carriedBy = null; }
  let msg;
  if (p.bounty) {
    w.money += p.bounty;
    changeRep(w, police.faction, REP.bounty, '賞金首を引き渡した');
    msg = `${p.name}を引き渡し、賞金${p.bounty}錆貨を受け取った。`;
  } else {
    w.money += 50;
    changeRep(w, police.faction, REP.rescue * 2, '保護した者を送り届けた');
    msg = `${p.name}を送り届け、礼金50錆貨を受け取った。`;
  }
  w.people = w.people.filter((o) => o !== p);
  w.addLogFn?.(msg);
  return msg;
}
