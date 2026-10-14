// 足元の選択リング（味方=緑・敵対=赤・その他=淡色）と移動先の印
import * as THREE from 'three';
import { heightAt } from '../sim/terrain.js';

export const RING = { party: 0x6fd27a, hostile: 0xe0533f, neutral: 0xe8d9a8, dest: 0x9fe6a8 };

export class Markers {
  constructor(scene, max = 64) {
    const geo = new THREE.RingGeometry(0.42, 0.55, 28, 1);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.rings = new THREE.InstancedMesh(geo, this.mat, max);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2;
    scene.add(this.rings);

    const dgeo = new THREE.RingGeometry(0.15, 0.32, 4, 1);
    dgeo.rotateX(-Math.PI / 2);
    this.dmat = new THREE.MeshBasicMaterial({ color: RING.dest, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.dest = new THREE.InstancedMesh(dgeo, this.dmat, max);
    this.dest.frustumCulled = false;
    this.dest.renderOrder = 2;
    scene.add(this.dest);

    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    this.max = max;
  }

  // items: [{x,z,color,scale}], dests: [{x,z}]
  update(items, dests, time) {
    const { m, q, v, s, c } = this;
    let n = 0;
    for (const it of items) {
      if (n >= this.max) break;
      const pulse = 1 + Math.sin(time * 4) * 0.04;
      m.compose(v.set(it.x, heightAt(it.x, it.z) + 0.06, it.z), q.identity(), s.setScalar((it.scale || 1) * pulse));
      this.rings.setMatrixAt(n, m);
      this.rings.setColorAt(n, c.setHex(it.color));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    let d = 0;
    for (const it of dests) {
      if (d >= this.max) break;
      q.setFromAxisAngle(v.set(0, 1, 0), time * 2);
      m.compose(v.set(it.x, heightAt(it.x, it.z) + 0.08, it.z), q, s.setScalar(1 + Math.sin(time * 5) * 0.15));
      this.dest.setMatrixAt(d++, m);
    }
    this.dest.count = d;
    this.dest.instanceMatrix.needsUpdate = true;
  }
}
