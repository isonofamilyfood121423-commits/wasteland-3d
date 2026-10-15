// Phase 6：天候・襲撃・隊商と巡回・遺跡の定義（追加・調整はこのファイルで行う）

// ---- 天候 ----
// region: 起きやすい地域（sand＝砂の平原 / rust＝錆の荒地 / ash＝灰の高地）
// chance: 晴れのあとにこの天気になる確率 / hours: 続く時間（ゲーム内）
// fogMul: 霧の距離の倍率（小さいほど見通しが悪い） / tint: 霧の色 / sight: 盗賊が気づく距離の倍率
export const WEATHER = {
  clear: { label: '晴れ', fogMul: 1, sight: 1 },
  sandstorm: {
    label: '砂嵐', region: 'sand', chance: 0.35, hours: [1.2, 3.5],
    fogMul: 0.3, tint: 0xc4a06a, sunMul: 0.45, sight: 0.45,
    particle: { color: 0xd8b98a, len: 0.9, speed: 26, fall: 1.5, wind: [1, 0.35] },
  },
  acid: {
    label: '酸性雨', region: 'rust', chance: 0.32, hours: [1, 3],
    fogMul: 0.55, tint: 0x7f8a6c, sunMul: 0.5, sight: 0.75,
    particle: { color: 0xb8c79a, len: 1.4, speed: 3, fall: 18, wind: [0.2, 0.1] },
    // 雨に打たれた部位が少しずつ傷む。小屋の中にいれば平気。外套・頭の装備で軽くなる
    damagePerHour: 10, floor: 0.5, outerMul: 0.5, headMul: 0.75, raceMul: { sabibone: 1.5 },
  },
  ashfall: {
    label: '灰降り', region: 'ash', chance: 0.4, hours: [1.5, 4],
    fogMul: 0.5, tint: 0x8c8682, sunMul: 0.6, sight: 0.7,
    particle: { color: 0xcfcac4, len: 0.18, speed: 1.5, fall: 1.2, wind: [0.4, 0.2] },
  },
};
export const WEATHER_CFG = {
  clearHours: [3, 8],      // 晴れが続く時間
  fadeSec: 40,             // 天気の切り替わりにかかる秒数（現実）
  particles: { low: 450, mid: 900, high: 1400 },
};

// ---- 拠点への襲撃 ----
// 仕様判断：拠点の建物（完成済み）が minBuildings 以上になると襲撃の対象になる
export const RAID_FREQ = {
  off: { label: 'なし', days: Infinity },
  low: { label: '少なめ', days: 6 },
  normal: { label: '普通', days: 3.5 },
  high: { label: '多め', days: 2 },
};
export const RAID = {
  minBuildings: 5,
  noticeHours: 4,          // 何時間前に予告するか（ゲーム内）
  firstDelayDays: 1.5,     // 拠点を作ってから最初の襲撃までの最短日数
  spawnDist: 150,
  baseSize: 3,             // 人数の基本値（拠点の規模で増える）
  perBuildings: 7,         // 建物がこの数増えるごとに1人増える
  maxSize: 10,
  lootRatio: 0.35,         // 守り手がいなくなると、倉庫の物をこの割合奪っていく
  moneyRatio: 0.15,
  giveUpRatio: 0.4,        // この割合まで減ると逃げる
  siegeDps: 9,             // 壁・門を壊す速さ（1人・1秒あたり）
  timeoutHours: 6,         // これ以上たったら引き上げる
  // 襲ってくる勢力と重み。cond は条件（hostile: その派閥から敵とみなされているとき）
  kinds: [
    { id: 'bandit', label: '砂鼠団の襲撃隊', faction: 'bandit', w: 6, members: ['thug', 'starved', 'thug', 'starved', 'boss', 'thug', 'starved', 'thug', 'thug', 'starved'] },
    { id: 'eater', label: '灰喰らいの群れ', faction: 'eater', w: 2, members: ['eater', 'eater', 'eater', 'eater_big', 'eater', 'eater', 'eater_big', 'eater', 'eater', 'eater'] },
    { id: 'holy', label: '白灯の討伐隊', faction: 'holy', w: 3, cond: 'hostile', members: ['crusader', 'crusader', 'crusader', 'zealot', 'crusader', 'crusader', 'zealot', 'crusader', 'crusader', 'crusader'] },
  ],
};
// 建物の耐久（壊されると撤去される）。書いていない建物は壊されない
export const BUILDING_HP = { wall: 150, gate: 180, gate_iron: 480, tower: 260 };

// ---- 隊商・巡回（道の上を進む。遠くでは位置だけを動かし、近づいたら人物を出す） ----
export const TRAFFIC = {
  caravans: 4,             // 世界を行き来する隊商の数
  patrols: 3,              // 巡回部隊の数
  speed: 1.35,             // 遠くにいるときの進む速さ（m/秒）
  showDist: 170,           // 一団・カメラからこの距離に入ると人物を出す
  hideDist: 240,           // この距離より離れたら人物をしまう
  leadAhead: 36,           // 道の先のこの距離を目指して歩く
  caravan: { escorts: [2, 3], porters: [1, 2] },
  patrol: { size: [3, 5] },
};

// ---- 遺跡の探索 ----
export const RUIN = {
  searchHours: 0.12,       // 調べるのにかかる時間（ゲーム内）
  seeDist: 45,             // この距離まで近づくと地図に載る
  // 出てくる物：重みつき。q は品質（装備の場合）
  loot: [
    { id: 'relic_part', w: 10, qty: [1, 3] },
    { id: 'relic_record', w: 6, qty: [1, 2] },
    { id: 'scrap', w: 8, qty: [2, 5] },
    { id: 'relic_core', w: 1.5, qty: [1, 1] },
    { id: 'aidkit', w: 3, qty: [1, 2] },
    { id: 'long_blade', w: 1.2, qty: [1, 1], q: [1, 3] },
    { id: 'iron_helm', w: 1.2, qty: [1, 1], q: [1, 3] },
    { id: 'limb_crude', w: 0.8, qty: [1, 1] },
  ],
  rolls: [2, 4],
  money: [10, 120],
};
