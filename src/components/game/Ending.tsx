"use client";
// 엔딩 연출: 미사일과 버섯구름, 우주선 발사, 차원문과 외계 생명체, 영생의 빛기둥.
// 모두 엔딩 상태와 시각만으로 그리므로 함께 보는 관찰자마다 같은 장면이 보인다.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { HOUR } from "@/sim/constants";
import { alienViews, ALIENS, startOf } from "@/sim/ending";
import { clamp } from "@/sim/noise";
import type { Terrain } from "@/sim/terrain";
import type { Ending as EndingState, WorldState } from "@/sim/types";
import { useHud } from "@/game/hud";
import { useAmbience, useRuntime, useWorldVersion } from "./context";
import { camState } from "./Controls";
import { env } from "./env";
import { G, merge, part, vcMat } from "./geo";

// ─── 연기 · 불꽃 알갱이 ────────────────────────────────────────────────

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
  gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.15, d));
}`;

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; r: number; g: number; b: number; a: number }

class Puffs {
  readonly geo = new THREE.BufferGeometry();
  readonly mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
  private list: Puff[] = [];
  private col = new THREE.Color();
  constructor(private max: number) {
    const a = (n: number) => new THREE.BufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", a(3));
    this.geo.setAttribute("aSize", a(1));
    this.geo.setAttribute("aAlpha", a(1));
    this.geo.setAttribute("aColor", a(3));
  }
  emit(x: number, y: number, z: number, o: { v?: [number, number, number]; life: number; size: number; grow?: number; color: string; alpha?: number; jitter?: number }) {
    if (this.list.length >= this.max) return;
    const j = o.jitter ?? 0;
    this.col.set(o.color);
    const [vx, vy, vz] = o.v ?? [0, 0, 0];
    this.list.push({
      x: x + (Math.random() - 0.5) * j, y: y + (Math.random() - 0.5) * j, z: z + (Math.random() - 0.5) * j,
      vx, vy, vz, life: o.life, max: o.life, size: o.size, grow: o.grow ?? 0, r: this.col.r, g: this.col.g, b: this.col.b, a: o.alpha ?? 0.8,
    });
  }
  update(dt: number) {
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const size = this.geo.attributes.aSize as THREE.BufferAttribute;
    const alpha = this.geo.attributes.aAlpha as THREE.BufferAttribute;
    const color = this.geo.attributes.aColor as THREE.BufferAttribute;
    let n = 0;
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.985;
      p.vz *= 0.985;
      const k = p.life / p.max;
      pos.setXYZ(n, p.x, p.y, p.z);
      size.setX(n, p.size * (1 + (1 - k) * p.grow));
      alpha.setX(n, p.a * Math.min(1, k * 2));
      color.setXYZ(n, p.r, p.g, p.b);
      this.list[n++] = p;
    }
    this.list.length = n;
    this.geo.setDrawRange(0, n);
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = color.needsUpdate = true;
  }
}

const glow = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const smoke = (color: string, opacity = 0.9) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

/** 엔딩마다 한 번씩 이 장면이 잘 보이게 시점을 옮긴다 (따라가던 사람이 있으면 그대로) */
function useDirector(e: EndingState, frame: (ph: number) => { x: number; z: number; dist: number; pitch: number; lift?: number; yaw?: number } | null) {
  const last = useRef("");
  useFrame(() => {
    const cur = useHud.getState();
    const key = `${e.t0}:${e.ph}:${e.done ?? ""}`;
    if (last.current === key) return;
    last.current = key;
    if (e.done != null) camState.lift = 0;
    if (e.done != null || cur.followId != null || cur.panel !== "none") return;
    const f = frame(e.ph);
    if (!f) return;
    camState.tx = f.x;
    camState.tz = f.z;
    camState.dist = f.dist;
    camState.pitch = f.pitch;
    camState.lift = f.lift ?? 0;
    if (f.yaw != null) camState.yaw = f.yaw;
  });
}

// ─── 핵전쟁 ────────────────────────────────────────────────────────────

const missileGeo = merge([
  part(G.cyl(0.35, 0.35, 3.2, 6), { color: "#e9ecef", rot: [0, 0, -Math.PI / 2] }),
  part(G.cone(0.35, 1.0, 6), { color: "#d9534f", pos: [2.1, 0, 0], rot: [0, 0, -Math.PI / 2] }),
  part(G.box, { color: "#868e96", pos: [-1.4, 0, 0], scale: [0.6, 0.9, 0.08] }),
  part(G.box, { color: "#868e96", pos: [-1.4, 0, 0], scale: [0.6, 0.08, 0.9] }),
]);

function Nuke({ e, terrain }: { e: EndingState; terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const puffs = useMemo(() => new Puffs(1400), []);
  const missiles = useRef<(THREE.Mesh | null)[]>([]);
  const fire = useRef<THREE.Mesh>(null);
  const wave = useRef<THREE.Mesh>(null);
  const stem = useRef<THREE.Mesh>(null);
  const cap = useRef<THREE.Mesh>(null);
  const roll = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => ({ fire: glow("#fff1b8"), wave: glow("#ffd8a8", 0.7), stem: smoke("#8a7462"), cap: smoke("#9a8370"), roll: smoke("#7d6a5a"), hot: new THREE.Color("#ffb066") }), []);
  const boom = useRef(false);
  const foeDir = useMemo(() => {
    const w = rt.world;
    const n = w?.nations.find((x) => x.name === e.foe);
    return n ? n.dir : Math.atan2(w?.camp.z ?? 1, w?.camp.x ?? 0);
  }, [rt, e.foe]);
  // 미사일이 섬 너머에서 날아오는 게 보이게 적국 반대편에서 바라본다
  const back = Math.atan2(-Math.cos(foeDir), -Math.sin(foeDir));
  useDirector(e, (ph) => (ph === 0 ? { x: e.x, z: e.z, dist: 70, pitch: 0.55 } : ph === 1 ? { x: e.x, z: e.z, dist: 140, pitch: 0.12, lift: 36, yaw: back } : { x: e.x, z: e.z, dist: 150, pitch: 0.2, lift: 24 }));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = env.time;
    const B = startOf(e, 2), S1 = startOf(e, 1);
    const ground = Math.max(terrain.height(e.x, e.z), 0);
    // 미사일: 바다 건너에서 셋이 날아오고, 섬에서도 둘이 맞받아 쏘아 올린다
    const paths = [
      { a: foeDir - 0.25, l: S1 + 60, d: B, out: false, ox: -7 },
      { a: foeDir, l: S1 + 300, d: B, out: false, ox: 0 },
      { a: foeDir + 0.25, l: S1 + 540, d: B, out: false, ox: 7 },
      { a: foeDir + Math.PI * 0.85, l: S1 + 150, d: S1 + 1500, out: true, ox: 12 },
      { a: foeDir - Math.PI * 0.85, l: S1 + 700, d: S1 + 2000, out: true, ox: -12 },
    ];
    paths.forEach((m, i) => {
      const mesh = missiles.current[i];
      if (!mesh) return;
      const s = (t - m.l) / (m.d - m.l);
      if (s < 0 || s >= 1 || e.done != null) {
        mesh.visible = false;
        return;
      }
      const far = { x: e.x + Math.cos(m.a) * 340, z: e.z + Math.sin(m.a) * 340 };
      const near = { x: e.x + m.ox, z: e.z + m.ox * 0.5 };
      const [a, b] = m.out ? [near, far] : [far, near];
      const y0 = m.out ? ground : 40, y1 = m.out ? 90 : ground;
      const at = (k: number) => new THREE.Vector3(a.x + (b.x - a.x) * k, y0 + (y1 - y0) * k + Math.sin(Math.PI * k) * (m.out ? 60 : 70), a.z + (b.z - a.z) * k);
      const p = at(s), q = at(Math.min(1, s + 0.01));
      mesh.visible = true;
      mesh.position.copy(p);
      mesh.lookAt(q);
      mesh.rotateY(-Math.PI / 2);
      puffs.emit(p.x, p.y, p.z, { life: 8, size: 5, grow: 2.5, color: "#d9d4cc", alpha: 0.75, jitter: 1.2 });
      if (m.out && s < 0.03) puffs.emit(p.x, ground + 1, p.z, { v: [(Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 6], life: 3, size: 5, grow: 1.5, color: "#d6d0c6", alpha: 0.6 });
    });
    // 폭발
    const tau = t - B;
    const fade = e.done != null ? clamp(1 - (t - e.done) / (8 * HOUR), 0, 1) : 1;
    const on = tau >= 0 && fade > 0;
    if (on && !boom.current) {
      boom.current = true;
      amb?.pop(38, 0.6);
      amb?.pop(70, 0.4);
    }
    if (tau < 0) boom.current = false;
    if (fire.current) {
      const k = clamp(tau / 600, 0, 1);
      fire.current.visible = on && k < 1;
      fire.current.position.set(e.x, ground + 6 + k * 10, e.z);
      fire.current.scale.setScalar(4 + 26 * Math.sqrt(k));
      mats.fire.opacity = 1 - k;
    }
    if (wave.current) {
      const k = clamp(tau / 900, 0, 1);
      wave.current.visible = on && k < 1;
      wave.current.position.set(e.x, ground + 0.6, e.z);
      wave.current.scale.setScalar(2 + 170 * Math.pow(k, 0.6));
      mats.wave.opacity = 0.75 * (1 - k);
    }
    const H = 8 + 66 * (1 - Math.exp(-Math.max(0, tau) / 1500));
    const R = 6 + 22 * (1 - Math.exp(-Math.max(0, tau) / 1800));
    const hot = Math.exp(-Math.max(0, tau) / 700);
    const cloudOp = 0.92 * fade;
    for (const [m, mat, base] of [[stem.current, mats.stem, "#8a7462"], [cap.current, mats.cap, "#9a8370"], [roll.current, mats.roll, "#7d6a5a"]] as const) {
      if (!m) continue;
      m.visible = on;
      mat.color.set(base).lerp(mats.hot, hot * 0.85);
      mat.opacity = cloudOp;
    }
    if (on) {
      stem.current?.position.set(e.x, ground + H / 2, e.z);
      stem.current?.scale.set(R * 0.22, H, R * 0.22);
      cap.current?.position.set(e.x, ground + H, e.z);
      cap.current?.scale.set(R, R * 0.55, R);
      roll.current?.position.set(e.x, ground + H - R * 0.25, e.z);
      roll.current?.scale.setScalar(R);
      if (tau < 1200 && Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2;
        puffs.emit(e.x + Math.cos(a) * R * 0.6, ground + 2, e.z + Math.sin(a) * R * 0.6, { v: [Math.cos(a) * 14, 1.5, Math.sin(a) * 14], life: 4, size: 7, grow: 1.6, color: "#a08a74", alpha: 0.5 });
      }
    }
    // 무너진 마을에서 피어오르는 연기 · 잿빛 눈
    const w: WorldState | null = rt.world;
    if (w && tau >= 0 && env.ash > 0.05) {
      if (Math.random() < env.ash * 0.6) {
        const ruins = w.structures.filter((s) => (s.dmg ?? 0) >= 0.6);
        const s = ruins[Math.floor(Math.random() * ruins.length)];
        if (s) puffs.emit(s.x, terrain.height(s.x, s.z) + 1.5, s.z, { v: [0.4, 2.2, 0.2], life: 6, size: 2.5, grow: 2.2, color: "#5c534c", alpha: 0.5, jitter: 1.5 });
      }
      const c = camState.cur;
      for (let i = 0; i < 3 * env.ash; i++) {
        puffs.emit(c.tx + (Math.random() - 0.5) * 70, 26 + Math.random() * 10, c.tz + (Math.random() - 0.5) * 70, { v: [0.6, -2.2, 0.3], life: 11, size: 0.22, color: "#d8d2c8", alpha: 0.75 });
      }
    }
    env.rumble = on ? Math.max(0, 1.4 * (1 - tau / 900)) : 0;
    puffs.update(dt);
  });

  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} ref={(m) => { missiles.current[i] = m; }} geometry={missileGeo} material={vcMat} scale={2.6} visible={false} />
      ))}
      <mesh ref={fire} material={mats.fire} visible={false}>
        <sphereGeometry args={[1, 20, 14]} />
      </mesh>
      <mesh ref={wave} material={mats.wave} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.85, 1, 48]} />
      </mesh>
      <mesh ref={stem} material={mats.stem} visible={false}>
        <cylinderGeometry args={[0.8, 1.3, 1, 12, 1, true]} />
      </mesh>
      <mesh ref={cap} material={mats.cap} visible={false}>
        <sphereGeometry args={[1, 18, 12]} />
      </mesh>
      <mesh ref={roll} material={mats.roll} rotation-x={Math.PI / 2} visible={false}>
        <torusGeometry args={[0.85, 0.32, 10, 24]} />
      </mesh>
      <points geometry={puffs.geo} material={puffs.mat} frustumCulled={false} />
    </group>
  );
}

// ─── 우주선 ────────────────────────────────────────────────────────────

const padGeo = merge([
  part(G.cyl(4.8, 5.1, 0.35, 16), { color: "#8f9399", pos: [0, 0.17, 0] }),
  part(G.cyl(2.2, 2.2, 0.06, 16), { color: "#f0c419", pos: [0, 0.37, 0] }),
  // 발사탑: 기둥 넷과 가로대, 우주선으로 뻗은 팔
  ...[[-2.4, -0.5], [-2.4, 0.5], [-3.4, -0.5], [-3.4, 0.5]].map(([x, z]) => part(G.box, { color: "#c0392b", pos: [x, 6.6, z], scale: [0.18, 13, 0.18] })),
  ...[2, 5, 8, 11].map((y) => part(G.box, { color: "#a93226", pos: [-2.9, y, 0], scale: [1.2, 0.14, 1.2] })),
  part(G.box, { color: "#7f8c8d", pos: [-1.6, 8.6, 0], scale: [1.6, 0.25, 0.5] }),
  part(G.box, { color: "#7f8c8d", pos: [-1.6, 4.4, 0], scale: [1.6, 0.25, 0.5] }),
]);
const rocketGeo = merge([
  part(G.cyl(0.95, 0.95, 8, 14), { color: "#f4f4f2", pos: [0, 5, 0] }),
  part(G.cyl(0.97, 0.97, 0.45, 14), { color: "#d9534f", pos: [0, 7.6, 0] }),
  part(G.cyl(0.97, 0.97, 0.3, 14), { color: "#3d4a5c", pos: [0, 2.2, 0] }),
  part(G.cone(0.95, 2.8, 14), { color: "#d9534f", pos: [0, 10.4, 0] }),
  part(G.sphere(0.22, 8, 6), { color: "#5fb4e8", pos: [0.86, 8.4, 0] }),
  part(G.sphere(0.22, 8, 6), { color: "#5fb4e8", pos: [0.86, 6.6, 0] }),
  ...[0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    return part(G.box, { color: "#d9534f", pos: [Math.cos(a) * 1.25, 1.7, Math.sin(a) * 1.25], scale: [0.12, 2.4, 1.1], rot: [0, -a, 0] });
  }),
  part(G.cyl(0.45, 0.75, 0.9, 10), { color: "#3b3f45", pos: [0, 0.55, 0] }),
]);

function Rocket({ e, terrain }: { e: EndingState; terrain: Terrain }) {
  const amb = useAmbience();
  const puffs = useMemo(() => new Puffs(1400), []);
  const rocket = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Group>(null);
  const mats = useMemo(() => ({ flame: glow("#ffa94d", 0.9), core: glow("#fff3bf", 0.95) }), []);
  const lit = useRef(false);
  const ground = terrain.height(e.x, e.z);
  // 발사대는 마을 쪽을 바라본다
  const face = useMemo(() => Math.atan2(e.z, e.x), [e.x, e.z]);
  useDirector(e, (ph) => (ph === 0 ? { x: e.x, z: e.z, dist: 46, pitch: 0.42 } : ph === 3 ? { x: e.x, z: e.z, dist: 110, pitch: 0.22 } : null));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = env.time;
    const r = rocket.current;
    if (!r) return;
    const t0 = startOf(e, 0);
    // 처음에는 땅속에서 천천히 들어 올려 세운다
    const rise = clamp((t - t0) / (0.4 * HOUR), 0, 1);
    let h = 0;
    const launch = e.ph === 3 && e.done == null ? t - e.ts[3] : -1;
    if (launch >= 0) h = 0.00012 * launch * launch;
    r.visible = e.done == null && h < 900;
    r.position.set(e.x, ground + 0.35 - (1 - rise) * 11 + h, e.z);
    const burning = launch >= 0;
    const countdown = e.ph === 2 && e.done == null;
    if (flame.current) {
      flame.current.visible = burning;
      const f = 0.85 + Math.random() * 0.3;
      flame.current.scale.set(f, f * (1 + Math.min(1.5, launch / 900)), f);
    }
    if (burning && !lit.current) {
      lit.current = true;
      amb?.pop(45, 0.5);
    }
    if (!burning) lit.current = false;
    // 발사 준비: 바닥에서 하얀 김
    if (countdown && Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2;
      puffs.emit(e.x + Math.cos(a) * 1.5, ground + 0.8, e.z + Math.sin(a) * 1.5, { v: [Math.cos(a) * 3, 0.8, Math.sin(a) * 3], life: 3, size: 2.5, grow: 1.5, color: "#f1f3f5", alpha: 0.6 });
    }
    if (burning) {
      const y = ground + h;
      for (let i = 0; i < (h < 30 ? 4 : 2); i++) {
        puffs.emit(e.x, y, e.z, { v: [(Math.random() - 0.5) * 2, -3 - Math.random() * 2, (Math.random() - 0.5) * 2], life: h < 30 ? 6 : 9, size: h < 30 ? 4.5 : 3, grow: 2.2, color: h < 30 ? "#dee2e6" : "#f1f3f5", alpha: 0.65, jitter: 0.8 });
      }
      if (h < 12) {
        const a = Math.random() * Math.PI * 2;
        puffs.emit(e.x, ground + 0.8, e.z, { v: [Math.cos(a) * 12, 0.6, Math.sin(a) * 12], life: 5, size: 6, grow: 1.8, color: "#ced4da", alpha: 0.6 });
      }
    }
    env.rumble = burning ? clamp(0.9 - h / 160, 0, 0.9) : countdown ? 0.15 : 0;
    // 하늘로 오르는 우주선을 눈으로 좇는다
    if (burning && useHud.getState().followId == null) camState.lift = Math.min(110, h * 0.85);
    else if (e.done != null) camState.lift = 0;
    puffs.update(dt);
  });

  return (
    <group>
      <mesh geometry={padGeo} material={vcMat} position={[e.x, ground, e.z]} rotation-y={-face} receiveShadow castShadow />
      <group ref={rocket} rotation-y={-face}>
        <mesh geometry={rocketGeo} material={vcMat} castShadow />
        <group ref={flame} position-y={0.1} visible={false}>
          <mesh material={mats.flame} position-y={-2.2} rotation-x={Math.PI}>
            <coneGeometry args={[0.85, 4.4, 10, 1, true]} />
          </mesh>
          <mesh material={mats.core} position-y={-1.2} rotation-x={Math.PI}>
            <coneGeometry args={[0.45, 2.2, 8]} />
          </mesh>
        </group>
      </group>
      <points geometry={puffs.geo} material={puffs.mat} frustumCulled={false} />
    </group>
  );
}

// ─── 차원문 침공 ───────────────────────────────────────────────────────

const alienGeo = merge([
  part(G.box, { color: "#5f7f5a", pos: [0, 0.36, 0.12], scale: [0.13, 0.72, 0.13] }),
  part(G.box, { color: "#5f7f5a", pos: [0, 0.36, -0.12], scale: [0.13, 0.72, 0.13] }),
  part(G.box, { color: "#7fa878", pos: [0, 0.98, 0], scale: [0.32, 0.6, 0.44] }),
  part(G.box, { color: "#7fa878", pos: [0.05, 0.98, 0.3], scale: [0.1, 0.55, 0.1], rot: [0, 0, -0.5] }),
  part(G.box, { color: "#7fa878", pos: [0.05, 0.98, -0.3], scale: [0.1, 0.55, 0.1], rot: [0, 0, -0.5] }),
  part(G.box, { color: "#3d4a5c", pos: [0.42, 1.1, -0.3], scale: [0.5, 0.1, 0.1] }),
  part(G.box, { color: "#93c08a", pos: [0, 1.36, 0], scale: [0.1, 0.18, 0.1] }),
  part(G.sphere(0.38, 10, 8), { color: "#b7e0a8", pos: [0.02, 1.68, 0], scale: [0.9, 1.15, 1] }),
  ...[-0.13, 0, 0.13].map((z) => part(G.sphere(0.075, 6, 4), { color: "#111418", pos: [0.31, 1.72 + (z === 0 ? 0.08 : 0), z], scale: [0.6, 1.3, 1] })),
]);

const swirlVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const swirlFrag = /* glsl */ `
uniform float uTime; uniform float uOpen;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float s = sin(a * 5.0 + r * 9.0 - uTime * 3.0) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.42, 0.2, 0.75), vec3(0.45, 0.95, 1.0), s * (1.0 - r));
  gl_FragColor = vec4(col, (0.55 + 0.4 * s) * smoothstep(1.0, 0.6, r) * uOpen);
}`;

function Invasion({ e, terrain }: { e: EndingState; terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const portal = useRef<THREE.Group>(null);
  const aliens = useRef<(THREE.Group | null)[]>([]);
  const beams = useRef<(THREE.Mesh | null)[]>([]);
  const beamLife = useRef<number[]>(Array(14).fill(0));
  const mats = useMemo(() => ({
    ring: glow("#b197fc", 0.9),
    swirl: new THREE.ShaderMaterial({ vertexShader: swirlVert, fragmentShader: swirlFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uOpen: { value: 1 } } }),
    body: Array.from({ length: ALIENS }, () => { const m = vcMat.clone(); m.transparent = true; return m; }),
    green: glow("#69f0ae", 0.95),
    gold: glow("#ffe066", 0.95),
  }), []);
  const camp = rt.world?.camp ?? { x: 0, z: 0 };
  const face = Math.atan2(camp.z - e.z, camp.x - e.x);
  const ground = terrain.height(e.x, e.z);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion() }), []);
  const land = useMemo(() => (x: number, z: number) => terrain.height(x, z) > 0.4 && !terrain.inPond(x, z), [terrain]);
  useDirector(e, (ph) => (ph === 0 ? { x: (e.x + camp.x) / 2, z: (e.z + camp.z) / 2, dist: 62, pitch: 0.45 } : ph === 2 ? { x: camp.x, z: camp.z, dist: 42, pitch: 0.5 } : null));

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = env.time;
    const w = rt.world;
    if (!w) return;
    // 이기면 차원문이 닫힌다
    const close = e.win ? clamp((t - startOf(e, 2)) / (0.3 * HOUR), 0, 1) : 0;
    const open = clamp((t - e.t0) / (0.15 * HOUR), 0, 1) * (1 - close);
    if (portal.current) {
      portal.current.visible = open > 0.01;
      portal.current.scale.setScalar(Math.max(0.01, open));
      portal.current.rotation.z = state.clock.elapsedTime * 0.3;
    }
    mats.swirl.uniforms.uTime.value = state.clock.elapsedTime;
    mats.swirl.uniforms.uOpen.value = open;
    const views = e.win && e.done != null ? [] : alienViews(e, w.camp, t, land);
    const fighting: THREE.Vector3[] = [];
    for (const g of aliens.current) if (g) g.visible = false;
    for (const v of views) {
      const i = v.i;
      const g = aliens.current[i];
      if (!g) continue;
      g.visible = true;
      const y = Math.max(terrain.height(v.x, v.z), 0);
      const tt = state.clock.elapsedTime * 6 + i;
      const walking = v.st === 0;
      g.position.set(v.x, y + (walking ? Math.abs(Math.sin(tt)) * 0.12 : 0) - (v.st === 2 ? v.fade * 0.6 : 0), v.z);
      g.rotation.set(0, -v.rot, v.st === 2 ? -Math.PI / 2 * Math.min(1, v.fade * 4) : walking ? Math.sin(tt) * 0.08 : 0);
      mats.body[i].opacity = v.st === 2 ? 1 - v.fade : 1;
      if (v.st === 1) fighting.push(new THREE.Vector3(v.x, y + 1.1, v.z));
    }
    // 광선: 외계 생명체는 초록, 섬 사람들은 노란 총알
    const shooters = w.people.filter((p) => p.alive && p.act?.k === "scene" && p.act.sub === "front" && p.act.ph === 1);
    if (fighting.length && shooters.length && e.ph === 1 && Math.random() < dt * 9) {
      const i = beamLife.current.findIndex((l) => l <= 0);
      const b = beams.current[i];
      if (b) {
        const a = fighting[Math.floor(Math.random() * fighting.length)];
        const p = shooters[Math.floor(Math.random() * shooters.length)];
        const fromAlien = Math.random() < 0.5;
        const man = new THREE.Vector3(p.x, terrain.height(p.x, p.z) + 1.2, p.z);
        tmp.a.copy(fromAlien ? a : man);
        tmp.b.copy(fromAlien ? man : a);
        const len = tmp.a.distanceTo(tmp.b);
        b.position.copy(tmp.a).lerp(tmp.b, 0.5);
        b.quaternion.setFromUnitVectors(tmp.up, tmp.b.clone().sub(tmp.a).normalize());
        b.scale.set(1, len, 1);
        b.material = fromAlien ? mats.green : mats.gold;
        b.visible = true;
        beamLife.current[i] = 0.14;
        if (fromAlien) amb?.pop(1400, 0.025);
      }
    }
    beamLife.current.forEach((l, i) => {
      beamLife.current[i] = l - dt;
      const b = beams.current[i];
      if (b && l - dt <= 0) b.visible = false;
    });
  });

  return (
    <group>
      <group position={[e.x, ground + 5.4, e.z]} rotation-y={-face + Math.PI / 2}>
        <group ref={portal}>
          <mesh material={mats.ring}>
            <torusGeometry args={[5, 0.45, 10, 40]} />
          </mesh>
          <mesh material={mats.swirl}>
            <circleGeometry args={[4.8, 40]} />
          </mesh>
        </group>
      </group>
      {Array.from({ length: ALIENS }, (_, i) => (
        <group key={i} ref={(g) => { aliens.current[i] = g; }} visible={false}>
          <mesh geometry={alienGeo} material={mats.body[i]} castShadow />
        </group>
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={`b${i}`} ref={(m) => { beams.current[i] = m; }} material={mats.green} visible={false}>
          <cylinderGeometry args={[0.06, 0.06, 1, 5]} />
        </mesh>
      ))}
    </group>
  );
}

// ─── 영생의 빛 ─────────────────────────────────────────────────────────

function Pillar({ e, terrain }: { e: EndingState; terrain: Terrain }) {
  const puffs = useMemo(() => new Puffs(900), []);
  const beam = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(() => ({ outer: glow("#ffe8a3", 0.22), inner: glow("#fff9db", 0.5), rings: [0, 1, 2].map(() => glow("#ffd43b", 0.6)) }), []);
  const ground = terrain.height(e.x, e.z);
  useDirector(e, (ph) => (ph === 0 ? { x: e.x, z: e.z, dist: 44, pitch: 0.5 } : ph === 1 ? { x: e.x, z: e.z, dist: 62, pitch: 0.3 } : null));

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = env.time;
    const on = e.done == null && e.ph >= 1;
    const k = on ? (e.ph === 1 ? clamp((t - e.ts[1]) / (0.1 * HOUR), 0, 1) : clamp(1 - (t - e.ts[2]) / (0.5 * HOUR), 0, 1)) : 0;
    const pulse = 0.85 + Math.sin(state.clock.elapsedTime * 2.2) * 0.15;
    if (beam.current) {
      beam.current.visible = k > 0.01;
      beam.current.scale.set(k * pulse, 1, k * pulse);
    }
    rings.current.forEach((m, i) => {
      if (!m) return;
      const s = (state.clock.elapsedTime * 0.25 + i / 3) % 1;
      m.visible = k > 0.01;
      m.position.y = ground + 0.3 + s * 14;
      m.scale.setScalar(3 + s * 9);
      mats.rings[i].opacity = 0.6 * (1 - s) * k;
    });
    if (k > 0.1 && Math.random() < 0.9) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 14;
      puffs.emit(e.x + Math.cos(a) * r, ground + 0.5, e.z + Math.sin(a) * r, { v: [0, 2.5 + Math.random() * 2, 0], life: 4, size: 0.35, color: Math.random() < 0.5 ? "#fff3bf" : "#ffe066", alpha: 0.9 });
    }
    puffs.update(dt);
  });

  return (
    <group>
      <group ref={beam} position={[e.x, ground + 110, e.z]} visible={false}>
        <mesh material={mats.outer}>
          <cylinderGeometry args={[3.4, 3.4, 220, 24, 1, true]} />
        </mesh>
        <mesh material={mats.inner}>
          <cylinderGeometry args={[1.2, 1.2, 220, 16, 1, true]} />
        </mesh>
      </group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { rings.current[i] = m; }} position={[e.x, ground, e.z]} rotation-x={Math.PI / 2} material={mats.rings[i]} visible={false}>
          <torusGeometry args={[1, 0.04, 6, 40]} />
        </mesh>
      ))}
      <points geometry={puffs.geo} material={puffs.mat} frustumCulled={false} />
    </group>
  );
}

function RobotDawn({ e }: { e: EndingState }) {
  const rt = useRuntime();
  useDirector(e, (ph) => (ph === 0 ? { x: rt.world?.camp.x ?? 0, z: rt.world?.camp.z ?? 0, dist: 50, pitch: 0.5 } : null));
  return null;
}

export function EndingFx({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  useWorldVersion(300);
  const e = rt.world?.ending;
  if (!e) {
    env.rumble = 0;
    camState.lift = 0;
    return null;
  }
  const key = `${e.t0}`;
  if (e.kind === "nuke") return <Nuke key={key} e={e} terrain={terrain} />;
  if (e.kind === "space") return <Rocket key={key} e={e} terrain={terrain} />;
  if (e.kind === "alien") return <Invasion key={key} e={e} terrain={terrain} />;
  if (e.kind === "eternal") return <Pillar key={key} e={e} terrain={terrain} />;
  return <RobotDawn key={key} e={e} />;
}
