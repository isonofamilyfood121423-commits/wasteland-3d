// ゲームロジックの状態（地面平面 x,z 上のシミュレーション）。描画には依存しない
import { mulberry32 } from '../core/rng.js';
import { slopeAt } from './terrain.js';
import { findSpawn } from './worldgen.js';
import { TIME, CROWD, PALETTE } from '../data/config.js';

export function createWorld(seed) {
  const rnd = mulberry32(seed);
  const spawn = findSpawn();
  const agents = [];
  for (let i = 0; i < CROWD.count; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * CROWD.spawnRadius;
    const x = spawn.x + Math.cos(a) * r, z = spawn.z + Math.sin(a) * r;
    agents.push({
      id: i,
      x, z, heading: rnd() * 6.28,
      homeX: x, homeZ: z,
      tx: x, tz: z,
      speed: 0, maxSpeed: CROWD.walkSpeed[0] + rnd() * (CROWD.walkSpeed[1] - CROWD.walkSpeed[0]),
      idle: rnd() * 3,
      phase: rnd() * 6.28,
      // 見た目のパラメータ（造形は描画層が解釈する）
      look: {
        skin: Math.floor(rnd() * PALETTE.skin.length),
        cloth: Math.floor(rnd() * PALETTE.cloth.length),
        pants: Math.floor(rnd() * PALETTE.cloth.length),
        hat: rnd() < 0.45,
        pack: rnd() < 0.35,
        height: 0.92 + rnd() * 0.16,
        bulk: 0.9 + rnd() * 0.25,
      },
    });
  }
  return {
    seed,
    spawn,
    rnd,
    hour: TIME.startHour,
    day: 1,
    timeScale: 1,      // 0=一時停止
    debugFast: false,
    agents,
  };
}

// dt: 現実の経過秒
export function stepWorld(w, dt) {
  const scale = w.timeScale * (w.debugFast ? TIME.debugFastForward : 1);
  if (scale <= 0) return;
  const gdt = dt * scale; // ゲーム内の経過秒（移動などはこちら）

  w.hour += (gdt / TIME.realSecondsPerDay) * 24;
  while (w.hour >= 24) { w.hour -= 24; w.day++; }

  // 早送り中の移動は物理的に破綻しないよう分割
  const sub = Math.min(20, Math.max(1, Math.ceil(gdt / 0.1)));
  const h = gdt / sub;
  for (let s = 0; s < sub; s++) for (const a of w.agents) stepAgent(w, a, h);
}

function stepAgent(w, a, dt) {
  const dx = a.tx - a.x, dz = a.tz - a.z;
  const dist = Math.hypot(dx, dz);
  if (a.idle > 0) {
    a.idle -= dt;
    a.speed = Math.max(0, a.speed - dt * 3);
    if (a.idle <= 0) pickTarget(w, a);
  } else if (dist < 0.6) {
    a.idle = 1 + w.rnd() * 5;
  } else {
    const want = Math.atan2(dx, dz);
    let d = want - a.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.heading += Math.max(-dt * 4, Math.min(dt * 4, d));
    // 仕様判断：斜面では速度を落とす（Phase 1 の経路コストと同じ考え方）
    const slow = 1 / (1 + slopeAt(a.x, a.z) * 1.5);
    const target = a.maxSpeed * slow * (Math.abs(d) > 1.2 ? 0.3 : 1);
    a.speed += (target - a.speed) * Math.min(1, dt * 3);
    a.x += Math.sin(a.heading) * a.speed * dt;
    a.z += Math.cos(a.heading) * a.speed * dt;
  }
  a.phase += a.speed * dt * 3.2;
}

function pickTarget(w, a) {
  for (let i = 0; i < 6; i++) {
    const ang = w.rnd() * 6.28, r = 6 + w.rnd() * 40;
    const x = a.homeX + Math.cos(ang) * r, z = a.homeZ + Math.sin(ang) * r;
    if (slopeAt(x, z) < 0.9) { a.tx = x; a.tz = z; return; }
  }
  a.tx = a.homeX; a.tz = a.homeZ;
}
