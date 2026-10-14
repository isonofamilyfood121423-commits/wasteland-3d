// フレーム計測・解像度の自動調整・初回の画質自動判定
import { DYN_RES } from '../data/config.js';

export class FrameStats {
  constructor() { this.samples = []; this.fps = 60; this.ms = 16.7; }
  push(dt) {
    this.samples.push(dt);
    if (this.samples.length > 60) this.samples.shift();
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.ms = avg * 1000;
    this.fps = 1 / avg;
  }
}

// フレームが落ちたら描画解像度を下げ、余裕があれば戻す
export class DynamicResolution {
  constructor() { this.scale = 1; this.low = 0; this.high = 0; this.enabled = true; }
  update(dt, fps) {
    if (!this.enabled) { this.scale = 1; return false; }
    let changed = false;
    if (fps < DYN_RES.lowFps) { this.low += dt; this.high = 0; } else if (fps > DYN_RES.highFps) { this.high += dt; this.low = 0; } else { this.low = 0; this.high = 0; }
    if (this.low > DYN_RES.lowWindow && this.scale > DYN_RES.minScale) {
      this.scale = Math.max(DYN_RES.minScale, this.scale - DYN_RES.step); this.low = 0; changed = true;
    }
    if (this.high > DYN_RES.highWindow && this.scale < 1) {
      this.scale = Math.min(1, this.scale + DYN_RES.step); this.high = 0; changed = true;
    }
    return changed;
  }
}

// 初回起動時の画質判定：中で計測 → 余裕があれば高も試す
export class QualityProbe {
  constructor(onDecide) {
    this.onDecide = onDecide;
    this.stage = 'mid';
    this.t = 0; this.frames = 0; this.acc = 0;
    this.done = false;
  }
  update(dt, setQuality) {
    if (this.done) return;
    this.t += dt;
    if (this.t < 1.2) return; // 読み込み直後は除外
    this.frames++; this.acc += dt;
    if (this.t < 4.2) return;
    const fps = this.frames / this.acc;
    if (this.stage === 'mid') {
      if (fps < 38) return this.finish('low');
      if (fps > 56) { this.stage = 'high'; this.reset(); setQuality('high'); return; }
      return this.finish('mid');
    }
    if (this.stage === 'high') return this.finish(fps > 48 ? 'high' : 'mid');
  }
  reset() { this.t = 0; this.frames = 0; this.acc = 0; }
  finish(q) { this.done = true; this.onDecide(q); }
}
