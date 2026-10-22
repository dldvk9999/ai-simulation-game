// 매 프레임 계산되는 하늘·빛·날씨 상태. 모든 3D 컴포넌트가 공유한다.
import * as THREE from "three";
import { hourOf, seasonOf, sunElevation } from "@/sim/clock";
import { DAY, DAYS_PER_SEASON, TIME_SCALE } from "@/sim/constants";
import { floodLevel, quakeShake } from "@/sim/disaster";
import { clamp, smoothstep } from "@/sim/noise";
import type { WorldState } from "@/sim/types";

export const env = {
  time: 0,
  hour: 12,
  sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize(),
  moonDir: new THREE.Vector3(-0.3, 0.8, -0.2).normalize(),
  sunColor: new THREE.Color(),
  sunIntensity: 2,
  moonIntensity: 0,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 1,
  skyTop: new THREE.Color(),
  skyHorizon: new THREE.Color(),
  fog: new THREE.Color(),
  fogNear: 80,
  fogFar: 420,
  day: 1,
  night: 0,
  dusk: 0,
  rain: 0,
  snowFall: 0,
  storm: 0,
  cloud: 0,
  wind: 0.3,
  windAngle: 0.6,
  snowCover: 0,
  wet: 0,
  flash: 0,
  season: 0,
  /** 0..1 계절 내 진행 */
  seasonT: 0,
  electric: false,
  /** 쓰나미로 차오른 바닷물 높이 */
  flood: 0,
  /** 지진 흔들림 0..1 */
  quake: 0,
  /** 태풍 */
  typhoon: 0,
};

const c = (hex: string) => new THREE.Color(hex);
const SKY = {
  dayTop: c("#4f9be8"), dayHor: c("#cfe8ff"),
  duskTop: c("#5a6fb8"), duskHor: c("#ffb38a"),
  nightTop: c("#070d1f"), nightHor: c("#1a2747"),
  stormTop: c("#3a4250"), stormHor: c("#6c7480"),
  snowTop: c("#9aa8ba"), snowHor: c("#dfe6ee"),
  cloudTop: c("#7d93ad"), cloudHor: c("#c7d2dd"),
};
const tmp = new THREE.Color();
const tmp2 = new THREE.Color();

let lastWorldTime = -1;
let lastWorldAt = 0;
const target = { rain: 0, snow: 0, storm: 0, cloud: 0 };

/** 실시간 렌더 시간을 부드럽게 추정 */
function renderTime(w: WorldState, now: number) {
  if (w.time !== lastWorldTime) {
    // 크게 튀면(동기화 직후) 바로 맞춘다
    const est = lastWorldTime + ((now - lastWorldAt) / 1000) * TIME_SCALE;
    if (lastWorldTime < 0 || Math.abs(est - w.time) > 600) env.time = w.time;
    lastWorldTime = w.time;
    lastWorldAt = now;
  }
  const est = lastWorldTime + ((now - lastWorldAt) / 1000) * TIME_SCALE;
  env.time += (est - env.time) * 0.15;
  return env.time;
}

export function updateEnv(w: WorldState, dt: number, now: number) {
  const t = renderTime(w, now);
  env.hour = hourOf(t);
  const e = sunElevation(t);
  const h = env.hour;
  // 태양은 동쪽(+x)에서 떠서 서쪽으로
  const ang = ((h - 6) / 13.5) * Math.PI;
  env.sunDir.set(Math.cos(ang), Math.max(-0.4, Math.sin(ang)) * 0.95 + 0.05, 0.35).normalize();
  env.moonDir.set(-Math.cos(ang), Math.max(0.15, -Math.sin(ang)) + 0.1, -0.3).normalize();
  env.day = smoothstep(-0.12, 0.3, e);
  env.night = 1 - smoothstep(-0.25, 0.05, e);
  env.dusk = Math.max(0, 1 - Math.abs(e) / 0.32) * (1 - env.night * 0.6);
  env.season = seasonOf(t);
  env.seasonT = ((t / DAY) % DAYS_PER_SEASON) / DAYS_PER_SEASON;

  const W = w.weather;
  target.rain = W.type === "rain" ? 0.55 : W.type === "storm" ? 1 : 0;
  target.snow = W.type === "snow" ? 1 : 0;
  target.storm = W.type === "storm" ? 1 : 0;
  target.cloud = W.type === "clear" ? 0.12 : W.type === "cloudy" ? 0.75 : W.type === "snow" ? 0.8 : 1;
  const k = 1 - Math.exp(-dt * 0.6);
  env.rain += (target.rain - env.rain) * k;
  env.snowFall += (target.snow - env.snowFall) * k;
  env.storm += (target.storm - env.storm) * k;
  env.cloud += (target.cloud - env.cloud) * k;
  env.wind += (W.wind - env.wind) * k;
  env.windAngle += 0.002 * dt;
  env.snowCover += (W.snow - env.snowCover) * (1 - Math.exp(-dt * 0.3));
  env.wet += (W.wet - env.wet) * (1 - Math.exp(-dt * 0.3));
  env.flash = Math.max(0, env.flash - dt * 5);
  env.electric = w.tech.known.includes("electricity");
  env.flood = floodLevel(w, t);
  env.quake = quakeShake(w, t);
  const ty = w.disaster?.type === "typhoon" && t >= w.disaster.start && t <= w.disaster.until ? 1 : 0;
  env.typhoon += (ty - env.typhoon) * k;

  const gloom = clamp(env.cloud * 0.35 + env.rain * 0.3 + env.storm * 0.35, 0, 1);
  // 하늘
  tmp.copy(SKY.nightTop).lerp(SKY.duskTop, smoothstep(-0.25, 0.0, e)).lerp(SKY.dayTop, smoothstep(0.0, 0.35, e));
  tmp2.copy(SKY.nightHor).lerp(SKY.duskHor, smoothstep(-0.25, 0.0, e)).lerp(SKY.dayHor, smoothstep(0.05, 0.4, e));
  const grey = env.snowFall > 0.3 ? SKY.snowTop : env.storm > 0.3 ? SKY.stormTop : SKY.cloudTop;
  const greyH = env.snowFall > 0.3 ? SKY.snowHor : env.storm > 0.3 ? SKY.stormHor : SKY.cloudHor;
  const dim = 0.25 + 0.75 * env.day;
  env.skyTop.copy(tmp).lerp(tmpC(grey, dim), gloom);
  env.skyHorizon.copy(tmp2).lerp(tmpC(greyH, dim), gloom);
  env.fog.copy(env.skyHorizon);
  env.fogNear = 60 - gloom * 30 - env.snowFall * 15;
  env.fogFar = 460 - gloom * 220 - env.snowFall * 120;

  // 빛
  env.sunColor.set("#ffffff").lerp(c2("#ffb070"), env.dusk * 0.85);
  env.sunIntensity = 2.6 * env.day * (1 - gloom * 0.7);
  env.moonIntensity = 0.35 * env.night * (1 - gloom * 0.6);
  env.hemiSky.copy(env.skyTop).lerp(c2("#ffffff"), 0.35);
  env.hemiGround.set("#5f6b45").lerp(c2("#1b2232"), env.night);
  env.hemiIntensity = 0.35 + 0.75 * env.day * (1 - gloom * 0.3) + env.flash * 3;
}

const tmpCol = new THREE.Color();
function tmpC(col: THREE.Color, mul: number) {
  return tmpCol.copy(col).multiplyScalar(mul);
}
const c2Cache = new Map<string, THREE.Color>();
function c2(hex: string) {
  let v = c2Cache.get(hex);
  if (!v) c2Cache.set(hex, (v = new THREE.Color(hex)));
  return v;
}

/** 렌더용으로 부드럽게 따라가는 위치 */
export function follow(cur: { x: number; z: number }, x: number, z: number, dt: number, rate = 9) {
  const dx = x - cur.x, dz = z - cur.z;
  if (dx * dx + dz * dz > 400) {
    cur.x = x;
    cur.z = z;
    return;
  }
  const k = 1 - Math.exp(-dt * rate);
  cur.x += dx * k;
  cur.z += dz * k;
}

export function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
