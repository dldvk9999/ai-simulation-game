"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { growthOf } from "@/sim/beasts";
import type { Terrain } from "@/sim/terrain";
import type { FxType } from "@/sim/types";
import { useAmbience, useRuntime } from "./context";
import { env } from "./env";

const N = 1800;

const vert = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vA; varying vec3 vC;
void main() {
  vA = aAlpha; vC = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (300.0 / -mv.z);
}`;
const frag = /* glsl */ `
varying float vA; varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.2, d));
}`;

interface P {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; size: number; g: number; r: number; gC: number; b: number; grow: number;
}

type Spec = { n: number; colors: string[]; speed: number; up: number; life: number; size: number; g: number; spread?: number; grow?: number };
const SPECS: Partial<Record<FxType | "click" | "smoke" | "ripple" | "blaze" | "ember" | "flame", Spec>> = {
  dice: { n: 3, colors: ["#ffffff", "#ff6b6b", "#ffe066"], speed: 0.7, up: 2.2, life: 0.6, size: 0.15, g: 8 },
  flame: { n: 1, colors: ["#ffb347", "#ff7b29", "#ffe08a", "#ff4d2e", "#fff3b0"], speed: 0, up: 0, life: 0.8, size: 1.1, g: -0.6, grow: 1.4 },
  douse: { n: 26, colors: ["#d9f3ff", "#a8e0ff", "#ffffff", "#e9eef2"], speed: 2.2, up: 2.6, life: 1.1, size: 0.26, g: 6, spread: 0.6 },
  coin: { n: 8, colors: ["#ffd43b", "#f5c542", "#fff3b0"], speed: 1.2, up: 2.4, life: 0.9, size: 0.16, g: 6 },
  pray: { n: 14, colors: ["#fff3b0", "#d0bfff", "#ffffff"], speed: 0.5, up: 1.6, life: 2.2, size: 0.2, g: -0.5, spread: 0.6 },
  cry: { n: 4, colors: ["#8fd3ff", "#d9f3ff"], speed: 0.8, up: 0.6, life: 0.7, size: 0.1, g: 5 },
  blaze: { n: 1, colors: ["#4a4542", "#6b6560", "#58524d"], speed: 0.4, up: 1.8, life: 5, size: 2.2, g: -0.12, grow: 2.4 },
  ember: { n: 1, colors: ["#ffb347", "#ff7b29", "#ffe08a"], speed: 0.6, up: 2.4, life: 1.4, size: 0.12, g: -0.6 },
  hit: { n: 6, colors: ["#c9b38a", "#a89070"], speed: 1.2, up: 1.5, life: 0.6, size: 0.25, g: 4 },
  click: { n: 5, colors: ["#fff6c2", "#ffffff"], speed: 1.6, up: 1.2, life: 0.45, size: 0.18, g: 3 },
  spark: { n: 10, colors: ["#ffd166", "#ff9f1c", "#fff3b0"], speed: 2.2, up: 3.5, life: 0.7, size: 0.16, g: 6 },
  ignite: { n: 30, colors: ["#ff9f1c", "#ffd166", "#ff6b35"], speed: 2.5, up: 4, life: 1.1, size: 0.28, g: 2 },
  fizzle: { n: 10, colors: ["#9aa0a6", "#c9ced3"], speed: 0.6, up: 1.4, life: 1.5, size: 0.5, g: -0.3, grow: 1.5 },
  chip: { n: 7, colors: ["#a8a39a", "#8c877f"], speed: 2.2, up: 2.5, life: 0.7, size: 0.16, g: 9 },
  splash: { n: 14, colors: ["#d9f3ff", "#a8e0ff", "#ffffff"], speed: 1.8, up: 3.2, life: 0.8, size: 0.2, g: 8 },
  eureka: { n: 18, colors: ["#fff3b0", "#ffd166", "#ffffff"], speed: 1.2, up: 2.4, life: 1.6, size: 0.24, g: -0.4, spread: 0.6 },
  drop: { n: 6, colors: ["#ffffff", "#e9e2cf"], speed: 1.0, up: 0.8, life: 0.5, size: 0.2, g: 3 },
  complete: { n: 36, colors: ["#ff6b6b", "#ffd166", "#06d6a0", "#4dabf7", "#f783ac"], speed: 2.6, up: 5, life: 1.8, size: 0.22, g: 5 },
  birth: { n: 20, colors: ["#ff8fa3", "#ffc2d1", "#ffffff"], speed: 1.0, up: 2.0, life: 2.0, size: 0.26, g: -0.3 },
  arrive: { n: 18, colors: ["#ffffff", "#d9f3ff"], speed: 2, up: 2.5, life: 1.0, size: 0.24, g: 6 },
  catch: { n: 8, colors: ["#f1c0a8", "#ffffff"], speed: 1.3, up: 1.6, life: 0.6, size: 0.2, g: 4 },
  chop: { n: 12, colors: ["#c9a26b", "#8a5f3d", "#e0c08a"], speed: 2.4, up: 3, life: 0.8, size: 0.16, g: 9 },
  stun: { n: 6, colors: ["#ffe14d"], speed: 1.4, up: 2, life: 0.6, size: 0.16, g: 3 },
  smoke: { n: 1, colors: ["#b9b4ad", "#cfcac3"], speed: 0.25, up: 1.1, life: 3.2, size: 0.45, g: -0.05, grow: 1.4 },
  dust: { n: 16, colors: ["#b8a58a", "#a8977e", "#cbbca5"], speed: 1.6, up: 1.2, life: 2.4, size: 0.7, g: 0.2, spread: 1.4, grow: 1.6 },
  collapse: { n: 22, colors: ["#8c6a48", "#a8a39a", "#6e4a30", "#cbbca5"], speed: 2.6, up: 3, life: 1.6, size: 0.35, g: 7, spread: 1.2 },
  heal: { n: 14, colors: ["#8ce99a", "#d3f9d8", "#ffffff"], speed: 0.6, up: 1.8, life: 1.6, size: 0.22, g: -0.6, spread: 0.4 },
  clash: { n: 10, colors: ["#fff3b0", "#ffd166", "#ffffff"], speed: 2.4, up: 2.2, life: 0.6, size: 0.2, g: 4 },
  portal: { n: 40, colors: ["#9fe8ff", "#b197fc", "#ffffff"], speed: 2.2, up: 2.6, life: 1.8, size: 0.3, g: -0.4, spread: 1.6 },
  roar: { n: 20, colors: ["#8a7a66", "#a8977e", "#5f564c"], speed: 2.8, up: 0.8, life: 1.6, size: 0.5, g: 0.6, spread: 1.0, grow: 1.4 },
  shot: { n: 10, colors: ["#fff3b0", "#ffd166", "#d9d9d9"], speed: 2.0, up: 1.4, life: 0.5, size: 0.22, g: 1 },
  bite: { n: 9, colors: ["#e5484d", "#ffb3b3", "#ffffff"], speed: 1.8, up: 1.6, life: 0.6, size: 0.2, g: 5 },
  crack: { n: 14, colors: ["#8c6a48", "#a8a39a", "#cbbca5"], speed: 2.0, up: 2.4, life: 1.0, size: 0.24, g: 7, spread: 0.8 },
};

export function Effects({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const parts = useRef<P[]>([]);
  const seen = useRef(new Set<number>());
  const smokeAcc = useRef(0);
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
    return { geo: g, mat: m };
  }, []);
  const col = useMemo(() => new THREE.Color(), []);

  const spawn = (type: keyof typeof SPECS, x: number, y: number, z: number) => {
    const s = SPECS[type];
    if (!s) return;
    for (let i = 0; i < s.n && parts.current.length < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = s.speed * (0.4 + Math.random() * 0.8);
      col.set(s.colors[Math.floor(Math.random() * s.colors.length)]);
      const spread = s.spread ?? 0.15;
      parts.current.push({
        x: x + Math.cos(a) * spread, y, z: z + Math.sin(a) * spread,
        vx: Math.cos(a) * sp, vy: s.up * (0.5 + Math.random() * 0.7), vz: Math.sin(a) * sp,
        life: s.life * (0.7 + Math.random() * 0.5), max: s.life, size: s.size * (0.7 + Math.random() * 0.6),
        g: s.g, r: col.r, gC: col.g, b: col.b, grow: s.grow ?? 0,
      });
    }
  };

  /** 용의 불길: 입에서 목표까지 불꽃이 쏟아진다 */
  const stream = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number) => {
    const s = SPECS.flame!;
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const spd = len / 0.7;
    for (let i = 0; i < 110 && parts.current.length < N; i++) {
      const j = () => (Math.random() - 0.5) * 0.35;
      const lag = Math.random() * 0.25;
      col.set(s.colors[Math.floor(Math.random() * s.colors.length)]);
      parts.current.push({
        x: fx + (dx / len) * lag, y: fy + (dy / len) * lag, z: fz + (dz / len) * lag,
        vx: (dx / len + j()) * spd, vy: (dy / len + j()) * spd, vz: (dz / len + j()) * spd,
        life: 0.55 + Math.random() * 0.4, max: 0.9, size: s.size * (0.6 + Math.random() * 0.9),
        g: s.g, r: col.r, gC: col.g, b: col.b, grow: s.grow ?? 0,
      });
    }
  };

  useFrame((_, dtRaw) => {
    const w = rt.world;
    if (!w) return;
    const dt = Math.min(dtRaw, 0.05);
    // 시뮬레이션 효과
    for (const f of w.fx) {
      if (seen.current.has(f.id)) continue;
      seen.current.add(f.id);
      if (w.time - f.t > 4 * 72) continue;
      if (f.type === "lightning" || f.type === "shake") continue;
      const ground = Math.max(terrain.height(f.x, f.z), 0);
      let y = ground + 0.3;
      if (f.type === "eureka") {
        const p = w.people.find((q) => q.id === f.ref);
        y = terrain.height(p?.x ?? f.x, p?.z ?? f.z) + 2.1;
        amb?.chime();
      }
      if (f.type === "complete") {
        y = ground + 1.5;
        amb?.chime();
      }
      if (f.type === "chip" || f.type === "chop" || f.type === "hit") amb?.pop(f.type === "chop" ? 320 : 520, 0.05);
      if (f.type === "splash") amb?.pop(900, 0.04);
      if (f.type === "collapse") amb?.pop(140, 0.12);
      if (f.type === "clash") amb?.pop(420, 0.06);
      if (f.type === "heal" || f.type === "portal") amb?.chime();
      if (f.type === "heal") {
        const p = w.people.find((q) => q.id === f.ref);
        y = terrain.height(p?.x ?? f.x, p?.z ?? f.z) + 1.2;
      }
      if (f.type === "portal") y = ground + 2.4;
      if (f.type === "shot") {
        y = ground + 1.2;
        amb?.pop(90, 0.16);
      }
      if (f.type === "roar") amb?.pop(70, 0.2);
      if (f.type === "bite") {
        y = ground + 0.8;
        amb?.pop(260, 0.08);
      }
      if (f.type === "crack") {
        y = ground + 1.2;
        amb?.pop(180, 0.1);
      }
      if (f.type === "coin") {
        y = ground + 1.2;
        amb?.pop(1200, 0.03);
      }
      if (f.type === "pray") {
        y = ground + 1.4;
        amb?.chime();
      }
      if (f.type === "douse") {
        y = ground + 0.8;
        amb?.pop(700, 0.05);
      }
      if (f.type === "dice") y = ground + 1.1;
      if (f.type === "breath") {
        // 용의 머리에서 목표로
        const b = w.beasts.find((q) => q.id === f.ref);
        if (b) {
          const sc = 1.25 * (0.85 + 0.45 * growthOf(b));
          const hx = b.x + Math.cos(b.rot) * 4.0 * sc, hz = b.z + Math.sin(b.rot) * 4.0 * sc;
          const hy = Math.max(terrain.height(b.x, b.z), 0) + (b.fly ?? 1) * 6.5 + 2.45 * sc;
          stream(hx, hy, hz, f.x, ground + 0.4, f.z);
        }
        amb?.pop(60, 0.22);
        spawn("ignite", f.x, ground + 0.4, f.z);
        continue;
      }
      if (f.type === "cry") {
        const p = w.people.find((q) => q.id === f.ref);
        y = terrain.height(p?.x ?? f.x, p?.z ?? f.z) + 1.0;
      }
      spawn(f.type, f.x, y, f.z);
    }
    if (seen.current.size > 3000) seen.current.clear();
    // 화면에서 바로 보이는 클릭 반응
    for (const f of rt.localFx.splice(0)) spawn(f.type as keyof typeof SPECS, f.x, Math.max(terrain.height(f.x, f.z), 0) + 0.2, f.z);
    // 모닥불 연기
    smokeAcc.current += dt;
    if (smokeAcc.current > 0.25) {
      smokeAcc.current = 0;
      for (const s of w.structures) {
        if ((s.type === "campfire" && s.lit) || (s.type === "smelter" && s.prog >= 1)) {
          const y = terrain.height(s.x, s.z) + (s.type === "smelter" ? 2.8 : 0.9);
          spawn("smoke", s.x, y, s.z);
        }
      }
      // 불길: 짙은 연기와 불티
      for (const b of w.blazes ?? []) {
        const n = Math.ceil(b.heat * (b.sid != null ? 2 : 1 + b.r / 3));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * b.r * 0.8;
          const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
          const y = Math.max(terrain.height(x, z), 0) + (b.sid != null ? 2.4 : 1.2);
          spawn("blaze", x, y, z);
          if (Math.random() < 0.6) spawn("ember", x, y - 0.6, z);
        }
      }
    }

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const size = geo.attributes.aSize as THREE.BufferAttribute;
    const alpha = geo.attributes.aAlpha as THREE.BufferAttribute;
    const color = geo.attributes.aColor as THREE.BufferAttribute;
    const list = parts.current;
    let n = 0;
    const windX = Math.cos(env.windAngle) * env.wind * 0.6, windZ = Math.sin(env.windAngle) * env.wind * 0.6;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.g * dt;
      p.x += (p.vx + (p.grow ? windX : 0)) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + (p.grow ? windZ : 0)) * dt;
      p.vx *= 0.98;
      p.vz *= 0.98;
      const k = p.life / p.max;
      pos.setXYZ(n, p.x, p.y, p.z);
      size.setX(n, p.size * (1 + (1 - k) * p.grow));
      alpha.setX(n, Math.min(1, k * 1.6) * (p.grow ? 0.45 : 1));
      color.setXYZ(n, p.r, p.gC, p.b);
      list[n] = p;
      n++;
    }
    list.length = n;
    geo.setDrawRange(0, n);
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = color.needsUpdate = true;
  });

  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
