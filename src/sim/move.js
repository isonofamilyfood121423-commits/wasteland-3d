// 移動の共通処理：経路の計画・再計画・停止（ロジック層）
import { findPath } from './pathfind.js';

export function clearTask(p) {
  p.task = null;
  p.resting = false;
  p.inBed = null;
}

export function planPath(w, p, gx, gz, quiet = false) {
  p.goal = { x: gx, z: gz };
  p.replans = 0;
  p.lastPlanDist = Infinity;
  p.quietPath = quiet;
  replan(w, p);
  return !!p.goal;
}

export function replan(w, p) {
  const res = findPath(p.x, p.z, p.goal.x, p.goal.z);
  if (!res || !res.points.length) {
    if (p.kind === 'party' && !p.quietPath && Math.hypot(p.goal.x - p.x, p.goal.z - p.z) > 2 && !p.task) w.addLogFn?.(`${p.name}：そこへは行けない。`);
    p.path = []; p.goal = null;
    return;
  }
  p.path = res.points;
  p.partial = !res.reached;
}

// 近くなら経路探索を使わずまっすぐ向かう（戦闘中の追いかけ用）
export function chase(w, p, x, z) {
  const d = Math.hypot(x - p.x, z - p.z);
  if (d < 10) { p.path = [{ x, z }]; p.goal = { x, z }; p.partial = false; return; }
  p.chaseTimer = (p.chaseTimer || 0) - 1;
  if (!p.goal || p.chaseTimer <= 0 || Math.hypot(p.goal.x - x, p.goal.z - z) > 3) {
    p.chaseTimer = 10;
    planPath(w, p, x, z, true);
  }
}

export function stopPerson(p) {
  p.path = []; p.goal = null; clearTask(p);
  p.retreat = false;
  if (p.fight) { p.fight.target = null; p.fight.ordered = false; }
}
