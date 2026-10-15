// 設定の保存（localStorage）。セーブデータ本体は Phase 1 で IndexedDB に実装
const KEY = 'w3d.settings.v1';
const DEFAULTS = {
  quality: 'auto',      // auto | low | mid | high
  decidedQuality: null, // 自動判定の結果
  dynRes: true,
  debug: true,          // Phase 0 は検証用に既定でオン
  vibrate: true,
  labels: 'role',       // 頭上の名札：all（全員）・role（役割のある人）・off
  brightness: 1,        // 全体の明るさ（露出の倍率）
  nightLift: 1,         // 夜の明るさ 0〜2
  fpsCap: 60,           // 30 にすると省電力
  sound: true,          // 効果音（Phase 6）
  volume: 0.7,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 容量不足・プライベートモードでも続行 */ }
}
