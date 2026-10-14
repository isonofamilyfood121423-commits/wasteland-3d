// ビルド：src/ を esbuild で1つのJSにまとめ、index.html にインライン化する
// あわせて manifest.webmanifest とアイコンPNG（コードで描画）を出力する
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => join(root, p);

// ---- ビルド番号 ----
const numFile = r('scripts/build-number.json');
const prev = existsSync(numFile) ? JSON.parse(readFileSync(numFile, 'utf8')) : { build: 0 };
const buildNo = prev.build + 1;
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const pad = (n) => String(n).padStart(2, '0');
const buildTime = `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())} JST`;

const { GAME_TITLE, GAME_SUBTITLE } = await import('../src/data/config.js');

const result = await build({
  entryPoints: [r('src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100'],
  write: false,
  legalComments: 'none',
  define: { __BUILD__: JSON.stringify(buildNo), __BUILD_TIME__: JSON.stringify(buildTime) },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let html = readFileSync(r('src/index.template.html'), 'utf8');
html = html
  .replaceAll('__TITLE__', GAME_TITLE)
  .replaceAll('__SUBTITLE__', GAME_SUBTITLE)
  .replaceAll('__BUILD_TIME__', buildTime)
  .replaceAll('__BUILD__', String(buildNo));
const i = html.indexOf('__SCRIPT__');
html = html.slice(0, i) + js + html.slice(i + '__SCRIPT__'.length);
writeFileSync(r('index.html'), html);

// ---- アイコン（砂丘と沈む太陽、錆色の遺構） ----
function png(w, h, rgba) {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let c = mix([58, 52, 78], [214, 140, 92], Math.min(1, v * 1.6)); // 空
    const sd = Math.hypot(u - 0.5, v - 0.56);
    if (sd < 0.2) c = mix([255, 214, 160], [240, 170, 110], sd / 0.2); // 太陽
    else c = mix(c, [255, 200, 140], Math.max(0, 0.3 - sd) * 0.8);
    // 遺構の柱（シルエット）
    if ((Math.abs(u - 0.27) < 0.035 && v > 0.36) || (Math.abs(u - 0.75) < 0.03 && v > 0.42) || (u > 0.2 && u < 0.5 && Math.abs(v - 0.4 - (u - 0.2) * 0.25) < 0.025)) c = [92, 54, 40];
    // 砂丘（2層）
    const d1 = 0.66 + Math.sin(u * 5.5 + 0.6) * 0.05;
    const d2 = 0.78 + Math.sin(u * 4.2 + 2.2) * 0.05;
    if (v > d1) c = [158, 108, 72];
    if (v > d2) c = [196, 160, 118];
    if (v > d2 && v < d2 + 0.012) c = [226, 196, 150];
    const o = (y * S + x) * 4;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
  }
  return png(S, S, buf);
}
writeFileSync(r('icon-192.png'), drawIcon(192));
writeFileSync(r('icon-512.png'), drawIcon(512));

writeFileSync(r('manifest.webmanifest'), JSON.stringify({
  name: `${GAME_TITLE} ${GAME_SUBTITLE}`,
  short_name: GAME_TITLE,
  start_url: './',
  scope: './',
  display: 'fullscreen',
  orientation: 'portrait',
  background_color: '#1a1612',
  theme_color: '#2a221b',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
}, null, 2));

writeFileSync(numFile, JSON.stringify({ build: buildNo, time: buildTime }, null, 2) + '\n');
console.log(`build ${buildNo} (${buildTime})  index.html ${(html.length / 1024).toFixed(0)} KB`);
