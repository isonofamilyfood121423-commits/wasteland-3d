// 人物の詳細（体の状態・能力・持ち物）をシートに描く
import { PARTS, PART, SKILLS, ITEMS, ITEM_CATS, RACES, HEALTH, GROWTH } from '../data/body.js';
import { SLOTS, WEAPON_CATS, QUALITY_MUL, itemLabel } from '../data/items.js';
import { partMax, hungerState, carryWeight, carryCapacity, totalBleed, healthPct } from '../sim/body.js';

export const hpColor = (b, max) => {
  if (b.lost && !b.prosthetic) return '#3a3430';
  if (b.prosthetic) return b.hp > 0 ? '#8d9599' : '#5c5550';
  const r = b.hp / max;
  return r > 0.75 ? '#6fd27a' : r > 0.4 ? '#d8c35a' : r > 0 ? '#d8823f' : '#c9573f';
};

// 人体シルエット（各部位を色で塗り分け。欠損は点線、義肢は灰色）
function silhouette(p) {
  const c = (id) => hpColor(p.body[id], partMax(p, id));
  const dash = (id) => (p.body[id].lost && !p.body[id].prosthetic ? 'stroke-dasharray="4 3" stroke="#c9573f"' : 'stroke="rgba(0,0,0,.45)"');
  const drop = (id, x, y) => (p.body[id].bleed > 0.05 ? `<path d="M${x} ${y - 7} q5 7 0 10 q-5 -3 0 -10z" fill="#e0533f"/>` : '');
  return `<svg viewBox="0 0 120 230" width="112" height="214" aria-label="体の状態">
    <g stroke-width="1.5">
      <ellipse cx="60" cy="24" rx="16" ry="18" fill="${c('head')}" ${dash('head')}/>
      <path d="M38 46 L82 46 L86 98 L34 98 Z" fill="${c('chest')}" ${dash('chest')}/>
      <path d="M36 100 L84 100 L80 134 L40 134 Z" fill="${c('stomach')}" ${dash('stomach')}/>
      <path d="M84 48 L98 52 L106 128 L94 130 L88 80 Z" fill="${c('armL')}" ${dash('armL')}/>
      <path d="M36 48 L22 52 L14 128 L26 130 L32 80 Z" fill="${c('armR')}" ${dash('armR')}/>
      <path d="M62 136 L80 136 L82 222 L66 222 Z" fill="${c('legL')}" ${dash('legL')}/>
      <path d="M58 136 L40 136 L38 222 L54 222 Z" fill="${c('legR')}" ${dash('legR')}/>
    </g>
    ${drop('head', 78, 18)}${drop('chest', 92, 70)}${drop('stomach', 90, 118)}${drop('armL', 112, 100)}${drop('armR', 8, 100)}${drop('legL', 90, 190)}${drop('legR', 30, 190)}
  </svg>`;
}

const bar = (v, max, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%;background:${color}"></i></div>`;

export function stateText(p) {
  if (p.state === 'dead') return '死亡';
  if (p.carriedBy) return '担がれている';
  if (p.bound) return p.state === 'ko' ? '気絶・縛られている' : '縛られている';
  if (p.state === 'ko') return '気絶';
  if (p.carrying) return '人を担いでいる';
  if (p.retreat) return '退却中';
  if (p.fight?.target) return '戦闘中';
  if (p.task?.kind === 'treat') return '治療中';
  if (p.task?.kind === 'rest') return '休息中';
  if (p.moveMode === 'crawl') return '這っている';
  if (p.path?.length) return p.moveMode === 'limp' ? '脚をかばって移動中' : '移動中';
  return '待機中';
}

export function renderBody(p) {
  const race = RACES[p.race];
  const hs = hungerState(p);
  const hungerLabel = { none: '食事不要', fed: '満腹', hungry: '空腹（能力-10%）', starving: '飢餓（能力-30%）' }[hs];
  const rows = PARTS.map((part) => {
    const b = p.body[part.id], max = partMax(p, part.id);
    let v = b.lost && !b.prosthetic ? '<b style="color:#e0533f">欠損</b>' : `${Math.round(b.hp)} / ${max}`;
    if (b.prosthetic) v += `<small class="muted">（${ITEMS[b.prosthetic].label}）</small>`;
    const bl = b.bleed > 0.05 ? ` <span class="bleed">出血 ${b.bleed.toFixed(1)}</span>` : '';
    return `<div class="prow"><i style="background:${hpColor(b, max)}"></i><span>${part.label}</span><span class="pv">${v}${bl}</span></div>`;
  }).join('');
  return `
    <div class="bodywrap">${silhouette(p)}<div class="plist">${rows}</div></div>
    <div class="stat"><span>状態</span><b>${stateText(p)}</b></div>
    <div class="stat"><span>血液</span>${bar(p.blood, HEALTH.bloodMax, p.blood < HEALTH.koBlood ? '#c9573f' : '#b84a3a')}<em>${Math.round(p.blood)}</em></div>
    ${race.eats ? `<div class="stat"><span>空腹度</span>${bar(p.hunger, HEALTH.hungerMax, hs === 'fed' ? '#c9a24f' : '#d8823f')}<em>${Math.round(p.hunger)}</em></div>` : ''}
    <div class="stat"><span>食事</span><b>${hungerLabel}</b></div>
    <div class="stat"><span>出血の合計</span><b>${totalBleed(p) > 0.05 ? totalBleed(p).toFixed(1) + '／時' : 'なし'}</b></div>
    <div class="stat"><span>総合</span>${bar(healthPct(p), 1, '#6fd27a')}<em>${Math.round(healthPct(p) * 100)}%</em></div>
    <div class="note">種族：${race.label}　${race.desc}</div>`;
}

export function renderSkills(p) {
  return SKILLS.map((s) => {
    const k = p.skills[s.id];
    return `<div class="srow"><span class="sl">${s.label}</span><b>${k.lv}</b><div class="bar thin"><i style="width:${(k.xp / GROWTH.xpPerLevel) * 100}%"></i></div><small class="muted">${s.grow}</small></div>`;
  }).join('') + '<div class="note">能力は使うほど伸びます。レベルが高いほど伸びにくくなります。空腹・飢餓のときは一時的に下がります。</div>';
}

// 装備：mode = 'mine'（外す）/ 'loot'（取る）/ 'view'
export function renderEquip(p, mode) {
  let html = '';
  for (const sl of SLOTS) {
    const e = p.equip?.[sl.id];
    const it = e ? ITEMS[e.id] : null;
    let extra = '';
    if (it?.weapon) { const c = WEAPON_CATS[it.weapon.type]; extra = `${c.label}・切${it.weapon.cut} 打${it.weapon.blunt}・必要筋力${it.weapon.reqStr}`; }
    else if (it?.armor) { const parts = Object.keys(it.armor.cover).map((k) => PART[k].label).join(''); extra = parts ? `防御 切${Math.round(it.armor.cut * QUALITY_MUL[e.q] * 100)}% 打${Math.round(it.armor.blunt * QUALITY_MUL[e.q] * 100)}%・${parts}` : '見た目のみ'; }
    else if (it?.carry) extra = `持てる重さ+${it.carry}kg`;
    const btn = !e ? '' : mode === 'mine' ? `<button class="btn" data-act="unequip" data-slot="${sl.id}">外す</button>` : mode === 'loot' ? `<button class="btn" data-act="takeEquip" data-slot="${sl.id}">取る</button>` : '';
    html += `<div class="irow"><div class="info"><span class="muted">${sl.label}</span>　<b>${e ? itemLabel(e.id, e.q) : '―'}</b>${extra ? `<br><small class="muted">${extra}</small>` : ''}</div>${btn}</div>`;
  }
  if (!p.equip?.weapon) html += '<div class="note">武器がないときは素手で戦います（弱い鈍器の扱い）。</div>';
  return html;
}

// 持ち物：mode = 'mine' / 'loot' / 'view'
export function renderInventory(p, mode, canEat, lostLimbs) {
  const w = carryWeight(p), cap = carryCapacity(p);
  let html = mode === 'mine' ? `<div class="stat"><span>重さ</span>${bar(w, cap, w > cap ? '#c9573f' : '#c9a24f')}<em>${w.toFixed(1)}/${cap.toFixed(0)}kg</em></div>` : '';
  if (mode === 'mine' && w > cap) html += '<div class="note" style="color:#ffb39f">重すぎて動きが遅くなっています。</div>';
  if (mode === 'loot' && p.money) html += `<div class="irow"><div class="info"><b>錆貨</b> ×${p.money}</div><button class="btn" data-act="takeMoney">取る</button></div>`;
  if (!p.inv.length) return html + '<div class="note">何も持っていません。</div>';
  for (const cat of Object.keys(ITEM_CATS)) {
    const items = p.inv.map((s, idx) => ({ s, idx })).filter(({ s }) => ITEMS[s.id].cat === cat);
    if (!items.length) continue;
    html += `<h3>${ITEM_CATS[cat]}</h3>`;
    for (const { s, idx } of items) {
      const it = ITEMS[s.id];
      const btns = [];
      if (mode === 'mine') {
        if (it.slot) btns.push(`<button class="btn" data-act="equip" data-idx="${idx}">装備</button>`);
        if (it.food && canEat) btns.push(`<button class="btn" data-act="eat" data-idx="${idx}">食べる</button>`);
        if (it.limb && lostLimbs.length) btns.push(`<button class="btn" data-act="attach" data-idx="${idx}">付ける</button>`);
        btns.push(`<button class="btn" data-act="give" data-idx="${idx}">渡す</button>`);
      } else if (mode === 'loot') btns.push(`<button class="btn" data-act="take" data-idx="${idx}">取る</button>`);
      let extra = it.food ? `空腹度+${it.food}` : it.aid ? `治療力${it.aid.power}${it.aid.kind === 'repair' ? '（錆骨用）' : ''}` : it.limb ? `等級${it.limb.grade}・HP${it.limb.hp}` : '';
      if (it.weapon) extra = `${WEAPON_CATS[it.weapon.type].label}・切${it.weapon.cut} 打${it.weapon.blunt}`;
      html += `<div class="irow"><div class="info"><b>${itemLabel(s.id, s.q)}</b> ×${s.qty}<br><small class="muted">${(it.weight * s.qty).toFixed(1)}kg　${extra}</small></div>${btns.join('')}</div>`;
    }
  }
  return html;
}
