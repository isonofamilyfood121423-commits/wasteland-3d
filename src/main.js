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
import { FACTIONS } from './data/combat.js';
import { Effects } from './render/effects.js';
import { Atmosphere } from './render/atmosphere.js';
import { TerrainView } from './render/terrainView.js';
import { HumanView } from './render/humanView.js';
import { Markers, RING } from './render/markers.js';
import { CameraRig } from './ui/cameraRig.js';
import { screenToGround, pickPeople, peopleInRect } from './ui/picking.js';
import { faceIcon } from './ui/faces.js';
import { ask, confirmBox, toast } from './ui/dialog.js';

/* global __BUILD__, __BUILD_TIME__ */
const BUILD = { build: __BUILD__, time: __BUILD_TIME__ };
installErrorPanel(BUILD);

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const vibrate = (ms) => { if (settings.vibrate) navigator.vibrate?.(ms); };

// ---- ブラウザ既定動作の無効化（ズーム・長押しメニュー・プルリフレッシュ） ----
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (!e.target.closest('#sheetBody,#errPanel,#party,#dialog textarea')) e.preventDefault(); }, { passive: false });

// ---- レンダラー ----
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 2600);
const atmosphere = new Atmosphere(scene);
const terrain = new TerrainView(scene);
const humans = new HumanView(scene, CROWD.count + 16);
const markers = new Markers(scene);
const effects = new Effects(scene);
const rig = new CameraRig(camera, canvas);

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
  world.onAlarm = () => vibrate([60, 40, 60]);
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
  startWorld(createWorld(WORLD.seed + Math.floor(Math.random() * 1e6)));
  // 仕様判断：地形は固定シード（手作りに近い世界として扱う）、人物の顔ぶれだけ毎回変える
  world.seed = WORLD.seed;
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
    const st = p.state === 'dead' ? '死亡' : p.state === 'ko' ? '気絶' : totalBleed(p) > 0.05 ? '出血' : p.task?.kind === 'treat' ? '治療' : p.task?.kind === 'rest' ? '休息' : '';
    el.querySelector('.st').textContent = st;
  });
}
function selectOnly(id) { selected.clear(); selected.add(id); inspected = null; updatePartyMarks(); }
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
    toast(`${p.name}（${p.title || FACTIONS[p.faction]?.label || '流れ者'}）　長押しで行動を選べます`);
    return;
  }
  const g = screenToGround(camera, x, y);
  if (g) moveSelectedTo(g.x, g.z);
};

rig.onLongPress = async (x, y) => {
  if (!running) return;
  vibrate(20);
  const p = await pickAt(x, y, 'だれに対して？');
  if (p) return personActions(p);
  const g = screenToGround(camera, x, y);
  if (!g) return;
  showActions('この地点', `${Math.round(g.x)}, ${Math.round(g.z)}`, [
    { label: '選択中の仲間を移動', run: () => moveSelectedTo(g.x, g.z) },
    { label: '全員をここへ', run: () => { const all = partyOf(world); orderMove(world, all.map((m) => m.id), g.x, g.z); selected.clear(); all.forEach((m) => selected.add(m.id)); updatePartyMarks(); } },
    { label: 'カメラをここへ', run: () => { rig.follow = null; rig.target.x = g.x; rig.target.z = g.z; } },
    { label: '調べる', phase: 'Phase 6' },
  ]);
};

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
    acts.push({ label: '話す', phase: 'Phase 4' });
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
  ({ party: sheetParty, save: sheetSave, log: sheetLog, settings: sheetSettings, person: sheetPerson })[sheetTab](body);
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
    <h3>表示と操作</h3>
    <div class="row">
      <button class="btn ${settings.dynRes ? 'on' : ''}" id="dynBtn">解像度の自動調整</button>
      <button class="btn ${settings.debug ? 'on' : ''}" id="dbgBtn">デバッグ表示</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn ${settings.vibrate ? 'on' : ''}" id="vibBtn">振動</button>
      <button class="btn" id="fsBtn">全画面</button>
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
  $('dbgBtn').onclick = () => { settings.debug = !settings.debug; saveSettings(settings); renderSheet(); };
  $('vibBtn').onclick = () => { settings.vibrate = !settings.vibrate; saveSettings(settings); vibrate(30); renderSheet(); };
  $('fsBtn').onclick = tryFullscreen;
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
  autosave();
}
function onShow() {
  if (!hiddenPaused) return;
  hiddenPaused = false;
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
  humans.update(world.people, focus, elapsed);
  if (world.events?.length) { effects.spawn(world.events); world.events.length = 0; }
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

  stats.push(dt);
  if (running) {
    if (probe && !probe.done) probe.update(dt, (name) => applyQuality(name));
    else if (dyn.update(dt, stats.fps)) resize();
    if (now - lastAutosave > SAVE.autosaveInterval * 1000) autosave();
  }

  uiTimer -= dt;
  if (uiTimer <= 0 && running) {
    uiTimer = 0.25;
    $('timeLabel').textContent = fmtHour(world.hour);
    $('dayLabel').textContent = `${world.day}日目 ${atmosphere.isNight ? '夜' : world.hour < 10 ? '朝' : world.hour < 17 ? '昼' : '夕'}`;
    $('moneyLabel').textContent = `${world.money} ${PARTY.currency}`;
    updatePartyMarks();
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

// ---- 起動 ----
function boot() {
  applyQuality(effectiveQuality());
  const sp = world.spawn;
  rig.target.set(sp.x, 0, sp.z);
  terrain.update(rig.target, atmosphere.fogColor, 999);
  rig.update(0.016);
  $('loading').classList.add('hide');
  refreshTitle();
  requestAnimationFrame((t) => { last = t; loop(t); });
}
boot();

// 自動テスト用
window.__game = { get world() { return world; }, rig, renderer, terrain, settings, BUILD, selected, camera, addLog: (t) => addLog(world, t), debug, openPerson, orderTreat, orderRest, orderBind, orderCarry, orderAttack, pick: (x, y) => pickPeople(camera, world.people, x, y).length };
