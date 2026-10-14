// 顔アイコンを Canvas で生成（外部画像は使わない）
import { PALETTE } from '../data/config.js';
import { RACES } from '../data/body.js';

const cache = new Map();
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function shade(n, k) {
  const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function faceIcon(person) {
  const L = person.look;
  const key = person.id + ':' + JSON.stringify(L);
  if (cache.has(key)) return cache.get(key);
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // 背景（砂色のグラデーション）
  const bg = g.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#6b5a48'); bg.addColorStop(1, '#3a2f26');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  const race = RACES[person.race || 'sunabito'];
  const skins = race.skin || PALETTE.skin;
  const skin = skins[L.skin % skins.length];
  const cloth = L.accent ?? PALETTE.cloth[L.cloth];
  // 肩・服
  g.fillStyle = hex(cloth);
  g.beginPath(); g.moveTo(10, S); g.lineTo(20, 70); g.lineTo(76, 70); g.lineTo(86, S); g.closePath(); g.fill();
  g.fillStyle = shade(cloth, 0.75); g.fillRect(40, 66, 16, 10);
  // 首と顔（多角形でローポリ風）
  g.fillStyle = shade(skin, 0.85); g.fillRect(41, 56, 14, 14);
  if (race.shape.head === 'box') {
    // 錆骨：箱型の頭と横一文字の覗き窓
    g.fillStyle = hex(skin); g.fillRect(30, 22, 36, 40);
    g.fillStyle = shade(skin, 0.78); g.fillRect(48, 22, 18, 40);
    g.fillStyle = '#20262a'; g.fillRect(33, 38, 30, 6);
    g.fillStyle = '#e0a24a'; g.fillRect(38, 40, 5, 2); g.fillRect(53, 40, 5, 2);
    g.fillStyle = shade(skin, 0.6); g.fillRect(36, 56, 24, 6);
  } else {
    g.fillStyle = hex(skin);
    g.beginPath(); g.moveTo(48, 20); g.lineTo(66, 30); g.lineTo(66, 52); g.lineTo(48, 64); g.lineTo(30, 52); g.lineTo(30, 30); g.closePath(); g.fill();
    g.fillStyle = shade(skin, 0.82);
    g.beginPath(); g.moveTo(48, 20); g.lineTo(66, 30); g.lineTo(66, 52); g.lineTo(48, 64); g.closePath(); g.fill();
    g.fillStyle = '#1d1712'; g.fillRect(38, 40, 6, 3); g.fillRect(52, 40, 6, 3);
  }
  if (race.shape.head === 'horn') {
    g.fillStyle = '#d9ccb4';
    g.beginPath(); g.moveTo(36, 26); g.lineTo(28, 6); g.lineTo(42, 22); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(60, 26); g.lineTo(68, 6); g.lineTo(54, 22); g.closePath(); g.fill();
  }
  // 帽子
  if (L.hat) {
    g.fillStyle = shade(PALETTE.sandDark, 0.95);
    g.beginPath(); g.ellipse(48, 28, 30, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = shade(PALETTE.sandDark, 0.8);
    g.beginPath(); g.moveTo(34, 28); g.lineTo(38, 12); g.lineTo(58, 12); g.lineTo(62, 28); g.closePath(); g.fill();
  } else if (race.shape.head === 'round') {
    g.fillStyle = '#2a211a';
    g.beginPath(); g.moveTo(30, 32); g.lineTo(36, 18); g.lineTo(60, 18); g.lineTo(66, 32); g.lineTo(58, 26); g.lineTo(38, 26); g.closePath(); g.fill();
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
