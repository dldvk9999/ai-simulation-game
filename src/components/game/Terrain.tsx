"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { createNoise2D } from "@/sim/noise";
import type { Terrain as TerrainData } from "@/sim/terrain";
import { env } from "./env";

const C = {
  deepSand: new THREE.Color("#b9a06c"),
  wetSand: new THREE.Color("#d6c08a"),
  sand: new THREE.Color("#efdcab"),
  grass: new THREE.Color("#8cc463"),
  grass2: new THREE.Color("#79b552"),
  forest: new THREE.Color("#5f9e47"),
  high: new THREE.Color("#86a85e"),
  rock: new THREE.Color("#928d86"),
  rock2: new THREE.Color("#aaa49b"),
  pond: new THREE.Color("#5f7f5a"),
};

export function buildTerrainGeometry(T: TerrainData) {
  const res = T.res;
  const pos = new Float32Array(res * res * 3);
  const col = new Float32Array(res * res * 3);
  const n = createNoise2D(T.seed + 99);
  const tmp = new THREE.Color();
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const x = -T.size / 2 + i * T.cell;
      const z = -T.size / 2 + j * T.cell;
      const h = T.heights[k];
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      const b = T.biome(x, z);
      const v = n(x * 0.15, z * 0.15) * 0.5 + 0.5;
      if (b === "pond") tmp.copy(C.pond);
      else if (h < -0.4) tmp.copy(C.deepSand);
      else if (h < 0.3) tmp.copy(C.wetSand).lerp(C.sand, (h + 0.4) / 0.7);
      else if (b === "beach") tmp.copy(C.sand).lerp(C.grass, Math.max(0, (h - 1.0) / 0.35) * 0.5);
      else if (b === "rock") tmp.copy(C.rock).lerp(C.rock2, v);
      else if (b === "forest") tmp.copy(C.forest).lerp(C.grass2, v * 0.5);
      else if (h > 7) tmp.copy(C.high).lerp(C.rock2, Math.min(1, (h - 7) / 5) * 0.6);
      else tmp.copy(C.grass).lerp(C.grass2, v);
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
    }
  }
  const idx = new Uint32Array((res - 1) * (res - 1) * 6);
  let p = 0;
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i, b = a + 1, c = a + res, d = c + 1;
      // 대각선을 번갈아 → 로우폴리 질감
      if ((i + j) % 2 === 0) {
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      } else {
        idx[p++] = a; idx[p++] = c; idx[p++] = d;
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function TerrainMesh({ terrain }: { terrain: TerrainData }) {
  const geo = useMemo(() => buildTerrainGeometry(terrain), [terrain]);
  const { mat, uniforms } = useMemo(() => {
    const uniforms = { uSnow: { value: 0 }, uWet: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vH;\nvarying float vNy;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = position.y;\nvNy = normal.y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uSnow;\nuniform float uWet;\nvarying float vH;\nvarying float vNy;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float snowAmt = uSnow * smoothstep(0.55, 0.85, vNy) * smoothstep(0.15, 0.9, vH);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), snowAmt);
          diffuseColor.rgb *= 1.0 - uWet * 0.22 * step(0.3, vH) * (1.0 - snowAmt);`,
        );
    };
    return { mat, uniforms };
  }, []);

  useFrame(() => {
    uniforms.uSnow.value = env.snowCover;
    uniforms.uWet.value = env.wet;
  });

  return <mesh geometry={geo} material={mat} receiveShadow castShadow name="terrain" />;
}

/** 물 셰이더가 수심을 알 수 있도록 높이를 텍스처로 */
export function heightTexture(T: TerrainData) {
  const res = T.res;
  const data = new Uint8Array(res * res);
  for (let k = 0; k < res * res; k++) data[k] = Math.max(0, Math.min(255, Math.round(((T.heights[k] + 8) / 24) * 255)));
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
