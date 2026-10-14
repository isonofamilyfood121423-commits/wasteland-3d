// ローポリ人形の群衆描画。部位ごとに InstancedMesh を1つ持ち、姿勢はプロシージャルに計算する
// ・欠損した手足はその部位のインスタンスを非表示、義肢は別造形（角ばった金属）に差し替え
// ・装備（帽子・兜・胴の防具・外套・脛当て・背負い袋・武器）を体の部位に重ねて表示
// ・姿勢：歩く／走る／かばう／這う／倒れる／座る／治療／構え／攻撃／受け止め／回避／よろめき／担ぐ／担がれる
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from '../sim/terrain.js';
import { BODY, PALETTE } from '../data/config.js';
import { RACES } from '../data/body.js';
import { ITEMS } from '../data/items.js';

const B = BODY;
const ni = (g) => (g.index ? g.toNonIndexed() : g);
const merge = (list) => mergeGeometries(list.map(ni));

function limb(r0, r1, len, seg = 5) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1);
  g.translate(0, -len / 2, 0); // 関節（上端）を原点に
  return g;
}
function plimb(w, len) {
  const g = new THREE.BoxGeometry(w, len, w * 0.9); g.translate(0, -len / 2, 0);
  const j = new THREE.BoxGeometry(w * 1.5, w * 1.1, w * 1.3); j.translate(0, -0.02, 0);
  return merge([g, j]);
}
const box = (w, h, d, x = 0, y = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };

// 武器：握りを原点、刃先を +y 方向に作る
function weaponGeometries() {
  const sword = merge([box(0.035, 0.16, 0.04, 0, 0.0), box(0.14, 0.025, 0.05, 0, 0.09), box(0.06, 0.72, 0.012, 0, 0.47)]);
  const longsword = merge([box(0.035, 0.22, 0.04, 0, 0.02), box(0.16, 0.03, 0.05, 0, 0.13), box(0.07, 1.0, 0.012, 0, 0.64)]);
  const club = merge([box(0.04, 0.6, 0.04, 0, 0.22), box(0.09, 0.22, 0.09, 0, 0.55)]);
  const hammer = merge([box(0.045, 0.95, 0.045, 0, 0.35), box(0.26, 0.15, 0.15, 0, 0.82)]);
  const spear = merge([box(0.03, 1.9, 0.03, 0, 0.55), box(0.05, 0.22, 0.012, 0, 1.6)]);
  const glaive = merge([box(0.035, 1.8, 0.035, 0, 0.5), box(0.09, 0.42, 0.012, 0.02, 1.58)]);
  const bowArc = [];
  for (let i = 0; i < 6; i++) { const a = -0.9 + i * 0.36; const g = box(0.025, 0.22, 0.025); g.rotateZ(-a * 0.5); g.translate(Math.cos(a) * 0.08 - 0.08, Math.sin(a) * 0.62, 0); bowArc.push(g); }
  bowArc.push(box(0.006, 1.15, 0.006, -0.12, 0, 0));
  return { w_sword: sword, w_longsword: longsword, w_club: club, w_hammer: hammer, w_spear: spear, w_glaive: glaive, w_bow: merge(bowArc) };
}

function makeGeometries() {
  const headR = new THREE.IcosahedronGeometry(B.headR, 1); headR.scale(0.92, 1.08, 1.0);
  const nose = box(0.04, 0.05, 0.05, 0, -0.01, B.headR * 0.95);
  const headB = new THREE.BoxGeometry(B.headR * 1.7, B.headR * 1.9, B.headR * 1.8);
  const visor = box(B.headR * 1.5, 0.035, 0.03, 0, 0.01, B.headR * 0.92);
  const jaw = box(B.headR * 1.2, 0.05, B.headR * 1.4, 0, -B.headR * 1.05, 0.01);
  const hornL = new THREE.ConeGeometry(0.035, 0.16, 4); hornL.rotateX(-0.6); hornL.rotateZ(-0.35); hornL.translate(0.06, B.headR * 0.95, 0.05);
  const hornR = hornL.clone(); hornR.scale(-1, 1, 1);
  const torso = new THREE.CylinderGeometry(B.torsoW * 1.05, B.torsoW * 0.8, B.torsoH, 6, 1); torso.scale(1, 1, 0.62);
  const pelvis = new THREE.CylinderGeometry(B.torsoW * 0.8, B.torsoW * 0.72, B.pelvisH, 6, 1); pelvis.scale(1, 1, 0.66);
  const hand = box(0.07, 0.1, 0.05, 0, -B.foreArm - 0.04, 0);
  const foot = box(0.1, 0.07, 0.24, 0, -B.shin - 0.02, 0.05);
  const pFoot = box(0.09, 0.05, 0.2, 0, -B.shin - 0.01, 0.04);
  const pHand = box(0.08, 0.08, 0.04, 0, -B.foreArm - 0.03, 0);
  const brim = new THREE.CylinderGeometry(0.25, 0.27, 0.025, 9); brim.translate(0, 0.02, 0);
  const crown = new THREE.CylinderGeometry(0.1, 0.14, 0.14, 8); crown.translate(0, 0.09, 0);
  const helm = new THREE.SphereGeometry(B.headR * 1.18, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55); helm.translate(0, -0.02, 0);
  const helmBrow = box(B.headR * 2.2, 0.04, 0.05, 0, -0.01, B.headR * 1.0);
  const hood = new THREE.SphereGeometry(B.headR * 1.22, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.7); hood.translate(0, -0.03, -0.015);
  const hoodTail = box(0.16, 0.18, 0.05, 0, -0.14, -B.headR * 0.95);
  const pack = new THREE.BoxGeometry(0.3, 0.4, 0.18);
  const roll = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6); roll.rotateZ(Math.PI / 2); roll.translate(0, 0.25, 0);
  // 胴の防具：胴の上に少し大きめに重ねる
  const vest = new THREE.CylinderGeometry(B.torsoW * 1.12, B.torsoW * 0.9, B.torsoH * 0.9, 6, 1); vest.scale(1, 1, 0.68);
  const plate = merge([(() => { const g = new THREE.CylinderGeometry(B.torsoW * 1.15, B.torsoW * 0.95, B.torsoH * 0.75, 6, 1); g.scale(1, 1, 0.72); g.translate(0, 0.05, 0); return g; })(),
    box(0.16, 0.06, 0.2, 0.2, 0.2, 0), box(0.16, 0.06, 0.2, -0.2, 0.2, 0)]);
  // 外套：肩から膝まで広がる
  const cloak = new THREE.CylinderGeometry(B.torsoW * 1.15, B.torsoW * 1.75, 1.05, 7, 1, true); cloak.scale(1, 1, 0.8); cloak.translate(0, -0.3, -0.02);
  const greave = box(0.11, 0.3, 0.12, 0, -B.shin * 0.45, 0.01);
  return {
    headRound: merge([headR, nose]), headBox: merge([headB, visor, jaw]), horns: merge([hornL, hornR]),
    torso, pelvis,
    upperArm: limb(B.armR, B.armR * 0.85, B.upperArm), foreArm: merge([limb(B.armR * 0.85, B.armR * 0.7, B.foreArm), hand]),
    thigh: limb(B.legR * 1.15, B.legR * 0.9, B.thigh), shin: merge([limb(B.legR * 0.9, B.legR * 0.7, B.shin), foot]),
    pUpperArm: plimb(0.07, B.upperArm), pForeArm: merge([plimb(0.06, B.foreArm), pHand]),
    pThigh: plimb(0.09, B.thigh), pShin: merge([plimb(0.075, B.shin), pFoot]),
    hat: merge([brim, crown]), helm: merge([helm, helmBrow]), hood: merge([hood, hoodTail]),
    pack: merge([pack, roll]), vest, plate, cloak, greave,
    ...weaponGeometries(),
  };
}

// 部位名 → 1体あたりの数
const PARTS = {
  headRound: 1, headBox: 1, horns: 1, torso: 1, pelvis: 1,
  upperArm: 2, foreArm: 2, thigh: 2, shin: 2,
  pUpperArm: 2, pForeArm: 2, pThigh: 2, pShin: 2,
  hat: 1, helm: 1, hood: 1, pack: 1, vest: 1, plate: 1, cloak: 1, greave: 2,
  w_sword: 1, w_longsword: 1, w_club: 1, w_hammer: 1, w_spear: 1, w_glaive: 1, w_bow: 1,
};
const WEAPON_PARTS = ['w_sword', 'w_longsword', 'w_club', 'w_hammer', 'w_spear', 'w_glaive', 'w_bow'];
const HEAD_GEAR = { hat: 'hat', helm: 'helm', hood: 'hood' };
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

const lostOrBad = (b) => b && ((b.lost && !b.prosthetic) || b.hp <= 0);

// 姿勢パラメータ（角度はラジアン。腕・脚は「前へ振る＝負」）
function poseFor(a, time, i) {
  const st = a.state || 'ok';
  const amt = Math.min(1, a.speed / 1.4);
  const p = a.phase, sp = Math.sin(p);
  const P = {
    lie: 0, lift: 0, hipY: B.thigh + B.shin + 0.05, lean: 0, twist: 0, headPitch: 0, side: 0,
    arm: [0, 0], elbow: [0.25, 0.25], armOut: [0.07, 0.07],
    thigh: [0, 0], knee: [0.02, 0.02], legOut: [0, 0], weaponInHand: false,
  };
  const f = a.fight;
  if (a.carriedBy) {
    // 担がれている：肩の上で横向きにうつ伏せ、手足がぶら下がる
    P.lie = Math.PI / 2; P.lift = 1.36; P.hipY = 0; P.yawOffset = Math.PI / 2;
    P.arm = [-1.45, -1.55]; P.elbow = [0.2, 0.3]; P.thigh = [-1.2, -1.35]; P.knee = [0.35, 0.2]; P.headPitch = 0.6;
    return P;
  }
  if (a.inBed && st === 'ok') {
    // 寝床で眠る
    P.lie = -Math.PI / 2; P.lift = 0.62; P.hipY = 0; P.arm = [0.1, 0.1]; P.armOut = [0.15, 0.15]; P.elbow = [0.3, 0.3];
    P.headPitch = -0.2; P.lean = Math.sin(time * 1.2 + i) * 0.015;
    return P;
  }
  if (a.caged && st === 'ok') {
    P.hipY = 0.16; P.lean = 0.3; P.thigh = [-1.4, -1.4]; P.knee = [1.9, 1.9]; P.arm = [0.4, 0.4]; P.armOut = [-0.15, -0.15]; P.elbow = [1.3, 1.3]; P.headPitch = 0.5;
    return P;
  }
  if (st === 'dead' || st === 'ko') {
    P.lie = -Math.PI / 2; P.lift = 0.13; P.hipY = 0;
    P.arm = [-0.15, 0.25]; P.armOut = [0.5, 0.35]; P.elbow = [0.3, 0.6];
    P.thigh = [-0.1, 0.05]; P.knee = [0.25, 0.05]; P.legOut = [0.12, -0.08];
    P.lean = st === 'ko' ? Math.sin(time * 2 + i) * 0.02 : 0;
    P.headPitch = -0.3;
    if (a.bound) { P.arm = [0.35, 0.35]; P.armOut = [-0.15, -0.15]; P.elbow = [1.2, 1.2]; P.legOut = [0, 0]; P.thigh = [0, 0]; }
    return P;
  }
  if (a.bound) {
    // 縛られて座り込んでいる
    P.hipY = 0.16; P.lean = 0.25; P.thigh = [-1.4, -1.4]; P.knee = [1.9, 1.9]; P.arm = [0.4, 0.4]; P.armOut = [-0.15, -0.15]; P.elbow = [1.3, 1.3]; P.headPitch = 0.4;
    return P;
  }
  if (a.moveMode === 'crawl') {
    P.lie = Math.PI / 2 * 0.9; P.lift = 0.16; P.hipY = 0;
    P.arm = [-2.5 + sp * 0.5 * amt, -2.5 - sp * 0.5 * amt]; P.elbow = [0.4 + Math.max(0, sp) * 0.6 * amt, 0.4 + Math.max(0, -sp) * 0.6 * amt];
    P.armOut = [0.25, 0.25];
    P.thigh = [sp * 0.15 * amt, -sp * 0.15 * amt]; P.knee = [0.2 + Math.max(0, sp) * 0.5, 0.2 + Math.max(0, -sp) * 0.5];
    P.headPitch = -0.9;
    return P;
  }
  if (a.task?.kind === 'rest' || a.resting) {
    P.hipY = 0.16; P.lean = 0.12 + Math.sin(time * 1.5 + i) * 0.01;
    P.thigh = [-1.45, -1.35]; P.knee = [1.5, 1.3]; P.legOut = [0.25, -0.25];
    P.arm = [-0.6, -0.55]; P.elbow = [0.7, 0.8]; P.armOut = [0.15, 0.15];
    return P;
  }
  if ((a.task?.kind === 'treat' || a.task?.kind === 'bind' || a.task?.kind === 'release') && a.speed < 0.3) {
    const w = Math.sin(time * 7 + i) * 0.15;
    P.hipY = 0.52; P.lean = 0.35;
    P.thigh = [-1.5, 0.15]; P.knee = [1.5, 1.6];
    P.arm = [-1.0 + w, -1.0 - w]; P.elbow = [0.6, 0.6]; P.headPitch = 0.3;
    return P;
  }

  if (a.working && a.speed < 0.3) {
    // 仕事の動き
    const k = time * (a.working === 'mine' ? 3.2 : 6) + i;
    if (a.working === 'mine') { const u = (Math.sin(k) + 1) / 2; P.arm = [-1.2 - u * 1.4, -1.3 - u * 1.4]; P.elbow = [0.6, 0.5]; P.lean = 0.15 + u * 0.35; P.knee = [0.3, 0.3]; P.thigh = [-0.2, 0.1]; P.hipY -= 0.05; }
    else if (a.working === 'farm') { P.lean = 0.9; P.hipY -= 0.12; P.knee = [0.6, 0.6]; P.thigh = [-0.5, -0.4]; P.arm = [-0.6 + Math.sin(k) * 0.3, -0.7 - Math.sin(k) * 0.3]; P.elbow = [0.3, 0.3]; }
    else if (a.working === 'research') { P.lean = 0.35; P.arm = [-0.9, -0.8 + Math.sin(k * 0.3) * 0.2]; P.elbow = [1.1, 1.0]; P.headPitch = 0.35; }
    else { P.lean = 0.3; P.arm = [-0.8, -1.4 + Math.sin(k) * 0.6]; P.elbow = [0.9, 0.7 + Math.max(0, Math.sin(k)) * 0.6]; }
    return P;
  }
  // ---- 歩く・走る・かばう（下半身の基本） ----
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
    const bad = limp && lostOrBad(a.body?.[k === 0 ? 'legL' : 'legR']);
    P.thigh[k] = -Math.sin(ph) * stride * amt * (bad ? 0.3 : 1);
    P.knee[k] = bad ? 0.05 : (Math.max(0, Math.cos(ph)) * (0.95 + run * 0.6) + 0.04) * amt + 0.02;
  }

  if (a.sneak && !(f && (f.target || f.act))) {
    // 忍び歩き：腰を落として前かがみ
    P.hipY -= 0.22; P.lean += 0.45; P.headPitch -= 0.35;
    P.thigh = P.thigh.map((v) => v - 0.45); P.knee = P.knee.map((v) => v + 0.75);
    P.arm = P.arm.map((v) => v * 0.5 - 0.35); P.elbow = P.elbow.map((v) => v + 0.4);
  }
  if (a.carrying) {
    // 人を担いでいる：右腕で肩の上を押さえる
    P.arm[1] = -2.7; P.elbow[1] = 1.7; P.armOut[1] = 0.2; P.arm[0] = -2.5; P.elbow[0] = 1.8; P.armOut[0] = 0.25;
    P.lean += 0.18;
    return P;
  }

  // ---- 戦闘の上半身 ----
  if (f && (f.target || f.act || f.swing > 0)) {
    const wt = f.act?.weapon || f.swingType || 'sword';
    const bow = wt === 'bow';
    const pole = wt === 'polearm';
    P.weaponInHand = true;
    if (amt < 0.4) { P.hipY -= 0.06; P.knee = [0.35, 0.3]; P.thigh = [-0.3, 0.1]; }
    P.lean += 0.12;
    // 構え
    P.arm = bow ? [-1.45, -1.4] : pole ? [-0.7, -0.9] : [-0.55, -0.95];
    P.elbow = bow ? [0.5, 0.2] : pole ? [1.0, 0.5] : [1.2, 1.05];
    P.armOut = [0.15, 0.15];
    const act = f.act;
    if (act?.kind === 'attack') {
      const u = Math.min(1, act.t / act.dur);
      if (bow) { P.elbow[1] = 0.2 + u * 1.9; P.arm[1] = -1.45 + u * 0.15; }
      else if (pole) { P.arm[1] = -0.7 + u * 0.6; P.elbow[1] = 0.5 + u * 1.3; P.twist = 0.25 * u; }
      else { P.arm[1] = -0.95 - u * 1.9; P.elbow[1] = 1.05 + u * 0.5; P.twist = 0.3 * u; P.lean -= 0.12 * u; }
    } else if (f.swing > 0) {
      const u = f.swing / 0.28;
      if (bow) { P.elbow[1] = 0.3; }
      else if (pole) { P.arm[1] = -1.55; P.elbow[1] = 0.05; P.arm[0] = -1.3; P.elbow[0] = 0.3; P.lean += 0.15; P.twist = -0.2; }
      else { P.arm[1] = -0.35 - u * 0.3; P.elbow[1] = 0.25; P.twist = -0.35; P.lean += 0.25; }
    } else if (act?.kind === 'block') {
      P.arm = [-1.6, -1.7]; P.elbow = [1.4, 1.3]; P.armOut = [0.35, 0.35]; P.lean -= 0.08;
    } else if (act?.kind === 'dodge') {
      P.lean -= 0.3; P.twist = 0.5 * (act.side || 1); P.hipY -= 0.08; P.side = 0.15 * (act.side || 1);
    } else if (act?.kind === 'hit') {
      P.lean -= 0.35; P.headPitch = -0.35; P.armOut = [0.45, 0.45]; P.arm = [-0.2, -0.3];
    }
  }
  return P;
}

export class HumanView {
  constructor(scene, maxCount) {
    this.max = maxCount;
    this.geos = makeGeometries();
    this.mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.clothMat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
    this.meshes = {};
    for (const [name, mul] of Object.entries(PARTS)) {
      const im = new THREE.InstancedMesh(this.geos[name], name === 'cloak' ? this.clothMat : this.mat, maxCount * mul);
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.meshes[name] = im;
    }
    this.colorKey = '';
    this.mats = { root: new THREE.Matrix4(), pelvis: new THREE.Matrix4(), torso: new THREE.Matrix4(), tmp: new THREE.Matrix4(), tmp2: new THREE.Matrix4(), hand: new THREE.Matrix4() };
    this.visibleRadius = 120;
  }

  reset() { this.colorKey = ''; }
  setShadows(on) { for (const m of Object.values(this.meshes)) m.castShadow = on; }

  applyColors(people) {
    const c = new THREE.Color();
    const M = this.meshes;
    const itemColor = (e, fallback) => new THREE.Color(e && ITEMS[e.id].color !== undefined ? ITEMS[e.id].color : fallback);
    people.forEach((a, i) => {
      const L = a.look;
      const E = a.equip || {};
      const race = RACES[a.race || 'sunabito'];
      const skins = race.skin || PALETTE.skin;
      const skin = new THREE.Color(skins[L.skin % skins.length]);
      const shirt = new THREE.Color(L.accent ?? PALETTE.cloth[L.cloth]);
      const torsoC = E.body && ITEMS[E.body.id].look !== 'shirt' ? itemColor(E.body, 0x6b4a32) : E.body ? shirt : skin.clone().multiplyScalar(0.95);
      const pants = itemColor(E.legs && ITEMS[E.legs.id].look === 'pants' ? E.legs : null, PALETTE.cloth[L.pants]).multiplyScalar(0.85);
      const dead = a.state === 'dead';
      if (dead) { skin.multiplyScalar(0.7); torsoC.multiplyScalar(0.75); }
      M.headRound.setColorAt(i, skin);
      M.headBox.setColorAt(i, skin);
      M.horns.setColorAt(i, c.setHex(0xd9ccb4));
      M.torso.setColorAt(i, E.body?.id === 'iron_plate' ? shirt : torsoC);
      M.vest.setColorAt(i, torsoC);
      M.plate.setColorAt(i, itemColor(E.body, METAL));
      M.cloak.setColorAt(i, itemColor(E.outer, 0x8c7a5e));
      M.pelvis.setColorAt(i, pants);
      const sleeve = E.body ? shirt : skin;
      for (let k = 0; k < 2; k++) {
        M.upperArm.setColorAt(i * 2 + k, sleeve);
        M.foreArm.setColorAt(i * 2 + k, skin);
        M.thigh.setColorAt(i * 2 + k, pants);
        M.shin.setColorAt(i * 2 + k, pants);
        M.greave.setColorAt(i * 2 + k, itemColor(E.legs, METAL));
        for (const n of ['pUpperArm', 'pForeArm', 'pThigh', 'pShin']) M[n].setColorAt(i * 2 + k, c.setHex(METAL));
      }
      M.hat.setColorAt(i, itemColor(E.head, PALETTE.sandDark).multiplyScalar(0.9 + (i % 3) * 0.1));
      M.helm.setColorAt(i, itemColor(E.head, METAL));
      M.hood.setColorAt(i, itemColor(E.head, 0x6b5a45));
      M.pack.setColorAt(i, itemColor(E.back, PALETTE.rustDark));
      for (const n of WEAPON_PARTS) M[n].setColorAt(i, itemColor(E.weapon, 0x8a7f74));
    });
    for (const m of Object.values(M)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  update(allPeople, camFocus, time) {
    // 近くの人だけを詰めて描く（遠くの人はインスタンスを使わない＝頂点処理も省く）
    const R2 = this.visibleRadius * this.visibleRadius;
    const people = this.visible || (this.visible = []);
    people.length = 0;
    for (const a of allPeople) {
      const dx = a.x - camFocus.x, dz = a.z - camFocus.z;
      if (dx * dx + dz * dz <= R2 && people.length < this.max) people.push(a);
    }
    // 顔ぶれ・死亡・装備が変わったら色を塗り直す
    let key = '';
    for (const a of people) key += a.id + (a.state === 'dead' ? 'd' : '.') + (a.equipVer || 0) + ',';
    if (key !== this.colorKey) { this.applyColors(people); this.colorKey = key; }

    const M = this.meshes;
    const { root, pelvis, torso, tmp, tmp2, hand } = this.mats;
    const n = people.length;
    const hide = (name, idx) => M[name].setMatrixAt(idx, ZERO);

    for (let i = 0; i < n; i++) {
      const a = people[i];
      const L = a.look;
      const E = a.equip || {};
      const shape = RACES[a.race || 'sunabito'].shape;
      const P = poseFor(a, time, a.id);

      _q.setFromAxisAngle(_v.set(0, 1, 0), a.heading + (P.yawOffset || 0));
      root.compose(_v.set(a.x, heightAt(a.x, a.z), a.z), _q, _s.set(L.bulk, L.height, L.bulk));
      if (P.side) root.multiply(_t.makeTranslation(P.side, 0, 0));
      if (P.lie) { root.multiply(_t.makeTranslation(0, P.lift, 0)); root.multiply(rot(P.lie, 0, 0)); }

      child(root, 0, P.hipY, 0, 0, -P.twist * 0.5, 0, pelvis);
      M.pelvis.setMatrixAt(i, pelvis);
      child(pelvis, 0, B.pelvisH / 2 + B.torsoH / 2, 0, P.lean, P.twist, 0, torso);
      M.torso.setMatrixAt(i, torso);
      // 胴の防具・外套
      const bodyLook = E.body ? ITEMS[E.body.id].look : null;
      M.vest.setMatrixAt(i, bodyLook === 'vest' ? torso : ZERO);
      M.plate.setMatrixAt(i, bodyLook === 'plate' ? torso : ZERO);
      if (E.outer) { child(torso, 0, B.torsoH / 2 - 0.02, 0, -P.lean * 0.6, 0, 0, tmp2); M.cloak.setMatrixAt(i, tmp2); } else hide('cloak', i);

      child(torso, 0, B.torsoH / 2 + B.neck + B.headR, 0.01, P.headPitch, -P.twist * 0.4, 0, tmp);
      M.headRound.setMatrixAt(i, shape.head === 'box' ? ZERO : tmp);
      M.headBox.setMatrixAt(i, shape.head === 'box' ? tmp : ZERO);
      M.horns.setMatrixAt(i, shape.head === 'horn' && !(E.head && ITEMS[E.head.id].look === 'helm') ? tmp : ZERO);
      const headLook = E.head ? HEAD_GEAR[ITEMS[E.head.id].look] : null;
      for (const g of ['hat', 'helm', 'hood']) {
        if (headLook === g && !(g === 'hat' && P.lie && !a.carriedBy)) {
          child(tmp, 0, g === 'hat' ? B.headR * (shape.head === 'box' ? 0.9 : 0.62) : 0.01, 0, 0, 0, 0, tmp2);
          if (shape.head === 'box' && g !== 'hat') tmp2.multiply(_t.makeScale(1.15, 1.1, 1.15));
          M[g].setMatrixAt(i, tmp2);
        } else hide(g, i);
      }
      if (E.back) { child(torso, 0, 0.02, -B.torsoW * 0.62 - 0.08, 0, 0, 0, tmp2); M.pack.setMatrixAt(i, tmp2); }
      else hide('pack', i);

      let rightHand = null;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1, idx = i * 2 + k;
        const arm = a.body?.[k === 0 ? 'armL' : 'armR'];
        const armLost = arm?.lost && !arm.prosthetic, armPro = !!arm?.prosthetic;
        child(torso, side * B.shoulderX, B.torsoH / 2 - 0.05, 0, P.arm[k], 0, side * P.armOut[k], tmp);
        child(tmp, 0, -B.upperArm, 0, -P.elbow[k], 0, 0, tmp2);
        M.upperArm.setMatrixAt(idx, armLost || armPro ? ZERO : tmp);
        M.foreArm.setMatrixAt(idx, armLost || armPro ? ZERO : tmp2);
        M.pUpperArm.setMatrixAt(idx, armPro ? tmp : ZERO);
        M.pForeArm.setMatrixAt(idx, armPro ? tmp2 : ZERO);
        if (k === 1 && !armLost) { child(tmp2, 0, -B.foreArm - 0.05, 0, Math.PI / 2, 0, 0, hand); rightHand = hand; }
        const leg = a.body?.[k === 0 ? 'legL' : 'legR'];
        const legLost = leg?.lost && !leg.prosthetic, legPro = !!leg?.prosthetic;
        child(pelvis, side * B.hipX, -B.pelvisH / 2 + 0.02, 0, P.thigh[k], 0, side * P.legOut[k], tmp);
        child(tmp, 0, -B.thigh, 0, P.knee[k], 0, 0, tmp2);
        M.thigh.setMatrixAt(idx, legLost || legPro ? ZERO : tmp);
        M.shin.setMatrixAt(idx, legLost || legPro ? ZERO : tmp2);
        M.pThigh.setMatrixAt(idx, legPro ? tmp : ZERO);
        M.pShin.setMatrixAt(idx, legPro ? tmp2 : ZERO);
        M.greave.setMatrixAt(idx, !legLost && !legPro && E.legs && ITEMS[E.legs.id].look === 'greaves' ? tmp2 : ZERO);
      }
      // 武器：戦闘中は右手、それ以外は背中
      const wl = E.weapon ? 'w_' + ITEMS[E.weapon.id].look : null;
      for (const n2 of WEAPON_PARTS) {
        if (n2 !== wl || a.carriedBy || (P.lie && !a.carriedBy)) { hide(n2, i); continue; }
        if (P.weaponInHand && rightHand) M[n2].setMatrixAt(i, rightHand);
        else { child(torso, 0.06, n2 === 'w_bow' ? 0.0 : -0.15, -B.torsoW * 0.62 - (E.back ? 0.2 : 0.06), 0, 0, n2 === 'w_bow' ? 0.15 : 0.65, tmp2); M[n2].setMatrixAt(i, tmp2); }
      }
    }
    for (const [name, mul] of Object.entries(PARTS)) { M[name].count = n * mul; M[name].instanceMatrix.needsUpdate = true; }
  }
}
