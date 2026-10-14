// 空・霧・光・昼夜サイクル（描画層）
import * as THREE from 'three';
import { DAY_KEYS } from '../data/config.js';

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999; // 常に最遠
}`;
const SKY_FS = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunVis;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uTop, t);
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(s, 700.0) * 3.0 + pow(s, 12.0) * 0.25) * uSunVis;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tmpA = new THREE.Color(), tmpB = new THREE.Color();

function sampleKeys(hour) {
  let i = 0;
  while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1].h <= hour) i++;
  const a = DAY_KEYS[i], b = DAY_KEYS[i + 1];
  const t = (hour - a.h) / (b.h - a.h);
  const mix = (ka, kb, key) => tmpA.setHex(ka[key]).lerp(tmpB.setHex(kb[key]), t).clone();
  return {
    sun: mix(a, b, 'sun'), sky: mix(a, b, 'sky'), ground: mix(a, b, 'ground'),
    fog: mix(a, b, 'fog'), top: mix(a, b, 'top'),
    sunI: a.sunI + (b.sunI - a.sunI) * t,
    hemiI: a.hemiI + (b.hemiI - a.hemiI) * t,
    fogK: a.fogK + (b.fogK - a.fogK) * t,
  };
}

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.fog = new THREE.Fog(0xd8c3a0, 40, 200);
    scene.fog = this.fog;

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunVis: { value: 1 },
      },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sunDir = new THREE.Vector3();
    this.fogColor = new THREE.Color();
    this.shadowRange = 55;
  }

  setShadows(enabled, mapSize) {
    this.sun.castShadow = enabled;
    if (enabled) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      const c = this.sun.shadow.camera;
      const r = this.shadowRange;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 400;
      c.updateProjectionMatrix();
    }
  }

  // hour: 0..24, focus: 影を落とす中心（カメラ注視点）, fogFar: 画質ごとの霧距離
  update(hour, focus, cameraPos, fogFar, camDist = 40, weather = null) {
    const k = sampleKeys(hour);
    // 天候：霧を濃く・色を寄せ・日差しを弱める
    if (weather && weather.i > 0.001 && weather.def.tint) {
      const wi = weather.i;
      tmpA.setHex(weather.def.tint);
      // 夜は天気の色も暗くする
      const dark = Math.min(1, k.sunI / 2.2 + 0.25);
      tmpA.multiplyScalar(dark);
      k.fog.lerp(tmpA, wi * 0.85);
      k.top.lerp(tmpA, wi * 0.7);
      k.fogK *= 1 + (weather.def.fogMul - 1) * wi;
      k.sunI *= 1 + (weather.def.sunMul - 1) * wi;
      k.hemiI *= 1 - 0.15 * wi;
    }
    // 太陽：6時に東から昇り18時に西へ沈む
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang), Math.max(elev, -0.3) * 0.95, 0.35).normalize();
    // 夜は月明かり（太陽の反対側・高めの角度）
    const lightDir = elev > -0.02 ? this.sunDir.clone() : new THREE.Vector3(-0.4, 0.8, -0.45).normalize();
    if (elev > -0.02 && lightDir.y < 0.12) lightDir.y = 0.12; // 夕方の長い影（地平線すれすれ）

    this.hemi.color.copy(k.sky);
    this.hemi.groundColor.copy(k.ground);
    this.hemi.intensity = k.hemiI;
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.sunI;

    // 影カメラを注視点に追従（テクセル単位でスナップしてちらつき防止）
    const snap = (this.shadowRange * 2) / (this.sun.shadow.mapSize.x || 1024);
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + lightDir.x * 160, focus.y + lightDir.y * 160, fz + lightDir.z * 160);
    this.sun.target.updateMatrixWorld();

    this.fogColor.copy(k.fog);
    this.fog.color.copy(k.fog);
    // 霧はカメラからの距離で効くため、ズームアウト時は注視点までの距離ぶん奥へずらす
    this.fog.far = camDist + fogFar * k.fogK;
    this.fog.near = camDist * 0.85 + fogFar * k.fogK * 0.12;
    this.scene.background = k.fog;

    this.skyMat.uniforms.uTop.value.copy(k.top);
    this.skyMat.uniforms.uHorizon.value.copy(k.fog);
    this.skyMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.skyMat.uniforms.uSunColor.value.copy(k.sun);
    this.skyMat.uniforms.uSunVis.value = Math.max(0, Math.min(1, elev * 5 + 0.3)) * (1 - 0.85 * (weather?.def?.tint ? weather.i : 0));
    this.sky.position.copy(cameraPos);
    this.sky.scale.setScalar(50);
    this.isNight = hour >= 19.5 || hour < 5;
    return k;
  }
}
