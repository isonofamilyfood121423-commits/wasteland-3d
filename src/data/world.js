// 派閥・町・道・交易の定義（追加・調整はこのファイルで行う）
// すべてオリジナルの名称

// ---- 派閥 ----
// accent: 差し色 / style: 建築様式 / guard: 衛兵の種類 / enemies: 最初から敵対している派閥
export const FACTIONS = {
  player: { label: '一団' },
  drifter: { label: '流れ者', desc: '町と町のあいだをさまよう人々。' },
  merchant: {
    label: '塩路商会', accent: 0x3f6f8f, style: 'adobe',
    desc: '塩と鉄の取引で荒野をつなぐ商人たちの連合。金を払う者には寛大だが、盗人と賞金首には容赦しない。',
    enemies: ['bandit', 'eater'],
  },
  holy: {
    label: '白灯の教団', accent: 0xd8d0b8, style: 'stone',
    desc: '「白い灯」を信じる宗教国家。規律に厳しく、通行料を取る。機械の体を持つ錆骨を忌み嫌う。',
    enemies: ['bandit', 'eater'],
    hatesRace: 'sabibone',
  },
  bandit: { label: '砂鼠団', accent: 0xa3392b, style: 'camp', desc: '荒野をうろつく盗賊団。弱った旅人を襲い、食料と金を奪っていく。', enemies: ['player', 'merchant', 'holy'] },
  eater: { label: '灰喰らい', accent: 0x5e7a3a, style: 'huts', desc: '灰の高地に住む人食いの集団。誰彼かまわず襲いかかる。', enemies: ['player', 'merchant', 'holy', 'bandit', 'drifter'] },
};

export const REP = {
  min: -100, max: 100,
  hostileBelow: -40,        // これ未満でその派閥から敵とみなされる
  friendlyAbove: 30,
  attack: -12,              // その派閥の者を攻撃した
  kill: -25,
  crime: -20,               // 町での犯罪（盗み・住人への攻撃）
  bounty: 10,               // 賞金首を引き渡した
  rescue: 6,                // 縛られた住人を送り届けた／倒れた者を治療した
  trade: 0.5,               // 1回の取引ごと（上限あり）
  tradeCap: 20,
  tollRefuse: -15,
  wantedDays: 3,            // 指名手配が自然に解けるまで（ゲーム内の日数）
  fineMul: 1.5,             // 罰金＝ 指名手配の重さ × この倍率 × 100
  jailDays: 2,              // 連行されたときの拘留日数
};

// ---- 町 ----
// x, z: 中心の座標（m） / r: 町の半径 / kind: town（町）・capital（城壁のある都）・camp（野営地）
// shops: 店の種類 / prices: 品目ごとの価格倍率（町ごとの差が交易のもうけになる）
export const TOWNS = [
  {
    id: 'sunamachi', name: '砂町', faction: 'merchant', x: 240, z: -170, r: 46, kind: 'town',
    shops: ['general', 'bar', 'police', 'weapons'], houses: 7, guards: 4, folk: 8,
    prices: { food: 1.0, med: 1.0, weapon: 1.1, armor: 1.1, trade_salt: 1.3, trade_iron: 1.2, trade_cloth: 0.8, trade_herb: 1.0 },
    desc: '旅人が最初にたどり着く小さな宿場町。',
  },
  {
    id: 'shionoichi', name: '塩の市', faction: 'merchant', x: -760, z: -180, r: 52, kind: 'town',
    shops: ['general', 'bar', 'police', 'armor'], houses: 9, guards: 5, folk: 10,
    prices: { food: 0.9, med: 1.1, weapon: 1.2, armor: 0.95, trade_salt: 0.55, trade_iron: 1.35, trade_cloth: 1.2, trade_herb: 1.3 },
    desc: '塩田のそばに開かれた市。塩が安い。',
  },
  {
    id: 'kanatoko', name: '鉄床', faction: 'merchant', x: 300, z: -900, r: 50, kind: 'town',
    shops: ['general', 'weapons', 'armor', 'bar', 'police'], houses: 8, guards: 5, folk: 8,
    prices: { food: 1.3, med: 1.2, weapon: 0.8, armor: 0.85, trade_salt: 1.4, trade_iron: 0.55, trade_cloth: 1.3, trade_herb: 1.2 },
    desc: '錆の荒地で鉄を打つ鍛冶の町。武具と鉄板が安い。',
  },
  {
    id: 'inorinoizumi', name: '祈りの泉', faction: 'holy', x: 420, z: 700, r: 44, kind: 'town',
    shops: ['general', 'bar', 'police'], houses: 6, guards: 4, folk: 7, toll: 30,
    prices: { food: 0.8, med: 0.8, weapon: 1.3, armor: 1.2, trade_salt: 1.2, trade_iron: 1.3, trade_cloth: 0.6, trade_herb: 0.5 },
    desc: '湧き水のそばの教団の町。薬草と布が安い。',
  },
  {
    id: 'hakutounomiyako', name: '白灯の都', faction: 'holy', x: -900, z: 620, r: 66, kind: 'capital',
    shops: ['general', 'weapons', 'armor', 'bar', 'police'], houses: 12, guards: 8, folk: 12, toll: 60,
    prices: { food: 1.0, med: 0.9, weapon: 1.0, armor: 0.9, trade_salt: 1.5, trade_iron: 1.1, trade_cloth: 0.9, trade_herb: 1.4 },
    desc: '城壁に囲まれた教団の都。門で通行料を取る。',
  },
  {
    id: 'sunanezumi', name: '砂鼠の巣', faction: 'bandit', x: 700, z: -350, r: 34, kind: 'camp',
    shops: [], houses: 5, guards: 7, folk: 0, boss: true,
    desc: '砂鼠団のねぐら。頭目がいる。',
  },
  {
    id: 'haikurai', name: '灰喰らいの集落', faction: 'eater', x: 1250, z: 450, r: 36, kind: 'camp',
    shops: [], houses: 6, guards: 9, folk: 0,
    desc: '近づいてはならない。',
  },
];

// 町と町を結ぶ道（町の id の組）
export const ROADS = [
  ['sunamachi', 'shionoichi'], ['sunamachi', 'kanatoko'], ['sunamachi', 'inorinoizumi'],
  ['inorinoizumi', 'hakutounomiyako'], ['shionoichi', 'hakutounomiyako'], ['sunamachi', 'sunanezumi'],
];
export const ROAD = { width: 4, pathCost: 0.6 };

// ---- 店 ----
// stock: 並べる品の候補（cat または id）と数 / buyCats: 買い取る品目（null＝何でも）
export const SHOPS = {
  general: { label: '雑貨屋', stock: [['dried_meat', 8], ['hardtack', 12], ['bandage', 8], ['aidkit', 2], ['repair_kit', 3], ['rope', 4], ['backpack', 1], ['trade_salt', 6], ['trade_cloth', 6], ['trade_herb', 6], ['trade_iron', 4], ['stone', 12]], buyCats: null },
  weapons: { label: '武器屋', stock: [['rusty_blade', 2], ['long_blade', 1], ['iron_club', 2], ['sledge', 1], ['spear', 2], ['glaive', 1], ['short_bow', 1]], buyCats: ['weapon', 'material'] },
  armor: { label: '防具屋', stock: [['cloth_hood', 2], ['iron_helm', 1], ['leather_vest', 2], ['iron_plate', 1], ['dust_cloak', 2], ['leather_pants', 2], ['iron_greaves', 1], ['boots', 2], ['backpack', 1], ['limb_crude', 1], ['limb_good', 1]], buyCats: ['armor', 'material', 'limb'] },
  bar: { label: '酒場', stock: [['dried_meat', 6], ['hardtack', 6]], buyCats: ['food'], recruits: [1, 3] },
  police: { label: '警備所', stock: [], buyCats: [] },
};
export const TRADE = {
  sellRatio: 0.5,           // 売るときは基準価格のこの割合
  repDiscount: 0.002,       // 好感度1あたりの値引き（最大20%）
  restockDays: 1,           // 在庫が入れ替わる間隔（ゲーム内の日数）
  stealBase: 0.25, stealPerLv: 0.012, stealGuardPenalty: 0.12,
  recruitPrice: [0, 1600],  // 仲間の雇い代の範囲
  partyMax: 10,
};

// ---- 町の人々の装備と強さ ----
// skill: 能力の範囲 / gear: スロットごとの候補 / q: 品質の範囲
export const ROLES = {
  guard: {
    merchant: { label: '商会の用心棒', skill: [16, 26], q: [1, 2], gear: { weapon: ['long_blade', 'spear', 'glaive', 'iron_club'], body: ['leather_vest', 'iron_plate'], head: ['iron_helm', 'cloth_hood'], legs: ['leather_pants', 'iron_greaves'], feet: ['boots'] } },
    holy: { label: '白灯の衛兵', skill: [18, 30], q: [1, 2], gear: { weapon: ['glaive', 'long_blade', 'spear'], body: ['iron_plate'], head: ['iron_helm'], legs: ['iron_greaves'], feet: ['boots'], outer: ['dust_cloak'] } },
    bandit: { label: '砂鼠団の見張り', skill: [8, 18], q: [0, 1], gear: { weapon: ['rusty_blade', 'iron_club', 'spear', 'short_bow'], body: ['rag_shirt', 'leather_vest'], head: ['cloth_hood', null], legs: ['leather_pants', null], feet: ['sandals'] } },
    eater: { label: '灰喰らい', skill: [12, 22], q: [0, 1], gear: { weapon: ['iron_club', 'sledge', 'spear'], body: [null, 'rag_shirt'], head: [null], legs: [null], feet: [null] } },
  },
  police: { label: '警備所の役人', skill: [14, 22], q: [1, 1], gear: { weapon: ['long_blade'], body: ['leather_vest'], head: ['cloth_hood'], feet: ['boots'] } },
  shopkeeper: { label: '店主', skill: [3, 10], q: [1, 1], gear: { body: ['rag_shirt'], feet: ['sandals'] } },
  bartender: { label: '酒場の主人', skill: [5, 12], q: [1, 1], gear: { weapon: ['iron_club'], body: ['rag_shirt'], feet: ['sandals'] } },
  folk: { label: '町の住人', skill: [2, 8], q: [0, 1], gear: { body: ['rag_shirt'], head: ['straw_hat', null, null], feet: ['sandals', null] } },
  recruit: { label: '酒場の客', skill: [3, 14], q: [0, 1], gear: { weapon: ['rusty_blade', 'iron_club', null, 'spear'], body: ['rag_shirt', 'leather_vest'], head: ['straw_hat', 'cloth_hood', null], feet: ['sandals', 'boots'] } },
  boss: { label: '砂鼠団の頭目', skill: [24, 34], q: [1, 2], gear: { weapon: ['long_blade', 'sledge', 'glaive'], body: ['iron_plate'], head: ['iron_helm'], legs: ['iron_greaves'], feet: ['boots'], outer: ['dust_cloak'] }, bounty: [1200, 1800] },
};
export const ROLE_LABEL = { guard: '衛兵', police: '役人', shopkeeper: '店主', bartender: '酒場の主人', folk: '住人', recruit: '酒場の客', boss: '頭目' };
