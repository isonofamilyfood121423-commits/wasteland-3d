// 店の売買・在庫・窃盗・仲間の雇用（ロジック層）
import { SHOPS, TRADE, REP, FACTIONS } from '../data/world.js';
import { ITEMS, QUALITY_PRICE } from '../data/items.js';
import { addItem, removeItem, gainXp, effSkill } from './body.js';
import { changeRep, makeWanted } from './factions.js';
import { townById } from './towns.js';
import { PARTY } from '../data/config.js';
import { defaultJobs } from './base.js';
import { Rng, hash2 } from '../core/rng.js';

const isGear = (id) => !!(ITEMS[id].weapon || ITEMS[id].armor || ITEMS[id].carry);

export function priceOf(w, town, id, q = 1, selling = false) {
  const it = ITEMS[id];
  const mod = town.prices?.[id] ?? town.prices?.[it.cat] ?? 1;
  const rep = w.rep[town.faction] ?? 0;
  const disc = Math.min(0.2, Math.max(-0.2, rep * TRADE.repDiscount));
  let p = it.price * (isGear(id) ? QUALITY_PRICE[q] : 1) * mod;
  p = selling ? p * TRADE.sellRatio * (1 + disc) : p * (1 - disc);
  return Math.max(1, Math.round(p));
}

// 在庫：1日ごとに入れ替わる（町と日付から決まる）
export function shopStock(w, townId, shopType) {
  w.shops = w.shops || {};
  const key = townId + ':' + shopType;
  let s = w.shops[key];
  const day = Math.floor((w.day - 1) / TRADE.restockDays);
  if (!s || s.day !== day) {
    const r = new Rng(Math.floor(hash2(day, key.length * 31 + townId.charCodeAt(0), shopType.charCodeAt(0)) * 2 ** 31));
    const stock = [];
    for (const [id, n] of SHOPS[shopType].stock) {
      const qty = Math.max(0, Math.round(n * (0.4 + r.next() * 0.8)));
      if (!qty) continue;
      if (isGear(id)) {
        for (let i = 0; i < qty; i++) {
          const x = r.next();
          const q = x < 0.3 ? 0 : x < 0.8 ? 1 : x < 0.96 ? 2 : 3;
          const ex = stock.find((e) => e.id === id && e.q === q);
          if (ex) ex.qty++; else stock.push({ id, q, qty: 1 });
        }
      } else stock.push({ id, q: 1, qty });
    }
    s = w.shops[key] = { day, stock, sold: [] };
  }
  return s;
}

function tradeRep(w, f) {
  w.tradeRep = w.tradeRep || {};
  if ((w.tradeRep[f] || 0) >= REP.tradeCap) return;
  w.tradeRep[f] = (w.tradeRep[f] || 0) + REP.trade;
  changeRep(w, f, REP.trade, '取引');
}

export function buy(w, townId, shopType, idx, buyer) {
  const town = townById(townId);
  const s = shopStock(w, townId, shopType);
  const e = s.stock[idx];
  if (!e) return { ok: false, msg: '品切れです' };
  const price = priceOf(w, town, e.id, e.q);
  if (w.money < price) return { ok: false, msg: `錆貨が足りません（${price}）` };
  w.money -= price;
  e.qty--; if (e.qty <= 0) s.stock.splice(idx, 1);
  addItem(buyer, e.id, 1, e.q);
  tradeRep(w, town.faction);
  return { ok: true, msg: `${buyer.name}が買った（-${price}錆貨）` };
}

export function canSell(shopType, id) {
  const cats = SHOPS[shopType].buyCats;
  return cats === null || cats.includes(ITEMS[id].cat);
}

export function sell(w, townId, shopType, seller, invIdx) {
  const town = townById(townId);
  const st = seller.inv[invIdx];
  if (!st || !canSell(shopType, st.id)) return { ok: false, msg: 'この店では買い取れません' };
  const q = st.q ?? 1;
  const price = priceOf(w, town, st.id, q, true);
  removeItem(seller, st.id, 1, q);
  w.money += price;
  // 売った物は店に並ぶ
  const s = shopStock(w, townId, shopType);
  const ex = s.stock.find((x) => x.id === st.id && x.q === q);
  if (ex) ex.qty++; else s.stock.push({ id: st.id, q, qty: 1 });
  tradeRep(w, town.faction);
  return { ok: true, msg: `売った（+${price}錆貨）` };
}

// 盗む：窃盗の能力と、近くにいる衛兵の数で成功率が決まる。失敗すると指名手配
export function stealChance(w, thief, townId, door) {
  const guards = w.people.filter((o) => ((o.town === townId && o.role === 'guard') || o.role === 'escort') && o.state === 'ok' && Math.hypot(o.x - door.x, o.z - door.z) < 15).length;
  const sneak = thief.sneak ? 0.1 : 0;
  return Math.max(0.03, Math.min(0.9, TRADE.stealBase + effSkill(thief, 'theft') * TRADE.stealPerLv + sneak - guards * TRADE.stealGuardPenalty));
}
export function steal(w, townId, shopType, idx, thief, door) {
  const town = townById(townId);
  const s = shopStock(w, townId, shopType);
  const e = s.stock[idx];
  if (!e) return { ok: false, msg: '品切れです' };
  const chance = stealChance(w, thief, townId, door);
  if (w.rng.next() < chance) {
    e.qty--; if (e.qty <= 0) s.stock.splice(idx, 1);
    addItem(thief, e.id, 1, e.q);
    gainXp(w, thief, 'theft', 10);
    return { ok: true, msg: `${thief.name}は${ITEMS[e.id].label}をこっそり盗んだ` };
  }
  gainXp(w, thief, 'theft', 4);
  changeRep(w, town.faction, REP.crime, '盗み');
  makeWanted(w, town.faction, 1, `${thief.name}が盗みに失敗`);
  return { ok: false, caught: true, msg: `${thief.name}の盗みが見つかった！` };
}

// 雇う：酒場の客を仲間にする
export function hire(w, recruit) {
  const party = w.people.filter((p) => p.kind === 'party' && p.state !== 'dead');
  if (party.length >= TRADE.partyMax) return { ok: false, msg: `一団は${TRADE.partyMax}人までです` };
  if (w.money < recruit.hirePrice) return { ok: false, msg: `錆貨が足りません（${recruit.hirePrice}）` };
  w.money -= recruit.hirePrice;
  recruit.kind = 'party';
  recruit.faction = 'player';
  recruit.role = null; recruit.station = null; recruit.town = null; recruit.title = null;
  recruit.look.accent = PARTY.clothColor; recruit.equipVer = (recruit.equipVer || 0) + 1;
  recruit.path = []; recruit.goal = null;
  recruit.jobs = defaultJobs();
  if (!recruit.inv.some((s) => ITEMS[s.id].food)) addItem(recruit, 'hardtack', 2);
  w.addLogFn?.(`${recruit.name}が一団に加わった！`);
  return { ok: true, msg: `${recruit.name}が仲間になった` };
}

export { FACTIONS };
