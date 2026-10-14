// 調整用の数値・定義はすべてここに集める（CLAUDE.md 品質ルール）

export const GAME_TITLE = '砂錆の地';
export const GAME_SUBTITLE = 'RUSTWASTE';
// 仕様判断：正式タイトル未定のため仮題。原作と無関係なオリジナル名称。

// ---- 世界 ----
export const WORLD = {
  seed: 1729,
  chunkSize: 64,          // 1チャンクの一辺（m）
  chunkRes: 24,           // 1チャンクの分割数（低画質では減らす）
  limit: 3000,            // カメラが移動できる範囲（±m）
  maxHeight: 60,
  seaLevel: -100,         // Phase 0 では水域なし
};

// ---- 経路探索 ----
export const PATH = {
  cell: 2,            // グリッド1マス（m）
  maxSlope: 0.95,     // これより急な斜面（約44°）は通行不可＝崖
  slopeCost: 2.5,     // 傾斜1あたりの追加コスト
  maxNodes: 12000,    // 1回の探索で調べる最大マス数（遠い目的地は到達できた所から再探索）
};

// ---- 時間 ----
// 仕様判断：ゲーム内1日＝現実約20分（1x時）。CLAUDE.md「時間の扱い」
export const TIME = {
  realSecondsPerDay: 20 * 60,
  startHour: 15.5,        // 初回は夕方前から（長い影を早めに見せるため）
  speeds: [0, 0.5, 1, 2, 3],
  debugFastForward: 60,   // デバッグ用早送り倍率
};

// ---- 画質プリセット ----
export const QUALITY = {
  low: {
    label: '低', dprCap: 1.0, shadows: false, shadowMap: 0,
    viewChunks: 2, chunkRes: 16, rockPerChunk: 10, grassPerChunk: 30,
    fogFar: 150, antialias: false,
  },
  mid: {
    label: '中', dprCap: 1.25, shadows: true, shadowMap: 1024,
    viewChunks: 3, chunkRes: 20, rockPerChunk: 18, grassPerChunk: 70,
    fogFar: 210, antialias: false,
  },
  high: {
    label: '高', dprCap: 1.5, shadows: true, shadowMap: 2048,
    viewChunks: 4, chunkRes: 24, rockPerChunk: 26, grassPerChunk: 120,
    fogFar: 270, antialias: true,
  },
};
export const DPR_HARD_CAP = 1.5;
export const DYN_RES = {
  minScale: 0.55,        // 上限解像度に対する最小倍率
  lowFps: 40, highFps: 56,
  lowWindow: 1.5, highWindow: 4.0, // 秒
  step: 0.1,
};

// ---- カメラ ----
export const CAMERA = {
  fov: 45,
  minDist: 10, maxDist: 110, startDist: 42,
  minPitch: 0.55, maxPitch: 1.22, // ラジアン（約32°〜70°）。俯角のみ制限
  startPitch: 0.74,
  panInertia: 0.9,
};

// ---- 色（砂・錆・灰を基調にした低彩度パレット） ----
export const PALETTE = {
  sandLight: 0xd8c6a2,
  sand: 0xc2aa82,
  sandDark: 0x8c7556,
  rust: 0x8f5a3c,
  rustDark: 0x6b4130,
  rock: 0x7b7570,
  rockDark: 0x57524f,
  ash: 0x9a948a,
  grassDry: 0x9a8c5a,
  ruin: 0x6e6a64,
  ruinRust: 0x7a4b34,
  skin: [0xd2a07a, 0xa8754f, 0x7b5236, 0xc9b49a, 0x8d8a86],
  cloth: [0x6b5a45, 0x5a5f55, 0x7a6248, 0x4e4a46, 0x8a7a5e, 0x5d4436, 0x6e6f6a],
  // 派閥差し色（Phase 4 以降で使用）
  factionAccent: {
    holy: 0xd8d0b8, merchant: 0x3f6f8f, bandit: 0xa3392b, eater: 0x5e7a3a, machine: 0x9aa7ad,
  },
};

// ---- 昼夜の色（時刻ごとのキーフレーム） ----
// h: 時刻, sun: 太陽光色, sunI: 強さ, sky/ground: 半球光, hemiI: 強さ, fog: 霧と空の地平色, top: 天頂色, fogK: 霧距離係数
export const DAY_KEYS = [
  { h: 0,  sun: 0x8090c0, sunI: 0.5,  sky: 0x3a4870, ground: 0x2a2620, hemiI: 0.6,  fog: 0x262e42, top: 0x0e1426, fogK: 0.55 },
  { h: 4.5,sun: 0x8090c0, sunI: 0.45, sky: 0x3e4a70, ground: 0x2a2620, hemiI: 0.6,  fog: 0x2c3448, top: 0x10162a, fogK: 0.6 },
  { h: 6,  sun: 0xffa66a, sunI: 1.1,  sky: 0x8a8aa0, ground: 0x5a4a3a, hemiI: 0.6,  fog: 0xc79a7a, top: 0x5b6f96, fogK: 0.8 },
  { h: 8,  sun: 0xffe2bd, sunI: 2.2,  sky: 0xb7c2cc, ground: 0x8a7458, hemiI: 0.9,  fog: 0xd9c9ad, top: 0x8ea6c2, fogK: 1.0 },
  { h: 12, sun: 0xfff2dc, sunI: 2.8,  sky: 0xc6cdd2, ground: 0x9a8262, hemiI: 1.0,  fog: 0xddd0b6, top: 0x93aac4, fogK: 1.0 },
  { h: 16, sun: 0xffdcae, sunI: 2.4,  sky: 0xbcbcbc, ground: 0x917556, hemiI: 0.9,  fog: 0xd8c3a0, top: 0x8a9fbd, fogK: 1.0 },
  { h: 18, sun: 0xff9a5a, sunI: 1.7,  sky: 0xa08c8c, ground: 0x6a5240, hemiI: 0.7,  fog: 0xbf9a80, top: 0x5f6a90, fogK: 0.9 },
  { h: 19.3,sun: 0xb0607a, sunI: 0.5, sky: 0x4a4560, ground: 0x2a2018, hemiI: 0.45, fog: 0x4a3a46, top: 0x1c2140, fogK: 0.65 },
  { h: 21, sun: 0x8090c0, sunI: 0.5,  sky: 0x3a4870, ground: 0x2a2620, hemiI: 0.6,  fog: 0x262e42, top: 0x0e1426, fogK: 0.55 },
  { h: 24, sun: 0x8090c0, sunI: 0.5,  sky: 0x3a4870, ground: 0x2a2620, hemiI: 0.6,  fog: 0x262e42, top: 0x0e1426, fogK: 0.55 },
];

// ---- 人体の造形パラメータ ----
export const BODY = {
  // 長さ（m）。種族ごとの体型差は Phase 2 で倍率として追加
  headR: 0.13, neck: 0.06,
  torsoH: 0.5, torsoW: 0.2, pelvisH: 0.14,
  upperArm: 0.3, foreArm: 0.28, armR: 0.055,
  thigh: 0.44, shin: 0.43, legR: 0.07,
  shoulderX: 0.24, hipX: 0.1,
};

// ---- Phase 0 群衆テスト ----
export const CROWD = {
  count: 50,
  spawnRadius: 55,
  wanderRadius: 45,
  walkSpeed: [1.1, 1.9],
  idleTime: [1, 6],
};

// ---- プレイヤーの一団 ----
// 仕様判断：開始時は3人。所持金の単位はオリジナル通貨「錆貨（さびか）」
export const PARTY = {
  size: 3,
  runSpeed: 3.4,
  startMoney: 300,
  currency: '錆貨',
  formationGap: 1.6,   // 複数人へ同じ地点を指示したときの間隔（m）
  clothColor: 0x4f6f6a, // プレイヤー側の差し色
};

// オリジナルの人名（音の組み合わせ）
export const NAMES = {
  first: ['サク', 'ヨミ', 'ガラン', 'ルカ', 'テツ', 'ナギ', 'ハル', 'キサ', 'ドウ', 'マオ', 'リン', 'ソウ', 'イオ', 'カヤ', 'ジン', 'ノエ', 'ベル', 'トキ'],
  last: ['砂原', '灰谷', '赤錆', '石橋', '風見', '塩田', '鉄野', '乾', '影山', '古坂'],
};

// ---- 操作 ----
export const INPUT = {
  tapMaxMove: 10,      // px：これ以上動いたらドラッグ扱い
  tapMaxTime: 450,     // ms（長押し判定より短く離せばタップ）
  longPress: 450,      // ms
  pickRadius: 34,      // px：人物のタップ判定（見た目より大きめ）
};

// ---- セーブ ----
export const SAVE = {
  version: 2,         // Phase 2 で体・能力・所持品を追加
  slots: 3,
  autosaveInterval: 60, // 秒（現実時間）
};
