// ローポリ人形の群衆描画。部位ごとに InstancedMesh を1つ持ち、姿勢はプロシージャルに計算する
// 部位欠損（Phase 2）は該当部位のインスタンスを非表示にし、義肢は別メッシュに差し替える設計
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from '../sim/terrain.js';
import { BODY, PALETTE } from '../data/config.js';

const B = BODY;

function limb(r0, r1, len, seg = 5) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1);
  g.translate(0, -len / 2, 0); // 関節（上端）を原点に
  return g;
}

const ni = (g) => (g.index ? g.toNonIndexed() : g);

function makeGeometries() {
  const head = new THREE.IcosahedronGeometry(B.headR, 1);
  head.scale(0.92, 1.08, 1.0);
  const nose = new THREE.BoxGeometry(0.04, 0.05, 0.05); nose.translate(0, -0.01, B.headR * 0.95);
  const torso = new THREE.CylinderGeometry(B.torsoW * 1.05, B.torsoW * 0.8, B.torsoH, 6, 1);
  torso.scale(1, 1, 0.62);
  const pelvis = new THREE.CylinderGeometry(B.torsoW * 0.8, B.torsoW * 0.72, B.pelvisH, 6, 1);
  pelvis.scale(1, 1, 0.66);
  const upperArm = limb(B.armR, B.armR * 0.85, B.upperArm);
  const foreArm = limb(B.armR * 0.85, B.armR * 0.7, B.foreArm);
  const hand = new THREE.BoxGeometry(0.07, 0.1, 0.05); hand.translate(0, -B.foreArm - 0.04, 0);
  const thigh = limb(B.legR * 1.15, B.legR * 0.9, B.thigh);
  const shin = limb(B.legR * 0.9, B.legR * 0.7, B.shin);
  const foot = new THREE.BoxGeometry(0.1, 0.07, 0.24); foot.translate(0, -B.shin - 0.02, 0.05);
  const brim = new THREE.CylinderGeometry(0.25, 0.27, 0.025, 9); brim.translate(0, 0.02, 0);
  const crown = new THREE.CylinderGeometry(0.1, 0.14, 0.14, 8); crown.translate(0, 0.09, 0);
  const pack = new THREE.BoxGeometry(0.3, 0.4, 0.18);
  const roll = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6); roll.rotateZ(Math.PI / 2); roll.translate(0, 0.25, 0);
  return {
    head: mergeGeometries([ni(head), ni(nose)]),
    torso, pelvis, upperArm,
    foreArm: mergeGeometries([ni(foreArm), ni(hand)]),
    thigh,
    shin: mergeGeometries([ni(shin), ni(foot)]),
    hat: mergeGeometries([ni(brim), ni(crown)]),
    pack: mergeGeometries([ni(pack), ni(roll)]),
  };
}

// 部位名 → 1体あたりの数
const PARTS = { head: 1, torso: 1, pelvis: 1, upperArm: 2, foreArm: 2, thigh: 2, shin: 2, hat: 1, pack: 1 };

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function rot(x, y, z) { _e.set(x, y, z, 'YXZ'); return _r.makeRotationFromEuler(_e); }
function child(parent, tx, ty, tz, rx = 0, ry = 0, rz = 0, out = new THREE.Matrix4()) {
  _t.makeTranslation(tx, ty, tz);
  out.multiplyMatrices(parent, _t);
  out.multiply(rot(rx, ry, rz));
  return out;
}

export class HumanView {
  constructor(scene, maxCount) {
    this.max = maxCount;
    this.geos = makeGeometries();
    this.mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.meshes = {};
    for (const [name, mul] of Object.entries(PARTS)) {
      const im = new THREE.InstancedMesh(this.geos[name], this.mat, maxCount * mul);
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.meshes[name] = im;
    }
    this.colored = false;
    this.mats = { root: new THREE.Matrix4(), pelvis: new THREE.Matrix4(), torso: new THREE.Matrix4(), tmp: new THREE.Matrix4(), tmp2: new THREE.Matrix4() };
    this.visibleRadius = 150;
  }

  reset() { this.colored = false; }

  setShadows(on) { for (const m of Object.values(this.meshes)) m.castShadow = on; }

  applyColors(agents) {
    const c = new THREE.Color();
    agents.forEach((a, i) => {
      const L = a.look;
      const skin = c.setHex(PALETTE.skin[L.skin]).clone();
      const cloth = new THREE.Color(L.accent ?? PALETTE.cloth[L.cloth]);
      const pants = new THREE.Color(PALETTE.cloth[L.pants]).multiplyScalar(0.8);
      const M = this.meshes;
      M.head.setColorAt(i, skin);
      M.torso.setColorAt(i, cloth);
      M.pelvis.setColorAt(i, pants);
      for (let k = 0; k < 2; k++) {
        M.upperArm.setColorAt(i * 2 + k, cloth);
        M.foreArm.setColorAt(i * 2 + k, skin);
        M.thigh.setColorAt(i * 2 + k, pants);
        M.shin.setColorAt(i * 2 + k, pants);
      }
      M.hat.setColorAt(i, c.setHex(PALETTE.sandDark).multiplyScalar(0.9 + (i % 3) * 0.1));
      M.pack.setColorAt(i, c.setHex(PALETTE.rustDark));
    });
    for (const m of Object.values(this.meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.colored = true;
  }

  update(agents, camFocus, time) {
    if (!this.colored) this.applyColors(agents);
    const M = this.meshes;
    const { root, pelvis, torso, tmp, tmp2 } = this.mats;
    const R2 = this.visibleRadius * this.visibleRadius;
    const n = Math.min(agents.length, this.max);

    for (let i = 0; i < n; i++) {
      const a = agents[i];
      const dx = a.x - camFocus.x, dz = a.z - camFocus.z;
      if (dx * dx + dz * dz > R2) { // 遠方は描画しない（LOD）
        for (const [name, mul] of Object.entries(PARTS)) for (let k = 0; k < mul; k++) M[name].setMatrixAt(i * mul + k, ZERO);
        continue;
      }
      const L = a.look;
      const amt = Math.min(1, a.speed / 1.4);
      const run = Math.min(1, Math.max(0, (a.speed - 2.0) / 1.3)); // 走り：歩幅・前傾・腕の曲げを強める
      const stride = 0.55 + run * 0.35;
      const p = a.phase;
      const sp = Math.sin(p), cp = Math.cos(p);
      const breathe = Math.sin(time * 1.7 + i) * 0.012 * (1 - amt);

      // ルート：地面上の位置＋向き＋体格
      _q.setFromAxisAngle(_v.set(0, 1, 0), a.heading);
      root.compose(_v.set(a.x, heightAt(a.x, a.z), a.z), _q, _s.set(L.bulk, L.height, L.bulk));

      const legLen = B.thigh + B.shin + 0.05;
      const hipY = legLen - Math.abs(cp) * (0.035 + run * 0.05) * amt - run * 0.04;
      child(root, 0, hipY, 0, 0, sp * 0.12 * amt, 0, pelvis);
      M.pelvis.setMatrixAt(i, pelvis);

      child(pelvis, 0, B.pelvisH / 2 + B.torsoH / 2, 0, 0.07 * amt + run * 0.2 + breathe, -sp * 0.22 * amt, 0, torso);
      M.torso.setMatrixAt(i, torso);

      child(torso, 0, B.torsoH / 2 + B.neck + B.headR, 0.01, -0.05 * amt, sp * 0.1 * amt, 0, tmp);
      M.head.setMatrixAt(i, tmp);
      if (L.hat) { child(tmp, 0, B.headR * 0.62, 0, 0, 0, 0, tmp2); M.hat.setMatrixAt(i, tmp2); }
      else M.hat.setMatrixAt(i, ZERO);
      if (L.pack) { child(torso, 0, 0.02, -B.torsoW * 0.62 - 0.08, 0, 0, 0, tmp2); M.pack.setMatrixAt(i, tmp2); }
      else M.pack.setMatrixAt(i, ZERO);

      // 腕：脚と逆位相で振る（+z が前方。前へ振るには X 回転を負に）
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        const swing = (k === 0 ? sp : -sp) * (0.6 + run * 0.25) * amt;
        child(torso, side * B.shoulderX, B.torsoH / 2 - 0.05, 0, swing + breathe * 2, 0, side * 0.07, tmp);
        M.upperArm.setMatrixAt(i * 2 + k, tmp);
        child(tmp, 0, -B.upperArm, 0, -(0.25 + Math.max(0, -swing) * 0.6 + 0.15 * amt + run * 0.9), 0, 0, tmp2);
        M.foreArm.setMatrixAt(i * 2 + k, tmp2);
      }
      // 脚：太ももを前後に振り、膝は振り出し時に曲げる
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        const ph = k === 0 ? p + Math.PI : p;
        const thighA = -Math.sin(ph) * stride * amt;
        const knee = (Math.max(0, Math.cos(ph)) * (0.95 + run * 0.6) + 0.04) * amt + 0.02;
        child(pelvis, side * B.hipX, -B.pelvisH / 2 + 0.02, 0, thighA, 0, 0, tmp);
        M.thigh.setMatrixAt(i * 2 + k, tmp);
        child(tmp, 0, -B.thigh, 0, knee, 0, 0, tmp2);
        M.shin.setMatrixAt(i * 2 + k, tmp2);
      }
    }
    for (const [name, mul] of Object.entries(PARTS)) { M[name].count = n * mul; M[name].instanceMatrix.needsUpdate = true; }
  }
}
