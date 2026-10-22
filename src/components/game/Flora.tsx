"use client";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { makeRng, range, rand } from "@/sim/rng";
import type { Terrain } from "@/sim/terrain";
import type { Plant, PlantKind } from "@/sim/types";
import { useRuntime, useWorldVersion } from "./context";
import { env } from "./env";
import { G, leafMaterial, merge, part } from "./geo";

const BARK = "#8a5a3b";

function buildGeos() {
  const tree = merge([
    part(G.cyl(0.16, 0.26, 2.2), { color: BARK, pos: [0, 1.1, 0] }),
    part(G.ico(1.45, 0), { color: "#5fae4a", leaf: 1, pos: [0, 2.9, 0], scale: [1, 0.85, 1] }),
    part(G.ico(1.0, 0), { color: "#6dbb55", leaf: 1, pos: [0.55, 3.5, 0.3] }),
  ]);
  const fruit = merge([
    part(G.cyl(0.14, 0.22, 1.7), { color: BARK, pos: [0, 0.85, 0] }),
    part(G.ico(1.25, 1), { color: "#78c25b", leaf: 1, pos: [0, 2.3, 0], scale: [1, 0.8, 1] }),
  ]);
  const pine = merge([
    part(G.cyl(0.13, 0.2, 1.4), { color: "#6e4a32", pos: [0, 0.7, 0] }),
    part(G.cone(1.45, 1.8, 7), { color: "#2f7a4a", leaf: 1, pos: [0, 1.9, 0] }),
    part(G.cone(1.1, 1.6, 7), { color: "#358552", leaf: 1, pos: [0, 2.8, 0] }),
    part(G.cone(0.72, 1.4, 7), { color: "#3b8f58", leaf: 1, pos: [0, 3.6, 0] }),
  ]);
  const palmParts = [
    part(G.cyl(0.13, 0.2, 2.2), { color: "#a07850", pos: [0.15, 1.05, 0], rot: [0, 0, -0.12] }),
    part(G.cyl(0.11, 0.14, 2.0), { color: "#a98057", pos: [0.55, 3.0, 0], rot: [0, 0, -0.28] }),
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    palmParts.push(
      part(G.cone(0.38, 2.4, 4), {
        color: i % 2 ? "#4f9e3e" : "#5aad46",
        leaf: 1,
        pos: [0.9 + Math.cos(a) * 1.0, 3.9, Math.sin(a) * 1.0],
        rot: [Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25],
        scale: [1, 1, 0.25],
      }),
    );
  }
  const palm = merge(palmParts);
  const bush = merge([
    part(G.ico(0.62, 0), { color: "#4f9a3f", leaf: 1, pos: [0, 0.45, 0] }),
    part(G.ico(0.5, 0), { color: "#5aa848", leaf: 1, pos: [0.45, 0.35, 0.2] }),
    part(G.ico(0.45, 0), { color: "#4a9240", leaf: 1, pos: [-0.35, 0.32, -0.3] }),
  ]);
  const fiberParts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    fiberParts.push(
      part(G.cone(0.08, 1.0, 3), {
        color: i % 2 ? "#a8c95a" : "#bcd46a",
        leaf: 1,
        pos: [Math.cos(a) * 0.15, 0.48, Math.sin(a) * 0.15],
        rot: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35],
      }),
    );
  }
  const fiber = merge(fiberParts);
  const herb = merge([
    part(G.cyl(0.03, 0.03, 0.5, 4), { color: "#5b8a3a", pos: [0, 0.25, 0] }),
    part(G.ico(0.13, 0), { color: "#b48ee0", pos: [0, 0.55, 0] }),
    part(G.ico(0.1, 0), { color: "#c9a8f0", pos: [0.15, 0.42, 0.05] }),
    part(G.ico(0.1, 0), { color: "#a77ad6", pos: [-0.12, 0.4, -0.08] }),
    part(G.cone(0.18, 0.3, 4), { color: "#5f9a42", leaf: 1, pos: [0, 0.15, 0] }),
  ]);
  const cropParts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    cropParts.push(part(G.cyl(0.025, 0.035, 0.9, 3), { color: "#9fbf55", leaf: 1, pos: [Math.cos(a) * 0.18, 0.45, Math.sin(a) * 0.18] }));
    cropParts.push(part(G.cone(0.06, 0.25, 4), { color: "#d9c25a", leaf: 1, pos: [Math.cos(a) * 0.18, 0.98, Math.sin(a) * 0.18] }));
  }
  const crop = merge(cropParts);
  const stump = merge([
    part(G.cyl(0.24, 0.3, 0.35, 7), { color: BARK, pos: [0, 0.17, 0] }),
    part(G.cyl(0.22, 0.22, 0.02, 7), { color: "#d9b88a", pos: [0, 0.36, 0] }),
  ]);
  return { tree, fruit, pine, palm, bush, fiber, herb, crop, stump } as Record<PlantKind | "stump", THREE.BufferGeometry>;
}

const KINDS: (PlantKind | "stump")[] = ["tree", "fruit", "pine", "palm", "bush", "fiber", "herb", "crop", "stump"];
// 동식물이 예전보다 1.7배 많아져서 넉넉하게
const MAX: Record<string, number> = { tree: 380, fruit: 140, pine: 210, palm: 155, bush: 240, fiber: 240, herb: 90, crop: 64, stump: 280 };

// 계절별 잎 색 (봄, 여름, 가을, 겨울)
const TINTS: Record<string, [THREE.Color, THREE.Color][]> = {
  tree: [
    [new THREE.Color(1.05, 1.08, 0.95), new THREE.Color(1.15, 1.1, 0.85)],
    [new THREE.Color(0.85, 0.98, 0.85), new THREE.Color(0.8, 0.95, 0.8)],
    [new THREE.Color(1.75, 0.95, 0.35), new THREE.Color(1.8, 0.55, 0.3)],
    [new THREE.Color(0.85, 0.78, 0.62), new THREE.Color(0.78, 0.72, 0.6)],
  ],
  fruit: [
    [new THREE.Color(1.6, 1.2, 1.4), new THREE.Color(1.3, 1.25, 1.1)],
    [new THREE.Color(0.9, 1.0, 0.85), new THREE.Color(0.85, 0.98, 0.8)],
    [new THREE.Color(1.5, 1.05, 0.45), new THREE.Color(1.6, 0.8, 0.4)],
    [new THREE.Color(0.85, 0.8, 0.65), new THREE.Color(0.8, 0.75, 0.62)],
  ],
  bush: [
    [new THREE.Color(1, 1.05, 0.95), new THREE.Color(1.1, 1.05, 0.9)],
    [new THREE.Color(0.9, 1, 0.88), new THREE.Color(0.85, 0.98, 0.85)],
    [new THREE.Color(1.3, 0.85, 0.5), new THREE.Color(1.5, 0.6, 0.4)],
    [new THREE.Color(0.8, 0.8, 0.7), new THREE.Color(0.75, 0.75, 0.68)],
  ],
};
const DEFAULT_TINT: [THREE.Color, THREE.Color] = [new THREE.Color(1, 1, 1), new THREE.Color(0.9, 1, 0.9)];

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tA = new THREE.Color();
const tB = new THREE.Color();

function tintFor(kind: string, season: number, t: number, out: [THREE.Color, THREE.Color]) {
  const set = TINTS[kind];
  if (!set) {
    out[0].copy(DEFAULT_TINT[0]);
    out[1].copy(DEFAULT_TINT[1]);
    return;
  }
  const next = (season + 1) % 4;
  const k = THREE.MathUtils.smoothstep(t, 0.6, 1);
  out[0].copy(set[season][0]).lerp(set[next][0], k);
  out[1].copy(set[season][1]).lerp(set[next][1], k);
}

export function Flora({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(300);
  const geos = useMemo(() => {
    const g = buildGeos();
    // 인스턴스별 색 변화
    for (const k of KINDS) {
      const v = new Float32Array(MAX[k]);
      const r = makeRng(k.length * 977 + k.charCodeAt(0));
      for (let i = 0; i < v.length; i++) v[i] = rand(r);
      g[k].setAttribute("aVar", new THREE.InstancedBufferAttribute(v, 1));
    }
    return g;
  }, []);
  const mats = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, leafMaterial()])), []);
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const byKind = useRef<Record<string, Plant[]>>({});
  const fruitMesh = useRef<THREE.InstancedMesh>(null);
  const cocoMesh = useRef<THREE.InstancedMesh>(null);
  const berryMesh = useRef<THREE.InstancedMesh>(null);
  const lastRebuild = useRef(0);
  const shakes = useRef(new Map<number, number>());
  const seenFx = useRef(new Set<number>());

  const rebuild = () => {
    const w = rt.world;
    if (!w) return;
    const lists: Record<string, Plant[]> = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const p of w.plants) (p.stump ? lists.stump : lists[p.kind])?.push(p);
    byKind.current = lists;
    const now = performance.now();
    for (const k of KINDS) {
      const mesh = meshes.current[k];
      if (!mesh) continue;
      const list = lists[k];
      const n = Math.min(list.length, MAX[k]);
      for (let i = 0; i < n; i++) {
        const p = list[i];
        const g = k === "stump" ? 1 : 0.22 + 0.78 * p.g;
        const s = p.s * g * (k === "crop" ? 1 : 1);
        let rx = 0, rz = 0;
        const sh = shakes.current.get(p.id);
        if (sh && now - sh < 700) {
          const t = (now - sh) / 700;
          const amp = Math.sin(t * Math.PI * 6) * (1 - t) * 0.12;
          rx = amp;
          rz = amp * 0.6;
        }
        tmpP.set(p.x, terrain.height(p.x, p.z) - 0.05, p.z);
        tmpQ.setFromEuler(tmpE.set(rx, p.rot, rz));
        tmpS.set(s, k === "crop" ? s * (0.4 + 0.6 * p.g) : s, s);
        mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // 열매
    const fill = (mesh: THREE.InstancedMesh | null, kinds: PlantKind[], place: (p: Plant, i: number, out: THREE.Vector3) => void, max: number) => {
      if (!mesh) return;
      let n = 0;
      for (const kind of kinds) {
        for (const p of lists[kind]) {
          if (p.stump || p.g < 1) continue;
          for (let i = 0; i < p.fruit && n < max; i++) {
            place(p, i, tmpP);
            mesh.setMatrixAt(n++, tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(p.s)));
          }
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    fill(cocoMesh.current, ["palm"], (p, i, o) => {
      const a = p.rot + i * 2.1;
      const cx = Math.cos(p.rot) * 0.9 * p.s, cz = -Math.sin(p.rot) * 0.9 * p.s;
      o.set(p.x + cx + Math.cos(a) * 0.25, terrain.height(p.x, p.z) + 3.75 * p.s, p.z + cz + Math.sin(a) * 0.25);
    }, 260);
    fill(fruitMesh.current, ["fruit"], (p, i, o) => {
      const a = p.rot + i * 1.7;
      o.set(p.x + Math.cos(a) * 1.05 * p.s, terrain.height(p.x, p.z) + (2.0 + (i % 2) * 0.5) * p.s, p.z + Math.sin(a) * 1.05 * p.s);
    }, 280);
    fill(berryMesh.current, ["bush"], (p, i, o) => {
      const a = p.rot + i * 1.1;
      o.set(p.x + Math.cos(a) * 0.55 * p.s, terrain.height(p.x, p.z) + (0.45 + (i % 3) * 0.12) * p.s, p.z + Math.sin(a) * 0.55 * p.s);
    }, 850);
  };

  useEffect(() => {
    rebuild();
    lastRebuild.current = performance.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, terrain]);

  const tints = useMemo(() => [tA, tB] as [THREE.Color, THREE.Color], []);
  useFrame(() => {
    const w = rt.world;
    if (!w) return;
    // 흔들림 효과
    const now = performance.now();
    for (const f of w.fx) {
      if (f.type === "shake" && f.ref != null && !seenFx.current.has(f.id)) {
        seenFx.current.add(f.id);
        shakes.current.set(f.ref, now);
      }
    }
    if (seenFx.current.size > 500) seenFx.current.clear();
    let shaking = false;
    for (const [id, t] of shakes.current) {
      if (now - t < 750) shaking = true;
      else if (now - t > 2000) shakes.current.delete(id);
    }
    if (shaking || now - lastRebuild.current > 1200) {
      lastRebuild.current = now;
      rebuild();
    }
    for (const k of KINDS) {
      const m = mats[k];
      tintFor(k, env.season, env.seasonT, tints);
      m.uniforms.uTint.value.copy(tints[0]);
      m.uniforms.uTint2.value.copy(tints[1]);
      m.uniforms.uSnow.value = env.snowCover;
    }
  });

  return (
    <group>
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            meshes.current[k] = m;
          }}
          args={[geos[k], mats[k].mat, MAX[k]]}
          castShadow={k !== "fiber" && k !== "herb" && k !== "crop"}
          receiveShadow
          frustumCulled={false}
        />
      ))}
      <instancedMesh ref={cocoMesh} args={[undefined, undefined, 260]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[0.17, 0]} />
        <meshStandardMaterial color="#7a5230" flatShading roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={fruitMesh} args={[undefined, undefined, 280]} frustumCulled={false}>
        <icosahedronGeometry args={[0.15, 0]} />
        <meshStandardMaterial color="#e2453a" flatShading roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={berryMesh} args={[undefined, undefined, 850]} frustumCulled={false}>
        <icosahedronGeometry args={[0.08, 0]} />
        <meshStandardMaterial color="#c2265a" flatShading roughness={0.5} />
      </instancedMesh>
      <GrassDecor terrain={terrain} />
    </group>
  );
}

/** 장식용 풀과 꽃 (저장되지 않음) */
function GrassDecor({ terrain }: { terrain: Terrain }) {
  const grassRef = useRef<THREE.InstancedMesh>(null);
  const flowerRef = useRef<THREE.InstancedMesh>(null);
  const { grassGeo, flowerGeo, mat } = useMemo(() => {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(part(G.cone(0.05, 0.38, 3), { color: i ? "#7fbf55" : "#93cc63", leaf: 1, pos: [Math.cos(a) * 0.07, 0.18, Math.sin(a) * 0.07], rot: [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3] }));
    }
    const flowerGeo = merge([
      part(G.cyl(0.015, 0.015, 0.3, 3), { color: "#5f9a42", pos: [0, 0.15, 0] }),
      part(G.ico(0.07, 0), { color: "#ffffff", leaf: 1, pos: [0, 0.32, 0] }),
    ]);
    return { grassGeo: merge(parts), flowerGeo, mat: leafMaterial() };
  }, []);

  useEffect(() => {
    const r = makeRng(terrain.seed + 5);
    const place = (mesh: THREE.InstancedMesh | null, n: number, ok: (b: string, x: number, z: number) => boolean, colors?: string[]) => {
      if (!mesh) return;
      let c = 0;
      const col = new THREE.Color();
      for (let k = 0; k < n * 6 && c < n; k++) {
        const x = range(r, -85, 85), z = range(r, -85, 85);
        const b = terrain.biome(x, z);
        if (!ok(b, x, z)) continue;
        tmpP.set(x, terrain.height(x, z) - 0.02, z);
        tmpQ.setFromEuler(tmpE.set(0, rand(r) * 6.28, 0));
        tmpS.setScalar(range(r, 0.7, 1.4));
        mesh.setMatrixAt(c, tmpM.compose(tmpP, tmpQ, tmpS));
        if (colors) mesh.setColorAt(c, col.set(colors[Math.floor(rand(r) * colors.length)]));
        c++;
      }
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    place(grassRef.current, 4400, (b) => b === "grass" || b === "forest");
    place(flowerRef.current, 880, (b) => b === "grass", ["#ffffff", "#ffe066", "#ff9ec7", "#c7a4ff", "#ffb36b"]);
  }, [terrain]);

  useFrame(() => {
    tintFor("bush", env.season, env.seasonT, [mat.uniforms.uTint.value, mat.uniforms.uTint2.value]);
    mat.uniforms.uSnow.value = env.snowCover;
    if (flowerRef.current) flowerRef.current.visible = env.season !== 3 && env.snowCover < 0.4;
  });

  return (
    <>
      <instancedMesh ref={grassRef} args={[grassGeo, mat.mat, 4400]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={flowerRef} args={[flowerGeo, undefined, 880]} frustumCulled={false}>
        <meshStandardMaterial vertexColors flatShading roughness={0.7} />
      </instancedMesh>
    </>
  );
}
