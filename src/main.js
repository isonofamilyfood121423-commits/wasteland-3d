// エントリーポイント：ロジック（sim）と描画（render）と操作（ui）をつなぐ
import * as THREE from 'three';
import { installErrorPanel } from './core/errors.js';
import { FrameStats, DynamicResolution, QualityProbe } from './core/perf.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { serialize, deserialize, saveSlot, loadSlot, deleteSlot, listSlots, exportText, importText, SLOT_IDS, slotLabel } from './core/save.js';
import { QUALITY, DPR_HARD_CAP, CAMERA, WORLD, CROWD, PARTY, SAVE } from './data/config.js';
import { createWorld, stepWorld, orderMove, orderRest, orderTreat, stopPerson, partyOf, personById, addLog, attachRuntime, attachProsthetic, debug } from './sim/world.js';
import { healthPct, totalBleed, eat, partsNeedingAid, addItem, removeItem } from './sim/body.js';
import { RACES, ITEMS, PART } from './data/body.js';
import { renderBody, renderSkills, renderInventory, renderEquip, stateText } from './ui/personSheet.js';
import { equipItem, unequip } from './sim/equip.js';
import { orderAttack, orderRetreat, orderCarry, orderBind, orderRelease, dropCarried, hostile } from './sim/combat.js';
import { itemLabel } from './data/items.js';
import { FACTIONS, TOWNS, REP, SHOPS, ROLE_LABEL } from './data/world.js';
import { TownView } from './render/townView.js';
import { ensureMapImage, drawMap, screenToMap } from './ui/map.js';
import { shopStock, priceOf, buy, sell, canSell, steal, stealChance, hire } from './sim/trade.js';
import { isWanted, fineFor, payFine, handoverCandidates, handOver, changeRep } from './sim/factions.js';
import { townLayout, townById } from './sim/towns.js';
import { townAt } from './sim/terrain.js';
import { LINES } from './data/dialog.js';
import { BaseView } from './render/baseView.js';
import {
  ensureBase, canPlace, placeBuilding, placeWall, snapPos, footprint, missingFor, buildableTypes, unlocked, techAvailable,
  stockCount, stockTake, stockAdd, parseKey, demolish, toggleGate, powerState, freeBed, cagePrisoner, releaseCage, defaultJobs,
} from './sim/base.js';
import { BUILDINGS, TECHS, RECIPES, JOBS, BASE } from './data/build.js';
import { Effects } from './render/effects.js';
import { WeatherView } from './render/weatherView.js';
import { CacheView } from './render/cacheView.js';
import { weatherInfo, setWeather } from './sim/weather.js';
import { raidCountdownHours, begin as beginRaid, resetRaidSchedule, ensureRaid, baseScore } from './sim/raids.js';
import { trafficMarks } from './sim/traffic.js';
import { cachesNear, cacheState, orderSearch } from './sim/ruins.js';
import { RAID_FREQ, RAID, WEATHER, WEATHER_CFG } from './data/events.js';
import { initAudio, setAudio, play, playEvents, updateAmbience, suspendAudio, resumeAudio } from './core/audio.js';
import { Atmosphere } from './render/atmosphere.js';
import { TerrainView } from './render/terrainView.js';
import { HumanView } from './render/humanView.js';
import { Markers, RING } from './render/markers.js';
import { CameraRig } from './ui/cameraRig.js';
import { screenToGround, pickPeople, peopleInRect } from './ui/picking.js';
import { faceIcon } from './ui/faces.js';
import { Labels } from './ui/labels.js';
import { ask, confirmBox, toast } from './ui/dialog.js';

/* global __BUILD__, __BUILD_TIME__ */
const BUILD = { build: __BUILD__, time: __BUILD_TIME__ };
installErrorPanel(BUILD);

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const vibrate = (ms) => { if (settings.vibrate) navigator.vibrate?.(ms); };
initAudio({ enabled: settings.sound, volume: settings.volume });

// ---- ブラウザ既定動作の無効化（ズーム・長押しメニュー・プルリフレッシュ） ----
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('#sheetBody,#errPanel,#party,#dialog textarea')) e.preventDefault(); }, { passive: false });

// ---- レンダラー ----
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const BASE_EXPOSURE = 1.18;
renderer.toneMappingExposure = BASE_EXPOSURE * (settings.brightness || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 2600);
const atmosphere = new Atmosphere(scene);
const terrain = new TerrainView(scene);
const humans = new HumanView(scene, 300);
const markers = new Markers(scene);
const effects = new Effects(scene);
const towns = new TownView(scene);
const baseView = new BaseView(scene);
const weatherView = new WeatherView(scene, WEATHER_CFG.particles.high);
const cacheView = new CacheView(scene);
const rig = new CameraRig(camera, canvas);
const labels = new Labels(document.getElementById('labels'));

let world = createWorld(WORLD.seed); // タイトル背景にも使う
const selected = new Set();  // 選択中の仲間の id
let inspected = null;        // 選択中の仲間以外の人物（情報表示用）

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
  towns.setShadows(q.shadows);
  baseView.setShadows(q.shadows);
  cacheView.setShadows(q.shadows);
  weatherView.setCount(WEATHER_CFG.particles[name] || 600);
  terrain.setQuality(q);
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  resize();
  if (sheetTab === 'settings') renderSheet();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_HARD_CAP, q.dprCap) * dyn.scale);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function tryFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('portrait').catch(() => {})).catch(() => {});
}
const openManual = () => window.open('docs/manual.html', '_blank');

// =====================================================================
// 世界の開始・セーブ・ロード
// =====================================================================
let running = false;
let gameOverShown = false;

function cameraState() { return { x: rig.target.x, z: rig.target.z, yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist }; }

function startWorld(w, cam) {
  world = w;
  attachRuntime(world);
  world.onLog = (text) => toast(text);
  let lastBuzz = 0;
  world.onPartyHit = () => { const t = performance.now(); if (t - lastBuzz > 400) { lastBuzz = t; vibrate(25); } };
  world.onAlarm = () => { vibrate([60, 40, 60]); play('alarm'); };
  world.onRaid = (stage) => {
    if (stage === 'notice') { vibrate([40, 30, 40]); play('notice'); }
    if (stage === 'repelled') play('found');
  };
  world.onFound = () => play('found');
  world.onToll = (t) => onToll(t);
  gameOverShown = false;
  humans.reset();
  selected.clear(); inspected = null; rig.follow = null;
  const party = partyOf(world);
  if (cam) {
    rig.target.set(cam.x, 0, cam.z); rig.yaw = cam.yaw; rig.pitch = cam.pitch; rig.dist = cam.dist;
  } else if (party.length) {
    rig.target.set(party[0].x, 0, party[0].z); rig.dist = 30; rig.pitch = CAMERA.startPitch;
  }
  rig.smoothY = 0; rig.update(1);
  // ロード時：移動中だった人の目的地を引き継ぐ
  for (const p of world.people) if (p.pendingGoal) { orderMove(world, [p.id], p.pendingGoal.x, p.pendingGoal.z); delete p.pendingGoal; }
  if (party.length) selected.add(party[0].id);
  setSpeedButtons();
  renderParty();
  $('title').classList.add('hide');
  $('hud').classList.remove('hide');
  running = true;
  lastAutosave = performance.now();
  if (settings.quality === 'auto' && !settings.decidedQuality) startProbe();
}

async function autosave() {
  if (!running) return;
  try { await saveSlot('auto', serialize(world, cameraState(), BUILD.build)); } catch { /* 自動セーブの失敗は次回に再試行 */ }
  lastAutosave = performance.now();
}

async function newGame() {
  const meta = listSlots();
  if (meta.auto && !(await confirmBox('はじめから遊びますか？\n自動セーブは次の自動セーブで上書きされます（スロットのセーブは残ります）。', 'はじめから'))) return;
  tryFullscreen();
  const r = await ask('拠点への襲撃の頻度を選んでください。\n（拠点をある程度大きくすると、盗賊などが攻めてきます。襲撃の前には予告があります。あとから設定で変えられます）', [
    { label: 'なし', value: 'off' }, { label: '少なめ', value: 'low' }, { label: '普通', value: 'normal', cls: 'primary' }, { label: '多め', value: 'high' },
  ]);
  startWorld(createWorld(WORLD.seed + Math.floor(Math.random() * 1e6)));
  // 仕様判断：地形は固定シード（手作りに近い世界として扱う）、人物の顔ぶれだけ毎回変える
  world.seed = WORLD.seed;
  world.raidFreq = r.value || 'normal';
}

async function loadFrom(id) {
  const data = await loadSlot(id);
  if (!data) { toast('セーブデータがありません'); return; }
  try {
    const { world: w, camera: cam } = deserialize(data);
    tryFullscreen();
    closeSheet();
    startWorld(w, cam);
    toast(`${slotLabel(id)}を読み込みました`);
  } catch (e) {
    await ask(`読み込めませんでした。\n${e.message}`, [{ label: '閉じる', value: 0 }]);
  }
}

function refreshTitle() {
  const m = listSlots().auto;
  $('contBtn').classList.toggle('hide', !m);
  if (m) $('contInfo').textContent = `${m.day}日目 ${fmtHour(m.hour)}・${(m.members || []).join('、')}`;
}
$('contBtn').onclick = () => loadFrom('auto');
$('newBtn').onclick = newGame;
$('loadBtn').onclick = () => openSheet('save');
$('manualBtn').onclick = openManual;

// =====================================================================
// HUD・一団の顔アイコン
// =====================================================================
const fmtHour = (h) => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };

function setSpeedButtons() {
  document.querySelectorAll('#speeds .btn').forEach((x) => x.classList.toggle('on', parseFloat(x.dataset.s) === world.timeScale));
  $('hud').classList.toggle('paused', world.timeScale === 0);
  $('pauseBadge').classList.toggle('hide', world.timeScale !== 0);
}
document.querySelectorAll('#speeds .btn').forEach((b) => {
  b.onclick = () => { world.timeScale = parseFloat(b.dataset.s); setSpeedButtons(); };
});

function renderParty() {
  const box = $('party');
  box.innerHTML = '';
  for (const p of partyOf(world)) {
    const el = document.createElement('button');
    el.className = 'face';
    el.dataset.id = p.id;
    el.innerHTML = `<img src="${faceIcon(p)}" alt=""><span>${p.name}</span><div class="hpb"><i></i></div><div class="st"></div>`;
    el.onclick = () => {
      // すでに1人だけ選択中なら、カメラをその人へ（さらに押すと詳細）
      if (selected.size === 1 && selected.has(p.id)) {
        if (Math.hypot(rig.target.x - p.x, rig.target.z - p.z) < 3) openPerson(p.id, 'body');
        else centerOn(p);
        return;
      }
      selectOnly(p.id);
    };
    box.appendChild(el);
  }
  updatePartyMarks();
}
function updatePartyMarks() {
  document.querySelectorAll('#party .face').forEach((el) => {
    const p = personById(world, +el.dataset.id);
    el.classList.toggle('sel', selected.has(+el.dataset.id));
    if (!p) return;
    el.classList.toggle('moving', !!p.path.length);
    el.classList.toggle('ko', p.state === 'ko');
    el.classList.toggle('dead', p.state === 'dead');
    el.classList.toggle('bleeding', totalBleed(p) > 0.05 && p.state !== 'dead');
    const hp = healthPct(p);
    const bar = el.querySelector('.hpb i');
    bar.style.width = Math.round(hp * 100) + '%';
    bar.style.background = hp > 0.66 ? '#6fd27a' : hp > 0.33 ? '#d8c35a' : '#c9573f';
    const st = p.state === 'dead' ? '死亡' : p.jailUntil ? '投獄' : p.state === 'ko' ? '気絶' : totalBleed(p) > 0.05 ? '出血' : p.task?.kind === 'treat' ? '治療' : p.task?.kind === 'rest' ? '休息' : p.sneak ? '忍び' : '';
    el.querySelector('.st').textContent = st;
  });
}
function selectOnly(id) { selected.clear(); selected.add(id); inspected = null; updatePartyMarks(); play('tap'); }
function centerOn(p) { rig.follow = null; rig.target.x = p.x; rig.target.z = p.z; rig.vel.set(0, 0); }
function selectedParty() { return [...selected].map((id) => personById(world, id)).filter(Boolean); }

$('allBtn').onclick = () => { selected.clear(); for (const p of partyOf(world)) selected.add(p.id); inspected = null; updatePartyMarks(); toast('全員を選択しました'); };
$('stopBtn').onclick = () => {
  const s = selectedParty();
  if (!s.length) { toast('仲間を選択してください'); return; }
  s.forEach(stopPerson); toast('その場で待機します');
};
let combatMode = false;
$('restBtn').onclick = () => {
  if (combatMode) {
    const s = selectedParty().filter((p) => p.state === 'ok');
    if (!s.length) { toast('退却する仲間を選択してください'); return; }
    orderRetreat(world, s);
    toast('退却します。倒れた仲間は長押し→「担ぐ」で連れて逃げられます');
    return;
  }
  const s = selectedParty().filter((p) => p.state === 'ok');
  if (!s.length) { toast('休ませる仲間を選択してください'); return; }
  orderRest(world, s.map((p) => p.id));
  toast('座って休みます（回復が速くなります）');
};
$('followBtn').onclick = () => {
  if (rig.follow) { rig.follow = null; $('followBtn').classList.remove('on'); toast('追従を解除しました'); return; }
  const p = selectedParty()[0] || inspected;
  if (!p) { toast('追従する人物を選択してください'); return; }
  followPerson(p);
};
function followPerson(p) {
  const id = p.id;
  rig.follow = () => personById(world, id) || rig.target;
  $('followBtn').classList.add('on');
  toast(`${p.name}を追従します（ドラッグで解除）`);
}
rig.onManualMove = () => $('followBtn').classList.remove('on');

// ---- 範囲選択 ----
$('boxBtn').onclick = () => setBoxMode(!rig.selectMode);
function setBoxMode(on) {
  rig.selectMode = on;
  $('boxBtn').classList.toggle('on', on);
  $('modeTip').classList.toggle('hide', !on);
  if (!on) $('selRect').classList.add('hide');
}
rig.onSelectDrag = (x0, y0, x1, y1) => {
  const r = $('selRect');
  r.classList.remove('hide');
  Object.assign(r.style, { left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
};
rig.onSelectEnd = (x0, y0, x1, y1) => {
  $('selRect').classList.add('hide');
  if (x0 === null) return;
  const hit = peopleInRect(camera, partyOf(world), x0, y0, x1, y1);
  if (!hit.length) { toast('囲んだ範囲に仲間がいません'); return; }
  selected.clear(); hit.forEach((p) => selected.add(p.id)); inspected = null;
  updatePartyMarks(); vibrate(15);
  toast(`${hit.length}人を選択しました`);
  setBoxMode(false);
};

// =====================================================================
// タップ・長押し
// =====================================================================
const pop = $('pop');
function closePop() { pop.classList.add('hide'); pop.innerHTML = ''; }

// 近くに複数の人物がいる場合は一覧から選ばせる
function choose(people, title) {
  return new Promise((resolve) => {
    pop.innerHTML = `<div class="head">${title}<small>近くに${people.length}人</small></div><div class="list"></div><button class="btn ghost cancel">やめる</button>`;
    const list = pop.querySelector('.list');
    people.slice(0, 5).forEach((p) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `${p.name}${p.kind === 'party' ? '（仲間）' : '（流れ者）'}`;
      b.onclick = () => { closePop(); resolve(p); };
      list.appendChild(b);
    });
    pop.querySelector('.cancel').onclick = () => { closePop(); resolve(null); };
    pop.classList.remove('hide');
  });
}

function showActions(title, sub, actions) {
  pop.innerHTML = `<div class="head">${title}<small>${sub || ''}</small></div><div class="grid"></div><button class="btn ghost cancel">閉じる</button>`;
  const grid = pop.querySelector('.grid');
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.innerHTML = a.phase ? `${a.label}<small>${a.phase}で実装</small>` : a.label;
    b.disabled = !!a.phase;
    b.onclick = () => { closePop(); a.run(); };
    grid.appendChild(b);
  }
  pop.querySelector('.cancel').onclick = closePop;
  pop.classList.remove('hide');
}

function moveSelectedTo(x, z) {
  const s = selectedParty();
  if (!s.length) { toast('先に仲間を選択してください（下の顔アイコン）'); return false; }
  orderMove(world, s.map((p) => p.id), x, z);
  updatePartyMarks();
  vibrate(10);
  return true;
}

async function pickAt(x, y, title) {
  const hits = pickPeople(camera, world.people, x, y);
  if (hits.length <= 1) return hits[0] || null;
  return choose(hits, title);
}

rig.onTap = async (x, y) => {
  if (!running) return;
  if (!pop.classList.contains('hide')) { closePop(); return; }
  const hits = pickPeople(camera, world.people, x, y);
  if (hits.length) {
    const p = hits.length > 1 ? await choose(hits, 'だれを選びますか') : hits[0];
    if (!p) return;
    if (p.kind === 'party') { selectOnly(p.id); vibrate(8); return; }
    const fighters = selectedParty().filter((m) => m.state === 'ok');
    // 敵をタップ：選択中の仲間で攻撃
    if (fighters.length && p.state === 'ok' && !p.bound && hostile(fighters[0], p)) {
      orderAttack(world, fighters, p); inspected = p; vibrate(12);
      toast(`${p.name}を攻撃します`);
      return;
    }
    inspected = p;
    // 町の人をタップ：話しかける
    if (p.role && p.state === 'ok' && !p.bound && !hostile(p, partyOf(world)[0] || p)) { talk(p); return; }
    toast(`${p.name}（${p.title || FACTIONS[p.faction]?.label || '流れ者'}）　長押しで行動を選べます`);
    return;
  }
  const g = screenToGround(camera, x, y);
  if (!g) return;
  const bld = buildingAt(g.x, g.z);
  if (bld && !buildMode) { buildingActions(bld); return; }
  const cache = cachesNear(g.x, g.z, 1.6)[0];
  if (cache && !buildMode) { cacheActions(cache); return; }
  moveSelectedTo(g.x, g.z);
};

rig.onLongPress = async (x, y) => {
  if (!running) return;
  vibrate(20);
  const p = await pickAt(x, y, 'だれに対して？');
  if (p) return personActions(p);
  const g = screenToGround(camera, x, y);
  if (!g) return;
  const bld = buildingAt(g.x, g.z);
  if (bld) { buildingActions(bld); return; }
  const cache = cachesNear(g.x, g.z, 3.5)[0];
  if (cache) { cacheActions(cache); return; }
  showActions('この地点', `${Math.round(g.x)}, ${Math.round(g.z)}`, [
    { label: '選択中の仲間を移動', run: () => moveSelectedTo(g.x, g.z) },
    { label: '全員をここへ', run: () => { const all = partyOf(world); orderMove(world, all.map((m) => m.id), g.x, g.z); selected.clear(); all.forEach((m) => selected.add(m.id)); updatePartyMarks(); } },
    { label: 'カメラをここへ', run: () => { rig.follow = null; rig.target.x = g.x; rig.target.z = g.z; } },
  ]);
};

// 廃墟の遺物の箱
function cacheActions(c) {
  const st = cacheState(world, c.key);
  if (st === 2) { showActions('古い箱', '空っぽ（調べ済み）', [{ label: 'そばへ移動', run: () => moveSelectedTo(c.x + 1, c.z + 1) }]); return; }
  showActions('古い箱', '廃墟に残された箱。遺物が入っているかもしれない', [
    { label: '調べる', run: () => {
      let s = selectedParty().filter((m) => m.state === 'ok');
      if (!s.length) { toast('調べる仲間を選択してください'); return; }
      s = s.sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
      if (orderSearch(world, s[0], c)) { toast(`${s[0].name}が箱を調べに行きます`); play('select'); }
    } },
    { label: 'そばへ移動', run: () => moveSelectedTo(c.x + 1, c.z + 1) },
  ]);
}

function treatWith(patient) {
  // 選択中の仲間で治療する。だれも選んでいなければ本人が自分で手当て
  let medics = selectedParty().filter((m) => m.state === 'ok');
  if (!medics.length && patient.kind === 'party' && patient.state === 'ok') medics = [patient];
  if (!medics.length) { toast('治療する仲間を選択してください'); return; }
  if (!partsNeedingAid(patient).length) { toast(`${patient.name}は治療の必要がありません`); return; }
  orderTreat(world, medics.map((m) => m.id), patient.id);
  toast(`${medics.map((m) => m.name).join('・')}が${medics.length === 1 && medics[0] === patient ? '自分' : patient.name}を手当てします`);
}

function debugActions(p) {
  showActions('検証用', `${p.name}（戦闘ができるまでの確認用）`, [
    { label: '負傷させる', run: () => debug.hurt(world, p) },
    { label: '重傷を負わせる', run: () => debug.heavy(world, p) },
    { label: '脚を失わせる', run: () => debug.loseLeg(world, p) },
    { label: '空腹にする', run: () => { debug.starve(world, p); toast(`${p.name}を空腹にしました`); } },
    { label: '義肢を持たせる', run: () => debug.giveLimb(world, p) },
    { label: '盗賊を呼ぶ', run: () => debug.bandits(world, p) },
    { label: '拠点を襲撃させる', run: () => { if (!ensureBase(world).founded) { toast('拠点がありません'); return; } debug.raid(world); } },
    { label: '砂嵐にする', run: () => setWeather(world, 'sandstorm', 2) },
    { label: '酸性雨にする', run: () => setWeather(world, 'acid', 2) },
    { label: '灰降りにする', run: () => setWeather(world, 'ashfall', 2) },
    { label: '晴れにする', run: () => setWeather(world, 'clear', 3) },
    { label: '包帯を5つ渡す', run: () => { const id = RACES[p.race].aid === 'repair' ? 'repair_kit' : 'bandage'; addItem(p, id, 5); toast(`${ITEMS[id].label}を5つ渡しました`); } },
  ]);
}

function personActions(p) {
  const dead = p.state === 'dead';
  const down = p.state !== 'ok' || p.bound;
  const sel = selectedParty().filter((m) => m.state === 'ok' && m !== p);
  const actor = sel[0] || null;
  const need = (fn) => () => { if (!actor) { toast('先に行動する仲間を選択してください'); return; } fn(actor); };
  if (p.kind === 'party') {
    const acts = [];
    if (p.state === 'ok') {
      acts.push({ label: '選択する', run: () => selectOnly(p.id) });
      if (p.carrying) acts.push({ label: '降ろす', run: () => dropCarried(world, p) });
    }
    if (down && !dead) acts.push({ label: '担ぐ', run: need((a) => orderCarry(world, a, p)) });
    acts.push({ label: '体の状態', run: () => openPerson(p.id, 'body') });
    if (!dead) acts.push({ label: '治療する', run: () => treatWith(p) });
    acts.push({ label: '装備・持ち物', run: () => openPerson(p.id, 'equip') });
    if (p.state === 'ok') {
      acts.push({ label: '休む', run: () => orderRest(world, [p.id]) });
      acts.push({ label: 'その場で待機', run: () => stopPerson(p) });
      acts.push({ label: p.sneak ? '忍び歩きをやめる' : '忍び歩き', run: () => { const who = selected.has(p.id) ? selectedParty() : [p]; const on = !p.sneak; who.forEach((m) => { m.sneak = on; }); toast(on ? '忍び歩きにしました（遅いが見つかりにくい）' : '普通に歩きます'); } });
    }
    acts.push({ label: 'カメラで追う', run: () => followPerson(p) });
    acts.push({ label: '検証メニュー', run: () => debugActions(p) });
    showActions(p.name, `仲間・${stateText(p)}`, acts);
    return;
  }
  inspected = p;
  const label = p.title || FACTIONS[p.faction]?.label || '流れ者';
  const acts = [];
  if (!dead && !p.bound) acts.push({ label: down ? 'とどめを刺す' : '攻撃する', run: () => { const f = selectedParty().filter((m) => m.state === 'ok'); if (!f.length) { toast('攻撃する仲間を選択してください'); return; } if (down) { f.forEach((m) => { m.fight.target = p.id; m.fight.ordered = true; }); toast('倒れた相手にとどめを刺します'); } else orderAttack(world, f, p); } });
  if (down) {
    acts.push({ label: '持ち物をあさる', run: () => openPerson(p.id, 'equip') });
    if (!dead && !p.bound) acts.push({ label: '縛る', run: need((a) => orderBind(world, a, p)) });
    if (p.bound) acts.push({ label: '縄をほどく', run: need((a) => orderRelease(world, a, p)) });
    acts.push({ label: '担ぐ', run: need((a) => orderCarry(world, a, p)) });
  } else {
    acts.push({ label: '話す', run: () => talk(p) });
  }
  if (!dead) acts.push({ label: '治療する', run: () => treatWith(p) });
  acts.push({ label: '体の状態', run: () => openPerson(p.id, 'body') });
  acts.push({ label: 'カメラで追う', run: () => followPerson(p) });
  if (!down) acts.push({ label: 'そばへ移動', run: () => moveSelectedTo(p.x + 1.2, p.z + 1.2) });
  showActions(p.name, `${label}・${RACES[p.race].label}・${stateText(p)}${p.bounty ? `・賞金${p.bounty}` : ''}`, acts);
}

// =====================================================================
// メニュー（一団・セーブ・ログ・設定）
// =====================================================================
const sheet = $('sheet'), scrim = $('scrim');
let sheetTab = 'party';
function openSheet(tab) {
  sheetTab = tab;
  sheet.classList.add('open'); scrim.classList.remove('hide');
  renderSheet();
}
function closeSheet() { sheet.classList.remove('open'); scrim.classList.add('hide'); }
$('menuBtn').onclick = () => openSheet(sheetTab);
$('closeSheet').onclick = closeSheet;
scrim.onclick = closeSheet;
document.querySelectorAll('#tabs .btn').forEach((b) => { b.onclick = () => { sheetTab = b.dataset.tab; renderSheet(); }; });

function renderSheet() {
  document.querySelectorAll('#tabs .btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === sheetTab);
    b.classList.toggle('hide', !running && b.dataset.tab !== 'save' && b.dataset.tab !== 'settings');
  });
  const body = $('sheetBody');
  body.innerHTML = '';
  ({ party: sheetParty, save: sheetSave, log: sheetLog, settings: sheetSettings, person: sheetPerson, factions: sheetFactions, shop: sheetShop, base: sheetBase })[sheetTab](body);
}

let personId = null, personSub = 'body';
function openPerson(id, sub = 'body') { personId = id; personSub = sub; closePop(); openSheet('person'); }

// あさる・取る：倒れている／死んでいる／縛られている相手から、選択中（なければ近い）仲間へ移す
function looter(from) {
  const sel = selectedParty().filter((m) => m.state === 'ok' && m !== from);
  if (sel.length) return sel[0];
  return partyOf(world).filter((m) => m.state === 'ok' && m !== from).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
}
const lootable = (p) => p.kind !== 'party' && (p.state !== 'ok' || p.bound);

function sheetPerson(body) {
  const p = personById(world, personId);
  if (!p) { sheetTab = 'party'; renderSheet(); return; }
  const race = RACES[p.race];
  const mine = p.kind === 'party';
  const mode = mine ? 'mine' : lootable(p) ? 'loot' : 'view';
  const who = p.kind === 'party' ? '仲間' : (p.title || FACTIONS[p.faction]?.label || '流れ者');
  const tags = [p.bounty ? `賞金首 ${p.bounty}錆貨` : '', p.bound ? '縛られている' : ''].filter(Boolean).join('・');
  body.innerHTML = `
    <div class="phead"><img src="${faceIcon(p)}" alt=""><div class="info"><b>${p.name}</b> <span class="muted">${p.surname}</span><br>${who}・${race.label}・${stateText(p)}${tags ? `<br><span style="color:#e9b47a">${tags}</span>` : ''}</div></div>
    <div class="subtabs">${[['body', '体'], ['equip', '装備'], ['inv', '持ち物'], ['skills', '能力']].map(([k, l]) => `<button class="btn ${personSub === k ? 'on' : ''}" data-sub="${k}">${l}</button>`).join('')}</div>
    <div id="psub"></div>`;
  body.querySelectorAll('[data-sub]').forEach((b) => { b.onclick = () => { personSub = b.dataset.sub; renderSheet(); }; });
  const sub = body.querySelector('#psub');
  if (personSub === 'body') {
    sub.innerHTML = renderBody(p);
    if (p.state !== 'dead') {
      const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '10px';
      const t = document.createElement('button'); t.className = 'btn'; t.textContent = '治療する';
      t.onclick = () => { treatWith(p); closeSheet(); };
      row.appendChild(t);
      if (mine && p.state === 'ok') {
        const r = document.createElement('button'); r.className = 'btn'; r.textContent = '休む';
        r.onclick = () => { orderRest(world, [p.id]); closeSheet(); toast(`${p.name}は座って休みます`); };
        row.appendChild(r);
      }
      sub.appendChild(row);
    }
    return;
  }
  if (personSub === 'skills') { sub.innerHTML = renderSkills(p); return; }
  const lost = ['armL', 'armR', 'legL', 'legR'].filter((id) => p.body[id].lost && !p.body[id].prosthetic);
  if (mode === 'loot') sub.innerHTML = `<div class="note">取った物は${looter(p)?.name || '仲間'}の持ち物に入ります（選択中の仲間を優先）。</div>`;
  sub.innerHTML += personSub === 'equip' ? renderEquip(p, mode) : renderInventory(p, mode, mine && race.eats && p.state === 'ok', lost);
  sub.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.act;
      const st = b.dataset.idx !== undefined ? p.inv[+b.dataset.idx] : null;
      if (act === 'unequip') unequip(p, b.dataset.slot);
      if (act === 'equip' && st) {
        if (p.state !== 'ok' && mine) { toast('動ける状態でないと装備できません'); return; }
        equipItem(p, st.id, st.q ?? 1);
        const wpn = ITEMS[st.id].weapon;
        if (wpn && wpn.reqStr > p.skills.str.lv) toast(`筋力が足りないため、${ITEMS[st.id].label}の攻撃が遅くなります（必要 ${wpn.reqStr}）`);
      }
      if (act === 'eat' && st) { if (eat(world, p, st.id)) toast(`${p.name}は${ITEMS[st.id].label}を食べた`); }
      if (act === 'attach' && st) {
        const part = lost.length === 1 ? lost[0] : (await ask('どこに付けますか？', lost.map((l) => ({ label: PART[l].label, value: l })).concat([{ label: 'やめる', value: null }]))).value;
        if (part) attachProsthetic(world, p, part, st.id);
      }
      if (act === 'give' && st) {
        const others = partyOf(world).filter((m) => m !== p && m.state !== 'dead');
        if (!others.length) { toast('渡せる仲間がいません'); return; }
        const r = await ask(`${itemLabel(st.id, st.q)}をだれに渡しますか？`, others.map((m) => ({ label: m.name, value: m.id })).concat([{ label: 'やめる', value: null }]));
        if (r.value) { const to = personById(world, r.value); if (removeItem(p, st.id, 1, st.q ?? 1)) { addItem(to, st.id, 1, st.q ?? 1); toast(`${to.name}に渡しました`); } }
      }
      const to = looter(p);
      if ((act === 'take' || act === 'takeEquip' || act === 'takeMoney') && !to) { toast('受け取れる仲間がいません'); return; }
      if (act === 'take' && st) { const q = st.q ?? 1; if (removeItem(p, st.id, 1, q)) addItem(to, st.id, 1, q); }
      if (act === 'takeEquip') { const e = p.equip[b.dataset.slot]; if (e) { p.equip[b.dataset.slot] = null; p.equipVer = (p.equipVer || 0) + 1; addItem(to, e.id, 1, e.q); toast(`${to.name}が${itemLabel(e.id, e.q)}を取った`); } }
      if (act === 'takeMoney') { world.money += p.money; toast(`${p.money}錆貨を手に入れた`); p.money = 0; }
      renderSheet();
    };
  });
}

function sheetParty(body) {
  body.innerHTML = `<h3>一団（${partyOf(world).length}人）　所持金 ${world.money} ${PARTY.currency}</h3>`;
  for (const p of partyOf(world)) {
    const d = document.createElement('div');
    d.className = 'member';
    d.innerHTML = `<img src="${faceIcon(p)}" alt=""><div class="info"><b>${p.name}</b> <span class="muted">${RACES[p.race].label}</span><br>${stateText(p)}・体力 ${Math.round(healthPct(p) * 100)}%</div>`;
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = '詳細';
    b.onclick = () => openPerson(p.id, 'body');
    d.appendChild(b);
    const c = document.createElement('button');
    c.className = 'btn'; c.textContent = '見る';
    c.onclick = () => { selectOnly(p.id); centerOn(p); closeSheet(); };
    d.appendChild(c);
    body.appendChild(d);
  }
  const n = document.createElement('div');
  n.className = 'note';
  n.textContent = '「詳細」で体の状態・能力・持ち物を確認できます。装備は Phase 3 で追加されます。';
  body.appendChild(n);
}

function sheetSave(body) {
  const meta = listSlots();
  body.innerHTML = `<h3>${running ? 'セーブとロード' : 'ロード'}</h3>`;
  for (const id of SLOT_IDS) {
    const m = meta[id];
    const d = document.createElement('div');
    d.className = 'slot';
    const when = m ? new Date(m.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    d.innerHTML = `<div class="info"><b>${slotLabel(id)}</b><br>${m ? `${m.day}日目 ${fmtHour(m.hour)}・${(m.members || []).join('、')}<br><span class="muted">${when} 保存（ビルド${m.build}）</span>` : '<span class="muted">空き</span>'}</div>`;
    if (running && id !== 'auto') {
      const s = document.createElement('button');
      s.className = 'btn'; s.textContent = '保存';
      s.onclick = async () => {
        if (m && !(await confirmBox(`${slotLabel(id)}に上書き保存しますか？`, '上書き'))) return;
        try { await saveSlot(id, serialize(world, cameraState(), BUILD.build)); toast(`${slotLabel(id)}に保存しました`); }
        catch (e) { toast('保存できませんでした：' + e.message); }
        renderSheet();
      };
      d.appendChild(s);
    }
    if (m) {
      const l = document.createElement('button');
      l.className = 'btn'; l.textContent = '読込';
      l.onclick = async () => { if (running && !(await confirmBox(`${slotLabel(id)}を読み込みますか？\n現在の進行は保存されていなければ失われます。`, '読み込む'))) return; loadFrom(id); };
      d.appendChild(l);
      const x = document.createElement('button');
      x.className = 'btn danger'; x.textContent = '消去';
      x.onclick = async () => { if (await confirmBox(`${slotLabel(id)}を消去しますか？元に戻せません。`, '消去', true)) { await deleteSlot(id); renderSheet(); refreshTitle(); } };
      d.appendChild(x);
    }
    body.appendChild(d);
  }
  const h = document.createElement('h3'); h.textContent = 'テキストで書き出し・読み込み'; body.appendChild(h);
  const row = document.createElement('div'); row.className = 'row';
  if (running) {
    const ex = document.createElement('button');
    ex.className = 'btn'; ex.textContent = '書き出す';
    ex.onclick = async () => {
      const text = await exportText(serialize(world, cameraState(), BUILD.build));
      await ask('この文字列を保存しておくと、別の端末や再インストール後に読み込めます。', [{ label: 'コピー', copy: true }, { label: '閉じる', value: 0 }], { value: text, readOnly: true });
    };
    row.appendChild(ex);
  }
  const im = document.createElement('button');
  im.className = 'btn'; im.textContent = '読み込む';
  im.onclick = async () => {
    const r = await ask('書き出した文字列を貼り付けてください。', [{ label: 'やめる', value: false }, { label: '読み込む', value: true, cls: 'primary' }], { value: '', placeholder: 'W3D1:...' });
    if (!r.value) return;
    try {
      const data = await importText(r.text);
      const { world: w, camera: cam } = deserialize(data);
      closeSheet(); tryFullscreen(); startWorld(w, cam);
      toast('テキストから読み込みました');
    } catch (e) { await ask(`読み込めませんでした。\n${e.message}`, [{ label: '閉じる', value: 0 }]); }
  };
  row.appendChild(im);
  body.appendChild(row);
  const n = document.createElement('div'); n.className = 'note';
  n.textContent = `アプリを切り替えたときと、${SAVE.autosaveInterval}秒ごとに自動セーブされます。`;
  body.appendChild(n);
}

function sheetLog(body) {
  body.innerHTML = '<h3>ログ</h3>';
  for (const l of [...world.log].reverse()) {
    const d = document.createElement('div');
    d.className = 'logline';
    d.innerHTML = `<time>${l.day}日目 ${fmtHour(l.hour)}</time>`;
    d.appendChild(document.createTextNode(l.text));
    body.appendChild(d);
  }
}

function sheetSettings(body) {
  body.innerHTML = `
    <h3>画質</h3>
    <div class="row" id="qRow">${['auto', 'low', 'mid', 'high'].map((k) => `<button class="btn ${settings.quality === k ? 'on' : ''}" data-q="${k}">${k === 'auto' ? '自動' : QUALITY[k].label}</button>`).join('')}</div>
    <div class="note">現在：${QUALITY[qName].label}（解像度上限 ${q.dprCap}倍・影 ${q.shadows ? 'あり' : 'なし'}・描画距離 ${q.viewChunks * WORLD.chunkSize}m）</div>
    <h3>明るさ</h3>
    <div class="row" id="briRow">${[[0.85, '暗め'], [1, '標準'], [1.2, '明るめ'], [1.45, '最大']].map(([v, l]) => `<button class="btn ${Math.abs((settings.brightness || 1) - v) < 0.01 ? 'on' : ''}" data-bri="${v}">${l}</button>`).join('')}</div>
    <div class="note">夜の明るさ</div>
    <div class="row" id="nightRow">${[[0, '暗い'], [1, '普通'], [2, '明るい']].map(([v, l]) => `<button class="btn ${(settings.nightLift ?? 1) === v ? 'on' : ''}" data-night="${v}">${l}</button>`).join('')}</div>
    <h3>頭上の名札</h3>
    <div class="row" id="lblRow">${[['role', '役割のある人'], ['all', '全員'], ['off', 'なし']].map(([v, l]) => `<button class="btn ${(settings.labels || 'role') === v ? 'on' : ''}" data-lbl="${v}">${l}</button>`).join('')}</div>
    <h3>表示と操作</h3>
    <div class="row">
      <button class="btn ${settings.dynRes ? 'on' : ''}" id="dynBtn">解像度の自動調整</button>
      <button class="btn ${settings.fpsCap === 30 ? 'on' : ''}" id="capBtn">省電力（30fps）</button>
      <button class="btn ${settings.debug ? 'on' : ''}" id="dbgBtn">デバッグ表示</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn ${settings.vibrate ? 'on' : ''}" id="vibBtn">振動</button>
      <button class="btn" id="fsBtn">全画面</button>
    </div>
    <h3>音</h3>
    <div class="row" id="volRow">
      <button class="btn ${settings.sound ? 'on' : ''}" id="sndBtn">効果音：${settings.sound ? 'あり' : 'なし'}</button>
      ${[['0.35', '小'], ['0.7', '中'], ['1', '大']].map(([v, l]) => `<button class="btn ${settings.sound && Math.abs(settings.volume - v) < 0.01 ? 'on' : ''}" data-vol="${v}">${l}</button>`).join('')}
    </div>
    <h3>検証用</h3>
    <div class="row">
      <button class="btn ${world.debugFast ? 'on' : ''}" id="ffBtn">時間を60倍で早送り</button>
    </div>
    <h3>ゲーム</h3>
    <div class="row">
      <button class="btn ${world.banditsOn !== false ? 'on' : ''}" id="banditBtn">盗賊の出現：${world.banditsOn !== false ? 'あり' : 'なし'}</button>
      <button class="btn" id="manualBtn2">操作マニュアル</button>
    </div>
    <div class="note">拠点への襲撃（拠点の建物が${RAID.minBuildings}つ以上になると起きます。前もって予告があります）</div>
    <div class="row" id="raidRow">${Object.entries(RAID_FREQ).map(([k, v]) => `<button class="btn ${(world.raidFreq || 'normal') === k ? 'on' : ''}" data-raid="${k}">${v.label}</button>`).join('')}</div>
    <div class="note">ビルド ${BUILD.build}（${BUILD.time}）</div>`;
  body.querySelectorAll('#qRow .btn').forEach((b) => {
    b.onclick = () => {
      settings.quality = b.dataset.q;
      if (b.dataset.q === 'auto') { settings.decidedQuality = null; applyQuality('mid'); startProbe(); }
      else applyQuality(b.dataset.q);
      saveSettings(settings); renderSheet();
    };
  });
  $('dynBtn').onclick = () => { settings.dynRes = !settings.dynRes; dyn.enabled = settings.dynRes; if (!dyn.enabled) { dyn.scale = 1; resize(); } saveSettings(settings); renderSheet(); };
  $('capBtn').onclick = () => { settings.fpsCap = settings.fpsCap === 30 ? 60 : 30; saveSettings(settings); toast(settings.fpsCap === 30 ? '30fpsに抑えます（電池が長持ちします）' : 'fpsの上限を解除しました'); renderSheet(); };
  $('dbgBtn').onclick = () => { settings.debug = !settings.debug; saveSettings(settings); renderSheet(); };
  $('vibBtn').onclick = () => { settings.vibrate = !settings.vibrate; saveSettings(settings); vibrate(30); renderSheet(); };
  $('fsBtn').onclick = tryFullscreen;
  body.querySelectorAll('[data-bri]').forEach((b) => { b.onclick = () => { settings.brightness = +b.dataset.bri; renderer.toneMappingExposure = BASE_EXPOSURE * settings.brightness; saveSettings(settings); renderSheet(); }; });
  body.querySelectorAll('[data-night]').forEach((b) => { b.onclick = () => { settings.nightLift = +b.dataset.night; saveSettings(settings); renderSheet(); }; });
  body.querySelectorAll('[data-lbl]').forEach((b) => { b.onclick = () => { settings.labels = b.dataset.lbl; saveSettings(settings); renderSheet(); }; });
  $('sndBtn').onclick = () => { settings.sound = !settings.sound; setAudio(settings.sound, settings.volume); saveSettings(settings); if (settings.sound) play('select'); renderSheet(); };
  body.querySelectorAll('[data-vol]').forEach((b) => { b.onclick = () => { settings.sound = true; settings.volume = +b.dataset.vol; setAudio(true, settings.volume); saveSettings(settings); play('select'); renderSheet(); }; });
  body.querySelectorAll('[data-raid]').forEach((b) => { b.onclick = () => { world.raidFreq = b.dataset.raid; resetRaidSchedule(world); toast(`拠点への襲撃：${RAID_FREQ[world.raidFreq].label}`); renderSheet(); }; });
  $('ffBtn').onclick = () => { world.debugFast = !world.debugFast; toast(world.debugFast ? '時間を60倍で早送り中' : '早送りを解除しました'); renderSheet(); };
  $('manualBtn2').onclick = openManual;
  $('banditBtn').onclick = () => { world.banditsOn = world.banditsOn === false; toast(world.banditsOn ? '盗賊が現れるようになりました' : '盗賊は新しく現れなくなりました（今いる盗賊は残ります）'); renderSheet(); };
}

function startProbe() {
  probe = new QualityProbe((res) => {
    settings.decidedQuality = res; saveSettings(settings);
    if (qName !== res) applyQuality(res);
    toast(`画質を「${QUALITY[res].label}」に自動設定しました`);
  });
  toast('端末性能を計測しています…');
}

// =====================================================================
// アプリ切替・画面オフ：自動ポーズ＋自動セーブ＋描画停止
// =====================================================================
let hiddenPaused = false, savedScale = 1, lastAutosave = 0;
function onHide() {
  if (hiddenPaused) return;
  hiddenPaused = true;
  savedScale = world.timeScale;
  world.timeScale = 0;
  suspendAudio();
  autosave();
}
function onShow() {
  if (!hiddenPaused) return;
  hiddenPaused = false;
  resumeAudio();
  // 仕様判断：復帰時は一時停止のまま再開（状況を確認してから動かせるように）
  world.timeScale = 0;
  if (running) { setSpeedButtons(); toast('一時停止中です。右上の速度ボタンで再開します'); }
  else world.timeScale = savedScale;
  last = performance.now();
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
window.addEventListener('pagehide', onHide);

// =====================================================================
// メインループ
// =====================================================================
const focus = new THREE.Vector3();
let last = performance.now();
let elapsed = 0, uiTimer = 0, sheetRefresh = 0;
const ringItems = [], destItems = [];

const roofPts = [];
function loop(now) {
  if (document.hidden) return; // 描画停止（復帰時に onShow から再開）
  requestAnimationFrame(loop);
  // 省電力：30fps に抑える（1フレームおきに描く）
  if (settings.fpsCap === 30 && now - last < 1000 / 30 - 4) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += dt;

  if (running) { stepWorld(world, dt); checkPendingTalk(); }
  else rig.yaw += dt * 0.04; // タイトル画面ではゆっくり旋回

  rig.update(dt);
  focus.copy(rig.target);
  const wx = running ? weatherInfo(world) : null;
  const k = atmosphere.update(world.hour, focus, camera.position, q.fogFar, rig.dist, wx, settings.nightLift ?? 1);
  weatherView.update(world.timeScale > 0 || !running ? dt : dt * 0.15, wx, focus);
  if (running) cacheView.update(world, focus, dt);
  terrain.update(focus, k.fog, running ? 2 : 6);
  roofPts.length = 0; roofPts.push(focus);
  if (running) for (const id of selected) { const p = personById(world, id); if (p) roofPts.push(p); }
  towns.update(focus, q.fogFar + rig.dist + 60, roofPts);
  world.focus = focus;
  baseView.update(world, elapsed, roofPts);
  if (buildMode) updateBuildPreview();
  humans.update(world.people, focus, elapsed);
  if (world.events?.length) { playEvents(world.events, focus); effects.spawn(world.events); world.events.length = 0; }
  if (running && wx) updateAmbience(wx, world.timeScale > 0);
  effects.update(dt);

  // 選択リングと移動先
  ringItems.length = 0; destItems.length = 0;
  if (running) {
    for (const id of selected) {
      const p = personById(world, id);
      if (!p) continue;
      ringItems.push({ x: p.x, z: p.z, color: RING.party });
      if (p.goal) destItems.push(p.goal);
    }
    if (inspected && !inspected.carriedBy) ringItems.push({ x: inspected.x, z: inspected.z, color: inspected.state === 'ok' && hostile(inspected, partyOf(world)[0] || inspected) ? RING.hostile : RING.neutral });
    // 襲ってきている敵は赤いリング
    for (const o of world.people) {
      if (o === inspected || o.state !== 'ok' || o.bound || o.carriedBy) continue;
      if ((o.squadHunting || o.angryAt?.includes('player')) && Math.hypot(o.x - focus.x, o.z - focus.z) < 70) ringItems.push({ x: o.x, z: o.z, color: RING.hostile, scale: 0.9 });
    }
  }
  markers.update(ringItems, destItems, elapsed);

  renderer.info.reset();
  renderer.render(scene, camera);
  if (running) {
    const pl = partyOf(world).find((m) => m.state !== 'dead') || { faction: 'player', state: 'ok', x: 0, z: 0 };
    labels.update(camera, world.people, focus, rig.dist, settings.labels || 'role', (o) => hostile(o, pl), window.innerWidth, window.innerHeight, (o) => towns.hiddenInside(o));
  }

  stats.push(dt);
  if (running) {
    if (probe && !probe.done) probe.update(dt, (name) => applyQuality(name));
    else if (dyn.update(dt, settings.fpsCap === 30 ? Math.min(60, stats.fps * 2) : stats.fps)) resize();
    if (now - lastAutosave > SAVE.autosaveInterval * 1000) autosave();
  }

  uiTimer -= dt;
  if (uiTimer <= 0 && running) {
    uiTimer = 0.25;
    $('timeLabel').textContent = fmtHour(world.hour);
    $('dayLabel').textContent = `${world.day}日目 ${atmosphere.isNight ? '夜' : world.hour < 10 ? '朝' : world.hour < 17 ? '昼' : '夕'}`;
    $('moneyLabel').textContent = `${world.money} ${PARTY.currency}`;
    // 天気と襲撃の予告
    const wi = weatherInfo(world);
    $('weatherLabel').textContent = wi.label;
    $('weatherLabel').className = wi.label === '晴れ' ? '' : 'bad';
    const cd = raidCountdownHours(world), rr = ensureRaid(world);
    const alertText = rr.active ? `${rr.label || '襲撃隊'}が拠点を攻撃中！` : cd !== null ? `襲撃の予告：${RAID.kinds.find((x) => x.id === rr.kind)?.label || '襲撃隊'}　あと${cd < 1 ? '1時間以内' : `約${Math.round(cd)}時間`}` : '';
    $('alertBar').classList.toggle('hide', !alertText);
    if (alertText) $('alertBar').textContent = alertText;
    updatePartyMarks();
    drawMinimap();
    const tHere = townAt(rig.target.x, rig.target.z);
    $('townBadge').classList.toggle('hide', !tHere);
    if (tHere) $('townBadge').textContent = `${tHere.name}・${FACTIONS[tHere.faction].label}${isWanted(tHere.faction) ? '（手配中）' : ''}`;
    const party0 = partyOf(world);
    const cm = party0.some((m) => m.fight?.target && m.state === 'ok') || world.people.some((o) => o.state === 'ok' && (o.squadHunting || o.angryAt?.includes('player')) && party0.some((m) => Math.hypot(m.x - o.x, m.z - o.z) < 45));
    if (cm !== combatMode) { combatMode = cm; $('restBtn').textContent = cm ? '退却' : '休む'; $('restBtn').classList.toggle('danger', cm); }
    // 詳細シートを開いている間は1秒ごとに数値を更新
    sheetRefresh -= 0.25;
    if (sheetRefresh <= 0 && sheet.classList.contains('open') && sheetTab === 'person' && personSub !== 'inv' && $('dialog').classList.contains('hide')) {
      sheetRefresh = 1;
      const sb = $('sheetBody'), top = sb.scrollTop;
      renderSheet(); sb.scrollTop = top;
    }
    // 全滅
    const party = partyOf(world);
    if (!gameOverShown && party.length && party.every((m) => m.state === 'dead')) {
      gameOverShown = true;
      world.timeScale = 0; setSpeedButtons();
      ask('一団は全滅した。\n荒野は何事もなかったように続いていく。', [{ label: 'ロード', value: 'load' }, { label: 'はじめから', value: 'new', cls: 'primary' }]).then((r) => {
        if (r.value === 'load') openSheet('save');
        else startWorld(createWorld(WORLD.seed + Math.floor(Math.random() * 1e6)));
      });
    }
    $('debug').classList.toggle('hide', !settings.debug);
    if (settings.debug) {
      const inf = renderer.info.render;
      $('debug').textContent = `fps  ${stats.fps.toFixed(0)}\nms   ${stats.ms.toFixed(1)}\ncall ${inf.calls}\ntri  ${(inf.triangles / 1000).toFixed(1)}k\n画質 ${QUALITY[qName].label} ${renderer.getPixelRatio().toFixed(2)}`;
    }
  }
}

// =====================================================================
// 町：会話・店・酒場・警備所・派閥・通行料・地図
// =====================================================================
const rnd = () => Math.random();
const pickL = (list) => list[Math.floor(rnd() * list.length)];
const near = (a, b, d) => Math.hypot(a.x - b.x, a.z - b.z) < d;

// 話しかける：近くに仲間がいなければ、選択中の仲間を向かわせ、着いたら自動で会話を始める。
// 仕様判断：話しかけた相手はその場で立ち止まり、会話中は時間が止まる（終わったら元の速度に戻る）
let pendingTalk = null;   // { npc, ids } 相手のところへ向かっている途中
let talkSession = null;   // { npc, prev } 会話中（時間停止中）
function holdNpc(npc, sec) { npc.holdUntil = world.time + sec; npc.path = []; npc.goal = null; npc.tx = undefined; }
function talk(npc) {
  if (npc.state !== 'ok') { toast('返事がない。'); return; }
  const party = partyOf(world).filter((m) => m.state === 'ok');
  const speaker = party.filter((m) => near(m, npc, 6)).sort((a, b) => Math.hypot(a.x - npc.x, a.z - npc.z) - Math.hypot(b.x - npc.x, b.z - npc.z))[0];
  if (!speaker) {
    let go = selectedParty().filter((m) => m.state === 'ok');
    if (!go.length) go = party.slice().sort((a, b) => Math.hypot(a.x - npc.x, a.z - npc.z) - Math.hypot(b.x - npc.x, b.z - npc.z)).slice(0, 1);
    if (!go.length) { toast('話しかけられる仲間がいません'); return; }
    if (hostile(npc, go[0])) { toast(`${npc.name}は話を聞く気がない。`); return; }
    holdNpc(npc, 180);
    orderMove(world, go.map((m) => m.id), npc.x + 1.2, npc.z + 1.2);
    pendingTalk = { npc, ids: go.map((m) => m.id) };
    if (world.timeScale === 0) { world.timeScale = 1; setSpeedButtons(); }
    toast(`${go[0].name}が${npc.name}に話しかけに行きます`);
    return;
  }
  startTalk(npc, speaker);
}
// 向かっている途中の確認（毎フレーム）
function checkPendingTalk() {
  if (pendingTalk) {
    const { npc, ids } = pendingTalk;
    const goers = ids.map((id) => personById(world, id)).filter((m) => m && m.state === 'ok');
    if (npc.state !== 'ok' || !goers.length) { pendingTalk = null; npc.holdUntil = 0; }
    else {
      const sp = goers.find((m) => near(m, npc, 3.2));
      if (sp) { pendingTalk = null; startTalk(npc, sp); }
      else if (!goers.some((m) => m.goal)) {
        // 別の指示を出した・たどり着けなかった
        pendingTalk = null; npc.holdUntil = 0;
      }
    }
  }
  if (talkSession && $('dialog').classList.contains('hide') && !sheet.classList.contains('open')) {
    talkSession.npc.holdUntil = world.time + 4;
    world.timeScale = talkSession.prev || 1; setSpeedButtons();
    talkSession = null;
  }
}
function startTalk(npc, speaker) {
  if (hostile(npc, speaker)) { npc.holdUntil = 0; toast(`${npc.name}は話を聞く気がない。`); return; }
  holdNpc(npc, 600);
  npc.speed = 0;
  if (!talkSession) { talkSession = { npc, prev: world.timeScale }; }
  world.timeScale = 0; setSpeedButtons();
  speaker.heading = Math.atan2(npc.x - speaker.x, npc.z - speaker.z);
  talkTo(npc, speaker);
}
function talkTo(npc, speaker) {
  npc.heading = Math.atan2(speaker.x - npc.x, speaker.z - npc.z);
  const town = npc.town ? townById(npc.town) : null;
  const who = `${npc.name}（${npc.title || ROLE_LABEL[npc.role] || FACTIONS[npc.faction]?.label || '流れ者'}）`;
  const f = npc.faction;
  if (npc.role === 'trader') {
    const dest = townById(npc.town);
    ask(`${who}\n「${pickL(LINES.trader)}」\n（行き先：${dest?.name || '？'}。値段は行き先の町に近い）`, [
      { label: '荷を見る', value: 'shop', cls: 'primary' }, { label: '噂を聞く', value: 'rumor' }, { label: '立ち去る', value: null },
    ]).then((r) => {
      if (r.value === 'shop') openShop(npc.town, 'caravan', npc, speaker);
      if (r.value === 'rumor') ask(`${who}\n「${pickL(LINES.rumors.concat(LINES.traderRumors))}」`, [{ label: '礼を言う', value: 0 }]);
    });
    return;
  }
  if (npc.role === 'escort' || npc.role === 'porter') {
    const line = npc.role === 'porter' ? pickL(LINES.porter) : pickL(isWanted(f) ? LINES.guard.hostile : LINES.escort);
    ask(`${who}\n「${line}」`, [{ label: '立ち去る', value: null }]);
    return;
  }
  if (npc.role === 'shopkeeper' || (npc.role === 'bartender')) {
    const line = pickL(npc.role === 'bartender' ? LINES.bartender : LINES.shopkeeper);
    const btns = [{ label: '店を見る', value: 'shop', cls: 'primary' }];
    if (npc.role === 'bartender') { btns.push({ label: '仲間を探す', value: 'recruit' }); btns.push({ label: '噂を聞く', value: 'rumor' }); }
    btns.push({ label: '立ち去る', value: null });
    ask(`${who}\n「${line}」`, btns).then((r) => {
      if (r.value === 'shop') openShop(npc.town, npc.shop, npc, speaker);
      if (r.value === 'recruit') showRecruits(npc.town);
      if (r.value === 'rumor') ask(`${who}\n「${pickL(LINES.rumors)}」`, [{ label: '礼を言う', value: 0 }]);
    });
    return;
  }
  if (npc.role === 'police') {
    const cands = handoverCandidates(world, npc);
    const fine = fineFor(world, f);
    const btns = [];
    for (const c of cands.slice(0, 3)) btns.push({ label: `${c.name}を引き渡す（${c.bounty ? `賞金${c.bounty}` : '保護'}）`, value: 'h:' + c.id, cls: 'primary' });
    if (fine) btns.push({ label: `罰金を払う（${fine}錆貨）`, value: 'fine' });
    btns.push({ label: '賞金首について聞く', value: 'bounty' });
    btns.push({ label: '立ち去る', value: null });
    const wantedLine = isWanted(f) ? '\n（あなたの一団はここで指名手配されています）' : '';
    ask(`${who}\n「${pickL(LINES.police)}」${wantedLine}\n\n縛った賞金首を、この役人のそば（8m以内）まで担いでくると引き渡せます。`, btns).then((r) => {
      if (!r.value) return;
      if (r.value === 'fine') { if (!payFine(world, f)) toast('錆貨が足りません'); return; }
      if (r.value === 'bounty') { const b = world.people.find((x) => x.bounty && x.state !== 'dead'); ask(`${who}\n「${b ? `${b.name}という${b.title || '賞金首'}に${b.bounty}錆貨がかかっている。生け捕りにしてこい。` : '今は目立った賞金首はいない。'}」`, [{ label: 'わかった', value: 0 }]); return; }
      const c = personById(world, +r.value.slice(2));
      if (c) { handOver(world, npc, c); if (inspected === c) inspected = null; }
    });
    return;
  }
  if (npc.role === 'recruit') { showRecruitTalk(npc); return; }
  let line;
  if (npc.role === 'guard') line = pickL((isWanted(f) ? LINES.guard.hostile : LINES.guard[f]) || LINES.guard.merchant);
  else if (npc.role === 'folk') line = pickL(LINES.folk[f] || LINES.folk.merchant);
  else line = pickL(LINES.drifter);
  ask(`${who}\n「${line}」`, [{ label: '立ち去る', value: 0 }]);
}

function showRecruitTalk(r) {
  const top = Object.entries(r.skills).sort((a, b) => b[1].lv - a[1].lv).slice(0, 3).map(([k, v]) => `${({ str: '筋力', agi: '敏捷', tough: '耐久', melee: '近接攻撃', defense: '防御', dodge: '回避', stealth: '隠密', theft: '窃盗', ranged: '射撃', medic: '医療', labor: '労働', cook: '料理', farm: '農業', smith: '鍛冶', research: '研究' })[k]}${v.lv}`).join('・');
  const price = r.hirePrice;
  ask(`${r.name}（${RACES[r.race].label}・${top}）\n「${pickL(LINES.recruit)}」\n\n${price ? `雇い代：${price}錆貨（所持金 ${world.money}）` : '金はいらないらしい。'}`, [
    { label: price ? `${price}錆貨で雇う` : '仲間に誘う', value: 'hire', cls: 'primary' }, { label: 'やめる', value: null },
  ]).then((res) => {
    if (res.value !== 'hire') return;
    const out = hire(world, r);
    toast(out.msg);
    if (out.ok) { humans.reset(); renderParty(); selectOnly(r.id); }
  });
}

function showRecruits(townId) {
  const list = world.people.filter((p) => p.role === 'recruit' && p.town === townId && p.state === 'ok');
  if (!list.length) { ask('酒場の主人「今日は誰もいないよ。また来な。」', [{ label: '立ち去る', value: 0 }]); return; }
  ask('酒場の主人「この辺に座ってる連中だ。話してみな。」', list.map((r) => ({ label: `${r.name}（${RACES[r.race].label}）${r.hirePrice ? ` ${r.hirePrice}錆貨` : ' 無料'}`, value: r.id })).concat([{ label: 'やめる', value: null }])).then((res) => {
    const r = res.value && personById(world, res.value);
    if (r) showRecruitTalk(r);
  });
}

// ---- 店 ----
let shopState = null;
function openShop(townId, shopType, keeper, buyer) {
  shopState = { townId, shopType, keeperId: keeper.id, buyerId: buyer.id, mode: 'buy' };
  openSheet('shop');
}
function sheetShop(body) {
  if (!shopState) { sheetTab = 'party'; renderSheet(); return; }
  const town = townById(shopState.townId);
  const keeper = personById(world, shopState.keeperId);
  let buyer = personById(world, shopState.buyerId);
  const near2 = partyOf(world).filter((m) => m.state === 'ok' && keeper && near(m, keeper, 12));
  if (!keeper || keeper.state !== 'ok' || !near2.length) { body.innerHTML = '<div class="note">店から離れたため、取引できません。</div>'; return; }
  if (!buyer || !near2.includes(buyer)) { buyer = near2[0]; shopState.buyerId = buyer.id; }
  const st = shopStock(world, town.id, shopState.shopType);
  const mode = shopState.mode;
  body.innerHTML = `<h3>${shopState.shopType === 'caravan' ? `隊商の荷（${town.name}行き）` : `${town.name}の${SHOPS[shopState.shopType].label}`}</h3>
    <div class="shopbar">所持金 <span class="money">${world.money} 錆貨</span></div>
    <div class="shopbar">取引する仲間：${near2.map((m) => `<button class="btn ${m === buyer ? 'on' : ''}" data-buyer="${m.id}">${m.name}</button>`).join('')}</div>
    <div class="subtabs">${[['buy', '買う'], ['sell', '売る'], ['steal', '盗む']].map(([k, l]) => `<button class="btn ${mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
    <div id="shopList"></div>`;
  body.querySelectorAll('[data-buyer]').forEach((b) => { b.onclick = () => { shopState.buyerId = +b.dataset.buyer; renderSheet(); }; });
  body.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { shopState.mode = b.dataset.mode; renderSheet(); }; });
  const list = body.querySelector('#shopList');
  let html = '';
  if (mode === 'buy' || mode === 'steal') {
    const door = townLayout(town).shopDoors[shopState.shopType] || keeper;
    if (mode === 'steal') html += `<div class="note">成功率 ${Math.round(stealChance(world, buyer, town.id, door) * 100)}%（窃盗の能力・近くの衛兵の数・忍び歩きで変わります）。失敗すると${FACTIONS[town.faction].label}に指名手配されます。</div>`;
    if (!st.stock.length) html += '<div class="note">品切れです。明日には入れ替わります。</div>';
    st.stock.forEach((e, i) => {
      const it = ITEMS[e.id];
      const price = priceOf(world, town, e.id, e.q);
      html += `<div class="irow"><div class="info"><b>${itemLabel(e.id, e.q)}</b> ×${e.qty}<br><small class="muted">${it.weight}kg・${ITEM_CAT_LABEL(it.cat)}</small></div><span class="money">${price}</span><button class="btn ${mode === 'steal' ? 'danger' : ''}" data-i="${i}">${mode === 'steal' ? '盗む' : '買う'}</button></div>`;
    });
  } else {
    const items = buyer.inv.map((s2, i) => ({ s: s2, i })).filter(({ s: s2 }) => canSell(shopState.shopType, s2.id));
    if (!items.length) html += '<div class="note">この店で買い取ってもらえる物を持っていません。</div>';
    for (const { s: s2, i } of items) html += `<div class="irow"><div class="info"><b>${itemLabel(s2.id, s2.q)}</b> ×${s2.qty}</div><span class="money">${priceOf(world, town, s2.id, s2.q ?? 1, true)}</span><button class="btn" data-sell="${i}">売る</button></div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-i]').forEach((b) => {
    b.onclick = async () => {
      if (mode === 'steal') {
        const door = townLayout(town).shopDoors[shopState.shopType] || keeper;
        const r = steal(world, town.id, shopState.shopType, +b.dataset.i, buyer, door);
        toast(r.msg);
        if (r.caught) { closeSheet(); return; }
      } else { const r = buy(world, town.id, shopState.shopType, +b.dataset.i, buyer); toast(r.msg); if (r.ok) play('coin'); }
      renderSheet();
    };
  });
  list.querySelectorAll('[data-sell]').forEach((b) => { b.onclick = () => { const r = sell(world, town.id, shopState.shopType, buyer, +b.dataset.sell); toast(r.msg); if (r.ok) play('coin'); renderSheet(); }; });
}
const ITEM_CAT_LABEL = (c) => ({ weapon: '武器', armor: '防具', food: '食料', med: '医療', trade: '交易品', material: '素材', limb: '義肢', relic: '遺物' })[c] || '';

// ---- 派閥 ----
function sheetFactions(body) {
  let html = '<h3>派閥との関係</h3>';
  for (const f of ['merchant', 'holy', 'bandit', 'eater']) {
    const F = FACTIONS[f];
    const rep = world.rep?.[f] ?? 0;
    const hostileF = (F.enemies || []).includes('player') || rep < REP.hostileBelow;
    const wanted = isWanted(f);
    const tag = wanted ? '<span class="tag" style="color:#ff8f7a">指名手配中</span>' : hostileF ? '<span class="tag" style="color:#ff8f7a">敵対</span>' : rep > REP.friendlyAbove ? '<span class="tag" style="color:#6fd27a">友好</span>' : '<span class="tag muted">中立</span>';
    const fine = fineFor(world, f);
    html += `<div class="frow"><div class="top"><b>${F.label}</b>${tag}</div>
      <div class="repbar"><i style="left:calc(${(rep + 100) / 2}% - 2px)"></i></div>
      <div class="desc">評判 ${Math.round(rep)}${wanted ? `・罰金 ${fine}錆貨（警備所で払うと解ける。${world.wanted[f].until}日目に自然に解ける）` : ''}<br>${F.desc}</div>
      <div class="desc">町：${TOWNS.filter((t) => t.faction === f).map((t) => (world.discovered?.[t.id] ? t.name : '？')).join('、') || 'なし'}</div></div>`;
  }
  html += '<div class="note">評判は取引・賞金首の引き渡し・手当てで上がり、攻撃・殺害・盗みで下がります。-40を下回るとその派閥から敵とみなされます。</div>';
  body.innerHTML = html;
}

// ---- 通行料 ----
function onToll(t) {
  const prev = world.timeScale;
  world.timeScale = 0; setSpeedButtons();
  const hasMachine = partyOf(world).some((m) => m.race === FACTIONS[t.faction].hatesRace && m.state !== 'dead');
  const extra = hasMachine ? '\n「それと、機械の体の者を連れているな。灯の下で見つけたら、ただでは済まさん。」' : '';
  const can = world.money >= t.toll;
  ask(`${t.name}の衛兵\n「止まれ。ここは${FACTIONS[t.faction].label}の町だ。通行料${t.toll}錆貨を払え。」${extra}\n\n所持金 ${world.money}錆貨`, [
    ...(can ? [{ label: `${t.toll}錆貨を払う`, value: 'pay', cls: 'primary' }] : []),
    { label: '断る', value: 'refuse', cls: 'danger' },
    { label: '引き返す', value: 'leave' },
  ]).then((r) => {
    world.pendingToll = null;
    world.timeScale = prev || 1; setSpeedButtons();
    if (r.value === 'pay') { world.money -= t.toll; world.tollPaid[t.id] = world.day; addLog(world, `通行料${t.toll}錆貨を払った。`); }
    else if (r.value === 'refuse') { world.tollRefused[t.id] = world.day; changeRep(world, t.faction, REP.tollRefuse, '通行料を拒んだ'); addLog(world, `通行料を拒んだ。${t.name}の衛兵が向かってくる！`); world.onAlarm?.(); }
    else {
      // 町の外へ下がる
      const party = partyOf(world).filter((m) => m.state === 'ok');
      party.forEach((m) => { const dx = m.x - t.x, dz = m.z - t.z, l = Math.hypot(dx, dz) || 1; orderMove(world, [m.id], t.x + (dx / l) * (t.r + 25), t.z + (dz / l) * (t.r + 25)); });
      world.inTown = { ...(world.inTown || {}), [t.id]: false };
    }
  });
}

// ---- ミニマップ・地図 ----
const minimap = $('minimap');
let mapView = null, mapZoom = 1600;
function drawMinimap() { drawMap(minimap, world, rig.target, 320, { camera: null }); }
minimap.onclick = () => openMap();
function openMap() {
  ensureMapImage(() => { if (!$('mapPanel').classList.contains('hide')) renderMapPanel(); });
  $('mapPanel').classList.remove('hide');
  renderMapPanel();
}
function renderMapPanel() {
  const party = partyOf(world).filter((m) => m.state !== 'dead');
  const c = mapZoom >= 4000 ? { x: 0, z: 0 } : party.length ? { x: party[0].x, z: party[0].z } : rig.target;
  mapView = drawMap($('mapCanvas'), world, c, mapZoom, { labels: true, camera: rig.target });
  const baseRow = world.base?.founded ? `<div class="trow"><i style="background:#e9b47a"></i><span>拠点</span><span class="muted">${party.length ? Math.round(Math.hypot(world.base.x - party[0].x, world.base.z - party[0].z)) : 0}m</span><button class="btn" data-gobase="1">ここへ</button></div>` : '';
  $('mapTowns').innerHTML = baseRow + TOWNS.map((t) => {
    const known = world.discovered?.[t.id];
    const d = party.length ? Math.round(Math.hypot(t.x - party[0].x, t.z - party[0].z)) : 0;
    return `<div class="trow"><i style="background:#${(FACTIONS[t.faction].accent || 0x888888).toString(16).padStart(6, '0')}"></i><span>${known ? `${t.name}（${FACTIONS[t.faction].label}）` : '未発見の場所'}</span><span class="muted">${known ? `${d}m` : ''}</span>${known ? `<button class="btn" data-go="${t.id}">ここへ</button>` : ''}</div>`;
  }).join('');
  $('mapTowns').querySelectorAll('[data-gobase]').forEach((b) => { b.onclick = () => goTo(world.base.x + 3, world.base.z + 3, '拠点'); });
  $('mapTowns').querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { const t = townById(b.dataset.go); goTo(t.x + 4, t.z + 4, t.name); }; });
}
function goTo(x, z, label) {
  const s = selectedParty().filter((m) => m.state === 'ok');
  if (!s.length) { toast('移動させる仲間を選択してください'); return; }
  orderMove(world, s.map((m) => m.id), x, z);
  $('mapPanel').classList.add('hide');
  toast(`${label || 'その地点'}へ向かいます（遠い場所は道をたどって進みます）`);
}
$('mapCanvas').addEventListener('click', (e) => {
  if (!mapView) return;
  const r = e.target.getBoundingClientRect();
  const k = $('mapCanvas').width / r.width;
  const pt = screenToMap(mapView, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
  confirmBox(`この地点（${Math.round(pt.x)}, ${Math.round(pt.z)}）へ選択中の仲間を移動しますか？`, '移動する').then((ok) => { if (ok) goTo(pt.x, pt.z); });
});
document.querySelectorAll('#mapPanel [data-zoom]').forEach((b) => { b.onclick = () => { mapZoom = +b.dataset.zoom; renderMapPanel(); }; });
$('mapClose').onclick = () => $('mapPanel').classList.add('hide');

// =====================================================================
// 拠点：建物のタップ・建築モード（照準）・拠点タブ
// =====================================================================
function buildingAt(x, z) {
  const base = world.base;
  if (!base) return null;
  for (const b of base.buildings) {
    if (b.wallSeg) { if (Math.hypot(b.x - x, b.z - z) < 1.3) return b; continue; }
    const fp = footprint(b.type, b.x, b.z, b.rot);
    if (Math.abs(x - fp.x) < fp.w / 2 + 0.3 && Math.abs(z - fp.z) < fp.d / 2 + 0.3) return b;
  }
  return null;
}

function buildingActions(b) {
  const B = BUILDINGS[b.type];
  const acts = [];
  let sub = b.done ? '完成' : `建設中 ${Math.round((b.progress / B.work) * 100)}%`;
  if (!b.done && !b.paid) { const miss = missingFor(world, B.cost); if (miss.length) sub += `・材料不足（${miss.join('、')}）`; }
  if (b.done) {
    if (B.gate) acts.push({ label: b.open ? '門を閉める' : '門を開ける', run: () => { toggleGate(world, b); toast(b.open ? '門を開けました' : '門を閉めました（敵も味方も通れません）'); } });
    if (b.type === 'storage') acts.push({ label: '倉庫を見る', run: () => { baseSub = 'stock'; openSheet('base'); } });
    if (b.type === 'bed') acts.push({ label: '寝かせる', run: () => { const s = selectedParty().filter((m) => m.state === 'ok'); if (!s.length) { toast('仲間を選択してください'); return; } orderRest(world, [s[0].id]); } });
    if (b.type === 'research') acts.push({ label: '研究を選ぶ', run: () => { baseSub = 'research'; openSheet('base'); } });
    if (b.type === 'forge' || b.type === 'armorer') acts.push({ label: '作る物を予約', run: () => { baseSub = 'craft'; openSheet('base'); } });
    if (b.type === 'farm') sub += `・${{ empty: '種まき待ち', growing: `育成中 ${Math.round(b.crop.t * 100)}%`, ripe: '収穫できる' }[b.crop.stage]}`;
    if (B.power) sub += `・電力 ${B.power > 0 ? '+' : ''}${B.power}`;
    if (b.type === 'cage') {
      const inside = world.people.find((o) => o.caged === b.id);
      if (inside) { sub += `・${inside.name}を収容中`; acts.push({ label: '出す', run: () => { const t = releaseCage(world, b); if (t) toast(`${t.name}を檻から出した`); } }); }
      else acts.push({ label: '檻に入れる', run: () => { const c = selectedParty().find((m) => m.carrying); if (!c) { toast('縛った人を担いでいる仲間を選択してください'); return; } if (Math.hypot(c.x - b.x, c.z - b.z) > 4) { toast('檻のそばまで運んでください'); return; } cagePrisoner(world, c, b); } });
    }
  }
  acts.push({ label: '取り壊す', run: async () => { if (await confirmBox(`${B.label}を取り壊しますか？${b.done ? '材料の半分が倉庫に戻ります。' : '材料は戻ります。'}`, '取り壊す', true)) demolish(world, b); } });
  showActions(B.label, sub, acts);
}

// ---- 建築モード ----
let buildMode = null, buildInfoTimer = 0;
function enterBuild(type) {
  closeSheet(); closePop();
  buildMode = { type, rot: 0, start: null, ok: false, pos: null };
  $('reticle').classList.remove('hide');
  $('buildBar').classList.remove('hide');
  document.querySelector('#hud .bottom').classList.add('hide');
  renderBuildBar();
  toast(BUILDINGS[type].wall ? '照準を始点に合わせて「始点」を押してください' : '画面を動かして照準を建てたい場所に合わせてください');
}
function exitBuild() {
  buildMode = null;
  baseView.hidePreview();
  $('reticle').classList.add('hide');
  $('buildBar').classList.add('hide');
  document.querySelector('#hud .bottom').classList.remove('hide');
}
function renderBuildBar() {
  const m = buildMode;
  const B = BUILDINGS[m.type];
  const btns = $('buildBtns');
  btns.innerHTML = '';
  const add = (label, fn, cls = '') => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; btns.appendChild(b); };
  if (B.wall) {
    if (!m.start) add('始点', () => { if (m.pos) { m.start = { x: Math.round(m.pos.x), z: Math.round(m.pos.z) }; renderBuildBar(); } }, 'primary');
    else add('終点', () => {
      if (!m.pos) return;
      const res = placeWall(world, m.start.x, m.start.z, Math.round(m.pos.x), Math.round(m.pos.z));
      toast(res.ok ? `石壁を${res.count}区画置きました${res.reason ? `（${res.reason}）` : ''}` : res.reason || '置けませんでした');
      if (res.ok) m.start = { x: Math.round(m.pos.x), z: Math.round(m.pos.z) }; // 続けて引ける
      renderBuildBar();
    }, 'primary');
    if (m.start) add('始点を外す', () => { m.start = null; renderBuildBar(); });
  } else {
    add('回転', () => { m.rot = (m.rot + 1) % 4; });
    add('確定', () => {
      if (!m.pos) return;
      const res = placeBuilding(world, m.type, m.pos.x, m.pos.z, m.rot);
      if (!res.ok) { toast(res.reason); return; }
      vibrate(15);
      const miss = missingFor(world, B.cost);
      toast(`${B.label}の建設予定地を置きました${miss.length ? `。材料が足りません（${miss.join('、')}）` : '。「建築」の仕事をしている仲間が建てます'}`);
    }, 'primary');
  }
  add('やめる', exitBuild);
}
function updateBuildPreview() {
  const m = buildMode;
  const g = screenToGround(camera, window.innerWidth / 2, window.innerHeight * 0.45);
  if (!g) { baseView.hidePreview(); m.pos = null; return; }
  const B = BUILDINGS[m.type];
  if (B.wall) {
    m.pos = g;
    if (m.start) {
      const len = Math.hypot(g.x - m.start.x, g.z - m.start.z);
      const n = Math.max(1, Math.round(len / 2)), ang = Math.atan2(g.z - m.start.z, g.x - m.start.x);
      const segs = [];
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; segs.push({ x: m.start.x + (g.x - m.start.x) * t, z: m.start.z + (g.z - m.start.z) * t, angle: ang, len: len / n }); }
      baseView.showPreview('wall', 0, 0, 0, true, segs);
    } else baseView.showPreview('wall', g.x, g.z, 0, true, [{ x: g.x, z: g.z, angle: 0, len: 2 }]);
  } else {
    const sp = snapPos(m.type, g.x, g.z, m.rot);
    m.pos = sp;
    const chk = canPlace(world, m.type, sp.x, sp.z, m.rot);
    m.ok = chk.ok; m.reason = chk.reason;
    baseView.showPreview(m.type, sp.x, sp.z, m.rot, chk.ok);
  }
  buildInfoTimer -= 1;
  if (buildInfoTimer <= 0) {
    buildInfoTimer = 15;
    const miss = missingFor(world, B.cost);
    const cost = Object.entries(B.cost).map(([id, n]) => `${ITEMS[id].label}${n}`).join('・');
    $('buildInfo').innerHTML = `<b>${B.label}</b>　材料：${cost}${miss.length ? `　<span class="ng">不足：${miss.join('、')}</span>` : ''}<br>${B.wall ? (m.start ? '照準を終点に合わせて「終点」' : '照準を始点に合わせて「始点」') : m.ok ? '置けます' : `<span class="ng">${m.reason || ''}</span>`}`;
  }
}

// ---- 拠点タブ ----
let baseSub = 'build';
function sheetBase(body) {
  const base = ensureBase(world);
  const pw = powerState(world);
  body.innerHTML = `<div class="subtabs">${[['build', '建設'], ['stock', '倉庫'], ['jobs', '仕事'], ['research', '研究'], ['craft', '生産']].map(([k, l]) => `<button class="btn ${baseSub === k ? 'on' : ''}" data-bsub="${k}">${l}</button>`).join('')}</div>
    <div class="note">${base.founded ? `拠点：建物${base.buildings.filter((b) => b.done).length}・建設中${base.buildings.filter((b) => !b.done).length}・電力 ${pw.supply}/${pw.demand}${pw.ok ? '' : '（不足）'}` : 'まだ拠点がありません。最初の建物を置いた場所が拠点になります（範囲は中心から' + BASE.radius + 'm）。'}</div>
    <div id="bsub"></div>`;
  body.querySelectorAll('[data-bsub]').forEach((b) => { b.onclick = () => { baseSub = b.dataset.bsub; renderSheet(); }; });
  const el = body.querySelector('#bsub');
  if (baseSub === 'build') {
    let html = '';
    for (const t of Object.keys(BUILDINGS)) {
      const B = BUILDINGS[t];
      const ok = unlocked(world, t);
      const miss = missingFor(world, B.cost);
      const cost = Object.entries(B.cost).map(([id, n]) => `${ITEMS[id].label}${n}`).join('・');
      html += `<div class="irow"><div class="info"><b>${B.label}</b>　<small class="muted">${cost}</small><br><small class="muted">${ok ? B.desc : `研究「${TECHS[B.tech].label}」で解放`}</small>${ok && miss.length ? `<br><small style="color:#ff8f7a">不足：${miss.join('、')}</small>` : ''}</div>${ok ? `<button class="btn" data-build="${t}">建てる</button>` : ''}</div>`;
    }
    el.innerHTML = html + '<div class="note">材料は倉庫と、拠点にいる仲間の持ち物から使われます。石材は石切り場（灰色の岩）で掘るか、雑貨屋で買えます。鉄板は町で買うか、精錬炉で鉄鉱石（赤茶色の岩）から作ります。</div>';
    el.querySelectorAll('[data-build]').forEach((b) => { b.onclick = () => enterBuild(b.dataset.build); });
  } else if (baseSub === 'stock') {
    const keys = Object.keys(base.stock).filter((k) => base.stock[k] > 0);
    const who = selectedParty().find((m) => m.state !== 'dead') || partyOf(world).find((m) => m.state === 'ok');
    let html = `<h3>倉庫の中身</h3>`;
    if (!keys.length) html += '<div class="note">空です。採掘した物や作った物はここに入ります。</div>';
    for (const k of keys) { const { id, q } = parseKey(k); html += `<div class="irow"><div class="info"><b>${itemLabel(id, q)}</b> ×${base.stock[k]}</div><button class="btn" data-take="${k}">取り出す</button></div>`; }
    if (who) {
      const inBase = base.founded && Math.hypot(who.x - base.x, who.z - base.z) < BASE.radius;
      html += `<h3>${who.name}の持ち物をしまう</h3>`;
      if (!inBase) html += '<div class="note">拠点の中にいる仲間だけがしまえます。</div>';
      else who.inv.forEach((st, i) => { html += `<div class="irow"><div class="info"><b>${itemLabel(st.id, st.q)}</b> ×${st.qty}</div><button class="btn" data-put="${i}">しまう</button><button class="btn" data-putall="${i}">全部</button></div>`; });
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-take]').forEach((b) => { b.onclick = () => { if (!who) return; const { id, q } = parseKey(b.dataset.take); if (stockTake(world, id, 1, q)) addItem(who, id, 1, q); renderSheet(); }; });
    el.querySelectorAll('[data-put],[data-putall]').forEach((b) => { b.onclick = () => { const st = who.inv[+(b.dataset.put ?? b.dataset.putall)]; if (!st) return; const n = b.dataset.putall !== undefined ? st.qty : 1; const q = st.q ?? 1; if (removeItem(who, st.id, n, q)) stockAdd(world, st.id, n, q); renderSheet(); }; });
  } else if (baseSub === 'jobs') {
    const party = partyOf(world).filter((m) => m.state !== 'dead');
    const cols = `76px repeat(${JOBS.length}, 1fr)`;
    let html = `<div class="note">数字は優先度（1が最優先）。押すたびに 1→2→3→なし と切り替わります。拠点の中で手が空いている仲間が、自動で仕事をします。</div><div class="jobgrid" style="grid-template-columns:${cols}"><span></span>${JOBS.map((j) => `<span class="h">${j.label}</span>`).join('')}`;
    for (const m of party) {
      m.jobs = m.jobs || defaultJobs();
      html += `<span>${m.name}</span>` + JOBS.map((j) => `<button class="btn ${m.jobs[j.id] ? 'on' : ''}" data-job="${m.id}:${j.id}">${m.jobs[j.id] || '-'}</button>`).join('');
    }
    el.innerHTML = html + '</div>';
    el.querySelectorAll('[data-job]').forEach((b) => { b.onclick = () => { const [id, j] = b.dataset.job.split(':'); const m = personById(world, +id); m.jobs[j] = ((m.jobs[j] || 0) + 1) % 4; renderSheet(); }; });
  } else if (baseSub === 'research') {
    const r = base.research;
    let html = `<div class="note">研究台を建て、「研究」の仕事を割り当てた仲間が進めます。電力があると2倍の速さです。</div>`;
    if (r.current) html += `<div class="stat"><span>研究中</span><div class="bar"><i style="width:${(r.progress / TECHS[r.current].cost) * 100}%"></i></div><em>${TECHS[r.current].label}</em></div>`;
    for (const [id, T] of Object.entries(TECHS)) {
      const doneT = r.done.includes(id), av = techAvailable(world, id);
      const req = T.requires.filter((x) => !r.done.includes(x)).map((x) => TECHS[x].label).join('・');
      const items = Object.entries(T.items || {}).map(([it, n]) => `${ITEMS[it].label}${n}（倉庫${stockCount(world, it)}）`).join('・');
      html += `<div class="tech ${doneT ? 'done' : ''}"><div class="info"><b>${T.label}</b>　<span class="muted">${T.cost}</span><br>${T.desc}${items && !doneT ? `<br><span class="muted">遺物：${items}</span>` : ''}${req ? `<br><span class="muted">先に：${req}</span>` : ''}</div>${doneT ? '<span class="muted">完了</span>' : r.current === id ? '<span class="money">研究中</span>' : av ? `<button class="btn" data-tech="${id}">研究する</button>` : ''}</div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-tech]').forEach((b) => { b.onclick = () => {
      const id = b.dataset.tech, T = TECHS[id];
      if (r.current === id) return;
      // 遺物が必要な研究は、始めるときに倉庫から使う（途中で別の研究に切り替えると失われる）
      const lack = Object.entries(T.items || {}).filter(([it, n]) => stockCount(world, it) < n);
      if (lack.length) { toast(`倉庫に${lack.map(([it, n]) => `${ITEMS[it].label}${n}`).join('・')}が必要です（廃墟の箱で見つかります）`); return; }
      for (const [it, n] of Object.entries(T.items || {})) stockTake(world, it, n);
      r.progress = 0; r.current = id; toast(`「${T.label}」を研究します`); renderSheet();
    }; });
  } else {
    let html = '<div class="note">精錬炉（鉄鉱石3→鉄板）と調理台（穀物2→平焼きパン）は、材料が倉庫にあれば「加工」「調理」の仕事で自動で作ります。武器・防具は予約した分だけ作ります。出来た物は倉庫に入ります。</div>';
    for (const type of ['forge', 'armorer']) {
      const has = base.buildings.some((b) => b.done && b.type === type);
      html += `<h3>${BUILDINGS[type].label}${has ? '' : '（未建設）'}</h3>`;
      const q = base.queues[type];
      if (q.length) html += `<div class="note">予約：${q.map((id) => RECIPES[type].find((x) => x.id === id)?.label).join('、')}　<button class="btn" data-clear="${type}">取り消し</button></div>`;
      for (const r of RECIPES[type]) {
        if (r.tech && !base.research.done.includes(r.tech)) continue;
        const ins = Object.entries(r.in).map(([id, n]) => `${ITEMS[id].label}${n}（${stockCount(world, id)}）`).join('・');
        html += `<div class="irow"><div class="info"><b>${r.label}</b><br><small class="muted">${ins}</small></div>${has ? `<button class="btn" data-queue="${type}:${r.id}">予約</button>` : ''}</div>`;
      }
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-queue]').forEach((b) => { b.onclick = () => { const [t, id] = b.dataset.queue.split(':'); base.queues[t].push(id); renderSheet(); }; });
    el.querySelectorAll('[data-clear]').forEach((b) => { b.onclick = () => { base.queues[b.dataset.clear] = []; renderSheet(); }; });
  }
}

// ---- 起動 ----
function boot() {
  applyQuality(effectiveQuality());
  const sp = world.spawn;
  rig.target.set(sp.x, 0, sp.z);
  terrain.update(rig.target, atmosphere.fogColor, 999);
  rig.update(0.016);
  $('loading').classList.add('hide');
  refreshTitle();
  setTimeout(() => ensureMapImage(), 1500);
  requestAnimationFrame((t) => { last = t; loop(t); });
}
boot();

// 自動テスト用
window.__game = { get world() { return world; }, rig, renderer, atmosphere, towns, orderMoveTo: (x, z) => moveSelectedTo(x, z), terrain, settings, BUILD, selected, camera, addLog: (t) => addLog(world, t), debug, openPerson, orderTreat, orderRest, orderBind, orderCarry, orderAttack, talk, openMap, openSheet, enterBuild, exitBuild, placeBuilding, snapPos, ensureBase, setBaseSub: (v) => { baseSub = v; }, serializeNow: () => serialize(world, cameraState(), BUILD.build), pick: (x, y) => pickPeople(camera, world.people, x, y).length, closeSheet, ph6: { setWeather, weatherInfo, cachesNear, cacheState, orderSearch, trafficMarks, ensureRaid, raidCountdownHours, baseScore, get pendingTalk() { return pendingTalk; }, get talkSession() { return talkSession; } } };
