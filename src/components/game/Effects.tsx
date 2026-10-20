"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Terrain } from "@/sim/terrain";
import type { FxType } from "@/sim/types";
import { useAmbience, useRuntime } from "./context";
import { env } from "./env";

const N = 900;

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
const SPECS: Partial<Record<FxType | "click" | "smoke" | "ripple", Spec>> = {
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
      spawn(f.type, f.x, y, f.z);
    }
    if (seen.current.size > 3000) seen.current.clear();
    // 화면에서 바로 보이는 클릭 반응
    for (const f of rt.localFx.splice(0)) spawn(f.type as keyof typeof SPECS, f.x, terrain.height(f.x, f.z) + 0.2, f.z);
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
