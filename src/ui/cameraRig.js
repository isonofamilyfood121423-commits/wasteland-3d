// 斜め見下ろしカメラと指操作（1本指ドラッグ=移動 / ピンチ=ズーム / 2本指ひねり=水平回転）
import * as THREE from 'three';
import { CAMERA, WORLD } from '../data/config.js';
import { heightAt } from '../sim/terrain.js';
import { clamp } from '../core/rng.js';

export class CameraRig {
  constructor(camera, el) {
    this.camera = camera;
    this.el = el;
    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = 0.6;
    this.pitch = CAMERA.startPitch;
    this.dist = CAMERA.startDist;
    this.vel = new THREE.Vector2();
    this.follow = null;     // () => {x,z} を返す関数
    this.pointers = new Map();
    this.prev = null;
    this.smoothY = 0;
    this.onTap = null;

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
  }

  down(e) {
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.prev = this.snapshot();
    this.vel.set(0, 0);
  }

  snapshot() {
    const p = [...this.pointers.values()];
    if (p.length === 1) return { n: 1, x: p[0].x, y: p[0].y };
    if (p.length >= 2) {
      const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
      return { n: 2, x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
    }
    return null;
  }

  move(e) {
    const pt = this.pointers.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX; pt.y = e.clientY;
    const now = this.snapshot();
    const prev = this.prev;
    if (!now || !prev || now.n !== prev.n) { this.prev = now; return; }
    if (now.n === 1) {
      this.pan(now.x - prev.x, now.y - prev.y);
    } else {
      // ピンチ（ズーム）
      if (prev.d > 0) this.dist = clamp(this.dist * (prev.d / now.d), CAMERA.minDist, CAMERA.maxDist);
      // ひねり（水平回転）
      let da = now.a - prev.a;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      this.yaw -= da;
      // 2本指の上下移動で俯角を調整（範囲は制限）
      this.pitch = clamp(this.pitch + (now.y - prev.y) * 0.004, CAMERA.minPitch, CAMERA.maxPitch);
      this.pan(now.x - prev.x, 0);
    }
    this.prev = now;
  }

  up(e) {
    const pt = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (pt && this.pointers.size === 0) {
      const moved = Math.hypot(pt.x - pt.sx, pt.y - pt.sy);
      if (moved < 10 && performance.now() - pt.t < 350 && this.onTap) this.onTap(pt.x, pt.y);
    }
    this.prev = this.snapshot();
  }

  pan(dx, dy) {
    if (this.follow) this.follow = null; // 手動で動かしたら追従解除
    const k = (this.dist * 1.6) / this.el.clientHeight;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const mx = (-dx * c - dy * s) * k * 0.9;
    const mz = (dx * s - dy * c) * k * 0.9;
    this.target.x += mx; this.target.z += mz;
    this.vel.set(mx, mz);
    if (this.onManualMove) this.onManualMove();
  }

  update(dt) {
    if (this.pointers.size === 0 && this.vel.lengthSq() > 1e-6) {
      this.target.x += this.vel.x; this.target.z += this.vel.y;
      this.vel.multiplyScalar(Math.pow(CAMERA.panInertia, dt * 60));
    }
    if (this.follow) {
      const f = this.follow();
      this.target.x += (f.x - this.target.x) * Math.min(1, dt * 5);
      this.target.z += (f.z - this.target.z) * Math.min(1, dt * 5);
    }
    this.target.x = clamp(this.target.x, -WORLD.limit, WORLD.limit);
    this.target.z = clamp(this.target.z, -WORLD.limit, WORLD.limit);
    const gy = heightAt(this.target.x, this.target.z);
    this.smoothY += (gy - this.smoothY) * Math.min(1, dt * 4);
    this.target.y = this.smoothY;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cam = this.camera;
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // 地面にめり込まない
    const floor = heightAt(cam.position.x, cam.position.z) + 2;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.target.x, this.target.y + 1, this.target.z);
  }
}
