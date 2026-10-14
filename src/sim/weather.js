// 天候（ロジック層）：地域ごとに起きる天気・切り替わり・雨による傷み
// 仕様判断：天気は「一団のいる地域」に対して1つだけ持つ（スマホの負荷と分かりやすさを優先）
import { WEATHER, WEATHER_CFG } from '../data/events.js';
import { regionAt, townAt } from './terrain.js';
import { damage, partMax } from './body.js';
import { ensureBase, footprint } from './base.js';

const H = (w, hours) => (hours / 24) * w.daySeconds; // ゲーム内の時間 → 経過秒

function center(w) {
  const party = w.people.filter((p) => p.kind === 'party' && p.state !== 'dead');
  if (!party.length) return w.focus || { x: 0, z: 0 };
  return { x: party.reduce((a, p) => a + p.x, 0) / party.length, z: party.reduce((a, p) => a + p.z, 0) / party.length };
}

export function regionName(reg) {
  if (reg.rust > 0.5) return 'rust';
  if (reg.ash > 0.5) return 'ash';
  return 'sand';
}

export function ensureWeather(w) {
  if (!w.weather) w.weather = { type: 'clear', i: 0, until: H(w, 2) + w.time };
  return w.weather;
}

// 天気を強制する（検証用・設定画面）
export function setWeather(w, type, hours = 2) {
  const s = ensureWeather(w);
  s.type = type;
  s.forced = type !== 'clear'; // 地域に関係なく続ける（検証用）
  s.until = w.time + H(w, hours);
  if (type === 'clear') s.i = Math.min(s.i, 1);
}

// 1秒ごと（ゲーム内の経過）に呼ぶ
export function stepWeather(w, gsec) {
  const s = ensureWeather(w);
  w.weatherClock = (w.weatherClock || 0) + gsec;
  // 強さはなめらかに変える（ゲームの速さに関係なく現実時間で）
  const want = s.type === 'clear' ? 0 : 1;
  const c = center(w);
  const reg = regionName(regionAt(c.x, c.z));
  // 地域を出たら、その地域の天気は弱まっていく
  const fits = s.type === 'clear' || s.forced || WEATHER[s.type].region === reg;
  const target = fits ? want : 0;
  const step = gsec / Math.max(1, w.timeScale || 1) / WEATHER_CFG.fadeSec;
  s.i += Math.max(-step, Math.min(step, target - s.i));
  if (s.i < 0.001 && s.type !== 'clear' && !fits) { s.type = 'clear'; s.until = w.time + H(w, 1); }
  if (w.weatherClock < 1) return;
  const dt = w.weatherClock; w.weatherClock = 0;

  if (w.time >= s.until) {
    if (s.type !== 'clear') {
      s.type = 'clear'; s.forced = false;
      const [a, b] = WEATHER_CFG.clearHours;
      s.until = w.time + H(w, a + w.rng.next() * (b - a));
      if (s.i > 0.2) w.addLogFn?.('空が晴れてきた。', true);
    } else {
      const kind = Object.entries(WEATHER).find(([, v]) => v.region === reg);
      if (kind && w.rng.next() < kind[1].chance) {
        s.type = kind[0];
        const [a, b] = kind[1].hours;
        s.until = w.time + H(w, a + w.rng.next() * (b - a));
        w.addLogFn?.(`${kind[1].label}が近づいてくる。${kind[0] === 'acid' ? '屋根の下へ入ったほうがいい。' : ''}`);
      } else {
        s.until = w.time + H(w, 1 + w.rng.next() * 2);
      }
    }
  }
  const def = WEATHER[s.type];
  w.weatherSight = 1 - (1 - (def.sight ?? 1)) * s.i;

  // 酸性雨：屋根の下にいない人の体が少しずつ傷む（一定以下にはならない）
  if (s.type === 'acid' && s.i > 0.3) {
    const hours = (dt / w.daySeconds) * 24;
    for (const p of w.people) {
      if (p.state === 'dead' || p.far || p.caged || sheltered(w, p)) continue;
      let mul = s.i * (def.raceMul[p.race] || 1);
      if (p.equip?.outer) mul *= def.outerMul;
      if (p.equip?.head) mul *= def.headMul;
      const amt = def.damagePerHour * hours * mul;
      for (const id of ['head', 'chest', 'armL', 'armR']) {
        const b = p.body[id];
        if (!b || (b.lost && !b.prosthetic)) continue;
        const max = partMax(p, id);
        if (b.hp - amt / 4 > max * def.floor) damage(w, p, id, amt / 4, { cut: false });
      }
    }
  }
}

// 屋根の下：拠点の小屋の中、または町の中（建物の軒下に入れるものとする）
export function sheltered(w, p) {
  if (townAt(p.x, p.z)) return true; // 仕様判断：町の中では軒下に入れるものとして扱う
  const base = ensureBase(w);
  if (!base.founded) return false;
  for (const b of base.buildings) {
    if (!b.done || b.type !== 'hut') continue;
    const fp = footprint('hut', b.x, b.z, b.rot || 0);
    if (Math.abs(p.x - b.x) < fp.w / 2 && Math.abs(p.z - b.z) < fp.d / 2) return true;
  }
  return false;
}

export function weatherInfo(w) {
  const s = ensureWeather(w);
  return { type: s.type, i: s.i, def: WEATHER[s.type], label: s.i > 0.15 ? WEATHER[s.type].label : '晴れ' };
}
