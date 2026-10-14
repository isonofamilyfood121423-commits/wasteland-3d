// 廃墟の遺物の箱を描く（描画層）。調べた箱はふたが開いて暗くなる
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cachesNear, cacheState } from '../sim/ruins.js';

function colored(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
function crate(open) {
  const parts = [];
  const body = new THREE.BoxGeometry(1.1, 0.6, 0.7); body.translate(0, 0.3, 0); parts.push(colored(body, open ? 0x4a4038 : 0x6e5a44));
  const band = new THREE.BoxGeometry(1.14, 0.1, 0.74); band.translate(0, 0.42, 0); parts.push(colored(band, 0x5e6266));
  const lid = new THREE.BoxGeometry(1.14, 0.12, 0.74);
  if (open) { lid.rotateX(-1.2); lid.translate(0, 0.85, -0.55); } else lid.translate(0, 0.66, 0);
  parts.push(colored(lid, open ? 0x3e352e : 0x7d6a52));
  // 目印の古い部品（閉じた箱だけ）
  if (!open) { const k = new THREE.CylinderGeometry(0.08, 0.08, 0.25, 6); k.rotateZ(Math.PI / 2); k.translate(0.3, 0.78, 0.1); parts.push(colored(k, 0x8fa0a8)); }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}

export class CacheView {
  constructor(scene) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.closed = new THREE.InstancedMesh(crate(false), mat, 16);
    this.open = new THREE.InstancedMesh(crate(true), mat, 16);
    for (const m of [this.closed, this.open]) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
    this.t = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1); this.ax = new THREE.Vector3(0, 1, 0);
  }
  setShadows(on) { this.closed.castShadow = this.open.castShadow = on; }
  update(world, focus, dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.4;
    let a = 0, b = 0;
    for (const c of cachesNear(focus.x, focus.z, 160)) {
      const opened = cacheState(world, c.key) === 2;
      this.m.compose(this.v.set(c.x, c.y, c.z), this.q.setFromAxisAngle(this.ax, c.ry), this.s);
      if (opened && b < 16) this.open.setMatrixAt(b++, this.m);
      else if (!opened && a < 16) this.closed.setMatrixAt(a++, this.m);
    }
    this.closed.count = a; this.open.count = b;
    this.closed.instanceMatrix.needsUpdate = true; this.open.instanceMatrix.needsUpdate = true;
  }
}
