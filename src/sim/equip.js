// 装備（武器・防具）の付け外しと参照（ロジック層）
import { ITEMS, WEAPON_CATS, QUALITY_MUL, SLOTS } from '../data/items.js';
import { addItem, removeItem } from './body.js';

export function emptyEquip() { return Object.fromEntries(SLOTS.map((s) => [s.id, null])); }

// 所持品から装備する（同じスロットの物は所持品へ戻す）
export function equipItem(p, id, q = 1) {
  const it = ITEMS[id];
  if (!it?.slot) return false;
  if (!removeItem(p, id, 1, q)) return false;
  const old = p.equip[it.slot];
  if (old) addItem(p, old.id, 1, old.q);
  p.equip[it.slot] = { id, q };
  p.equipVer = (p.equipVer || 0) + 1;
  return true;
}

export function unequip(p, slot) {
  const e = p.equip[slot];
  if (!e) return false;
  addItem(p, e.id, 1, e.q);
  p.equip[slot] = null;
  p.equipVer = (p.equipVer || 0) + 1;
  return true;
}

// 手に持つ武器（なければ素手）
export function weaponOf(p) {
  const e = p.equip?.weapon;
  if (!e) return { id: null, cat: WEAPON_CATS.fist, type: 'fist', cut: 0, blunt: 6, reqStr: 0, q: 1, mul: 1 };
  const w = ITEMS[e.id].weapon;
  return { id: e.id, cat: WEAPON_CATS[w.type], type: w.type, cut: w.cut, blunt: w.blunt, reqStr: w.reqStr, q: e.q, mul: QUALITY_MUL[e.q] };
}

// その部位を守る防具の一覧
export function armorFor(p, partId) {
  const out = [];
  for (const s of SLOTS) {
    const e = p.equip?.[s.id];
    if (!e) continue;
    const a = ITEMS[e.id].armor;
    if (!a || !a.cover[partId]) continue;
    out.push({ cover: a.cover[partId], cut: Math.min(0.85, a.cut * QUALITY_MUL[e.q]), blunt: Math.min(0.85, a.blunt * QUALITY_MUL[e.q]) });
  }
  return out;
}
