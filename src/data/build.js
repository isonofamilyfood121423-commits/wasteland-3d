// 拠点の建物・研究・作業台のレシピ・仕事の定義（追加・調整はこのファイルで行う）

// ---- 建物 ----
// w,d: 大きさ（m。2mの格子に合わせる） / cost: 材料 / work: 建設に必要な作業量
// blocks: 通行不可にするか / furniture: 小屋の中に置ける家具 / tech: 解放に必要な研究
// power: 発電量（+）または消費量（-）
export const BUILDINGS = {
  storage: { label: '倉庫', w: 2, d: 2, h: 1.6, cost: { stone: 4 }, work: 20, furniture: true, desc: '集めた物をしまう。採掘した物はここへ運ばれる' },
  bed: { label: '寝床', w: 2, d: 2, h: 0.5, cost: { trade_cloth: 2 }, work: 10, furniture: true, desc: '「休む」を指示すると空いている寝床で眠り、回復が5倍になる' },
  hut: { label: '小屋', w: 8, d: 6, h: 3.4, cost: { stone: 10, trade_cloth: 2 }, work: 60, desc: '日差しをさえぎる簡単な住まい。中に家具を置ける（通り抜けできる）' },
  wall: { label: '石壁', w: 2, d: 1, h: 3, cost: { stone: 2 }, work: 8, blocks: true, wall: true, desc: '始点と終点を決めて一直線に引ける' },
  gate: { label: '木の門', w: 4, d: 1, h: 3.2, cost: { stone: 3, trade_cloth: 2 }, work: 20, blocks: true, gate: true, desc: 'タップで開け閉めできる。閉めると敵も味方も通れない' },
  gate_iron: { label: '鉄の門', w: 4, d: 1, h: 3.6, cost: { trade_iron: 4 }, work: 30, blocks: true, gate: true, tech: 'irongate', desc: '丈夫な門' },
  well: { label: '井戸', w: 2, d: 2, h: 1.2, cost: { stone: 6 }, work: 25, blocks: true, desc: '近く（30m以内）の畑の育ちが倍になる' },
  farm: { label: '畑', w: 6, d: 6, h: 0.3, cost: { stone: 2 }, work: 15, desc: '穀物を育てる。農業の仕事が種まきと収穫をする' },
  cookstove: { label: '調理台', w: 2, d: 2, h: 1, cost: { stone: 4, trade_iron: 1 }, work: 20, furniture: true, desc: '穀物から平焼きパンを作る' },
  research: { label: '研究台', w: 2, d: 2, h: 1.1, cost: { stone: 4, trade_iron: 2, trade_cloth: 2 }, work: 30, furniture: true, desc: '研究を進める。電力があると速い' },
  smelter: { label: '精錬炉', w: 4, d: 4, h: 3, cost: { stone: 10, trade_iron: 1 }, work: 50, blocks: true, tech: 'smelting', desc: '鉄鉱石から鉄板を作る' },
  generator: { label: '風車発電機', w: 2, d: 2, h: 6, cost: { trade_iron: 4, trade_cloth: 4 }, work: 45, blocks: true, tech: 'wind', power: 10, desc: '電力を作る' },
  mine: { label: '採掘機', w: 4, d: 4, h: 3.5, cost: { trade_iron: 8, stone: 4 }, work: 60, blocks: true, tech: 'mining', power: -5, onOre: true, desc: '鉱脈の上に建てると、電力があるかぎり自動で鉱石を掘る' },
  forge: { label: '武器作業台', w: 4, d: 2, h: 1.4, cost: { stone: 6, trade_iron: 4 }, work: 45, blocks: true, tech: 'weaponsmith', desc: '鉄板から武器を作る' },
  armorer: { label: '防具作業台', w: 4, d: 2, h: 1.4, cost: { stone: 6, trade_iron: 3, trade_cloth: 4 }, work: 45, blocks: true, tech: 'armorsmith', desc: '鉄板と布から防具を作る' },
  tower: { label: '防衛塔', w: 2, d: 2, h: 7, cost: { stone: 12, trade_iron: 4 }, work: 70, blocks: true, tech: 'towers', desc: '近づいた敵に自動で矢を放つ（25m）' },
  cage: { label: '檻', w: 2, d: 2, h: 2.4, cost: { trade_iron: 4 }, work: 25, desc: '縛った者を閉じ込めておける' },
};
export const START_BUILDINGS = ['storage', 'bed', 'hut', 'wall', 'gate', 'well', 'farm', 'cookstove', 'research', 'cage'];

// ---- 研究 ----
export const TECHS = {
  smelting: { label: '精錬', cost: 60, requires: [], desc: '精錬炉で鉄鉱石を鉄板にできる' },
  wind: { label: '風力発電', cost: 80, requires: [], desc: '風車発電機を建てられる' },
  mining: { label: '採掘機', cost: 120, requires: ['wind', 'smelting'], desc: '鉱脈の上に採掘機を建てられる' },
  weaponsmith: { label: '武器づくり', cost: 100, requires: ['smelting'], desc: '武器作業台で武器を作れる' },
  armorsmith: { label: '防具づくり', cost: 100, requires: ['smelting'], desc: '防具作業台で防具を作れる' },
  irongate: { label: '鉄の門', cost: 90, requires: ['smelting'], desc: '丈夫な鉄の門' },
  towers: { label: '防衛塔', cost: 140, requires: ['weaponsmith'], items: { relic_part: 1 }, desc: '自動で矢を放つ塔' },
  mastery: { label: '上質な鍛冶', cost: 220, requires: ['weaponsmith', 'armorsmith'], items: { relic_record: 2 }, desc: '作る武器・防具の品質が1段上がりやすくなる' },
  // Phase 6：遺跡の遺物（研究素材）が必要な研究
  prosthetics: { label: '義肢づくり', cost: 160, requires: ['armorsmith'], items: { relic_part: 2 }, desc: '防具作業台で粗末な義肢を作れる' },
  advlimbs: { label: '上等な義肢', cost: 260, requires: ['prosthetics'], items: { relic_record: 1, relic_core: 1 }, desc: '防具作業台で上等な義肢を作れる' },
};
// items: 研究を始めるときに倉庫から使う遺物（遺跡で見つかる）
// 仕様判断：檻は最初から建てられる（捕まえた賞金首を置いておけるように）

// ---- 作業台のレシピ ----
// in: 材料（拠点の倉庫から） / out: できる物 / work: 作業量 / skill: 伸びる能力
export const RECIPES = {
  cookstove: [{ id: 'bread', label: '平焼きパン', in: { grain: 2 }, out: 'flatbread', work: 8, skill: 'cook' }],
  smelter: [{ id: 'plate', label: '鉄板', in: { iron_ore: 3 }, out: 'trade_iron', work: 12, skill: 'smith' }],
  forge: [
    { id: 'rusty_blade', label: '刀', in: { trade_iron: 2 }, out: 'rusty_blade', work: 25, skill: 'smith', quality: true },
    { id: 'iron_club', label: '鉄棍', in: { trade_iron: 2 }, out: 'iron_club', work: 22, skill: 'smith', quality: true },
    { id: 'spear', label: '槍', in: { trade_iron: 2 }, out: 'spear', work: 24, skill: 'smith', quality: true },
    { id: 'long_blade', label: '長刀', in: { trade_iron: 4 }, out: 'long_blade', work: 45, skill: 'smith', quality: true },
    { id: 'glaive', label: '薙刀', in: { trade_iron: 4 }, out: 'glaive', work: 45, skill: 'smith', quality: true },
  ],
  armorer: [
    { id: 'cloth_hood', label: '布頭巾', in: { trade_cloth: 2 }, out: 'cloth_hood', work: 12, skill: 'smith', quality: true },
    { id: 'leather_vest', label: '革の胴着', in: { trade_cloth: 3, trade_iron: 1 }, out: 'leather_vest', work: 25, skill: 'smith', quality: true },
    { id: 'iron_helm', label: '鉄兜', in: { trade_iron: 3 }, out: 'iron_helm', work: 30, skill: 'smith', quality: true },
    { id: 'iron_plate', label: '鉄の胸当て', in: { trade_iron: 6 }, out: 'iron_plate', work: 50, skill: 'smith', quality: true },
    { id: 'limb_crude', label: '粗末な義肢', in: { trade_iron: 3, relic_part: 1 }, out: 'limb_crude', work: 40, skill: 'smith', tech: 'prosthetics' },
    { id: 'limb_good', label: '上等な義肢', in: { trade_iron: 5, relic_part: 2, relic_record: 1 }, out: 'limb_good', work: 70, skill: 'smith', tech: 'advlimbs' },
  ],
};

// ---- 仕事 ----
export const JOBS = [
  { id: 'build', label: '建築', skill: 'labor' },
  { id: 'mine', label: '採掘', skill: 'labor' },
  { id: 'farm', label: '農業', skill: 'farm' },
  { id: 'cook', label: '調理', skill: 'cook' },
  { id: 'craft', label: '加工', skill: 'smith' },
  { id: 'research', label: '研究', skill: 'research' },
];
export const BASE = {
  radius: 90,             // 拠点の範囲（m）。仕事はこの中で行う
  grid: 2,
  maxSlope: 1.6,          // 建てる場所の高低差の上限（m）
  workRate: 1.5,          // 作業速度の基本値（作業量/秒。能力で上がる）
  mineCarry: 6,           // 1回に運ぶ鉱石の数
  mineTime: 3,            // 鉱石1つを掘る秒数（労働で短くなる）
  farmGrowDays: 1,        // 畑が実るまでの日数（井戸があれば半分）
  farmYield: 8,
  mineAutoPerHour: 1.2,   // 採掘機が1時間に掘る鉱石の数
  researchPerSec: 0.25,   // 研究1あたり／秒
  researchPowerMul: 2,
  towerRange: 25, towerInterval: 2.2, towerDamage: 14,
  bedHealMul: 5,
};
