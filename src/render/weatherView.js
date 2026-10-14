// 天候の粒（砂嵐の砂・酸性雨・灰）を描く（描画層。ロジックの天気を読むだけ）
// カメラの注視点のまわりの箱の中で線分を流し、箱から出たら反対側へ戻す
import * as THREE from 'three';

const BOX = 46, HIGH = 26;

export class WeatherView {
  constructor(scene, max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.seed = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      this.seed[i * 3] = (Math.random() - 0.5) * BOX * 2;
      this.seed[i * 3 + 1] = Math.random() * HIGH;
      this.seed[i * 3 + 2] = (Math.random() - 0.5) * BOX * 2;
    }
    this.geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);
    this.count = 600;
    this.t = 0;
  }

  setCount(n) { this.count = Math.min(this.max, n); }

  // weather: { def, i } / focus: 注視点
  update(dt, weather, focus) {
    const def = weather?.def, P = def?.particle;
    if (!P || weather.i < 0.02) { this.lines.visible = false; return; }
    this.lines.visible = true;
    this.t += dt;
    const n = Math.round(this.count * weather.i);
    this.geo.setDrawRange(0, n * 2);
    this.mat.color.setHex(P.color);
    this.mat.opacity = 0.25 + 0.4 * weather.i;
    const [wx, wz] = P.wind;
    const vx = wx * P.speed, vz = wz * P.speed, vy = -P.fall;
    const len = P.len / Math.hypot(vx, vy, vz);
    const span = BOX * 2;
    const wrap = (v) => ((v % span) + span * 1.5) % span - BOX;
    const fx = focus.x, fz = focus.z, fy = focus.y || 0;
    const t = this.t;
    for (let i = 0; i < n; i++) {
      const sx = this.seed[i * 3], sy = this.seed[i * 3 + 1], sz = this.seed[i * 3 + 2];
      // 時間で流す（箱の中で巡回）。注視点の格子に合わせて固定し、カメラを動かしても流れが崩れない
      const x = wrap(sx + vx * t - fx) + fx;
      const z = wrap(sz + vz * t - fz) + fz;
      const y = fy + (((sy + vy * t) % HIGH) + HIGH) % HIGH - 4;
      const o = i * 6;
      this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
      this.pos[o + 3] = x - vx * len; this.pos[o + 4] = y - vy * len; this.pos[o + 5] = z - vz * len;
    }
    this.attr.needsUpdate = true;
  }
}
