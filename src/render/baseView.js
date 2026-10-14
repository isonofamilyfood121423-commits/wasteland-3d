// 拠点の建物（完成・建設中）、畑の作物、門の扉、風車の羽根、配置の下書き（プレビュー）の描画
// ロジック層の w.base を表示するだけ。種類ごとに InstancedMesh を1つ持つ
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS } from '../data/build.js';
import { heightAt } from '../sim/terrain.js';

const C = (hex) => new THREE.Color(hex);
class Geo {
  constructor() { this.parts = []; }
  add(g, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    g = g.index ? g.toNonIndexed() : g;
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
    g.translate(x, y, z);
    const c = C(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    this.parts.push(g);
    return this;
  }
  box(w, h, d, x, y, z, color, ry = 0) { return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, 0, ry); }
  cyl(r0, r1, h, x, y, z, color, seg = 7) { return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), color, x, y + h / 2, z); }
  done() { const g = mergeGeometries(this.parts); g.computeVertexNormals(); return g; }
}

const STONE = 0xa39a8a, WOOD = 0x6b5340, CLOTH = 0x8c7a5e, IRON = 0x6f6a64, DARK = 0x3a2c22;

// 種類ごとの造形（原点＝足元の中心、幅は x 方向、奥行きは z 方向）
function shape(type) {
  const B = BUILDINGS[type], g = new Geo();
  const W = B.w, D = B.d;
  g.box(W + 0.2, 1.6, D + 0.2, 0, -1.55, 0, 0x8f7a5c); // 土台（斜面に合わせて地中まで）
  switch (type) {
    case 'storage':
      g.box(1.6, 0.9, 1.6, 0, 0, 0, WOOD).box(1.7, 0.12, 1.7, 0, 0.9, 0, 0x5c4636).box(0.8, 0.6, 0.8, 0.3, 1.02, -0.2, 0x7a5a3c);
      break;
    case 'bed':
      g.box(1.0, 0.25, 1.9, 0, 0, 0, WOOD).box(0.9, 0.12, 1.8, 0, 0.25, 0, CLOTH).box(0.7, 0.12, 0.35, 0, 0.37, -0.65, 0xd8d0b8);
      break;
    case 'hut': {
      const wall = 0xc2a77e, H = 2.6;
      g.box(W, H, 0.3, 0, 0, -D / 2 + 0.15, wall).box(0.3, H, D, -W / 2 + 0.15, 0, 0, wall).box(0.3, H, D, W / 2 - 0.15, 0, 0, wall);
      g.box((W - 1.8) / 2, H, 0.3, -(W + 1.8) / 4, 0, D / 2 - 0.15, wall).box((W - 1.8) / 2, H, 0.3, (W + 1.8) / 4, 0, D / 2 - 0.15, wall);
      g.box(W + 0.6, 0.25, D + 0.6, 0, H, 0, 0x9c845f).box(1.8, 0.4, 0.3, 0, H - 0.4, D / 2 - 0.15, wall);
      break;
    }
    case 'wall':
      g.box(2, 3, 0.9, 0, 0, 0, STONE).box(0.6, 0.5, 1.0, -0.6, 3, 0, 0x8f877a).box(0.6, 0.5, 1.0, 0.6, 3, 0, 0x8f877a);
      break;
    case 'gate': case 'gate_iron': {
      const post = type === 'gate' ? WOOD : IRON;
      g.box(0.5, 3.4, 0.9, -1.75, 0, 0, STONE).box(0.5, 3.4, 0.9, 1.75, 0, 0, STONE).box(4, 0.5, 0.9, 0, 3.1, 0, post);
      break;
    }
    case 'well':
      g.cyl(0.9, 1.0, 0.9, 0, 0, 0, STONE).cyl(0.65, 0.65, 0.92, 0, 0.02, 0, 0x2a3036).box(0.15, 1.8, 0.15, -0.8, 0, 0, WOOD).box(0.15, 1.8, 0.15, 0.8, 0, 0, WOOD).box(1.9, 0.15, 0.3, 0, 1.8, 0, WOOD);
      break;
    case 'farm':
      g.box(W, 0.2, D, 0, -0.1, 0, 0x5d4436);
      for (let i = 0; i < 5; i++) g.box(W - 0.4, 0.12, 0.4, 0, 0.05, -D / 2 + 0.8 + i * 1.1, 0x4a372b);
      break;
    case 'cookstove':
      g.box(1.6, 0.8, 1.2, 0, 0, 0, STONE).box(0.3, 1.4, 0.3, 0.55, 0.8, -0.35, 0x8f877a).cyl(0.3, 0.25, 0.3, -0.2, 0.8, 0, IRON).box(0.5, 0.2, 0.3, -0.2, 0.3, 0.61, 0xd8823f);
      break;
    case 'research':
      g.box(1.8, 0.1, 1.0, 0, 0.8, 0, WOOD).box(0.1, 0.8, 0.1, -0.8, 0, -0.4, WOOD).box(0.1, 0.8, 0.1, 0.8, 0, -0.4, WOOD).box(0.1, 0.8, 0.1, -0.8, 0, 0.4, WOOD).box(0.1, 0.8, 0.1, 0.8, 0, 0.4, WOOD)
        .box(0.5, 0.05, 0.35, -0.3, 0.9, 0, 0xd8d0b8).box(0.4, 0.3, 0.3, 0.45, 0.9, -0.1, 0x7d8387).box(0.12, 0.25, 0.12, 0.6, 0.9, 0.25, 0xe9b47a);
      break;
    case 'smelter':
      g.box(3.4, 2.2, 3.4, 0, 0, 0, 0x8f877a).box(1.0, 2.5, 1.0, 0.9, 2.2, -0.9, 0x7a7266).box(1.2, 0.7, 0.2, 0, 0.3, 1.71, 0xd8823f).box(3.6, 0.3, 3.6, 0, 2.2, 0, 0x6e675d);
      break;
    case 'generator':
      g.box(0.5, 5.5, 0.5, 0, 0, 0, IRON).box(1.6, 0.25, 1.6, 0, 0, 0, STONE).box(0.6, 0.6, 1.2, 0, 5.4, 0, 0x5c5650);
      break;
    case 'mine':
      g.box(0.3, 3.4, 0.3, -1.6, 0, -1.6, IRON).box(0.3, 3.4, 0.3, 1.6, 0, -1.6, IRON).box(0.3, 3.4, 0.3, -1.6, 0, 1.6, IRON).box(0.3, 3.4, 0.3, 1.6, 0, 1.6, IRON)
        .box(3.6, 0.3, 3.6, 0, 3.3, 0, 0x5c5650).cyl(0.35, 0.2, 3.0, 0, 0.3, 0, 0x8a7f74).box(1.2, 0.8, 1.2, 0, 2.2, 0, 0x7a4630);
      break;
    case 'forge':
      g.box(3.6, 0.9, 1.4, 0, 0, 0, WOOD).box(0.6, 0.45, 0.4, -0.9, 0.9, 0, IRON).box(0.3, 0.3, 0.3, -0.9, 1.35, 0, IRON).box(0.12, 1.4, 0.12, 1.2, 0.9, -0.4, WOOD).box(0.05, 0.9, 0.12, 1.0, 1.1, -0.4, 0xa9a49c);
      break;
    case 'armorer':
      g.box(3.6, 0.9, 1.4, 0, 0, 0, WOOD).box(0.5, 0.7, 0.3, 1.0, 0.9, 0, IRON).box(0.08, 0.6, 0.08, 1.0, 1.6, 0, WOOD).box(0.9, 0.08, 0.6, -0.8, 0.9, 0, CLOTH);
      break;
    case 'tower': {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(0.3, 6, 0.3, sx * 0.8, 0, sz * 0.8, WOOD);
      g.box(2.4, 0.25, 2.4, 0, 6, 0, WOOD).box(2.4, 0.8, 0.15, 0, 6.25, -1.15, WOOD).box(2.4, 0.8, 0.15, 0, 6.25, 1.15, WOOD).box(0.15, 0.8, 2.4, 1.15, 6.25, 0, WOOD);
      const roof = new THREE.ConeGeometry(1.9, 1.2, 4); g.add(roof, 0x7a4b34, 0, 7.7, 0, 0, Math.PI / 4);
      break;
    }
    case 'cage':
      for (let i = 0; i < 6; i++) { const t = -0.9 + i * 0.36; g.box(0.06, 2.2, 0.06, t, 0, -0.9, IRON).box(0.06, 2.2, 0.06, t, 0, 0.9, IRON).box(0.06, 2.2, 0.06, -0.9, 0, t, IRON).box(0.06, 2.2, 0.06, 0.9, 0, t, IRON); }
      g.box(1.9, 0.12, 1.9, 0, 2.2, 0, IRON);
      break;
    default:
      g.box(W, B.h, D, 0, 0, 0, STONE);
  }
  return g.done();
}

export class BaseView {
  constructor(scene) {
    this.scene = scene;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.siteMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.42, depthWrite: false });
    this.done = {}; this.sites = {};
    this.geos = {};
    for (const t of Object.keys(BUILDINGS)) {
      this.geos[t] = shape(t);
      const cap = t === 'wall' ? 600 : 48;
      for (const [dict, mat] of [[this.done, this.mat], [this.sites, this.siteMat]]) {
        const im = new THREE.InstancedMesh(this.geos[t], mat, cap);
        im.count = 0; im.frustumCulled = false; im.castShadow = mat === this.mat; im.receiveShadow = true;
        scene.add(im); dict[t] = im;
      }
    }
    // 門の扉・風車の羽根・作物
    const door = new Geo().box(3.0, 2.8, 0.25, 0, 0.2, 0, 0x5c4636).box(3.0, 0.2, 0.3, 0, 1.4, 0.05, IRON).done();
    this.doors = new THREE.InstancedMesh(door, this.mat, 48); this.doors.count = 0; this.doors.frustumCulled = false; scene.add(this.doors);
    const blades = new Geo().box(0.25, 3.2, 0.05, 0, -1.6, 0, 0xd8d0b8).box(3.2, 0.25, 0.05, -1.6, -0.12, 0, 0xd8d0b8).done();
    this.blades = new THREE.InstancedMesh(blades, this.mat, 32); this.blades.count = 0; this.blades.frustumCulled = false; scene.add(this.blades);
    const crop = new Geo().add(new THREE.ConeGeometry(0.18, 1, 4), 0xffffff, 0, 0.5, 0).done();
    this.cropMat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.crops = new THREE.InstancedMesh(crop, this.cropMat, 48 * 16); this.crops.count = 0; this.crops.frustumCulled = false; scene.add(this.crops);
    // 下書き（緑＝置ける／赤＝置けない）
    this.preMat = new THREE.MeshBasicMaterial({ color: 0x6fd27a, transparent: true, opacity: 0.45, depthWrite: false });
    this.preview = new THREE.Mesh(this.geos.storage, this.preMat);
    this.preview.visible = false; this.preview.renderOrder = 3;
    scene.add(this.preview);
    this.wallPre = new THREE.InstancedMesh(this.geos.wall, this.preMat, 80); this.wallPre.count = 0; this.wallPre.frustumCulled = false; this.wallPre.renderOrder = 3; scene.add(this.wallPre);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    this.ver = -1;
  }

  matFor(b, scaleY = 1) {
    const { m, q, v, s } = this;
    const ry = b.wallSeg ? -b.angle : -(b.rot || 0) * Math.PI / 2;
    q.setFromAxisAngle(v.set(0, 1, 0), ry);
    const y = b.ground ?? heightAt(b.x, b.z);
    m.compose(v.set(b.x, y, b.z), q, s.set(b.wallSeg ? b.len / 2 : 1, scaleY, 1));
    return m;
  }

  update(world, time) {
    const base = world.base;
    const counts = {}, scounts = {};
    for (const t of Object.keys(BUILDINGS)) { counts[t] = 0; scounts[t] = 0; }
    let doors = 0, blades = 0, crops = 0;
    if (base) {
      for (const b of base.buildings) {
        const B = BUILDINGS[b.type];
        if (b.done) {
          const im = this.done[b.type];
          if (counts[b.type] >= im.instanceMatrix.count) continue;
          im.setMatrixAt(counts[b.type]++, this.matFor(b));
          if (B.gate && !b.open) this.doors.setMatrixAt(doors++, this.matFor(b));
          if (b.type === 'generator') {
            const { m, q, v, s } = this;
            const y = (b.ground ?? heightAt(b.x, b.z)) + 5.7;
            q.setFromEuler(new THREE.Euler(0, -(b.rot || 0) * Math.PI / 2, time * 2.2));
            m.compose(v.set(b.x, y, b.z), q, s.set(1, 1, 1));
            // 羽根は2枚を十字に（もう1組は90度ずらす）
            this.blades.setMatrixAt(blades++, m);
            q.setFromEuler(new THREE.Euler(0, -(b.rot || 0) * Math.PI / 2, time * 2.2 + Math.PI));
            m.compose(v, q, s); this.blades.setMatrixAt(blades++, m);
          }
          if (b.type === 'farm' && b.crop.stage !== 'empty') {
            const ripe = b.crop.stage === 'ripe';
            const hgt = ripe ? 1 : 0.15 + b.crop.t * 0.75;
            const y = b.ground ?? heightAt(b.x, b.z);
            for (let i = 0; i < 16 && crops < 48 * 16; i++) {
              const ox = ((i % 4) - 1.5) * 1.3, oz = (Math.floor(i / 4) - 1.5) * 1.3;
              this.m.compose(this.v.set(b.x + ox, y + 0.05, b.z + oz), this.q.identity(), this.s.set(1, hgt, 1));
              this.crops.setMatrixAt(crops, this.m);
              this.crops.setColorAt(crops, this.c.setHex(ripe ? 0xd8b64a : 0x7f8a3a));
              crops++;
            }
          }
        } else {
          const im = this.sites[b.type];
          if (scounts[b.type] >= im.instanceMatrix.count) continue;
          im.setMatrixAt(scounts[b.type]++, this.matFor(b, Math.max(0.12, b.progress / B.work)));
        }
      }
    }
    for (const t of Object.keys(BUILDINGS)) {
      this.done[t].count = counts[t]; this.done[t].instanceMatrix.needsUpdate = true; this.done[t].visible = counts[t] > 0;
      this.sites[t].count = scounts[t]; this.sites[t].instanceMatrix.needsUpdate = true; this.sites[t].visible = scounts[t] > 0;
    }
    this.doors.visible = doors > 0; this.blades.visible = blades > 0; this.crops.visible = crops > 0;
    this.doors.count = doors; this.doors.instanceMatrix.needsUpdate = true;
    this.blades.count = blades; this.blades.instanceMatrix.needsUpdate = true;
    this.crops.count = crops; this.crops.instanceMatrix.needsUpdate = true;
    if (this.crops.instanceColor) this.crops.instanceColor.needsUpdate = true;
  }

  // 下書き：type の建物を (x,z,rot) に。walls があれば壁の区画を並べる
  showPreview(type, x, z, rot, ok, walls = null) {
    this.preMat.color.setHex(ok ? 0x6fd27a : 0xe0533f);
    if (walls) {
      this.preview.visible = false;
      walls.slice(0, 80).forEach((b, i) => this.wallPre.setMatrixAt(i, this.matFor({ ...b, wallSeg: true })));
      this.wallPre.count = Math.min(80, walls.length); this.wallPre.instanceMatrix.needsUpdate = true;
      return;
    }
    this.wallPre.count = 0;
    this.preview.geometry = this.geos[type];
    this.preview.visible = true;
    this.preview.position.set(x, heightAt(x, z) + 0.05, z);
    this.preview.rotation.set(0, -rot * Math.PI / 2, 0);
  }
  hidePreview() { this.preview.visible = false; this.wallPre.count = 0; }
  setShadows(on) { for (const im of Object.values(this.done)) im.castShadow = on; }
}
