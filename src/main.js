// エントリーポイント：ロジック（sim）と描画（render）と操作（ui）をつなぐ
import * as THREE from 'three';
import { installErrorPanel } from './core/errors.js';
import { FrameStats, DynamicResolution, QualityProbe } from './core/perf.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { serialize, deserialize, saveSlot, loadSlot, deleteSlot, listSlots, exportText, importText, SLOT_IDS, slotLabel } from './core/save.js';
import { QUALITY, DPR_HARD_CAP, CAMERA, WORLD, CROWD, PARTY, SAVE } from './data/config.js';
import { createWorld, stepWorld, orderMove, stopPerson, partyOf, personById, addLog } from './sim/world.js';
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

function cameraState() { return { x: rig.target.x, z: rig.target.z, yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist }; }

function startWorld(w, cam) {
  world = w;
  world.onLog = (text) => toast(text);
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
    el.innerHTML = `<img src="${faceIcon(p)}" alt=""><span>${p.name}</span>`;
    el.onclick = () => {
      // すでに1人だけ選択中なら、カメラをその人へ
      if (selected.size === 1 && selected.has(p.id)) { centerOn(p); return; }
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
    el.classList.toggle('moving', !!(p && p.path.length));
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
    if (p.kind === 'party') { selectOnly(p.id); vibrate(8); }
    else { inspected = p; toast(`${p.name}（流れ者）　長押しで行動を選べます`); }
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

function personActions(p) {
  if (p.kind === 'party') {
    showActions(p.name, '仲間', [
      { label: '選択する', run: () => selectOnly(p.id) },
      { label: 'カメラで追う', run: () => followPerson(p) },
      { label: 'その場で待機', run: () => stopPerson(p) },
      { label: '体の状態', phase: 'Phase 2' },
      { label: '持ち物', phase: 'Phase 2' },
      { label: '治療する', phase: 'Phase 2' },
    ]);
  } else {
    inspected = p;
    showActions(p.name, '流れ者', [
      { label: '話す', phase: 'Phase 4' },
      { label: '攻撃する', phase: 'Phase 3' },
      { label: '担ぐ', phase: 'Phase 3' },
      { label: '治療する', phase: 'Phase 2' },
      { label: 'カメラで追う', run: () => followPerson(p) },
      { label: 'そばへ移動', run: () => moveSelectedTo(p.x + 1.2, p.z + 1.2) },
    ]);
  }
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
  ({ party: sheetParty, save: sheetSave, log: sheetLog, settings: sheetSettings })[sheetTab](body);
}

function sheetParty(body) {
  body.innerHTML = `<h3>一団（${partyOf(world).length}人）　所持金 ${world.money} ${PARTY.currency}</h3>`;
  for (const p of partyOf(world)) {
    const d = document.createElement('div');
    d.className = 'member';
    const state = p.path.length ? '移動中' : '待機中';
    d.innerHTML = `<img src="${faceIcon(p)}" alt=""><div class="info"><b>${p.name}</b> <span class="muted">${p.surname}</span><br>${state}・位置 ${Math.round(p.x)}, ${Math.round(p.z)}</div>`;
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = '見る';
    b.onclick = () => { selectOnly(p.id); centerOn(p); closeSheet(); };
    d.appendChild(b);
    body.appendChild(d);
  }
  const n = document.createElement('div');
  n.className = 'note';
  n.textContent = '体の状態・能力・装備・持ち物は Phase 2 以降でここに表示されます。';
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
let elapsed = 0, uiTimer = 0;
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

  // 選択リングと移動先
  ringItems.length = 0; destItems.length = 0;
  if (running) {
    for (const id of selected) {
      const p = personById(world, id);
      if (!p) continue;
      ringItems.push({ x: p.x, z: p.z, color: RING.party });
      if (p.goal) destItems.push(p.goal);
    }
    if (inspected) ringItems.push({ x: inspected.x, z: inspected.z, color: RING.neutral });
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
window.__game = { get world() { return world; }, rig, renderer, terrain, settings, BUILD, selected, camera, addLog: (t) => addLog(world, t) };
