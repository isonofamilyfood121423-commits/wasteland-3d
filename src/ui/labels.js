// 頭上の名札と店の看板（HTMLを3Dの上に重ねる）。だれがどんな役割か一目で分かるように（Phase 7）
import * as THREE from 'three';
import { heightAt } from '../sim/terrain.js';
import { SHOPS, ROLE_LABEL, FACTIONS } from '../data/world.js';
import { allTowns } from '../sim/towns.js';

const MAX = 26;
const v = new THREE.Vector3();

// 人物の役割の表示名と色の種類
export function roleText(p, hostileFn) {
  const down = p.state === 'dead' ? '（死亡）' : p.state !== 'ok' ? '（気絶）' : p.bound ? '（縛られている）' : '';
  if (p.kind === 'party') return { text: p.name + down, cls: 'party' };
  const hostile = p.state === 'ok' && !p.bound && hostileFn(p);
  let t;
  switch (p.role) {
    case 'shopkeeper': t = `${SHOPS[p.shop]?.label || '店'}の店主`; break;
    case 'bartender': t = '酒場の主人'; break;
    case 'police': t = '警備所の役人'; break;
    case 'recruit': t = `雇える人${p.hirePrice ? `・${p.hirePrice}` : '・無料'}`; break;
    case 'trader': t = '隊商の商人（売買）'; break;
    case 'boss': t = `${p.title || '頭目'}`; break;
    default: t = p.title || ROLE_LABEL[p.role] || FACTIONS[p.faction]?.label || '流れ者';
  }
  if (p.bounty && p.state !== 'dead') t += `・賞金${p.bounty}`;
  const cls = hostile ? 'foe' : ['shopkeeper', 'bartender', 'police', 'trader'].includes(p.role) ? 'shop' : p.role === 'recruit' ? 'hire' : p.role ? 'npc' : 'drift';
  return { text: t + down, cls };
}

export class Labels {
  constructor(root) {
    this.root = root;
    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'lbl hide';
      root.appendChild(el);
      this.pool.push({ el, text: '', cls: '' });
    }
    this.signs = [];
    for (const L of allTowns()) for (const b of L.buildings) if (b.type === 'shop') this.signs.push({ b, town: L.town, label: SHOPS[b.shop].label });
  }

  // mode: all（全員）・role（仲間・役割のある人・敵）・off
  update(camera, people, focus, camDist, mode, hostileFn, W, H, hiddenFn = () => false) {
    let n = 0;
    const placed = [];
    const set = (x, y, z, text, cls) => {
      if (n >= MAX) return;
      v.set(x, y, z).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
      let sx = ((v.x + 1) / 2) * W, sy = ((1 - v.y) / 2) * H;
      // 重なる名札は上へずらす（近い人ほど先に置くので、近い人の名札が元の位置に残る）
      const hw = (text.length * 14 + 12) / 2;
      for (let k = 0; k < 4; k++) {
        const hit = placed.find((r) => Math.abs(r.x - sx) < r.hw + hw && Math.abs(r.y - sy) < 19);
        if (!hit) break;
        sy = hit.y - 20;
      }
      placed.push({ x: sx, y: sy, hw });
      const s = this.pool[n++];
      if (s.text !== text) { s.el.textContent = text; s.text = text; }
      if (s.cls !== cls) { s.el.className = 'lbl ' + cls; s.cls = cls; }
      s.el.style.transform = `translate3d(${sx}px,${sy}px,0) translate(-50%,-100%)`;
    };
    if (mode !== 'off' && camDist < 80) {
      const R = Math.min(60, 18 + camDist * 0.8);
      // 店の看板（建物の上）
      for (const sg of this.signs) {
        const b = sg.b;
        if (Math.abs(b.x - focus.x) > R + 10 || Math.abs(b.z - focus.z) > R + 10) continue;
        set(b.x, heightAt(b.x, b.z) + b.h + 2.6, b.z, sg.label, 'sign');
      }
      // 人物（近い順）
      const list = [];
      for (const p of people) {
        if (p.carriedBy || p.far || (p.kind !== 'party' && hiddenFn(p))) continue;
        const dx = p.x - focus.x, dz = p.z - focus.z;
        if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
        if (mode === 'role' && p.kind !== 'party' && (!p.role || p.role === 'folk') && !p.bounty && !(p.state === 'ok' && hostileFn(p)) && !p.raider) continue;
        list.push([dx * dx + dz * dz, p]);
      }
      list.sort((a, b) => a[0] - b[0]);
      for (const [, p] of list) {
        if (n >= MAX) break;
        const { text, cls } = roleText(p, hostileFn);
        const lying = p.state !== 'ok';
        set(p.x, heightAt(p.x, p.z) + (lying ? 0.9 : 2.35 * (p.look?.height || 1)), p.z, text, cls);
      }
    }
    for (let i = n; i < MAX; i++) { const s = this.pool[i]; if (s.cls !== 'hide') { s.el.className = 'lbl hide'; s.cls = 'hide'; } }
  }
}
