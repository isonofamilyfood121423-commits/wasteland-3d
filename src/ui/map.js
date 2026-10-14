// ミニマップと全体マップ（地形はコードで描いた画像。町・道・人物を重ねる）
import { heightAt, regionAt, roadDist, townAt } from '../sim/terrain.js';
import { TOWNS, FACTIONS, ROAD } from '../data/world.js';

const RANGE = 2000;      // 地図に描く範囲（±m）
const SIZE = 256;        // 地図画像の解像度
const M_PER_PX = (RANGE * 2) / SIZE;

let img = null, building = false, progress = 0;
const listeners = [];

// 地図画像を少しずつ作る（1フレームに数行ずつ。重くならないように）
export function ensureMapImage(onReady) {
  if (img) { onReady?.(img); return; }
  if (onReady) listeners.push(onReady);
  if (building) return;
  building = true;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const data = g.createImageData(SIZE, SIZE);
  let row = 0;
  const step = () => {
    const end = Math.min(SIZE, row + 8);
    for (; row < end; row++) {
      for (let col = 0; col < SIZE; col++) {
        const x = -RANGE + (col + 0.5) * M_PER_PX, z = -RANGE + (row + 0.5) * M_PER_PX;
        const h = heightAt(x, z), hx = heightAt(x + M_PER_PX, z), hz = heightAt(x, z + M_PER_PX);
        const reg = regionAt(x, z);
        let r = 196 - reg.rust * 40 - reg.ash * 40, gg = 172 - reg.rust * 62 - reg.ash * 20, b = 128 - reg.rust * 40 + reg.ash * 10;
        const shade = 1 + ((hx - h) - (hz - h)) * 0.05 + h * 0.004;
        r *= shade; gg *= shade; b *= shade;
        const slope = Math.hypot(hx - h, hz - h) / M_PER_PX;
        if (slope > 0.5) { r *= 0.75; gg *= 0.72; b *= 0.72; }
        if (roadDist(x, z) < ROAD.width + 5) { r = 120; gg = 98; b = 72; }
        if (townAt(x, z)) { r = 90; gg = 72; b = 54; }
        const o = (row * SIZE + col) * 4;
        data.data[o] = r; data.data[o + 1] = gg; data.data[o + 2] = b; data.data[o + 3] = 255;
      }
    }
    progress = row / SIZE;
    if (row < SIZE) { requestAnimationFrame(step); return; }
    g.putImageData(data, 0, 0);
    img = c;
    building = false;
    listeners.splice(0).forEach((fn) => fn(img));
  };
  requestAnimationFrame(step);
}
export const mapProgress = () => progress;

const toPx = (v) => (v + RANGE) / M_PER_PX;

// center: 中心の座標, span: 表示する幅（m）
export function drawMap(canvas, world, center, span, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.fillStyle = '#2a221b'; g.fillRect(0, 0, W, H);
  const sx = W / span;
  const ox = center.x - span / 2, oz = center.z - span / 2;
  const P = (x, z) => [(x - ox) * sx, (z - oz) * sx];
  if (img) {
    const srcX = toPx(ox), srcY = toPx(oz), srcS = span / M_PER_PX;
    g.imageSmoothingEnabled = true;
    g.drawImage(img, srcX, srcY, srcS, srcS, 0, 0, W, H);
  } else {
    g.fillStyle = '#b9ab95'; g.font = `${Math.max(14, W / 18)}px sans-serif`; g.textAlign = 'center';
    g.fillText(`地図を作成中… ${Math.round(progress * 100)}%`, W / 2, H / 2);
  }
  // 町
  for (const t of TOWNS) {
    const [x, y] = P(t.x, t.z);
    if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    const known = world.discovered?.[t.id];
    g.fillStyle = known ? '#' + (FACTIONS[t.faction].accent || 0x888888).toString(16).padStart(6, '0') : '#6b5a48';
    g.strokeStyle = '#1a1612'; g.lineWidth = 2;
    const rr = Math.max(4, t.r * sx);
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); g.stroke();
    if (opts.labels) {
      g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,16,13,.85)'; g.fillStyle = '#efe6d6';
      const label = known ? t.name : '？';
      g.strokeText(label, x, y - rr - 5); g.fillText(label, x, y - rr - 5);
    }
  }
  // 人物
  for (const p of world.people) {
    if (p.state === 'dead') continue;
    const isParty = p.kind === 'party';
    const danger = p.squadHunting || p.angryAt?.includes('player');
    if (!isParty && !danger) continue;
    const [x, y] = P(p.x, p.z);
    if (x < 0 || y < 0 || x > W || y > H) continue;
    g.fillStyle = isParty ? (p.state === 'ok' ? '#6fd27a' : '#d8823f') : '#e0533f';
    g.beginPath(); g.arc(x, y, isParty ? 4 : 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 1; g.stroke();
  }
  // カメラの位置
  if (opts.camera) {
    const [x, y] = P(opts.camera.x, opts.camera.z);
    g.strokeStyle = '#efe6d6'; g.lineWidth = 1.5;
    g.strokeRect(x - 6, y - 6, 12, 12);
  }
  return { ox, oz, sx };
}

export function screenToMap(view, cx, cy) { return { x: view.ox + cx / view.sx, z: view.oz + cy / view.sx }; }
export const MAP_RANGE = RANGE;
