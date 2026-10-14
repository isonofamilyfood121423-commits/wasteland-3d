// 体（部位HP・出血・気絶/死亡・空腹）、能力の成長、所持品（ロジック層）
import { PARTS, PART, HEALTH as H, SKILLS, SKILL, GROWTH, RACES, ITEMS } from '../data/body.js';

// ======================= 生成 =======================
export function pickRace(rng) {
  const entries = Object.entries(RACES);
  const total = entries.reduce((a, [, r]) => a + r.weight, 0);
  let x = rng.next() * total;
  for (const [id, r] of entries) { x -= r.weight; if (x <= 0) return id; }
  return 'sunabito';
}

export function makeSkills(rng, raceId) {
  const bonus = RACES[raceId].skillBonus;
  const s = {};
  for (const sk of SKILLS) s[sk.id] = { lv: Math.max(1, Math.round(1 + rng.next() * 7 + (bonus[sk.id] || 0))), xp: 0 };
  return s;
}

export function makeBody(p) {
  const body = {};
  for (const part of PARTS) {
    const max = partMax(p, part.id);
    body[part.id] = { hp: max, bleed: 0, lost: false, prosthetic: null };
  }
  return body;
}

export function initHealth(p, rng) {
  p.skills = p.skills || makeSkills(rng, p.race);
  p.body = makeBody(p);
  p.blood = H.bloodMax;
  p.hunger = H.hungerMax * (0.8 + rng.next() * 0.2);
  p.state = 'ok';
  p.koTimer = 0;
  p.resting = false;
  p.inv = p.inv || [];
}

// ======================= 参照 =======================
export const lv = (p, id) => p.skills?.[id]?.lv ?? 1;

export function partMax(p, id) {
  const pr = p.body?.[id]?.prosthetic;
  if (pr) return ITEMS[pr].limb.hp;
  return Math.round(PART[id].max * (1 + lv(p, 'tough') * H.toughHpPerLv));
}

export function hungerState(p) {
  if (!RACES[p.race].eats) return 'none';
  if (p.hunger < H.starvingAt) return 'starving';
  if (p.hunger < H.hungryAt) return 'hungry';
  return 'fed';
}

// 空腹による能力低下を反映した実効値
export function effSkill(p, id) {
  const hs = hungerState(p);
  const mul = hs === 'starving' ? 0.7 : hs === 'hungry' ? 0.9 : 1;
  return lv(p, id) * mul;
}

const usable = (p, id) => { const b = p.body[id]; return !b.lost || b.prosthetic; };
const working = (p, id) => usable(p, id) && p.body[id].hp > 0;

// 移動できる状態：{ mode: 'run'|'limp'|'crawl'|'none', mul }
export function mobility(p) {
  if (p.state !== 'ok' || p.bound || p.carriedBy) return { mode: 'none', mul: 0 };
  const L = working(p, 'legL'), R = working(p, 'legR');
  let mul = 1;
  for (const id of ['legL', 'legR']) { const pr = p.body[id].prosthetic; if (pr) mul *= ITEMS[pr].limb.speed; }
  mul *= 1 + effSkill(p, 'agi') * 0.005;
  if (hungerState(p) === 'starving') mul *= 0.8;
  const over = loadRatio(p);
  if (over > 1) mul *= Math.max(0.35, 1 - (over - 1) * 0.8);
  if (p.carrying) mul *= 0.62; // 人を担いでいると遅い
  if (p.sneak) mul *= 0.45;    // 忍び歩き
  if (L && R) return { mode: 'run', mul };
  if (L || R) return { mode: 'limp', mul: mul * H.limpMul };
  return { mode: 'crawl', mul: 1 };
}

export const armsUsable = (p) => working(p, 'armL') || working(p, 'armR');

export function healthPct(p) {
  if (p.state === 'dead') return 0;
  let s = 0, m = 0;
  for (const part of PARTS) { const b = p.body[part.id]; const mx = partMax(p, part.id); s += Math.max(0, Math.min(b.hp, mx)); m += mx; }
  return Math.max(0, Math.min(1, (s / m) * Math.min(1, p.blood / H.bloodMax + 0.2)));
}
export const totalBleed = (p) => PARTS.reduce((a, part) => a + p.body[part.id].bleed, 0);

// 治療が必要な部位（出血・HP不足・欠損直後の止血）。悪い順
export function partsNeedingAid(p) {
  return PARTS.map((part) => ({ id: part.id, b: p.body[part.id], max: partMax(p, part.id) }))
    .filter(({ b, max }) => b.bleed > 0.05 || (!b.lost && b.hp < max * 0.75) || (b.lost && b.prosthetic && b.hp < max * 0.75))
    .sort((a, c) => (c.b.bleed * 3 + (c.max - c.b.hp)) - (a.b.bleed * 3 + (a.max - a.b.hp)));
}

// ======================= 所持品 =======================
// 所持品は { id, qty, q }（q＝品質 0〜3。武器・防具以外は 1 固定）
const sameStack = (s, id, q) => s.id === id && (s.q ?? 1) === (q ?? 1);
export function countItem(p, id) { return p.inv.filter((s) => s.id === id).reduce((a, s) => a + s.qty, 0); }
export function addItem(p, id, qty = 1, q = 1) {
  const s = p.inv.find((x) => sameStack(x, id, q));
  if (s) s.qty += qty; else p.inv.push(q === 1 ? { id, qty } : { id, qty, q });
}
// q を省略すると品質を問わず取り出す
export function removeItem(p, id, qty = 1, q) {
  const s = q === undefined ? p.inv.find((x) => x.id === id) : p.inv.find((x) => sameStack(x, id, q));
  if (!s || s.qty < qty) return false;
  s.qty -= qty;
  if (s.qty <= 0) p.inv.splice(p.inv.indexOf(s), 1);
  return true;
}
// 身に着けている物は重さを半分として数える（仕様判断：着た方が運びやすい）
export const carryWeight = (p) => p.inv.reduce((a, s) => a + ITEMS[s.id].weight * s.qty, 0)
  + Object.values(p.equip || {}).reduce((a, e) => a + (e ? ITEMS[e.id].weight * 0.5 : 0), 0);
export const carryCapacity = (p) => 18 + effSkill(p, 'str') * 0.7 + (p.equip?.back ? ITEMS[p.equip.back.id].carry || 0 : 0);
export const loadRatio = (p) => carryWeight(p) / carryCapacity(p);

// ======================= 能力の成長 =======================
// 使うと上がる。レベルが高いほど伸びにくい
export function gainXp(w, p, id, amount) {
  if (amount <= 0 || p.state === 'dead') return;
  const s = p.skills[id];
  if (!s || s.lv >= GROWTH.maxLevel) return;
  s.xp += (amount * RACES[p.race].learnMul) / (1 + s.lv * GROWTH.slowdown);
  while (s.xp >= GROWTH.xpPerLevel && s.lv < GROWTH.maxLevel) {
    s.xp -= GROWTH.xpPerLevel;
    s.lv++;
    if (p.kind === 'party') w.addLogFn?.(`${p.name}の${SKILL[id].label}が ${s.lv} に上がった。`, true);
    // 耐久が上がると最大HPも増える（現在HPは割合を保つ）
    if (id === 'tough') for (const part of PARTS) if (!p.body[part.id].prosthetic) p.body[part.id].hp += PART[part.id].max * H.toughHpPerLv;
  }
}

// ======================= ダメージ =======================
// cut=true で出血を伴う。戻り値：何が起きたか
export function damage(w, p, partId, amount, { cut = true, bleedMul = 1 } = {}) {
  if (p.state === 'dead') return null;
  const b = p.body[partId];
  if (b.lost && !b.prosthetic) partId = 'chest'; // 失った部位への攻撃は胴へ
  const bb = p.body[partId];
  const reduce = Math.min(0.4, lv(p, 'tough') * H.toughReducePerLv);
  const dmg = amount * (1 - reduce);
  bb.hp -= dmg;
  if (cut && !bb.prosthetic) bb.bleed += dmg * H.bleedFromDamage * bleedMul;
  gainXp(w, p, 'tough', dmg * GROWTH.toughXpPerDamage * 0.1);
  const max = partMax(p, partId);
  const def = PART[partId];
  let event = 'hurt';
  if (def.limb && bb.hp <= max * H.lostAt) {
    if (bb.prosthetic) { bb.hp = max * H.lostAt; event = 'broken'; } // 義肢は壊れても外れない（修理で直る）
    else if (!bb.lost) { bb.lost = true; bb.hp = 0; bb.bleed += 12; event = 'lost'; w.addLogFn?.(`${p.name}は${def.label}を失った…`); }
  }
  checkVitals(w, p);
  return event;
}

function checkVitals(w, p) {
  if (p.state === 'dead') return;
  for (const part of PARTS) {
    if (!part.vital) continue;
    if (p.body[part.id].hp <= partMax(p, part.id) * H.deathAt) return die(w, p, `${part.label}の致命傷`);
  }
  if (p.blood <= 0) return die(w, p, '失血');
  const vitalDown = PARTS.some((part) => part.vital && p.body[part.id].hp <= 0);
  if (p.state === 'ok' && (vitalDown || p.blood < H.koBlood)) {
    p.state = 'ko';
    p.koTimer = H.koMinHours;
    p.path = []; p.goal = null; p.task = null; p.resting = false;
    gainXp(w, p, 'tough', GROWTH.toughXpKo);
    if (p.kind === 'party') w.addLogFn?.(`${p.name}が気絶した。`);
  }
}

function die(w, p, cause) {
  p.state = 'dead';
  p.path = []; p.goal = null; p.task = null; p.resting = false;
  for (const part of PARTS) p.body[part.id].bleed = 0;
  if (p.kind === 'party') w.addLogFn?.(`${p.name}が死亡した（${cause}）。`);
  w.onDeathFn?.(p);
}

// ======================= 時間経過 =======================
export function bodyTick(w, p, hours) {
  if (p.state === 'dead') return;
  const race = RACES[p.race];
  // 出血
  let bleed = 0;
  for (const part of PARTS) {
    const b = p.body[part.id];
    if (b.bleed > 0) {
      bleed += b.bleed;
      b.bleed *= Math.exp(-H.clotPerHour * hours);
      if (b.bleed < 0.05) b.bleed = 0;
    }
  }
  if (bleed > 0) p.blood -= bleed * hours;
  else p.blood = Math.min(H.bloodMax, p.blood + H.bloodRegen * hours * (race.eats && hungerState(p) === 'starving' ? 0.3 : 1));

  // 空腹
  if (race.eats) {
    p.hunger = Math.max(0, p.hunger - H.hungerPerHour * race.hungerMul * hours);
    if (p.hunger <= 0) p.body.stomach.hp -= H.starveDamage * hours;
    if (p.hunger < H.autoEatBelow && p.state !== 'dead') autoEat(w, p);
  }

  // 自然回復（出血が止まっている部位のみ。飢餓中は回復しない）
  const mul = race.healMul * (p.state === 'ko' ? H.koHealMul : p.resting ? H.restMul : 1) * (race.eats && hungerState(p) === 'starving' ? 0 : 1);
  for (const part of PARTS) {
    const b = p.body[part.id];
    if (b.lost && !b.prosthetic) continue;
    const max = partMax(p, part.id);
    if (b.bleed === 0 && b.hp < max) b.hp = Math.min(max, b.hp + H.naturalHeal * mul * hours * (max / 70));
  }

  checkVitals(w, p);

  // 気絶からの回復
  if (p.state === 'ko') {
    p.koTimer -= hours;
    const vitalsOk = PARTS.every((part) => !part.vital || p.body[part.id].hp > 0);
    if (p.koTimer <= 0 && vitalsOk && p.blood >= H.wakeBlood) {
      p.state = 'ok';
      if (p.kind === 'party') w.addLogFn?.(`${p.name}が意識を取り戻した。`);
    }
  }
}

export function eat(w, p, itemId) {
  const it = ITEMS[itemId];
  if (!it?.food || !RACES[p.race].eats) return false;
  if (!removeItem(p, itemId)) return false;
  p.hunger = Math.min(H.hungerMax, p.hunger + it.food);
  return true;
}

function autoEat(w, p) {
  if (p.state !== 'ok') return;
  // 自分の持ち物から、空腹度を無駄にしにくい小さい食料を優先
  const foods = p.inv.filter((s) => ITEMS[s.id].food).sort((a, b) => ITEMS[a.id].food - ITEMS[b.id].food);
  for (const s of foods) {
    if (p.hunger + ITEMS[s.id].food * 0.6 > H.hungerMax) break;
    eat(w, p, s.id);
    if (p.kind === 'party') w.addLogFn?.(`${p.name}は${ITEMS[s.id].label}を食べた。`);
    return;
  }
  if (p.kind === 'party' && p.hunger < H.hungryAt && !p.warnedHunger) { p.warnedHunger = true; w.addLogFn?.(`${p.name}：腹が減った…食料がない。`); }
  if (p.hunger >= H.hungryAt) p.warnedHunger = false;
}

// ======================= 治療 =======================
// 治療に使える道具：治療役→患者の順に探す（種族で道具の種類が違う）
export function findAidItem(medic, patient) {
  const kind = RACES[patient.race].aid;
  for (const owner of [medic, patient]) {
    const best = owner.inv.filter((s) => ITEMS[s.id].aid?.kind === kind).sort((a, b) => ITEMS[b.id].aid.power - ITEMS[a.id].aid.power)[0];
    if (best) return { owner, id: best.id };
  }
  return null;
}

// 1部位を処置する。戻り値：処置した部位の名前
export function treatPart(w, medic, patient, partId, itemId, owner) {
  const it = ITEMS[itemId].aid;
  if (!removeItem(owner, itemId)) return null;
  const b = patient.body[partId];
  const max = partMax(patient, partId);
  const skill = effSkill(medic, 'medic');
  b.bleed = 0;
  if (!b.lost || b.prosthetic) {
    // 応急処置で戻せるのは最大HPの80%まで（残りは休息で回復）
    const heal = it.power * (0.6 + skill / 40);
    b.hp = Math.min(Math.max(b.hp, b.hp + heal), Math.max(b.hp, max * 0.8));
  }
  gainXp(w, medic, 'medic', GROWTH.medicXpPerTreat);
  return PART[partId].label;
}

// 処置1回にかかる時間（ゲーム内の時間）
export const treatHours = (medic, itemId) => 0.35 / (ITEMS[itemId].aid.speed * (1 + effSkill(medic, 'medic') / 25));
