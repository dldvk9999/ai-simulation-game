"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Terrain } from "@/sim/terrain";
import { useAmbience, useRuntime } from "./context";
import { env } from "./env";

const rainVert = /* glsl */ `
attribute float aSeed;
uniform float uTime; uniform vec3 uCenter; uniform float uWind; uniform float uSpeed;
varying float vA;
void main() {
  vec3 p = position;
  float H = 40.0;
  float y = mod(p.y - uTime * uSpeed * (0.8 + aSeed * 0.4), H);
  vec3 w = vec3(uCenter.x + mod(p.x + uWind * (H - y) * 0.6 - uCenter.x + 30.0, 60.0) - 30.0, uCenter.y + y - 6.0, uCenter.z + mod(p.z - uCenter.z + 30.0, 60.0) - 30.0);
  // 빗줄기 꼬리
  w.y += float(gl_VertexID % 2) * 0.55;
  w.x += float(gl_VertexID % 2) * uWind * 0.2;
  vA = 0.35 + aSeed * 0.4;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const rainFrag = /* glsl */ `
uniform float uOpacity; uniform vec3 uColor;
varying float vA;
void main() { gl_FragColor = vec4(uColor, vA * uOpacity); }`;

const snowVert = /* glsl */ `
attribute float aSeed;
uniform float uTime; uniform vec3 uCenter; uniform float uWind;
void main() {
  vec3 p = position;
  float H = 34.0;
  float y = mod(p.y - uTime * (1.2 + aSeed * 0.8), H);
  float sway = sin(uTime * (0.8 + aSeed) + aSeed * 30.0) * 0.8;
  vec3 w = vec3(uCenter.x + mod(p.x + sway + uWind * uTime * 1.5 - uCenter.x + 28.0, 56.0) - 28.0, uCenter.y + y - 5.0, uCenter.z + mod(p.z + cos(uTime * 0.7 + aSeed * 20.0) * 0.6 - uCenter.z + 28.0, 56.0) - 28.0);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (2.0 + aSeed * 3.0) * (60.0 / -mv.z);
}`;
const snowFrag = /* glsl */ `
uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, d) * uOpacity);
}`;

export function WeatherFx({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());

  const rain = useMemo(() => {
    const n = 4500;
    const pos = new Float32Array(n * 2 * 3);
    const seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 60, y = Math.random() * 40, z = Math.random() * 60, s = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      seed[i * 2] = seed[i * 2 + 1] = s;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: 0 }, uSpeed: { value: 26 },
        uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#cfe2ff") },
      },
    });
    return { g, m };
  }, []);

  const snow = useMemo(() => {
    const n = 3500;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([Math.random() * 56, Math.random() * 34, Math.random() * 56], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: snowVert,
      fragmentShader: snowFrag,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: 0 }, uOpacity: { value: 0 } },
    });
    return { g, m };
  }, []);

  // 구름
  const cloudRef = useRef<THREE.InstancedMesh>(null);
  const clouds = useMemo(() => {
    const list: { x: number; z: number; y: number; s: number; puffs: [number, number, number, number][] }[] = [];
    for (let i = 0; i < 26; i++) {
      const puffs: [number, number, number, number][] = [];
      const n = 4 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) puffs.push([(Math.random() - 0.5) * 14, Math.random() * 2.5, (Math.random() - 0.5) * 7, 3 + Math.random() * 3]);
      list.push({ x: (Math.random() - 0.5) * 360, z: (Math.random() - 0.5) * 360, y: 48 + Math.random() * 18, s: 0.8 + Math.random() * 0.8, puffs });
    }
    return list;
  }, []);
  const cloudMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", flatShading: true, transparent: true, opacity: 0.9, roughness: 1 }), []);
  const cloudGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const puffCount = clouds.reduce((s, c) => s + c.puffs.length, 0);

  // 번개
  const boltRef = useRef<THREE.LineSegments>(null);
  const bolt = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    return g;
  }, []);
  const boltMat = useMemo(() => new THREE.LineBasicMaterial({ color: "#eef3ff", transparent: true, opacity: 1 }), []);
  const boltLife = useRef(0);
  const seen = useRef(new Set<number>());

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const w = rt.world;
    if (!w) return;
    const t = state.clock.elapsedTime;
    // 카메라 앞쪽 지면 근처를 중심으로
    camera.getWorldDirection(v);
    target.current.set(camera.position.x + v.x * 18, Math.max(0, camera.position.y - 14), camera.position.z + v.z * 18);
    const ru = rain.m.uniforms;
    ru.uTime.value = t;
    (ru.uCenter.value as THREE.Vector3).copy(target.current);
    ru.uWind.value = env.wind * 0.7 + env.storm * 0.5;
    ru.uOpacity.value = env.rain * 0.85;
    (ru.uColor.value as THREE.Color).set(env.day > 0.4 ? "#d8e6ff" : "#8fa3c4");
    const su = snow.m.uniforms;
    su.uTime.value = t;
    (su.uCenter.value as THREE.Vector3).copy(target.current);
    su.uWind.value = env.wind;
    su.uOpacity.value = env.snowFall * 0.95;

    // 구름
    const cm = cloudRef.current;
    if (cm) {
      let n = 0;
      const drift = t * (0.6 + env.wind * 2.5);
      const visible = Math.round(6 + env.cloud * 20);
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        const show = i < visible;
        const cx = ((c.x + drift + 180) % 360) - 180;
        for (const [px, py, pz, ps] of c.puffs) {
          const s = show ? ps * c.s * (0.7 + env.cloud * 0.5) : 0.0001;
          cm.setMatrixAt(n++, m4.compose(v.set(cx + px * c.s, c.y + py, c.z + pz * c.s), q.identity(), sc.set(s, s * 0.6, s)));
        }
      }
      cm.instanceMatrix.needsUpdate = true;
      const grey = Math.min(1, env.rain * 0.6 + env.storm * 0.5);
      cloudMat.color.setRGB(1 - grey * 0.55, 1 - grey * 0.52, 1 - grey * 0.45).multiplyScalar(0.35 + 0.65 * env.day + env.flash);
      cloudMat.opacity = 0.75 + env.cloud * 0.2;
    }

    // 번개
    for (const f of w.fx) {
      if (f.type !== "lightning" || seen.current.has(f.id)) continue;
      seen.current.add(f.id);
      if (w.time - f.t > 3 * 72) continue;
      env.flash = 1;
      boltLife.current = 0.35;
      const pos = bolt.attributes.position as THREE.BufferAttribute;
      let x = f.x + (Math.random() - 0.5) * 8, y = 70, z = f.z + (Math.random() - 0.5) * 8;
      const gy = terrain.height(f.x, f.z);
      for (let i = 0; i < 20; i++) {
        const k = (i + 1) / 20;
        const nx = i === 19 ? f.x : x + (Math.random() - 0.5) * 4;
        const nz = i === 19 ? f.z : z + (Math.random() - 0.5) * 4;
        const ny = 70 + (gy - 70) * k;
        pos.setXYZ(i * 2, x, y, z);
        pos.setXYZ(i * 2 + 1, nx, ny, nz);
        x = nx; y = ny; z = nz;
      }
      pos.needsUpdate = true;
      amb?.thunder(Math.hypot(f.x - camera.position.x, f.z - camera.position.z));
    }
    if (seen.current.size > 200) seen.current.clear();
    if (boltRef.current) {
      boltLife.current -= dt;
      boltRef.current.visible = boltLife.current > 0 && Math.sin(boltLife.current * 60) > -0.3;
    }
  });

  return (
    <>
      <lineSegments geometry={rain.g} material={rain.m} frustumCulled={false} />
      <points geometry={snow.g} material={snow.m} frustumCulled={false} />
      <instancedMesh ref={cloudRef} args={[cloudGeo, cloudMat, puffCount]} frustumCulled={false} />
      <lineSegments ref={boltRef} geometry={bolt} material={boltMat} visible={false} frustumCulled={false} />
    </>
  );
}
