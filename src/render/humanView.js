// ローポリ人形の群衆描画。部位ごとに InstancedMesh を1つ持ち、姿勢はプロシージャルに計算する
// ・欠損した手足はその部位のインスタンスを非表示、義肢は別造形（角ばった金属）に差し替え
// ・姿勢：歩く／走る／片脚をかばう／這う／倒れる（気絶・死亡）／座る（休息）／しゃがむ（治療）
// ・種族ごとに頭の造形（丸・箱・角）と体格が変わる
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from '../sim/terrain.js';
import { BODY, PALETTE } from '../data/config.js';
import { RACES } from '../data/body.js';

const B = BODY;
const ni = (g) => (g.index ? g.toNonIndexed() : g);

function limb(r0, r1, len, seg = 5) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1);
  g.translate(0, -len / 2, 0); // 関節（上端）を原点に
  return g;
}
function plimb(w, len) { // 義肢：角ばった金属の棒と関節
  const g = new THREE.BoxGeometry(w, len, w * 0.9);
  g.translate(0, -len / 2, 0);
  const j = new THREE.BoxGeometry(w * 1.5, w * 1.1, w * 1.3);
  j.translate(0, -0.02, 0);
  return mergeGeometries([ni(g), ni(j)]);
}

function makeGeometries() {
  const headR = new THREE.IcosahedronGeometry(B.headR, 1);
  headR.scale(0.92, 1.08, 1.0);
  const nose = new THREE.BoxGeometry(0.04, 0.05, 0.05); nose.translate(0, -0.01, B.headR * 0.95);
  const headB = new THREE.BoxGeometry(B.headR * 1.7, B.headR * 1.9, B.headR * 1.8);
  const visor = new THREE.BoxGeometry(B.headR * 1.5, 0.035, 0.03); visor.translate(0, 0.01, B.headR * 0.92);
  const jaw = new THREE.BoxGeometry(B.headR * 1.2, 0.05, B.headR * 1.4); jaw.translate(0, -B.headR * 1.05, 0.01);
  const hornL = new THREE.ConeGeometry(0.035, 0.16, 4); hornL.rotateX(-0.6); hornL.rotateZ(-0.35); hornL.translate(0.06, B.headR * 0.95, 0.05);
  const hornR = hornL.clone(); hornR.scale(-1, 1, 1);
  const torso = new THREE.CylinderGeometry(B.torsoW * 1.05, B.torsoW * 0.8, B.torsoH, 6, 1); torso.scale(1, 1, 0.62);
  const pelvis = new THREE.CylinderGeometry(B.torsoW * 0.8, B.torsoW * 0.72, B.pelvisH, 6, 1); pelvis.scale(1, 1, 0.66);
  const upperArm = limb(B.armR, B.armR * 0.85, B.upperArm);
  const foreArm = limb(B.armR * 0.85, B.armR * 0.7, B.foreArm);
  const hand = new THREE.BoxGeometry(0.07, 0.1, 0.05); hand.translate(0, -B.foreArm - 0.04, 0);
  const thigh = limb(B.legR * 1.15, B.legR * 0.9, B.thigh);
  const shin = limb(B.legR * 0.9, B.legR * 0.7, B.shin);
  const foot = new THREE.BoxGeometry(0.1, 0.07, 0.24); foot.translate(0, -B.shin - 0.02, 0.05);
  const pFoot = new THREE.BoxGeometry(0.09, 0.05, 0.2); pFoot.translate(0, -B.shin - 0.01, 0.04);
  const pHand = new THREE.BoxGeometry(0.08, 0.08, 0.04); pHand.translate(0, -B.foreArm - 0.03, 0);
  const brim = new THREE.CylinderGeometry(0.25, 0.27, 0.025, 9); brim.translate(0, 0.02, 0);
  const crown = new THREE.CylinderGeometry(0.1, 0.14, 0.14, 8); crown.translate(0, 0.09, 0);
  const pack = new THREE.BoxGeometry(0.3, 0.4, 0.18);
  const roll = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6); roll.rotateZ(Math.PI / 2); roll.translate(0, 0.25, 0);
  return {
    headRound: mergeGeometries([ni(headR), ni(nose)]),
    headBox: mergeGeometries([ni(headB), ni(visor), ni(jaw)]),
    horns: mergeGeometries([ni(hornL), ni(hornR)]),
    torso, pelvis, upperArm,
    foreArm: mergeGeometries([ni(foreArm), ni(hand)]),
    thigh,
    shin: mergeGeometries([ni(shin), ni(foot)]),
    pUpperArm: plimb(0.07, B.upperArm),
    pForeArm: mergeGeometries([plimb(0.06, B.foreArm), ni(pHand)]),
    pThigh: plimb(0.09, B.thigh),
    pShin: mergeGeometries([plimb(0.075, B.shin), ni(pFoot)]),
    hat: mergeGeometries([ni(brim), ni(crown)]),
    pack: mergeGeometries([ni(pack), ni(roll)]),
  };
}

// 部位名 → 1体あたりの数
const PARTS = {
  headRound: 1, headBox: 1, horns: 1, torso: 1, pelvis: 1,
  upperArm: 2, foreArm: 2, thigh: 2, shin: 2,
  pUpperArm: 2, pForeArm: 2, pThigh: 2, pShin: 2,
  hat: 1, pack: 1,
};
const METAL = 0x7d8387;

const _r = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function rot(x, y, z) { _e.set(x, y, z, 'YXZ'); return _r.makeRotationFromEuler(_e); }
function child(parent, tx, ty, tz, rx = 0, ry = 0, rz = 0, out = new THREE.Matrix4()) {
  _t.makeTranslation(tx, ty, tz);
  out.multiplyMatrices(parent, _t);
  out.multiply(rot(rx, ry, rz));
  return out;
}

// 姿勢パラメータ（角度はラジアン。腕・脚は「前へ振る＝負」）
function poseFor(a, time, i) {
  const st = a.state || 'ok';
  const amt = Math.min(1, a.speed / 1.4);
  const p = a.phase, sp = Math.sin(p);
  const P = {
    lie: 0, hipY: B.thigh + B.shin + 0.05, lean: 0, twist: 0, headPitch: 0,
    arm: [0, 0], elbow: [0.25, 0.25], armOut: [0.07, 0.07],
    thigh: [0, 0], knee: [0.02, 0.02], legOut: [0, 0],
  };
  if (st === 'dead' || st === 'ko') {
    // 仰向けに倒れる（気絶は浅く呼吸する）
    P.lie = -Math.PI / 2; P.lift = 0.13; P.hipY = 0;
    P.arm = [-0.15, 0.25]; P.armOut = [0.5, 0.35]; P.elbow = [0.3, 0.6];
    P.thigh = [-0.1, 0.05]; P.knee = [0.25, 0.05]; P.legOut = [0.12, -0.08];
    P.lean = st === 'ko' ? Math.sin(time * 2 + i) * 0.02 : 0;
    P.headPitch = -0.3;
    return P;
  }
  if (a.moveMode === 'crawl') {
    // うつ伏せで腕を交互に伸ばして這う
    P.lie = Math.PI / 2 * 0.9; P.lift = 0.16; P.hipY = 0;
    P.arm = [-2.5 + sp * 0.5 * amt, -2.5 - sp * 0.5 * amt]; P.elbow = [0.4 + Math.max(0, sp) * 0.6 * amt, 0.4 + Math.max(0, -sp) * 0.6 * amt];
    P.armOut = [0.25, 0.25];
    P.thigh = [sp * 0.15 * amt, -sp * 0.15 * amt]; P.knee = [0.2 + Math.max(0, sp) * 0.5, 0.2 + Math.max(0, -sp) * 0.5];
    P.headPitch = -0.9;
    return P;
  }
  if (a.task?.kind === 'rest' || a.resting) {
    // 地面に座る
    P.hipY = 0.16; P.lean = 0.12 + Math.sin(time * 1.5 + i) * 0.01;
    P.thigh = [-1.45, -1.35]; P.knee = [1.5, 1.3]; P.legOut = [0.25, -0.25];
    P.arm = [-0.6, -0.55]; P.elbow = [0.7, 0.8]; P.armOut = [0.15, 0.15];
    return P;
  }
  if (a.task?.kind === 'treat' && a.speed < 0.3) {
    // 片膝をついて手当て
    const w = Math.sin(time * 7 + i) * 0.15;
    P.hipY = 0.52; P.lean = 0.35;
    P.thigh = [-1.5, 0.15]; P.knee = [1.5, 1.6];
    P.arm = [-1.0 + w, -1.0 - w]; P.elbow = [0.6, 0.6]; P.headPitch = 0.3;
    return P;
  }
  // 歩く・走る・かばう
  const run = Math.min(1, Math.max(0, (a.speed - 2.0) / 1.3));
  const stride = 0.55 + run * 0.35;
  const limp = a.moveMode === 'limp';
  const breathe = Math.sin(time * 1.7 + i) * 0.012 * (1 - amt);
  P.hipY -= Math.abs(Math.cos(p)) * (0.035 + run * 0.05 + (limp ? 0.06 : 0)) * amt + run * 0.04;
  P.lean = 0.07 * amt + run * 0.2 + breathe + (limp ? 0.12 : 0);
  P.twist = -sp * 0.22 * amt;
  P.headPitch = -0.05 * amt;
  for (let k = 0; k < 2; k++) {
    const swing = (k === 0 ? sp : -sp) * (0.6 + run * 0.25) * amt;
    P.arm[k] = swing + breathe * 2;
    P.elbow[k] = 0.25 + Math.max(0, -swing) * 0.6 + 0.15 * amt + run * 0.9;
    const ph = k === 0 ? p + Math.PI : p;
    // かばう脚（HPが0以下）は振りが小さく膝を曲げない
    const bad = limp && a.body && (a.body[k === 0 ? 'legL' : 'legR'].hp <= 0 && !a.body[k === 0 ? 'legL' : 'legR'].prosthetic || a.body[k === 0 ? 'legL' : 'legR'].lost && !a.body[k === 0 ? 'legL' : 'legR'].prosthetic);
    P.thigh[k] = -Math.sin(ph) * stride * amt * (bad ? 0.3 : 1);
    P.knee[k] = bad ? 0.05 : (Math.max(0, Math.cos(ph)) * (0.95 + run * 0.6) + 0.04) * amt + 0.02;
  }
  return P;
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
    this.colorKey = '';
    this.mats = { root: new THREE.Matrix4(), pelvis: new THREE.Matrix4(), torso: new THREE.Matrix4(), tmp: new THREE.Matrix4(), tmp2: new THREE.Matrix4() };
    this.visibleRadius = 150;
  }

  reset() { this.colorKey = ''; }
  setShadows(on) { for (const m of Object.values(this.meshes)) m.castShadow = on; }

  applyColors(people) {
    const c = new THREE.Color();
    const M = this.meshes;
    people.forEach((a, i) => {
      const L = a.look;
      const race = RACES[a.race || 'sunabito'];
      const skin = new THREE.Color((race.skin || PALETTE.skin)[L.skin % (race.skin || PALETTE.skin).length]);
      const cloth = new THREE.Color(L.accent ?? PALETTE.cloth[L.cloth]);
      const pants = new THREE.Color(PALETTE.cloth[L.pants]).multiplyScalar(0.8);
      const metal = new THREE.Color(METAL);
      const dead = a.state === 'dead';
      if (dead) { skin.multiplyScalar(0.7); cloth.multiplyScalar(0.75); }
      M.headRound.setColorAt(i, skin);
      M.headBox.setColorAt(i, skin);
      M.horns.setColorAt(i, c.setHex(0xd9ccb4));
      M.torso.setColorAt(i, cloth);
      M.pelvis.setColorAt(i, pants);
      for (let k = 0; k < 2; k++) {
        M.upperArm.setColorAt(i * 2 + k, cloth);
        M.foreArm.setColorAt(i * 2 + k, skin);
        M.thigh.setColorAt(i * 2 + k, pants);
        M.shin.setColorAt(i * 2 + k, pants);
        for (const n of ['pUpperArm', 'pForeArm', 'pThigh', 'pShin']) M[n].setColorAt(i * 2 + k, metal);
      }
      M.hat.setColorAt(i, c.setHex(PALETTE.sandDark).multiplyScalar(0.9 + (i % 3) * 0.1));
      M.pack.setColorAt(i, c.setHex(PALETTE.rustDark));
    });
    for (const m of Object.values(M)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  update(people, camFocus, time) {
    // 人数・死亡などが変わったら色を塗り直す
    let key = people.length + ':';
    for (const a of people) key += a.state === 'dead' ? 'd' : '.';
    if (key !== this.colorKey) { this.applyColors(people); this.colorKey = key; }

    const M = this.meshes;
    const { root, pelvis, torso, tmp, tmp2 } = this.mats;
    const R2 = this.visibleRadius * this.visibleRadius;
    const n = Math.min(people.length, this.max);
    const hide = (name, idx) => M[name].setMatrixAt(idx, ZERO);

    for (let i = 0; i < n; i++) {
      const a = people[i];
      const dx = a.x - camFocus.x, dz = a.z - camFocus.z;
      if (dx * dx + dz * dz > R2) { // 遠方は描画しない（LOD）
        for (const [name, mul] of Object.entries(PARTS)) for (let k = 0; k < mul; k++) hide(name, i * mul + k);
        continue;
      }
      const L = a.look;
      const shape = RACES[a.race || 'sunabito'].shape;
      const P = poseFor(a, time, i);

      _q.setFromAxisAngle(_v.set(0, 1, 0), a.heading);
      root.compose(_v.set(a.x, heightAt(a.x, a.z), a.z), _q, _s.set(L.bulk, L.height, L.bulk));
      if (P.lie) { root.multiply(_t.makeTranslation(0, P.lift, 0)); root.multiply(rot(P.lie, 0, 0)); }

      child(root, 0, P.hipY, 0, 0, -P.twist * 0.5, 0, pelvis);
      M.pelvis.setMatrixAt(i, pelvis);
      child(pelvis, 0, B.pelvisH / 2 + B.torsoH / 2, 0, P.lean, P.twist, 0, torso);
      M.torso.setMatrixAt(i, torso);

      child(torso, 0, B.torsoH / 2 + B.neck + B.headR, 0.01, P.headPitch, -P.twist * 0.4, 0, tmp);
      M.headRound.setMatrixAt(i, shape.head === 'box' ? ZERO : tmp);
      M.headBox.setMatrixAt(i, shape.head === 'box' ? tmp : ZERO);
      M.horns.setMatrixAt(i, shape.head === 'horn' ? tmp : ZERO);
      if (L.hat && !P.lie) { child(tmp, 0, B.headR * (shape.head === 'box' ? 0.9 : 0.62), 0, 0, 0, 0, tmp2); M.hat.setMatrixAt(i, tmp2); }
      else hide('hat', i);
      if (L.pack) { child(torso, 0, 0.02, -B.torsoW * 0.62 - 0.08, 0, 0, 0, tmp2); M.pack.setMatrixAt(i, tmp2); }
      else hide('pack', i);

      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1, idx = i * 2 + k;
        // 腕
        const arm = a.body?.[k === 0 ? 'armL' : 'armR'];
        const armLost = arm?.lost && !arm.prosthetic, armPro = !!arm?.prosthetic;
        child(torso, side * B.shoulderX, B.torsoH / 2 - 0.05, 0, P.arm[k], 0, side * P.armOut[k], tmp);
        child(tmp, 0, -B.upperArm, 0, -P.elbow[k], 0, 0, tmp2);
        M.upperArm.setMatrixAt(idx, armLost || armPro ? ZERO : tmp);
        M.foreArm.setMatrixAt(idx, armLost || armPro ? ZERO : tmp2);
        M.pUpperArm.setMatrixAt(idx, armPro ? tmp : ZERO);
        M.pForeArm.setMatrixAt(idx, armPro ? tmp2 : ZERO);
        // 脚
        const leg = a.body?.[k === 0 ? 'legL' : 'legR'];
        const legLost = leg?.lost && !leg.prosthetic, legPro = !!leg?.prosthetic;
        child(pelvis, side * B.hipX, -B.pelvisH / 2 + 0.02, 0, P.thigh[k], 0, side * P.legOut[k], tmp);
        child(tmp, 0, -B.thigh, 0, P.knee[k], 0, 0, tmp2);
        M.thigh.setMatrixAt(idx, legLost || legPro ? ZERO : tmp);
        M.shin.setMatrixAt(idx, legLost || legPro ? ZERO : tmp2);
        M.pThigh.setMatrixAt(idx, legPro ? tmp : ZERO);
        M.pShin.setMatrixAt(idx, legPro ? tmp2 : ZERO);
      }
    }
    for (const [name, mul] of Object.entries(PARTS)) { M[name].count = n * mul; M[name].instanceMatrix.needsUpdate = true; }
  }
}
