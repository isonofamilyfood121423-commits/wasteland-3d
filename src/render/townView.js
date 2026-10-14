// 町の建物を派閥ごとの様式で組み立てる（壁・柱・屋根・門などのモジュールの組み合わせ）
// ロジック層の townLayout() の結果を表示するだけ。町ごとに1つのメッシュにまとめて描画命令を減らす
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { allTowns } from '../sim/towns.js';
import { heightAt } from '../sim/terrain.js';
import { Rng, hash2 } from '../core/rng.js';

const C = (hex) => new THREE.Color(hex);

class Builder {
  constructor() { this.parts = []; }
  add(geo, color, x, y, z, ry = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const c = C(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    this.parts.push(g);
  }
  box(w, h, d, x, y, z, color, ry = 0) { this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, ry); }
  build() { const g = mergeGeometries(this.parts); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
}

const vary = (hex, r, amt = 0.08) => { const c = C(hex); const k = 1 - amt + r.next() * amt * 2; return c.multiplyScalar(k).getHex(); };

// 入口の向きに合わせた、正面の中心と向き
function front(b) {
  const f = b.door.face;
  if (f === 'e') return { x: b.x + b.w / 2, z: b.z, ry: Math.PI / 2 };
  if (f === 'w') return { x: b.x - b.w / 2, z: b.z, ry: -Math.PI / 2 };
  if (f === 's') return { x: b.x, z: b.z + b.d / 2, ry: 0 };
  return { x: b.x, z: b.z - b.d / 2, ry: Math.PI };
}

function adobeHouse(B, b, y, r, accent) {
  const wall = vary(0xc2a77e, r);
  B.box(b.w, b.h, b.d, b.x, y - 1.5, b.z, wall);
  B.box(b.w + 0.5, 0.35, b.d + 0.5, b.x, y + b.h - 1.5, b.z, vary(0x9c845f, r));
  B.box(b.w + 0.2, 0.5, 0.25, b.x, y + b.h - 1.15, b.z - b.d / 2, wall);
  const f = front(b);
  const dx = Math.sin(f.ry), dz = Math.cos(f.ry);
  B.box(1.3, 2.1, 0.12, f.x + dx * 0.05, y, f.z + dz * 0.05, 0x3a2c22, f.ry);
  // 窓
  for (const o of [-1, 1]) B.box(0.7, 0.6, 0.1, f.x + dx * 0.05 + Math.cos(f.ry) * o * b.w * 0.28, y + 1.6, f.z + dz * 0.05 - Math.sin(f.ry) * o * b.w * 0.28, 0x2a221b, f.ry);
  if (b.type === 'shop') {
    // 日よけと看板
    B.box(3.2, 0.12, 1.6, f.x + dx * 0.8, y + 2.5, f.z + dz * 0.8, accent, f.ry);
    B.box(1.6, 0.6, 0.12, f.x + dx * 0.1, y + 3.2, f.z + dz * 0.1, b.sign, f.ry);
  }
  // 屋上の小物
  if (r.next() < 0.5) B.box(1.2, 0.8, 1.2, b.x + (r.next() - 0.5) * b.w * 0.5, y + b.h - 1.15, b.z + (r.next() - 0.5) * b.d * 0.5, vary(0x8f7a5c, r));
}

function stoneHouse(B, b, y, r, accent) {
  const wall = vary(0xd4cdbd, r, 0.05);
  B.box(b.w, b.h, b.d, b.x, y - 1.5, b.z, wall);
  // 四角錐の屋根
  const roof = new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.75, 2.6, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(b.w / Math.max(b.w, b.d), 1, b.d / Math.max(b.w, b.d));
  B.add(roof, vary(0x8f8576, r), b.x, y + b.h - 1.5 + 1.3, b.z);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(0.6, b.h + 0.4, 0.6, b.x + sx * b.w / 2, y - 1.5, b.z + sz * b.d / 2, 0xbdb5a3);
  const f = front(b);
  const dx = Math.sin(f.ry), dz = Math.cos(f.ry);
  B.box(1.4, 2.4, 0.12, f.x + dx * 0.05, y, f.z + dz * 0.05, 0x4a3f36, f.ry);
  // 白い垂れ幕
  B.box(0.9, 2.2, 0.08, f.x + dx * 0.08 + Math.cos(f.ry) * 1.6, y + 1.2, f.z + dz * 0.08 - Math.sin(f.ry) * 1.6, accent, f.ry);
  if (b.type === 'shop') B.box(1.6, 0.6, 0.12, f.x + dx * 0.1, y + 2.7, f.z + dz * 0.1, b.sign, f.ry);
}

function tent(B, b, y, r) {
  const cone = new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.6, b.h, 5);
  B.add(cone, vary(r.next() < 0.5 ? 0x7e5a44 : 0x6b4130, r), b.x, y + b.h / 2 - 0.1, b.z, r.next());
  B.box(0.12, b.h + 0.6, 0.12, b.x, y - 0.1, b.z, 0x4a3a2c);
}

function hut(B, b, y, r) {
  const rr = Math.max(b.w, b.d) * 0.45;
  const wall = new THREE.CylinderGeometry(rr, rr * 1.05, 2.2, 7, 1);
  B.add(wall, vary(0x5d5a4a, r), b.x, y + 1.0, b.z);
  const roof = new THREE.ConeGeometry(rr * 1.3, 2.2, 7);
  B.add(roof, vary(0x6e6a4a, r), b.x, y + 3.2, b.z);
  // 骨の柱
  for (let i = 0; i < 2; i++) B.box(0.15, 2.8, 0.15, b.x + rr + 0.8, y - 0.1, b.z + (i - 0.5) * 1.5, 0xd9ccb4);
}

function tower(B, b, y, style) {
  const wood = style === 'stone' ? 0xbdb5a3 : 0x6b5340;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(0.35, b.h, 0.35, b.x + sx * 1.4, y - 0.5, b.z + sz * 1.4, wood);
  B.box(3.8, 0.3, 3.8, b.x, y + b.h - 1.5, b.z, wood);
  B.box(3.8, 0.9, 0.2, b.x, y + b.h - 1.2, b.z - 1.8, wood);
  B.box(3.8, 0.9, 0.2, b.x, y + b.h - 1.2, b.z + 1.8, wood);
  const roof = new THREE.ConeGeometry(2.9, 1.6, 4); roof.rotateY(Math.PI / 4);
  B.add(roof, style === 'stone' ? 0x8f8576 : 0x7a4b34, b.x, y + b.h + 1.1, b.z);
}

export class TownView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const L of allTowns()) {
      const t = L.town;
      const r = new Rng(Math.floor(hash2(t.x | 0, t.z | 0, 5) * 2 ** 31));
      const B = new Builder();
      const style = L.faction.style;
      const accent = L.faction.accent;
      for (const b of L.buildings) {
        const y = heightAt(b.x, b.z);
        if (b.type === 'tower') tower(B, b, y, style);
        else if (b.type === 'tent') (style === 'huts' ? hut : tent)(B, b, y, r);
        else if (style === 'stone') stoneHouse(B, b, y, r, accent);
        else adobeHouse(B, b, y, r, accent);
      }
      for (const wseg of L.walls) {
        const y = heightAt(wseg.x, wseg.z);
        B.box(wseg.w, wseg.h, wseg.d, wseg.x, y - 1.5, wseg.z, vary(0xbdb5a3, r, 0.04));
        // 胸壁
        const n = Math.round(Math.max(wseg.w, wseg.d) / 2);
        for (let i = 0; i < n; i++) {
          const o = (i + 0.5) / n - 0.5;
          B.box(wseg.w > wseg.d ? 0.9 : wseg.w + 0.2, 0.7, wseg.w > wseg.d ? wseg.d + 0.2 : 0.9, wseg.x + (wseg.w > wseg.d ? o * wseg.w : 0), y + wseg.h - 1.5, wseg.z + (wseg.w > wseg.d ? 0 : o * wseg.d), 0xa9a190);
        }
      }
      // 野営地：たき火と柵
      if (t.kind === 'camp') {
        const y = heightAt(t.x, t.z);
        B.box(1.6, 0.3, 1.6, t.x + 3, y - 0.1, t.z + 3, 0x3a2c22);
        B.box(0.5, 0.6, 0.5, t.x + 3, y + 0.1, t.z + 3, 0xd8823f);
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          if (i % 7 === 0) continue; // 出入り口
          const px = t.x + Math.cos(a) * (t.r + 1), pz = t.z + Math.sin(a) * (t.r + 1);
          B.box(0.3, 2.4 + r.next() * 0.8, 0.3, px, heightAt(px, pz) - 0.3, pz, style === 'huts' ? 0xd9ccb4 : 0x5c4636);
        }
      } else {
        // 広場の井戸
        const y = heightAt(t.x, t.z);
        B.add(new THREE.CylinderGeometry(1.2, 1.3, 0.9, 8), style === 'stone' ? 0xbdb5a3 : 0x9c845f, t.x, y + 0.4, t.z);
        B.box(0.2, 2.2, 0.2, t.x - 1, y, t.z, 0x5c4636); B.box(0.2, 2.2, 0.2, t.x + 1, y, t.z, 0x5c4636);
        B.box(2.4, 0.2, 0.3, t.x, y + 2.1, t.z, 0x5c4636);
      }
      const mesh = new THREE.Mesh(B.build(), this.mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.town = t;
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  setShadows(on) { for (const m of this.group.children) { m.castShadow = on; m.receiveShadow = on; } }

  // 遠い町は描かない
  update(focus, maxDist) {
    for (const m of this.group.children) {
      const t = m.userData.town;
      m.visible = Math.hypot(t.x - focus.x, t.z - focus.z) < maxDist + t.r;
    }
  }
}
