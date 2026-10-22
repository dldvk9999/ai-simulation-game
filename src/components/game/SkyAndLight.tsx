"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useRuntime } from "./context";
import { camState } from "./Controls";
import { env, updateEnv } from "./env";

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;
const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uDay; uniform float uMoon; uniform vec3 uMoonDir; uniform float uFlash;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.55, h));
  float s = max(dot(d, normalize(uSun)), 0.0);
  col += uSunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25) * uDay;
  float m = max(dot(d, normalize(uMoonDir)), 0.0);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, m) * 1.2 + pow(m, 40.0) * 0.12) * uMoon;
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

const starVert = /* glsl */ `
attribute float aSize; attribute float aPhase;
uniform float uTime; uniform float uOpacity;
varying float vA;
void main() {
  vA = uOpacity * (0.55 + 0.45 * sin(uTime * 1.7 + aPhase));
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_PointSize = aSize;
}`;
const starFrag = /* glsl */ `
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c)) * vA;
  gl_FragColor = vec4(1.0, 0.97, 0.9, a);
}`;

export function SkyAndLight() {
  const rt = useRuntime();
  const { scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sky = useRef<THREE.Mesh>(null);
  const stars = useRef<THREE.Points>(null);

  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHor: { value: new THREE.Color() },
          uSun: { value: new THREE.Vector3() },
          uSunCol: { value: new THREE.Color() },
          uDay: { value: 1 },
          uMoon: { value: 0 },
          uMoonDir: { value: new THREE.Vector3() },
          uFlash: { value: 0 },
        },
      }),
    [],
  );

  const starGeo = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.08;
      const th = u * Math.PI * 2, ph = Math.acos(1 - v);
      const r = 820;
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      size[i] = Math.random() < 0.06 ? 3.2 : 1.2 + Math.random() * 1.4;
      phase[i] = Math.random() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return g;
  }, []);
  const starMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: starVert,
        fragmentShader: starFrag,
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      }),
    [],
  );

  const fog = useMemo(() => new THREE.Fog("#cfe8ff", 80, 420), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame((state, dt) => {
    const w = rt.world;
    if (!w) return;
    updateEnv(w, Math.min(dt, 0.1), performance.now());
    const u = skyMat.uniforms;
    (u.uTop.value as THREE.Color).copy(env.skyTop);
    (u.uHor.value as THREE.Color).copy(env.skyHorizon);
    (u.uSun.value as THREE.Vector3).copy(env.sunDir);
    (u.uSunCol.value as THREE.Color).copy(env.sunColor);
    u.uDay.value = env.day * (1 - env.cloud * 0.8);
    u.uMoon.value = env.night * (1 - env.cloud * 0.85);
    (u.uMoonDir.value as THREE.Vector3).copy(env.moonDir);
    u.uFlash.value = env.flash;
    fog.color.copy(env.fog);
    fog.near = env.fogNear;
    fog.far = env.fogFar;
    if (sky.current) sky.current.position.copy(camera.position);
    if (stars.current) {
      stars.current.position.copy(camera.position);
      stars.current.rotation.y = env.time * 0.000004;
      starMat.uniforms.uTime.value = state.clock.elapsedTime;
      starMat.uniforms.uOpacity.value = env.night * (1 - env.cloud * 0.95);
    }
    if (sun.current) {
      // 그림자는 지금 보고 있는 곳을 중심으로 (섬이 넓어져 한 번에 다 담으면 흐려진다)
      const c = camState.cur;
      sun.current.target.position.set(c.tx, 0, c.tz);
      sun.current.target.updateMatrixWorld();
      sun.current.position.copy(env.sunDir).multiplyScalar(120).add(sun.current.target.position);
      sun.current.color.copy(env.sunColor);
      sun.current.intensity = env.sunIntensity;
      sun.current.castShadow = env.sunIntensity > 0.05;
    }
    if (moon.current) {
      moon.current.position.copy(env.moonDir).multiplyScalar(120);
      moon.current.intensity = env.moonIntensity;
    }
    if (hemi.current) {
      hemi.current.color.copy(env.hemiSky);
      hemi.current.groundColor.copy(env.hemiGround);
      hemi.current.intensity = env.hemiIntensity;
    }
  });

  return (
    <>
      <mesh ref={sky} material={skyMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      <points ref={stars} geometry={starGeo} material={starMat} renderOrder={-9} frustumCulled={false} />
      <hemisphereLight ref={hemi} intensity={1} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-85}
        shadow-camera-right={85}
        shadow-camera-top={85}
        shadow-camera-bottom={-85}
        shadow-camera-near={1}
        shadow-camera-far={320}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      <directionalLight ref={moon} color="#9fb6ff" intensity={0} />
    </>
  );
}
