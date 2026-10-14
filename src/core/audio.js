// 効果音（Web Audio でその場で合成する。音声ファイルは使わない）
// ・最初のタップで AudioContext を作る（ブラウザの自動再生の制限のため）
// ・戦闘の音はカメラの注視点からの距離で小さくなる
// ・風（砂嵐）と雨の音は天候の強さに合わせて鳴らし続ける

let ctx = null, master = null, noiseBuf = null, enabled = true, volume = 0.7;
let windNode = null, rainNode = null;
const last = {};

export function initAudio(opts = {}) {
  enabled = opts.enabled !== false;
  volume = opts.volume ?? 0.7;
  const unlock = () => {
    if (!ctx) create();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
}

function create() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { ctx = new AC(); } catch { ctx = null; return; }
  master = ctx.createGain();
  master.gain.value = enabled ? volume : 0;
  // 音割れを防ぐ
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function setAudio(on, vol) {
  enabled = on;
  if (vol !== undefined) volume = vol;
  if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.05);
}
export const audioReady = () => !!ctx;

// ---- 部品 ----
function noise(t, dur, { type = 'lowpass', freq = 1200, q = 0.7, gain = 0.5, attack = 0.005, sweep = null } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}
function tone(t, dur, { type = 'sine', freq = 440, to = null, gain = 0.3, attack = 0.005 } = {}) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

// ---- 効果音 ----
const SOUNDS = {
  hit: (t, v) => { noise(t, 0.12, { freq: 900, gain: 0.55 * v }); tone(t, 0.14, { freq: 140, to: 60, gain: 0.5 * v }); },
  sever: (t, v) => { noise(t, 0.3, { freq: 1400, gain: 0.6 * v, sweep: 300 }); tone(t, 0.25, { freq: 110, to: 45, gain: 0.6 * v }); },
  block: (t, v) => { tone(t, 0.18, { type: 'triangle', freq: 1250 + Math.random() * 200, gain: 0.22 * v }); tone(t, 0.12, { type: 'square', freq: 1880, gain: 0.05 * v }); noise(t, 0.05, { type: 'highpass', freq: 3000, gain: 0.25 * v }); },
  dodge: (t, v) => { noise(t, 0.22, { type: 'bandpass', freq: 600, sweep: 2400, q: 1.5, gain: 0.25 * v, attack: 0.05 }); },
  arrow: (t, v) => { tone(t, 0.12, { type: 'sawtooth', freq: 320, to: 160, gain: 0.08 * v }); noise(t + 0.02, 0.16, { type: 'bandpass', freq: 2200, sweep: 900, q: 2, gain: 0.18 * v, attack: 0.02 }); },
  siege: (t, v) => { tone(t, 0.2, { freq: 90, to: 50, gain: 0.6 * v }); noise(t, 0.15, { freq: 500, gain: 0.45 * v }); },
  collapse: (t, v) => { noise(t, 1.1, { freq: 400, sweep: 120, gain: 0.8 * v, attack: 0.02 }); tone(t, 0.8, { freq: 70, to: 35, gain: 0.7 * v }); },
  tap: (t) => { tone(t, 0.05, { type: 'triangle', freq: 880, gain: 0.07 }); },
  select: (t) => { tone(t, 0.07, { type: 'triangle', freq: 660, gain: 0.08 }); tone(t + 0.05, 0.07, { type: 'triangle', freq: 990, gain: 0.06 }); },
  coin: (t) => { tone(t, 0.08, { type: 'square', freq: 1320, gain: 0.05 }); tone(t + 0.07, 0.14, { type: 'square', freq: 1760, gain: 0.05 }); },
  built: (t) => { for (let i = 0; i < 3; i++) { tone(t + i * 0.14, 0.1, { type: 'triangle', freq: 520, gain: 0.15 }); noise(t + i * 0.14, 0.06, { type: 'highpass', freq: 2000, gain: 0.12 }); } },
  found: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.08, 0.25, { type: 'triangle', freq: f, gain: 0.1 })); },
  alarm: (t) => { for (let i = 0; i < 3; i++) { tone(t + i * 0.5, 0.42, { type: 'sawtooth', freq: 220, to: 200, gain: 0.12, attack: 0.04 }); tone(t + i * 0.5, 0.42, { type: 'sawtooth', freq: 277, to: 250, gain: 0.08, attack: 0.04 }); } },
  notice: (t) => { tone(t, 0.3, { type: 'triangle', freq: 392, gain: 0.14 }); tone(t + 0.25, 0.45, { type: 'triangle', freq: 330, gain: 0.14 }); },
  ko: (t) => { tone(t, 0.5, { freq: 180, to: 60, gain: 0.3 }); },
};

// name: 音の種類 / dist: 注視点からの距離（m。省略時は距離による減衰なし）
export function play(name, dist = 0) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const fn = SOUNDS[name];
  if (!fn) return;
  const v = dist ? Math.max(0, 1 - dist / 70) ** 1.5 : 1;
  if (v < 0.03) return;
  // 同じ音が一度に重なりすぎないように
  const now = ctx.currentTime;
  if (last[name] && now - last[name] < 0.04) return;
  last[name] = now;
  fn(now + 0.01, v);
}

// 戦闘などの出来事（ロジックの events）から音を鳴らす
export function playEvents(events, focus) {
  for (const e of events) {
    const d = Math.hypot(e.x - focus.x, e.z - focus.z);
    if (e.kind === 'arrow') play('arrow', Math.hypot(e.fx - focus.x, e.fz - focus.z) || 1);
    else play(e.kind, d || 1);
  }
}

// 環境音（風・雨）：weather は { type, i }
function loop(filterType, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  return { src, f, g };
}
export function updateAmbience(weather, timeRunning) {
  if (!ctx || ctx.state !== 'running') return;
  if (!windNode) { windNode = loop('bandpass', 420, 0.6); rainNode = loop('highpass', 2600, 0.3); }
  const t = ctx.currentTime;
  const i = timeRunning ? weather.i : weather.i * 0.4;
  const windy = weather.type === 'sandstorm' ? i : weather.type === 'ashfall' ? i * 0.35 : 0;
  const rain = weather.type === 'acid' ? i : 0;
  // 晴れでもかすかな風
  windNode.g.gain.setTargetAtTime(0.025 + windy * 0.32, t, 0.5);
  windNode.f.frequency.setTargetAtTime(380 + windy * 300 + Math.sin(t * 0.7) * 80 * windy, t, 0.3);
  rainNode.g.gain.setTargetAtTime(rain * 0.16, t, 0.5);
}
export function suspendAudio() { ctx?.suspend?.().catch(() => {}); }
export function resumeAudio() { if (enabled) ctx?.resume?.().catch(() => {}); }
