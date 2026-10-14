// 地形チャンク・岩・草・遺構の描画（ロジック層の heightAt / chunkProps を表示するだけ）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, regionAt, roadDist, townAt } from '../sim/terrain.js';
import { ROAD } from '../data/world.js';
import { chunkProps, chunkKey, landmarks } from '../sim/worldgen.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { WORLD, PALETTE } from '../data/config.js';

const C = (hex) => new THREE.Color(hex);
const COL = {
  sandL: C(PALETTE.sandLight), sand: C(PALETTE.sand), sandD: C(PALETTE.sandDark),
  rust: C(PALETTE.rust), rustD: C(PALETTE.rustDark),
  rock: C(PALETTE.rock), rockD: C(PALETTE.rockDark), ash: C(PALETTE.ash),
};
const tmp = new THREE.Color(), tmp2 = new THREE.Color();

function groundColor(out, x, z, h, ny, jitter) {
  const reg = regionAt(x, z);
  // 平地の色：地域ごとに砂・錆・灰を混ぜる
  out.copy(COL.sand).lerp(COL.sandL, Math.min(1, Math.max(0, (h + 5) / 40)));
  out.lerp(tmp.copy(COL.rust).lerp(COL.sandD, 0.35), reg.rust * 0.75);
  out.lerp(COL.ash, reg.ash * 0.7);
  // 斜面・崖は岩肌
  const cliff = Math.min(1, Math.max(0, (0.93 - ny) * 4.5));
  if (cliff > 0) {
    tmp2.copy(COL.rock).lerp(COL.rustD, reg.rust * 0.7).lerp(COL.rockD, jitter * 0.6);
    out.lerp(tmp2, cliff);
  }
  // 道と町の地面は踏み固められた色
  const rd = roadDist(x, z);
  if (rd < ROAD.width + 1.5) out.lerp(tmp2.setHex(0x8f7a5a), Math.min(1, (ROAD.width + 1.5 - rd) / 2) * 0.75);
  else if (townAt(x, z)) out.lerp(tmp2.setHex(0xa48c68), 0.5);
  // 面ごとのわずかなムラ（フラットシェーディングの面を際立たせる）
  const v = 0.93 + jitter * 0.12;
  out.r *= v; out.g *= v; out.b *= v;
  return out;
}

function buildChunkGeometry(cx, cz, res) {
  const S = WORLD.chunkSize, step = S / res;
  const ox = cx * S, oz = cz * S;
  const n = res + 1;
  const hs = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = heightAt(ox + i * step, oz + j * step);

  const triCount = res * res * 2;
  const pos = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  let p = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const color = new THREE.Color();

  const pushTri = (x0, z0, y0, x1, z1, y1, x2, z2, y2, seed) => {
    a.set(x0, y0, z0); b.set(x1, y1, z1); c.set(x2, y2, z2);
    e1.subVectors(b, a); e2.subVectors(c, a); nrm.crossVectors(e1, e2).normalize();
    if (nrm.y < 0) nrm.negate();
    const mx = (x0 + x1 + x2) / 3, mz = (z0 + z1 + z2) / 3, my = (y0 + y1 + y2) / 3;
    groundColor(color, mx, mz, my, nrm.y, hash2(Math.floor(mx * 3), Math.floor(mz * 3), seed));
    pos.set([x0, y0, z0, x1, y1, z1, x2, y2, z2], p);
    for (let k = 0; k < 3; k++) { col[p + k * 3] = color.r; col[p + k * 3 + 1] = color.g; col[p + k * 3 + 2] = color.b; }
    p += 9;
  };

  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x0 = ox + i * step, x1 = x0 + step, z0 = oz + j * step, z1 = z0 + step;
    const h00 = hs[j * n + i], h10 = hs[j * n + i + 1], h01 = hs[(j + 1) * n + i], h11 = hs[(j + 1) * n + i + 1];
    // 対角線の向きを交互にしてローポリ感を自然に
    if ((i + j) & 1) {
      pushTri(x0, z0, h00, x0, z1, h01, x1, z0, h10, 1);
      pushTri(x1, z0, h10, x0, z1, h01, x1, z1, h11, 2);
    } else {
      pushTri(x0, z0, h00, x0, z1, h01, x1, z1, h11, 1);
      pushTri(x0, z0, h00, x1, z1, h11, x1, z0, h10, 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const rnd = mulberry32(seed);
  const p = g.attributes.position;
  // 同じ頂点位置は同じだけ動かす（割れ目を作らない）
  const offs = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offs.has(key)) offs.set(key, 0.75 + rnd() * 0.45);
    const s = offs.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.8, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function grassGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(0.05, 0.7 + (i % 2) * 0.25, 3, 1);
    c.translate(0, 0.35, 0);
    c.rotateZ((i - 1.5) * 0.25);
    c.rotateY(i * 1.7);
    parts.push(c);
  }
  return mergeGeometries(parts);
}

// 巨大遺構の造形（箱の組み合わせ）
function landmarkGeometry(kind, rnd) {
  const parts = [];
  const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.rotateX(rx); b.rotateY(ry); b.rotateZ(rz);
    b.translate(x, y, z);
    parts.push(b);
  };
  if (kind === 'ring') {
    // 半ば埋もれた巨大な輪（欠けあり）
    const R = 70, seg = 22;
    for (let i = 0; i < seg; i++) {
      if (rnd() < 0.22) continue;
      const a = (i / seg) * Math.PI * 2;
      box(12, 22 * (0.8 + rnd() * 0.4), 14, Math.cos(a) * R, Math.sin(a) * R + 30, 0, 0, 0, a + Math.PI / 2);
    }
  } else if (kind === 'tower') {
    let y = 0, w = 26;
    for (let i = 0; i < 7; i++) {
      const h = 18 + rnd() * 10;
      box(w, h, w, (rnd() - 0.5) * 4 + i * 1.5, y + h / 2, (rnd() - 0.5) * 4, 0, rnd() * 0.3, 0.03 * i);
      y += h * 0.95; w *= 0.86;
      if (i > 3 && rnd() < 0.35) break;
    }
    box(8, 40, 8, 14, y - 10, 0, 0, 0, 0.6);
  } else if (kind === 'ribs') {
    // 巨大な骨組み（肋骨状の構造物）
    for (let r = 0; r < 6; r++) {
      const z = r * 22 - 55, H = 70 - Math.abs(r - 2.5) * 8;
      for (let k = 0; k < 7; k++) {
        const t = k / 6, a = t * Math.PI * 0.85;
        if (r === 4 && k > 3) break;
        box(5, 18, 5, Math.cos(a) * 35 - 20, Math.sin(a) * H, z, 0, 0, a);
      }
    }
    box(140, 6, 6, 0, 4, 0, 0, Math.PI / 2, 0.02);
  } else {
    box(120, 14, 60, 0, 20, 0, 0.1, 0, 0.35);
    box(20, 70, 20, -40, 30, 10, 0, 0, -0.15);
  }
  return mergeGeometries(parts);
}

export class TerrainView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map(); // key -> mesh
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.propMat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.rockGeo = rockGeometry(11);
    this.grassGeo = grassGeometry();
    this.ruinGeo = new THREE.BoxGeometry(1, 1, 1);
    this.rocks = null; this.grass = null; this.ruins = null;
    this.dirty = false;
    this.quality = null;
    this.centerKey = '';

    // 地平線の巨大遺構：霧に溶けたシルエットとして常時表示
    this.landmarkMat = new THREE.MeshBasicMaterial({ color: 0x777777, fog: false });
    this.landmarks = new THREE.Group();
    const rnd = mulberry32(99);
    for (const l of landmarks()) {
      const m = new THREE.Mesh(landmarkGeometry(l.kind, rnd), this.landmarkMat);
      m.position.set(l.x, l.y - 6, l.z);
      m.rotation.y = l.ry;
      m.scale.setScalar(l.scale);
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.landmarks.add(m);
    }
    scene.add(this.landmarks);
  }

  setQuality(q) {
    this.quality = q;
    for (const m of this.chunks.values()) { m.geometry.dispose(); this.group.remove(m); }
    this.chunks.clear();
    this.centerKey = '';
    this.dirty = true;
  }

  // 毎フレーム：注視点の周囲のチャンクを用意（1フレームに作るのは最大 budget 個）
  update(focus, fogColor, budget = 2) {
    const q = this.quality;
    const S = WORLD.chunkSize, R = q.viewChunks;
    const ccx = Math.floor(focus.x / S), ccz = Math.floor(focus.z / S);
    const want = new Set();
    const order = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R + R) continue;
      const k = chunkKey(ccx + dx, ccz + dz);
      want.add(k);
      if (!this.chunks.has(k)) order.push([dx * dx + dz * dz, ccx + dx, ccz + dz, k]);
    }
    order.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < order.length && i < budget; i++) {
      const [, cx, cz, k] = order[i];
      const mesh = new THREE.Mesh(buildChunkGeometry(cx, cz, q.chunkRes), this.mat);
      mesh.receiveShadow = q.shadows;
      mesh.castShadow = q.shadows && q.shadowMap >= 2048;
      mesh.matrixAutoUpdate = false;
      mesh.userData = { cx, cz };
      this.group.add(mesh);
      this.chunks.set(k, mesh);
      this.dirty = true;
    }
    for (const [k, m] of this.chunks) {
      if (!want.has(k)) { m.geometry.dispose(); this.group.remove(m); this.chunks.delete(k); this.dirty = true; }
    }
    const pending = Math.max(0, order.length - budget);
    if (this.dirty && pending === 0) { this.rebuildProps(); this.dirty = false; }

    // 遺構シルエットの色＝霧色を少し暗くしたもの
    this.landmarkMat.color.copy(fogColor).multiplyScalar(0.72);
    return pending;
  }

  rebuildProps() {
    const q = this.quality;
    const all = { rocks: [], grass: [], ruins: [] };
    for (const m of this.chunks.values()) {
      const p = chunkProps(m.userData.cx, m.userData.cz, q);
      all.rocks.push(...p.rocks); all.grass.push(...p.grass); all.ruins.push(...p.ruins);
    }
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    const ensure = (name, geo, need, shadow, receive) => {
      let im = this[name];
      if (!im || im.instanceMatrix.count < need) {
        if (im) { this.scene.remove(im); im.dispose(); }
        im = new THREE.InstancedMesh(geo, this.propMat, Math.max(16, Math.ceil(need * 1.5)));
        im.castShadow = shadow; im.receiveShadow = receive;
        im.frustumCulled = false;
        this.scene.add(im);
        this[name] = im;
      }
      im.castShadow = shadow; im.receiveShadow = receive;
      im.count = need;
      return im;
    };

    const rocks = ensure('rocks', this.rockGeo, all.rocks.length, q.shadows, q.shadows);
    all.rocks.forEach((r, i) => {
      e.set(r.tilt, r.ry, r.tilt * 0.7); qt.setFromEuler(e);
      m4.compose(v.set(r.x, r.y, r.z), qt, s.set(r.s, r.s * r.sy, r.s * (0.8 + r.tone * 0.4)));
      rocks.setMatrixAt(i, m4);
      if (r.nodeType) col.setHex(r.nodeType === 'ore' ? 0x8a4a2c : 0xb3ab9c); // 鉄鉱石の鉱脈・石切り場は色で見分ける
      else col.setHex(PALETTE.rock).lerp(tmp.setHex(PALETTE.rustDark), regionAt(r.x, r.z).rust * 0.6).multiplyScalar(0.8 + r.tone * 0.35);
      rocks.setColorAt(i, col);
    });
    rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;

    const grass = ensure('grass', this.grassGeo, all.grass.length, false, q.shadows);
    all.grass.forEach((g, i) => {
      e.set(0, g.ry, 0); qt.setFromEuler(e);
      m4.compose(v.set(g.x, g.y, g.z), qt, s.setScalar(g.s));
      grass.setMatrixAt(i, m4);
      col.setHex(PALETTE.grassDry).multiplyScalar(0.8 + (g.ry % 1) * 0.3);
      grass.setColorAt(i, col);
    });
    grass.instanceMatrix.needsUpdate = true; if (grass.instanceColor) grass.instanceColor.needsUpdate = true;

    const ruins = ensure('ruins', this.ruinGeo, all.ruins.length, q.shadows, q.shadows);
    all.ruins.forEach((r, i) => {
      e.set(r.rx, r.ry, r.rz); qt.setFromEuler(e);
      m4.compose(v.set(r.x, r.y, r.z), qt, s.set(r.sx, r.sy, r.sz));
      ruins.setMatrixAt(i, m4);
      col.setHex(r.rust ? PALETTE.ruinRust : PALETTE.ruin).multiplyScalar(0.85 + ((r.x * 7.3) % 1 + 1) % 1 * 0.25);
      ruins.setColorAt(i, col);
    });
    ruins.instanceMatrix.needsUpdate = true; if (ruins.instanceColor) ruins.instanceColor.needsUpdate = true;
  }
}
