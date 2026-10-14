// 戦闘の演出：血しぶき・火花・砂ぼこり・矢（描画層。ロジックの events を読むだけ）
import * as THREE from 'three';
import { heightAt } from '../sim/terrain.js';

const COLORS = { hit: 0x9e2a1e, sever: 0x8a1e14, block: 0xd8d0b8, dodge: 0xb39b74, siege: 0xa89a84, collapse: 0x9c8c74 };

export class Effects {
  constructor(scene, max = 160) {
    this.max = max;
    const g = new THREE.TetrahedronGeometry(0.05, 0);
    this.mat = new THREE.MeshBasicMaterial({ fog: true });
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    const ag = new THREE.BoxGeometry(0.02, 0.02, 0.7);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x3a2c22, fog: true });
    this.arrows = new THREE.InstancedMesh(ag, this.arrowMat, 24);
    this.arrows.frustumCulled = false;
    scene.add(this.arrows);
    this.parts = [];
    this.flying = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    this.mesh.count = 0; this.arrows.count = 0;
  }

  // events: [{kind, x, z, fx, fz}]
  spawn(events) {
    for (const e of events) {
      if (e.kind === 'arrow') {
        const y0 = heightAt(e.fx, e.fz) + 1.4, y1 = heightAt(e.x, e.z) + 1.2;
        this.flying.push({ x0: e.fx, y0, z0: e.fz, x1: e.x, y1, z1: e.z, t: 0, dur: Math.max(0.12, Math.hypot(e.x - e.fx, e.z - e.fz) / 45) });
        continue;
      }
      if (!COLORS[e.kind]) continue;
      const n = e.kind === 'collapse' ? 40 : e.kind === 'sever' ? 22 : e.kind === 'hit' ? 10 : 7;
      const y = heightAt(e.x, e.z) + (e.kind === 'dodge' ? 0.15 : e.kind === 'collapse' ? 0.8 : e.kind === 'siege' ? 1.6 : 1.15);
      const dx = e.x - e.fx, dz = e.z - e.fz, l = Math.hypot(dx, dz) || 1;
      for (let i = 0; i < n; i++) {
        if (this.parts.length >= this.max) this.parts.shift();
        this.parts.push({
          x: e.x - (dx / l) * 0.2, y, z: e.z - (dz / l) * 0.2,
          vx: (dx / l) * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2,
          vy: 1 + Math.random() * 2.5,
          vz: (dz / l) * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2,
          life: 0.5 + Math.random() * 0.4, color: COLORS[e.kind], s: e.kind === 'block' ? 0.6 : e.kind === 'collapse' ? 3 : e.kind === 'siege' ? 1.6 : 1,
        });
      }
    }
  }

  update(dt) {
    const { m, q, v, s, c } = this;
    let n = 0;
    for (const p of this.parts) {
      p.life -= dt;
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const g = heightAt(p.x, p.z) + 0.02;
      if (p.y < g) { p.y = g; p.vx *= 0.3; p.vz *= 0.3; p.vy = 0; }
      if (p.life <= 0) continue;
      m.compose(v.set(p.x, p.y, p.z), q.identity(), s.setScalar(p.s * Math.min(1, p.life * 3)));
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, c.setHex(p.color));
      n++;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    let a = 0;
    for (const f of this.flying) {
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      v.set(f.x0 + (f.x1 - f.x0) * u, f.y0 + (f.y1 - f.y0) * u + Math.sin(u * Math.PI) * 0.4, f.z0 + (f.z1 - f.z0) * u);
      q.setFromUnitVectors(s.set(0, 0, 1), new THREE.Vector3(f.x1 - f.x0, f.y1 - f.y0, f.z1 - f.z0).normalize());
      m.compose(v, q, s.set(1, 1, 1));
      if (a < 24) this.arrows.setMatrixAt(a++, m);
    }
    this.flying = this.flying.filter((f) => f.t < f.dur);
    this.arrows.count = a;
    this.arrows.instanceMatrix.needsUpdate = true;
  }
}
