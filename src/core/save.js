// セーブ／ロード
// ・本体は IndexedDB、スロット一覧は localStorage（自動セーブは localStorage にも控えを書く）
// ・世界はシード値から再生成できるため、変化する状態（人物・時刻・所持金など）だけを保存
// ・セーブ形式に版数 v を持たせ、migrate() で古い版を最新へ移行する
// ・書き出し用テキストは deflate 圧縮＋base64（非対応端末は無圧縮）
import { SAVE } from '../data/config.js';
import { Rng } from './rng.js';
import { findSpawn } from '../sim/worldgen.js';
import { initHealth } from '../sim/body.js';
import { attachRuntime, dressFromLook, populateTowns } from '../sim/world.js';
import { emptyEquip } from '../sim/equip.js';
import { newFight } from '../sim/combat.js';

const DB_NAME = 'w3d', STORE = 'saves', META_KEY = 'w3d.slots', AUTO_BACKUP = 'w3d.autosave';
export const SLOT_IDS = ['auto', ...Array.from({ length: SAVE.slots }, (_, i) => 's' + (i + 1))];
export const slotLabel = (id) => (id === 'auto' ? '自動セーブ' : `スロット${id.slice(1)}`);

// ---- 状態 ⇄ セーブデータ ----
const PERSON_FIELDS = ['id', 'kind', 'name', 'surname', 'x', 'z', 'heading', 'maxSpeed', 'homeX', 'homeZ', 'look',
  'race', 'body', 'blood', 'hunger', 'state', 'koTimer', 'skills', 'inv', 'resting',
  'faction', 'equip', 'equipVer', 'money', 'bound', 'angryAt', 'enemyType', 'title', 'bounty', 'squad', 'carrying', 'carriedBy',
  'role', 'town', 'station', 'patrolIdx', 'shop', 'hirePrice', 'sneak', 'jailUntil', 'provokedBy', 'treatedBy',
  'jobs', 'inBed', 'caged'];

export function serialize(world, cam, build) {
  return {
    v: SAVE.version,
    build,
    savedAt: Date.now(),
    seed: world.seed,
    rng: world.rng.state,
    nextId: world.nextId,
    hour: world.hour,
    day: world.day,
    timeScale: world.timeScale,
    money: world.money,
    time: world.time,
    banditsOn: world.banditsOn,
    rep: world.rep, wanted: world.wanted, tollPaid: world.tollPaid, tollRefused: world.tollRefused,
    discovered: world.discovered, shops: world.shops, tradeRep: world.tradeRep,
    base: world.base,
    spawnTimer: world.spawnTimer,
    squads: world.squads.map((q) => ({ id: q.id, members: q.members, mode: q.mode, cooldownUntil: q.cooldownUntil })),
    camera: cam,
    people: world.people.map((p) => {
      const o = {};
      for (const f of PERSON_FIELDS) o[f] = p[f];
      if (p.goal) o.goal = p.goal;
      return o;
    }),
    log: world.log.slice(-40),
  };
}

// 古い版のセーブを最新の形へ（版を上げたらここに1段ずつ追加する）
export function migrate(data) {
  if (!data || typeof data !== 'object') throw new Error('セーブデータの形式が正しくありません');
  let d = data;
  if (d.v === undefined) throw new Error('版数のないセーブデータは読み込めません');
  // v1 → v2（Phase 2）：体・能力・所持品・種族を追加
  if (d.v === 1) {
    d = { ...d, v: 2, people: d.people.map((p) => {
      const q = { ...p, race: 'sunabito', inv: p.kind === 'party' ? [{ id: 'dried_meat', qty: 2 }, { id: 'bandage', qty: 3 }] : [] };
      initHealth(q, new Rng(p.id * 7919 + 1));
      return q;
    }) };
  }
  // v2 → v3（Phase 3）：陣営・装備・所持金・戦闘の状態を追加
  if (d.v === 2) {
    d = { ...d, v: 3, time: 0, banditsOn: true, squads: [], people: d.people.map((p, i) => {
      const q = { ...p, faction: p.kind === 'party' ? 'player' : 'drifter', equip: emptyEquip(), money: 0 };
      dressFromLook(q);
      if (p.kind === 'party' && d.people.findIndex((x) => x.kind === 'party') === i) q.equip.weapon = { id: 'rusty_blade', q: 1 };
      return q;
    }) };
  }
  // v3 → v4（Phase 4）：町の人々・派閥の評判を追加（町の人々は読み込み時に生成）
  if (d.v === 3) d = { ...d, v: 4, needTowns: true };
  // v4 → v5（Phase 5）：拠点（なければ空のまま）と仕事の割り当て
  if (d.v === 4) d = { ...d, v: 5, people: d.people.map((p) => (p.kind === 'party' && !p.jobs ? { ...p, jobs: { build: 1, mine: 0, farm: 0, cook: 0, craft: 0, research: 0 } } : p)) };
  // 版を上げたらここに1段ずつ追加する
  if (d.v > SAVE.version) throw new Error('新しい版で作られたセーブデータです。ゲームを最新版に更新してください');
  return d;
}

export function deserialize(raw) {
  const d = migrate(raw);
  const world = {
    seed: d.seed,
    rng: new Rng(d.rng),
    nextId: d.nextId,
    spawn: findSpawn(),
    hour: d.hour,
    day: d.day,
    timeScale: d.timeScale ?? 1,
    debugFast: false,
    money: d.money ?? 0,
    time: d.time || 0,
    banditsOn: d.banditsOn !== false,
    spawnTimer: d.spawnTimer || 0,
    squads: (d.squads || []).map((q) => ({ ...q, t: 0 })),
    rep: d.rep, wanted: d.wanted, tollPaid: d.tollPaid, tollRefused: d.tollRefused, discovered: d.discovered, shops: d.shops, tradeRep: d.tradeRep,
    base: d.base,
    people: d.people.map((p) => ({
      ...p,
      speed: 0, phase: Math.random() * 6.28, path: [], goal: null, pendingGoal: p.goal || null,
      stuck: 0, replans: 0, idle: Math.random() * 2, task: null, fight: newFight(),
    })),
    log: d.log || [],
  };
  for (const p of world.people) if (p.resting) p.task = { kind: 'rest' };
  attachRuntime(world);
  if (d.needTowns) populateTowns(world);
  return { world, camera: d.camera };
}

// ---- IndexedDB ----
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      if (!('indexedDB' in window)) { rej(new Error('IndexedDB 非対応')); return; }
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbPromise;
}
async function idbPut(k, v) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function idbGet(k) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readonly'); const q = t.objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbDel(k) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

// ---- スロット一覧（localStorage） ----
export function listSlots() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function setMeta(id, data) {
  const m = listSlots();
  if (data) m[id] = { savedAt: data.savedAt, day: data.day, hour: data.hour, build: data.build, money: data.money, members: data.people.filter((p) => p.kind === 'party').map((p) => p.name) };
  else delete m[id];
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* 容量不足でも続行 */ }
}

export async function saveSlot(id, data) {
  setMeta(id, data);
  if (id === 'auto') {
    // 画面オフ直後は非同期の書き込みが間に合わないことがあるため、同期で控えも書く
    try { localStorage.setItem(AUTO_BACKUP, JSON.stringify(data)); } catch { /* 続行 */ }
  }
  try { await idbPut(id, data); } catch (e) { if (id !== 'auto') throw e; }
}

export async function loadSlot(id) {
  let data = null;
  try { data = await idbGet(id); } catch { /* IndexedDB が使えない */ }
  if (id === 'auto') {
    // IndexedDB と控えのうち新しい方を使う
    try {
      const b = JSON.parse(localStorage.getItem(AUTO_BACKUP) || 'null');
      if (b && (!data || b.savedAt > data.savedAt)) data = b;
    } catch { /* 続行 */ }
  }
  return data;
}

export async function deleteSlot(id) {
  setMeta(id, null);
  if (id === 'auto') localStorage.removeItem(AUTO_BACKUP);
  try { await idbDel(id); } catch { /* 続行 */ }
}

// ---- 書き出し・読み込み用テキスト ----
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export async function exportText(data) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== 'undefined') {
    const out = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return 'W3D1:' + b64(new Uint8Array(out));
  }
  return 'W3D0:' + b64(json);
}

export async function importText(text) {
  const t = text.trim().replace(/\s+/g, '');
  const head = t.slice(0, 5), body = t.slice(5);
  let bytes;
  if (head === 'W3D1:') {
    if (typeof DecompressionStream === 'undefined') throw new Error('この端末は圧縮データの読み込みに対応していません');
    bytes = new Uint8Array(await new Response(new Blob([unb64(body)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  } else if (head === 'W3D0:') bytes = unb64(body);
  else throw new Error('セーブデータのテキストではありません（先頭が W3D で始まります）');
  return migrate(JSON.parse(new TextDecoder().decode(bytes)));
}
