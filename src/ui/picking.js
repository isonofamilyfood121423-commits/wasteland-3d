// 画面上のタップ位置 → 地面の座標・人物（当たり判定は見た目より大きめ）
import * as THREE from 'three';
import { heightAt } from '../sim/terrain.js';
import { INPUT } from '../data/config.js';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const v = new THREE.Vector3();

// 地形（高さ関数）とレイの交点を、粗い刻みで進めてから二分探索で求める
export function screenToGround(camera, x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let t0 = 0, step = 1.5;
  let prevAbove = o.y > heightAt(o.x, o.z);
  for (let t = step; t < 1500; t += step) {
    const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
    const above = py > heightAt(px, pz);
    if (prevAbove && !above) {
      let a = t0, b = t;
      for (let i = 0; i < 18; i++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m > heightAt(o.x + d.x * m, o.z + d.z * m)) a = m; else b = m;
      }
      return { x: o.x + d.x * b, z: o.z + d.z * b };
    }
    prevAbove = above; t0 = t;
    step = Math.min(6, step * 1.04);
  }
  return null;
}

export function worldToScreen(camera, x, y, z) {
  v.set(x, y, z).project(camera);
  if (v.z > 1) return null;
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}

// タップ地点の近くにいる人物を近い順に返す（足元〜頭のどこでもよい）
export function pickPeople(camera, people, x, y, radius = INPUT.pickRadius) {
  const hits = [];
  for (const p of people) {
    const gy = heightAt(p.x, p.z);
    const feet = worldToScreen(camera, p.x, gy + 0.1, p.z);
    const head = worldToScreen(camera, p.x, gy + 1.8, p.z);
    if (!feet || !head) continue;
    // 足元と頭を結ぶ線分までの距離
    const sx = head.x - feet.x, sy = head.y - feet.y;
    const len2 = sx * sx + sy * sy || 1;
    const t = Math.max(0, Math.min(1, ((x - feet.x) * sx + (y - feet.y) * sy) / len2));
    const dx = x - (feet.x + sx * t), dy = y - (feet.y + sy * t);
    const d = Math.hypot(dx, dy);
    if (d <= radius) hits.push({ p, d });
  }
  hits.sort((a, b) => a.d - b.d);
  return hits.map((h) => h.p);
}

export function peopleInRect(camera, people, x0, y0, x1, y1) {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  return people.filter((p) => {
    const s = worldToScreen(camera, p.x, heightAt(p.x, p.z) + 0.9, p.z);
    return s && s.x >= l - 12 && s.x <= r + 12 && s.y >= t - 12 && s.y <= b + 12;
  });
}
