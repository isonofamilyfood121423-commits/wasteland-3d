// 体・種族・能力・アイテムの定義（追加・調整はこのファイルで行う）

// ---- 部位 ----
// max: 耐久1のときの最大HP。HPは負の値まで下がる（-max で欠損・死亡）
export const PARTS = [
  { id: 'head', label: '頭', max: 60, vital: true },
  { id: 'chest', label: '胸', max: 100, vital: true },
  { id: 'stomach', label: '腹', max: 80, vital: true },
  { id: 'armL', label: '左腕', max: 70, limb: 'arm' },
  { id: 'armR', label: '右腕', max: 70, limb: 'arm' },
  { id: 'legL', label: '左脚', max: 75, limb: 'leg' },
  { id: 'legR', label: '右脚', max: 75, limb: 'leg' },
];
export const PART = Object.fromEntries(PARTS.map((p) => [p.id, p]));

// ---- 体の数値（時間の単位はゲーム内の1時間） ----
export const HEALTH = {
  bloodMax: 100,
  koBlood: 50,          // 血液がこれ未満で気絶
  wakeBlood: 58,        // 目覚めるのに必要な血液
  bloodRegen: 8,        // 出血していないときの血液回復／時
  clotPerHour: 0.3,     // 出血は自然に弱まる（1時間で約26%減）
  bleedFromDamage: 0.18,// 切り傷：ダメージ×この値が出血量（血液／時）
  naturalHeal: 1.6,     // 自然回復 HP／時（出血が止まっている部位のみ）
  restMul: 3,           // 休息中の回復倍率
  koHealMul: 1.5,       // 気絶中の回復倍率
  koMinHours: 0.4,      // 気絶したら最低これだけは起きない
  lostAt: -1.0,         // 手足：最大HP×この値以下で失う
  deathAt: -1.0,        // 頭・胸・腹：最大HP×この値以下で死亡
  toughReducePerLv: 0.004, // 耐久1あたりの被ダメージ軽減（最大40%）
  toughHpPerLv: 0.012,  // 耐久1あたりの最大HP増加
  hungerMax: 300,
  hungerPerHour: 5,     // 1日で約120減る
  hungryAt: 150,        // これ未満で「空腹」（能力-10%）
  starvingAt: 50,       // これ未満で「飢餓」（能力-30%・移動-20%）
  autoEatBelow: 170,    // これ未満で手持ちの食料を自動で食べる
  starveDamage: 4,      // 空腹度0のとき腹へのダメージ／時
  limpMul: 0.5,         // 片脚が使えないとき
  crawlSpeed: 0.55,     // 両脚が使えないときの這う速さ（m/秒）
  treatRange: 1.6,      // 治療できる距離（m）
};

// ---- 能力 ----
// grow: このフェーズで伸びる手段の説明（UIに表示）
export const SKILLS = [
  { id: 'str', label: '筋力', grow: '重い荷物を持って歩く' },
  { id: 'agi', label: '敏捷', grow: '走る' },
  { id: 'tough', label: '耐久', grow: 'ダメージを受ける・気絶する' },
  { id: 'melee', label: '近接攻撃', grow: '武器や素手で戦う' },
  { id: 'defense', label: '防御', grow: '攻撃を受け止める' },
  { id: 'dodge', label: '回避', grow: '攻撃をかわす' },
  { id: 'stealth', label: '隠密', grow: '忍び歩く（Phase 4）' },
  { id: 'theft', label: '窃盗', grow: '盗む（Phase 4）' },
  { id: 'ranged', label: '射撃', grow: '弓で撃つ' },
  { id: 'medic', label: '医療', grow: '治療する' },
  { id: 'labor', label: '労働', grow: '採掘・運搬（Phase 5）' },
  { id: 'cook', label: '料理', grow: '調理する（Phase 5）' },
  { id: 'farm', label: '農業', grow: '畑仕事（Phase 5）' },
  { id: 'smith', label: '鍛冶', grow: '作る（Phase 5）' },
  { id: 'research', label: '研究', grow: '研究する（Phase 5）' },
];
export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const GROWTH = {
  maxLevel: 100,
  xpPerLevel: 100,
  slowdown: 0.06,       // レベルが高いほど伸びにくい（1/(1+lv×これ)）
  strLoadRatio: 0.5,    // 積載率がこれ以上で筋力が伸びる
  strXpPerMeter: 0.35,
  agiXpPerMeter: 0.06,
  toughXpPerDamage: 0.9,
  toughXpKo: 25,
  medicXpPerTreat: 12,
  meleeXpPerSwing: 3, meleeXpPerHit: 2, rangedXpPerShot: 4,
  defenseXpPerBlock: 5, dodgeXpPerDodge: 5, strXpPerBluntHit: 1.5,
};

// ---- 種族（オリジナル） ----
export const RACES = {
  sunabito: {
    label: '砂人', weight: 6,
    desc: '荒野に最も多い人々。得意も不得意もなく、何でも覚える。',
    hungerMul: 1, healMul: 1, learnMul: 1, aid: 'bandage', eats: true,
    shape: { height: 1, bulk: 1, head: 'round' },
    skillBonus: {},
  },
  tsunobito: {
    label: '角人', weight: 3,
    desc: '額に角を持つ大柄な種族。力と頑丈さに優れるが、よく食べ、身のこなしは重い。',
    hungerMul: 1.5, healMul: 1.1, learnMul: 0.9, aid: 'bandage', eats: true,
    shape: { height: 1.08, bulk: 1.2, head: 'horn' },
    skillBonus: { str: 8, tough: 6, agi: -4 },
    skin: [0x9a7a68, 0x7d6656, 0xa58a74],
  },
  sabibone: {
    label: '錆骨', weight: 2,
    desc: '機械の体で動く古い種族。食事をしないが自然には治らず、修理キットでしか治療できない。',
    hungerMul: 0, healMul: 0.25, learnMul: 0.8, aid: 'repair', eats: false,
    shape: { height: 1.02, bulk: 0.95, head: 'box' },
    skillBonus: { tough: 10, medic: -4 },
    skin: [0x8b8f92, 0x6f7377, 0x9c8f80],
  },
};

// ---- アイテム（定義は items.js） ----
export { ITEMS, ITEM_CATS } from './items.js';
