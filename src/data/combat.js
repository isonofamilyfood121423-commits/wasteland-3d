// 戦闘・敵の定義（追加・調整はこのファイルで行う）

export const COMBAT = {
  // 当たる部位の重み
  hitWeights: { head: 9, chest: 30, stomach: 20, armL: 10, armR: 10, legL: 10, legR: 11 },
  skillDamage: (lv) => 0.6 + lv / 40,      // 能力による威力の倍率
  strBluntBonus: (str) => 1 + str / 120,   // 鈍器は筋力で威力が上がる
  // 受け止める確率：基本＋（防御－相手の攻撃）×係数
  blockBase: 0.28, blockPerLv: 0.012, blockMin: 0.05, blockMax: 0.8,
  blockLeak: 0.15,                          // 受け止めても通るダメージの割合（鈍器は2倍）
  dodgeBase: 0.08, dodgePerLv: 0.008, dodgeAgiPerLv: 0.002, dodgeMin: 0.02, dodgeMax: 0.5,
  bowDodgeMul: 0.5,                         // 矢はかわしにくい
  staggerTime: 0.35,
  defendTime: 0.35,
  autoDefendRange: 9,                       // この距離で攻撃されたら自動で反撃
  retreatDistance: 45,
  fleeRange: 18,                            // 流れ者はこの距離の戦いから逃げる
  reqStrPenalty: 0.03,                      // 筋力不足1あたり攻撃間隔が伸びる割合
};

// ---- 敵の一団 ----
// 仕様判断：Phase 3 の敵は盗賊団のみ。派閥・町は Phase 4 で追加する
// 派閥の定義は world.js へ移動（Phase 4）
export { FACTIONS } from './world.js';

// 敵の種類：skill は能力の範囲、gear は装備の候補（null＝なし）、q は品質の範囲
export const ENEMY_TYPES = {
  starved: {
    label: '飢えた盗賊', skill: [2, 8],
    gear: { weapon: ['iron_club', 'rusty_blade', null], body: ['rag_shirt', null], head: [null, 'cloth_hood'], legs: [null] },
    q: [0, 1], money: [0, 15], food: [0, 1],
  },
  thug: {
    label: '砂鼠団の手下', skill: [6, 16],
    gear: { weapon: ['rusty_blade', 'iron_club', 'spear', 'short_bow'], body: ['rag_shirt', 'leather_vest'], head: ['cloth_hood', null, 'straw_hat'], legs: ['leather_pants', null], feet: ['sandals', 'boots'] },
    q: [0, 1], money: [10, 40], food: [1, 2],
  },
  boss: {
    label: '砂鼠団の頭目', skill: [18, 28],
    gear: { weapon: ['long_blade', 'sledge', 'glaive'], body: ['leather_vest', 'iron_plate'], head: ['iron_helm', 'cloth_hood'], legs: ['leather_pants', 'iron_greaves'], feet: ['boots'], outer: ['dust_cloak'] },
    q: [1, 2], money: [60, 140], food: [1, 2], bounty: [400, 900],
  },
  // Phase 6：拠点を襲う勢力（faction で陣営を指定）
  eater: {
    label: '灰喰らい', faction: 'eater', skill: [10, 20],
    gear: { weapon: ['iron_club', 'sledge', 'spear'], body: [null, 'rag_shirt'], head: [null], legs: [null] },
    q: [0, 1], money: [0, 10], food: [0, 1],
  },
  eater_big: {
    label: '灰喰らいの大男', faction: 'eater', skill: [18, 28],
    gear: { weapon: ['sledge'], body: ['rag_shirt'], head: [null], legs: ['leather_pants'] },
    q: [1, 2], money: [0, 20], food: [1, 2], bounty: [200, 400],
  },
  crusader: {
    label: '白灯の討伐兵', faction: 'holy', skill: [14, 24],
    gear: { weapon: ['glaive', 'long_blade', 'spear'], body: ['iron_plate', 'leather_vest'], head: ['iron_helm'], legs: ['iron_greaves', 'leather_pants'], feet: ['boots'] },
    q: [1, 2], money: [20, 60], food: [1, 2],
  },
  zealot: {
    label: '白灯の審問官', faction: 'holy', skill: [22, 32],
    gear: { weapon: ['long_blade', 'glaive'], body: ['iron_plate'], head: ['iron_helm'], legs: ['iron_greaves'], feet: ['boots'], outer: ['dust_cloak'] },
    q: [2, 3], money: [60, 140], food: [1, 2],
  },
};
// 陣営ごとの差し色
export const FACTION_ACCENT = { bandit: 0x7e3a2c, eater: 0x4e5e34, holy: 0xd8d0b8, merchant: 0x3f6f8f };

export const SQUADS = {
  max: 2,                   // 同時にうろつく盗賊団の数
  spawnDist: [140, 220],    // 一団からこの距離に現れる
  spawnEvery: 0.6,          // ゲーム内の時間（時）ごとに補充を確認
  sight: 38,                // この距離で一団を見つけると襲ってくる
  giveUp: 75,               // これ以上離されたら諦める
  cooldownHours: 3,         // 略奪のあとしばらく襲わない
  despawnDist: 320,
  // 構成：重みつきの候補
  makeup: [
    { w: 5, members: ['starved', 'starved', 'starved'] },
    { w: 4, members: ['thug', 'starved', 'starved', 'thug'] },
    { w: 2, members: ['boss', 'thug', 'thug', 'thug', 'starved'] },
  ],
  stealMoneyRatio: 0.3,
};
