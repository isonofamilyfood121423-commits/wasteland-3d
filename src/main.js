// エントリーポイント：ロジック（sim）と描画（render）をつなぐループ
import * as THREE from 'three';
import { installErrorPanel } from './core/errors.js';
import { FrameStats, DynamicResolution, QualityProbe } from './core/perf.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { QUALITY, DPR_HARD_CAP, CAMERA, WORLD, CROWD } from './data/config.js';
import { createWorld, stepWorld } from './sim/world.js';
import { Atmosphere } from './render/atmosphere.js';
import { TerrainView } from './render/terrainView.js';
import { HumanView } from './render/humanView.js';
import { CameraRig } from './ui/cameraRig.js';

/* global __BUILD__, __BUILD_TIME__ */
const BUILD = { build: __BUILD__, time: __BUILD_TIME__ };
installErrorPanel(BUILD);

const $ = (id) => document.getElementById(id);
const settings = loadSettings();

// ---- ブラウザ既定動作の無効化（ズーム・長押しメニュー・プルリフレッシュ） ----
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('#sheet,#errPanel')) e.preventDefault(); }, { passive: false });

// ---- レンダラー ----
const canvas = $('view');
let renderer;
function createRenderer(antialias) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
}
createRenderer(false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 2600);
const atmosphere = new Atmosphere(scene);
const terrain = new TerrainView(scene);
const humans = new HumanView(scene, CROWD.count);
const rig = new CameraRig(camera, canvas);
const world = createWorld(WORLD.seed);

const stats = new FrameStats();
const dyn = new DynamicResolution();
dyn.enabled = settings.dynRes;
let probe = null;
let qName = 'mid';
let q = QUALITY.mid;

function effectiveQuality() {
  if (settings.quality !== 'auto') return settings.quality;
  return settings.decidedQuality || 'mid';
}

function applyQuality(name) {
  qName = name; q = QUALITY[name];
  renderer.shadowMap.enabled = q.shadows;
  atmosphere.setShadows(q.shadows, q.shadowMap);
  humans.setShadows(q.shadows);
  terrain.setQuality(q);
  // シェーダーを影の有無に合わせて作り直す
  scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
  resize();
  updateSheet();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_HARD_CAP, q.dprCap) * dyn.scale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---- UI ----
const toastEl = $('toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function openManual() { window.open('docs/manual.html', '_blank'); }
$('manualBtn').onclick = openManual;
$('manualBtn2').onclick = openManual;

function tryFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('portrait').catch(() => {})).catch(() => {});
}

let running = false;
$('startBtn').onclick = () => {
  tryFullscreen();
  $('title').classList.add('hide');
  $('hud').classList.remove('hide');
  running = true;
  if (settings.quality === 'auto' && !settings.decidedQuality) {
    probe = new QualityProbe((res) => {
      settings.decidedQuality = res; saveSettings(settings);
      if (qName !== res) applyQuality(res);
      toast(`画質を「${QUALITY[res].label}」に自動設定しました`);
    });
    toast('端末性能を計測しています…');
  }
};

document.querySelectorAll('#speeds .btn').forEach((b) => {
  b.onclick = () => {
    world.timeScale = parseFloat(b.dataset.s);
    document.querySelectorAll('#speeds .btn').forEach((x) => x.classList.toggle('on', x === b));
  };
});

let followIndex = -1;
$('followBtn').onclick = () => {
  if (rig.follow) { rig.follow = null; $('followBtn').classList.remove('on'); toast('追従を解除しました'); return; }
  // 仕様判断：Phase 0 は選択機能がないため、カメラに最も近い人物を追従する
  let best = 0, bd = Infinity;
  world.agents.forEach((a, i) => { const d = (a.x - rig.target.x) ** 2 + (a.z - rig.target.z) ** 2; if (d < bd) { bd = d; best = i; } });
  followIndex = best;
  rig.follow = () => world.agents[followIndex];
  $('followBtn').classList.add('on');
  toast('近くの人物を追従します（ドラッグで解除）');
};
rig.onManualMove = () => $('followBtn').classList.remove('on');

$('ffBtn').onclick = () => {
  world.debugFast = !world.debugFast;
  $('ffBtn').classList.toggle('on', world.debugFast);
  toast(world.debugFast ? '時間を60倍で早送り中（昼夜の確認用）' : '早送りを解除しました');
};

// 設定シート
const sheet = $('sheet'), scrim = $('scrim');
function openSheet() { sheet.classList.add('open'); scrim.classList.add('show'); updateSheet(); }
function closeSheet() { sheet.classList.remove('open'); scrim.classList.remove('show'); }
$('menuBtn').onclick = openSheet;
$('closeSheet').onclick = closeSheet;
scrim.onclick = closeSheet;
$('fsBtn').onclick = tryFullscreen;
document.querySelectorAll('#qRow .btn').forEach((b) => {
  b.onclick = () => {
    settings.quality = b.dataset.q;
    if (b.dataset.q === 'auto') { settings.decidedQuality = null; probe = new QualityProbe((res) => { settings.decidedQuality = res; saveSettings(settings); applyQuality(res); toast(`画質を「${QUALITY[res].label}」に自動設定しました`); }); applyQuality('mid'); toast('端末性能を計測しています…'); }
    else applyQuality(b.dataset.q);
    saveSettings(settings);
  };
});
$('dynBtn').onclick = () => { settings.dynRes = !settings.dynRes; dyn.enabled = settings.dynRes; if (!dyn.enabled) { dyn.scale = 1; resize(); } saveSettings(settings); updateSheet(); };
$('dbgBtn').onclick = () => { settings.debug = !settings.debug; saveSettings(settings); updateSheet(); };
$('vibBtn').onclick = () => { settings.vibrate = !settings.vibrate; saveSettings(settings); updateSheet(); if (settings.vibrate) navigator.vibrate?.(30); };

function updateSheet() {
  document.querySelectorAll('#qRow .btn').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
  $('qNote').textContent = `現在：${QUALITY[qName].label}（解像度上限 ${q.dprCap}倍・影 ${q.shadows ? 'あり' : 'なし'}・描画距離 ${q.viewChunks * WORLD.chunkSize}m）`;
  $('dynBtn').classList.toggle('on', settings.dynRes);
  $('dbgBtn').classList.toggle('on', settings.debug);
  $('vibBtn').classList.toggle('on', settings.vibrate);
  $('debug').classList.toggle('hide', !settings.debug);
}

// ---- アプリ切替・画面オフで自動ポーズ＋描画停止 ----
let hiddenPaused = false;
let savedScale = 1;
function onHide() {
  if (hiddenPaused) return;
  hiddenPaused = true;
  savedScale = world.timeScale;
  world.timeScale = 0;
  // Phase 1 で自動セーブを実装（IndexedDB）
}
function onShow() {
  if (!hiddenPaused) return;
  hiddenPaused = false;
  world.timeScale = savedScale;
  last = performance.now();
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
window.addEventListener('pagehide', onHide);

// ---- メインループ ----
const focus = new THREE.Vector3();
let last = performance.now();
let elapsed = 0;
let dbgTimer = 0;

function loop(now) {
  if (document.hidden) return; // 描画停止（復帰時に onShow から再開）
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += dt;

  if (running) stepWorld(world, dt);
  else rig.yaw += dt * 0.04; // タイトル画面ではゆっくり旋回

  rig.update(dt);
  focus.copy(rig.target);
  const k = atmosphere.update(world.hour, focus, camera.position, q.fogFar, rig.dist);
  terrain.update(focus, k.fog, running ? 2 : 6);
  humans.update(world.agents, focus, elapsed);

  renderer.info.reset();
  renderer.render(scene, camera);

  stats.push(dt);
  if (running) {
    if (probe && !probe.done) probe.update(dt, (name) => applyQuality(name));
    else if (dyn.update(dt, stats.fps)) resize();
  }

  dbgTimer -= dt;
  if (dbgTimer <= 0) {
    dbgTimer = 0.25;
    const hh = Math.floor(world.hour), mm = Math.floor((world.hour - hh) * 60);
    $('timeLabel').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('dayLabel').textContent = `${world.day}日目 ${atmosphere.isNight ? '夜' : world.hour < 10 ? '朝' : world.hour < 17 ? '昼' : '夕'}`;
    if (settings.debug) {
      const inf = renderer.info.render;
      $('debug').textContent =
        `fps  ${stats.fps.toFixed(0)}\nms   ${stats.ms.toFixed(1)}\ncall ${inf.calls}\ntri  ${(inf.triangles / 1000).toFixed(1)}k\n` +
        `画質 ${QUALITY[qName].label} 解像度${(renderer.getPixelRatio()).toFixed(2)}\nchunk ${terrain.chunks.size}`;
    }
  }
}

// ---- 起動 ----
function boot() {
  applyQuality(effectiveQuality());
  rig.target.set(world.spawn.x, 0, world.spawn.z);
  // タイトル背景用：最初の視界ぶんのチャンクを先に用意
  terrain.update(rig.target, atmosphere.fogColor, 999);
  rig.update(0.016);
  $('loading').classList.add('hide');
  updateSheet();
  requestAnimationFrame((t) => { last = t; loop(t); });
}
boot();

// デバッグ・自動テスト用
window.__game = { world, rig, renderer, terrain, settings, BUILD };
