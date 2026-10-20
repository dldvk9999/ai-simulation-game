"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { Terrain as TerrainData } from "@/sim/terrain";
import { env } from "./env";
import { heightTexture } from "./Terrain";

const vert = /* glsl */ `
#include <fog_pars_vertex>
uniform float uTime; uniform float uWave;
varying vec3 vWorld; varying float vWave;
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float w = sin(wp.x * 0.18 + uTime * 0.9) * 0.5 + sin(wp.z * 0.23 - uTime * 0.7) * 0.35 + sin((wp.x + wp.z) * 0.41 + uTime * 1.6) * 0.15;
  wp.y += w * uWave;
  vWave = w;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
#include <fog_pars_fragment>
uniform sampler2D uHeight; uniform float uTime; uniform float uSize;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunCol;
uniform float uLight; uniform float uSun; uniform float uGloom;
varying vec3 vWorld; varying float vWave;
void main() {
  vec2 uv = (vWorld.xz + uSize * 0.5) / uSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float h = mix(-8.0, texture2D(uHeight, uv).r * 24.0 - 8.0, inside);
  float depth = clamp(-h / 5.0, 0.0, 1.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.02, 0.85, depth));
  // 해안의 물거품
  float shore = 1.0 - smoothstep(0.0, 0.75, -h);
  float n = sin(vWorld.x * 1.3 + uTime * 1.1) * sin(vWorld.z * 1.7 - uTime * 0.9);
  float band = sin(uTime * 1.4 + h * 7.0) * 0.5 + 0.5;
  float foam = smoothstep(0.55, 0.92, shore + n * 0.12 + band * 0.18 * shore);
  foam += smoothstep(0.75, 1.0, vWave) * 0.12 * (1.0 - depth);
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  col = mix(col, uSky, fres * 0.55);
  vec3 N = normalize(vec3(-cos(vWorld.x * 0.18 + uTime * 0.9) * 0.09, 1.0, sin(vWorld.z * 0.23 - uTime * 0.7) * 0.08));
  vec3 R = reflect(-normalize(uSunDir), N);
  float spec = pow(max(dot(R, V), 0.0), 120.0) * uSun;
  col *= uLight;
  col += uSunCol * spec * 1.4;
  float alpha = mix(0.38, 0.93, smoothstep(0.0, 0.45, depth));
  alpha = max(alpha, foam * 0.9);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

const DEEP = new THREE.Color("#2b8fc7");
const SHALLOW = new THREE.Color("#5fe0d0");
const DEEP_STORM = new THREE.Color("#2b4a5c");
const SHALLOW_STORM = new THREE.Color("#5f8c8a");

export function Water({ terrain }: { terrain: TerrainData }) {
  const tex = useMemo(() => heightTexture(terrain), [terrain]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uHeight: { value: null },
            uTime: { value: 0 },
            uSize: { value: terrain.size },
            uWave: { value: 0.12 },
            uDeep: { value: new THREE.Color() },
            uShallow: { value: new THREE.Color() },
            uFoam: { value: new THREE.Color("#ffffff") },
            uSky: { value: new THREE.Color() },
            uSunDir: { value: new THREE.Vector3() },
            uSunCol: { value: new THREE.Color() },
            uLight: { value: 1 },
            uSun: { value: 1 },
            uGloom: { value: 0 },
          },
        ]),
      }),
    [terrain.size],
  );
  mat.uniforms.uHeight.value = tex;

  const pondMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3fa7b5", transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1 }),
    [],
  );

  useFrame((state) => {
    const u = mat.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    const gloom = Math.min(1, env.storm * 0.8 + env.rain * 0.3 + env.cloud * 0.2);
    (u.uDeep.value as THREE.Color).copy(DEEP).lerp(DEEP_STORM, gloom);
    (u.uShallow.value as THREE.Color).copy(SHALLOW).lerp(SHALLOW_STORM, gloom);
    (u.uSky.value as THREE.Color).copy(env.skyHorizon);
    (u.uSunDir.value as THREE.Vector3).copy(env.sunDir);
    (u.uSunCol.value as THREE.Color).copy(env.sunColor);
    u.uLight.value = 0.22 + 0.85 * env.day * (1 - gloom * 0.45) + env.flash * 0.8 + env.night * 0.08;
    u.uSun.value = env.day * (1 - env.cloud * 0.85);
    u.uWave.value = 0.1 + env.wind * 0.25 + env.storm * 0.35;
    pondMat.color.set("#3fa7b5").multiplyScalar(0.35 + 0.65 * env.day);
  });

  const { pond } = terrain;
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={0} material={mat} renderOrder={2}>
        <planeGeometry args={[1400, 1400, 220, 220]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[pond.x, pond.level, pond.z]} material={pondMat} renderOrder={2}>
        <circleGeometry args={[pond.r + 0.9, 40]} />
      </mesh>
    </>
  );
}
