// アイテム定義（食料・医療・素材・義肢・武器・防具）。追加・調整はこのファイルで行う

export const ITEM_CATS = { weapon: '武器', armor: '防具', food: '食料', med: '医療', trade: '交易品', material: '素材', limb: '義肢', relic: '遺物' };

// 品質：武器の威力・防具の防御力に掛かる倍率
export const QUALITY_NAMES = ['粗悪', '普通', '上質', '逸品'];
export const QUALITY_MUL = [0.7, 1, 1.25, 1.5];
export const QUALITY_PRICE = [0.5, 1, 2, 4];

// ---- 武器カテゴリ ----
// skill: 使う能力 / reach: 間合い(m) / interval: 攻撃の間隔(秒) / windup: 振りかぶる時間(秒)
export const WEAPON_CATS = {
  sword: { label: '刀剣', skill: 'melee', reach: 1.5, interval: 1.5, windup: 0.42, bleedMul: 1.2, desc: '切れ味で出血させる。扱いやすい' },
  blunt: { label: '鈍器', skill: 'melee', reach: 1.35, interval: 1.85, windup: 0.55, bleedMul: 0.3, desc: '重い一撃。防具の上からでも効き、筋力で威力が上がる' },
  polearm: { label: '長柄', skill: 'melee', reach: 2.4, interval: 1.95, windup: 0.5, bleedMul: 1, desc: '間合いが長い。先に当てられる' },
  bow: { label: '弓', skill: 'ranged', reach: 20, interval: 2.6, windup: 0.8, bleedMul: 1, desc: '離れた所から撃てる。受け止められない' },
  fist: { label: '素手', skill: 'melee', reach: 1.15, interval: 1.35, windup: 0.32, bleedMul: 0, desc: '武器を持っていないとき' },
};

// ---- 装備スロット ----
export const SLOTS = [
  { id: 'weapon', label: '武器' },
  { id: 'head', label: '頭' },
  { id: 'body', label: '胴' },
  { id: 'outer', label: '上着' },
  { id: 'legs', label: '脚' },
  { id: 'feet', label: '靴' },
  { id: 'back', label: '背中' },
];

// cover: 部位ごとの覆う割合（0〜1。当たった時にこの確率で防具が効く）
// cut/blunt: 防具が効いたときに減らす割合
export const ITEMS = {
  // 食料
  dried_meat: { label: '干し肉', cat: 'food', weight: 0.5, food: 90, price: 18 },
  hardtack: { label: '乾パン', cat: 'food', weight: 0.3, food: 55, price: 9 },
  // 医療
  bandage: { label: '包帯', cat: 'med', weight: 0.2, aid: { kind: 'bandage', power: 18, speed: 1 }, price: 12 },
  aidkit: { label: '応急処置キット', cat: 'med', weight: 0.8, aid: { kind: 'bandage', power: 40, speed: 1.6 }, price: 45 },
  repair_kit: { label: '修理キット', cat: 'med', weight: 0.8, aid: { kind: 'repair', power: 35, speed: 1.2 }, price: 40 },
  rope: { label: '縄', cat: 'material', weight: 0.6, price: 8 },
  // 交易品（町ごとに値段が大きく違う。安い町で買って高い町で売る）
  trade_salt: { label: '塩', cat: 'trade', weight: 1, price: 30 },
  trade_iron: { label: '鉄板', cat: 'trade', weight: 3, price: 64 },
  trade_cloth: { label: '布', cat: 'trade', weight: 0.8, price: 26 },
  trade_herb: { label: '薬草', cat: 'trade', weight: 0.3, price: 22 },
  // 拠点の資源（Phase 5）
  stone: { label: '石材', cat: 'material', weight: 3, price: 8 },
  iron_ore: { label: '鉄鉱石', cat: 'material', weight: 3, price: 10 },
  grain: { label: '穀物', cat: 'material', weight: 0.5, price: 4 },
  flatbread: { label: '平焼きパン', cat: 'food', weight: 0.3, food: 80, price: 14 },
  // 遺物（Phase 6）：遺跡で見つかる研究素材。高く売れる
  relic_part: { label: '古代の部品', cat: 'relic', weight: 1, price: 110 },
  relic_record: { label: '古い記録板', cat: 'relic', weight: 0.5, price: 180 },
  relic_core: { label: '動力核', cat: 'relic', weight: 2, price: 650 },
  // 素材
  scrap: { label: '鉄くず', cat: 'material', weight: 4, price: 6 },
  // 義肢
  limb_crude: { label: '粗末な義肢', cat: 'limb', weight: 6, limb: { grade: 1, hp: 50, speed: 0.8 }, price: 300 },
  limb_good: { label: '上等な義肢', cat: 'limb', weight: 5, limb: { grade: 2, hp: 80, speed: 1.0 }, price: 1200 },

  // 武器
  rusty_blade: { label: '錆びた刀', cat: 'weapon', slot: 'weapon', weapon: { type: 'sword', cut: 15, blunt: 3, reqStr: 1 }, weight: 2.5, price: 60, look: 'sword', color: 0x8a7f74 },
  long_blade: { label: '長刀', cat: 'weapon', slot: 'weapon', weapon: { type: 'sword', cut: 22, blunt: 5, reqStr: 12 }, weight: 4, price: 260, look: 'longsword', color: 0xa9a49c },
  iron_club: { label: '鉄棍', cat: 'weapon', slot: 'weapon', weapon: { type: 'blunt', cut: 0, blunt: 19, reqStr: 6 }, weight: 4.5, price: 70, look: 'club', color: 0x5c5650 },
  sledge: { label: '大槌', cat: 'weapon', slot: 'weapon', weapon: { type: 'blunt', cut: 2, blunt: 32, reqStr: 22 }, weight: 9, price: 320, look: 'hammer', color: 0x4c4744 },
  spear: { label: '槍', cat: 'weapon', slot: 'weapon', weapon: { type: 'polearm', cut: 14, blunt: 4, reqStr: 4 }, weight: 4, price: 90, look: 'spear', color: 0x8a7f74 },
  glaive: { label: '薙刀', cat: 'weapon', slot: 'weapon', weapon: { type: 'polearm', cut: 21, blunt: 6, reqStr: 14 }, weight: 6, price: 300, look: 'glaive', color: 0x9c968e },
  short_bow: { label: '短弓', cat: 'weapon', slot: 'weapon', weapon: { type: 'bow', cut: 13, blunt: 1, reqStr: 3 }, weight: 1.5, price: 140, look: 'bow', color: 0x6b4a32 },
  // 仕様判断：弓の矢は Phase 3 では消費しない（持ち物の管理を簡単にするため。Phase 7 で検討）

  // 防具
  straw_hat: { label: '笠', cat: 'armor', slot: 'head', weight: 0.4, armor: { cover: { head: 0.5 }, cut: 0.05, blunt: 0.05 }, price: 15, look: 'hat', color: 0x8c7556 },
  cloth_hood: { label: '布頭巾', cat: 'armor', slot: 'head', weight: 0.4, armor: { cover: { head: 0.7 }, cut: 0.15, blunt: 0.1 }, price: 30, look: 'hood', color: 0x6b5a45 },
  iron_helm: { label: '鉄兜', cat: 'armor', slot: 'head', weight: 3, armor: { cover: { head: 0.85 }, cut: 0.55, blunt: 0.3 }, price: 280, look: 'helm', color: 0x6f6a64 },
  rag_shirt: { label: '布の服', cat: 'armor', slot: 'body', weight: 0.8, armor: { cover: { chest: 0.9, stomach: 0.9 }, cut: 0.05, blunt: 0.02 }, price: 12, look: 'shirt' },
  leather_vest: { label: '革の胴着', cat: 'armor', slot: 'body', weight: 3, armor: { cover: { chest: 0.9, stomach: 0.85 }, cut: 0.3, blunt: 0.15 }, price: 140, look: 'vest', color: 0x6b4a32 },
  iron_plate: { label: '鉄の胸当て', cat: 'armor', slot: 'body', weight: 9, armor: { cover: { chest: 0.95, stomach: 0.6 }, cut: 0.6, blunt: 0.3 }, price: 520, look: 'plate', color: 0x6f6a64 },
  dust_cloak: { label: '砂除けの外套', cat: 'armor', slot: 'outer', weight: 2, armor: { cover: { chest: 0.7, stomach: 0.7, armL: 0.5, armR: 0.5, legL: 0.4, legR: 0.4 }, cut: 0.12, blunt: 0.05 }, price: 80, look: 'cloak', color: 0x8c7a5e },
  leather_pants: { label: '革のズボン', cat: 'armor', slot: 'legs', weight: 2, armor: { cover: { legL: 0.9, legR: 0.9 }, cut: 0.2, blunt: 0.1 }, price: 70, look: 'pants', color: 0x5d4436 },
  iron_greaves: { label: '鉄の脛当て', cat: 'armor', slot: 'legs', weight: 5, armor: { cover: { legL: 0.8, legR: 0.8 }, cut: 0.5, blunt: 0.25 }, price: 300, look: 'greaves', color: 0x6f6a64 },
  sandals: { label: '草鞋', cat: 'armor', slot: 'feet', weight: 0.3, armor: { cover: {}, cut: 0, blunt: 0 }, price: 5, look: 'feet', color: 0x8c7556 },
  boots: { label: '革靴', cat: 'armor', slot: 'feet', weight: 1.2, armor: { cover: { legL: 0.2, legR: 0.2 }, cut: 0.2, blunt: 0.1 }, price: 60, look: 'feet', color: 0x3e2f25 },
  backpack: { label: '背負い袋', cat: 'armor', slot: 'back', weight: 1.5, carry: 22, price: 90, look: 'pack', color: 0x6b4130 },
};

export function itemLabel(id, q) {
  const it = ITEMS[id];
  if (!it) return id;
  return (it.weapon || it.armor || it.carry) && q !== undefined && q !== 1 ? `${it.label}（${QUALITY_NAMES[q]}）` : it.label;
}
