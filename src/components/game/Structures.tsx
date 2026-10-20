"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { STRUCTS } from "@/sim/data";
import type { Terrain } from "@/sim/terrain";
import type { Structure, StructureType } from "@/sim/types";
import { useAmbience, useRuntime, useWorldVersion } from "./context";
import { env } from "./env";
import { G, merge, part, vcMat } from "./geo";

const WOOD = "#9c6b43";
const WOOD_D = "#7a5235";
const STRAW = "#d9b65a";
const STONE = "#a8a39a";
const STONE_D = "#8c877f";
const ROOF = "#a5483a";

/** 박공지붕: x축을 따라 용마루, 양 끝은 벽 색 삼각형 */
function gable(w: number, d: number, h: number, y: number, color: string, wall: string) {
  const len = Math.hypot(d / 2, h) + 0.2;
  const ang = Math.atan2(h, d / 2);
  return [
    part(G.box, { color, pos: [0, y + h / 2, d / 4], scale: [w + 0.35, 0.12, len], rot: [ang, 0, 0] }),
    part(G.box, { color, pos: [0, y + h / 2, -d / 4], scale: [w + 0.35, 0.12, len], rot: [-ang, 0, 0] }),
    part(G.cyl(1, 1, w, 3), { color: wall, pos: [0, y + h / 3, 0], rot: [-Math.PI / 2, 0, Math.PI / 2], scale: [d / Math.sqrt(3), 1, h / 1.5] }),
  ];
}

interface Model {
  geo: THREE.BufferGeometry;
  windows?: THREE.BufferGeometry;
}

function buildModel(type: StructureType): Model {
  switch (type) {
    case "campfire": {
      const parts = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part(G.dodec(0.15), { color: i % 2 ? STONE : STONE_D, pos: [Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55] }));
      }
      parts.push(part(G.cyl(0.07, 0.07, 0.9, 5), { color: "#6b4630", pos: [0, 0.12, 0], rot: [0, 0.6, Math.PI / 2] }));
      parts.push(part(G.cyl(0.07, 0.07, 0.9, 5), { color: "#5e3d29", pos: [0, 0.16, 0], rot: [0, -0.9, Math.PI / 2] }));
      parts.push(part(G.cyl(0.4, 0.45, 0.03, 10), { color: "#3b3631", pos: [0, 0.02, 0] }));
      return { geo: merge(parts) };
    }
    case "leanto":
      return {
        geo: merge([
          part(G.cyl(0.06, 0.07, 1.7, 5), { color: WOOD_D, pos: [0.7, 0.85, 0.9] }),
          part(G.cyl(0.06, 0.07, 1.7, 5), { color: WOOD_D, pos: [0.7, 0.85, -0.9] }),
          part(G.box, { color: WOOD, pos: [0.05, 0.95, 0], scale: [1.9, 0.08, 2.1], rot: [0, 0, 0.75] }),
          part(G.box, { color: "#5f9e47", pos: [0.0, 1.02, 0], scale: [1.95, 0.1, 2.2], rot: [0, 0, 0.75] }),
          part(G.box, { color: "#8a7a4a", pos: [0.2, 0.04, 0], scale: [1.4, 0.06, 1.6] }),
        ]),
      };
    case "hut":
      return {
        geo: merge([
          part(G.cyl(1.55, 1.6, 1.4, 10), { color: WOOD, pos: [0, 0.7, 0] }),
          part(G.cone(2.1, 1.7, 10), { color: STRAW, pos: [0, 2.2, 0] }),
          part(G.cyl(0.12, 0.12, 0.3, 5), { color: "#b8953f", pos: [0, 3.1, 0] }),
          part(G.box, { color: "#3e2a1c", pos: [1.52, 0.55, 0], scale: [0.12, 1.1, 0.7] }),
        ]),
      };
    case "loghouse":
      return {
        geo: merge([
          part(G.box, { color: "#a0683f", pos: [0, 0.9, 0], scale: [3.4, 1.8, 2.8] }),
          part(G.box, { color: "#8a5634", pos: [0, 0.35, 0], scale: [3.5, 0.15, 2.9] }),
          part(G.box, { color: "#8a5634", pos: [0, 1.0, 0], scale: [3.5, 0.15, 2.9] }),
          part(G.box, { color: "#8a5634", pos: [0, 1.6, 0], scale: [3.5, 0.15, 2.9] }),
          ...gable(3.4, 2.8, 1.1, 1.8, "#7a3b2a", "#a0683f"),
          part(G.box, { color: "#5a3b26", pos: [1.72, 0.65, 0], scale: [0.08, 1.3, 0.75] }),
          part(G.box, { color: STONE_D, pos: [-1.0, 2.8, 0.8], scale: [0.4, 1.2, 0.4] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [1.72, 1.15, 0.95], scale: [0.06, 0.5, 0.5] }),
          part(G.box, { color: "#ffffff", pos: [1.72, 1.15, -0.95], scale: [0.06, 0.5, 0.5] }),
        ]),
      };
    case "stonehouse":
      return {
        geo: merge([
          part(G.box, { color: "#c2bdb3", pos: [0, 1.1, 0], scale: [3.8, 2.2, 3.2] }),
          part(G.box, { color: STONE_D, pos: [0, 0.15, 0], scale: [3.95, 0.3, 3.35] }),
          ...gable(3.8, 3.2, 1.3, 2.2, ROOF, "#c2bdb3"),
          part(G.box, { color: "#4f3a2a", pos: [1.92, 0.75, 0], scale: [0.08, 1.4, 0.8] }),
          part(G.box, { color: STONE_D, pos: [-1.1, 3.3, -0.9], scale: [0.45, 1.4, 0.45] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [1.92, 1.4, 1.1], scale: [0.06, 0.6, 0.55] }),
          part(G.box, { color: "#ffffff", pos: [1.92, 1.4, -1.1], scale: [0.06, 0.6, 0.55] }),
          part(G.box, { color: "#ffffff", pos: [0, 1.4, 1.62], scale: [0.6, 0.6, 0.06] }),
        ]),
      };
    case "storage":
      return {
        geo: merge([
          part(G.box, { color: "#8f6a45", pos: [0, 0.65, 0], scale: [2.2, 1.3, 1.8] }),
          part(G.box, { color: "#6e4a30", pos: [0, 1.4, 0], scale: [2.5, 0.12, 2.1], rot: [0.12, 0, 0] }),
          part(G.box, { color: "#c09a62", pos: [1.3, 0.25, 0.6], scale: [0.45, 0.45, 0.45] }),
          part(G.cyl(0.25, 0.2, 0.4, 7), { color: "#d2b071", pos: [1.3, 0.2, -0.5] }),
        ]),
      };
    case "rack": {
      const parts = [];
      for (const z of [-0.9, 0.9]) {
        parts.push(part(G.cyl(0.04, 0.05, 1.7, 4), { color: WOOD_D, pos: [0.3, 0.8, z], rot: [0, 0, 0.35] }));
        parts.push(part(G.cyl(0.04, 0.05, 1.7, 4), { color: WOOD_D, pos: [-0.3, 0.8, z], rot: [0, 0, -0.35] }));
      }
      parts.push(part(G.cyl(0.04, 0.04, 2.0, 4), { color: WOOD, pos: [0, 1.5, 0], rot: [Math.PI / 2, 0, 0] }));
      for (let i = 0; i < 4; i++) parts.push(part(G.ico(0.14, 0), { color: i % 2 ? "#c98a4a" : "#b5653d", pos: [0, 1.25, -0.6 + i * 0.4], scale: [0.5, 1.6, 0.5] }));
      return { geo: merge(parts) };
    }
    case "kiln":
      return {
        geo: merge([
          part(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), { color: "#b0664a" }),
          part(G.box, { color: "#2a1d18", pos: [1.0, 0.3, 0], scale: [0.2, 0.5, 0.5] }),
          part(G.cyl(0.18, 0.22, 0.5, 6), { color: "#9a553c", pos: [0, 1.25, 0] }),
        ]),
      };
    case "farm": {
      const parts = [part(G.box, { color: "#8a6844", pos: [0, 0.0, 0], scale: [4.4, 0.3, 4.4] })];
      for (let i = 0; i < 4; i++) parts.push(part(G.box, { color: "#6e5034", pos: [-1.65 + i * 1.1, 0.16, 0], scale: [0.3, 0.06, 4.1] }));
      for (const [x, z] of [[2.2, 2.2], [2.2, -2.2], [-2.2, 2.2], [-2.2, -2.2]]) parts.push(part(G.cyl(0.05, 0.06, 0.7, 4), { color: WOOD_D, pos: [x, 0.35, z] }));
      return { geo: merge(parts) };
    }
    case "pen": {
      const parts = [part(G.cyl(3.0, 3.0, 0.05, 16), { color: "#c8b26a", pos: [0, 0.03, 0] })];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        parts.push(part(G.cyl(0.06, 0.07, 0.9, 4), { color: WOOD_D, pos: [Math.cos(a) * 3.1, 0.45, Math.sin(a) * 3.1] }));
        const a2 = ((i + 0.5) / 14) * Math.PI * 2;
        if (i !== 0) parts.push(part(G.box, { color: WOOD, pos: [Math.cos(a2) * 3.08, 0.6, Math.sin(a2) * 3.08], scale: [0.06, 0.08, 1.4], rot: [0, -a2, 0] }));
      }
      return { geo: merge(parts) };
    }
    case "well":
      return {
        geo: merge([
          part(G.cyl(0.8, 0.85, 0.8, 10), { color: STONE, pos: [0, 0.4, 0] }),
          part(G.cyl(0.62, 0.62, 0.05, 10), { color: "#2f4f5a", pos: [0, 0.78, 0] }),
          part(G.cyl(0.05, 0.05, 1.6, 4), { color: WOOD_D, pos: [0, 1.2, 0.75] }),
          part(G.cyl(0.05, 0.05, 1.6, 4), { color: WOOD_D, pos: [0, 1.2, -0.75] }),
          part(G.box, { color: ROOF, pos: [0, 2.05, 0], scale: [1.3, 0.1, 1.9] }),
          part(G.cyl(0.14, 0.12, 0.22, 6), { color: "#8a5f3d", pos: [0, 1.2, 0] }),
        ]),
      };
    case "workshop":
      return {
        geo: merge([
          ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => part(G.cyl(0.07, 0.08, 1.9, 5), { color: WOOD_D, pos: [x * 1.3, 0.95, z * 1.0] })),
          part(G.box, { color: STRAW, pos: [0, 2.0, 0], scale: [3.0, 0.14, 2.4], rot: [0.08, 0, 0] }),
          part(G.box, { color: WOOD, pos: [0, 0.55, 0], scale: [1.6, 0.12, 0.8] }),
          part(G.box, { color: WOOD_D, pos: [0, 0.27, 0], scale: [1.4, 0.5, 0.1] }),
          part(G.dodec(0.18), { color: STONE_D, pos: [0.4, 0.7, 0.1] }),
          part(G.box, { color: "#6b6b6b", pos: [-0.8, 0.35, -0.6], scale: [0.5, 0.45, 0.35] }),
        ]),
      };
    case "smelter":
      return {
        geo: merge([
          part(G.cyl(0.65, 0.95, 2.6, 8), { color: "#8f8a82", pos: [0, 1.3, 0] }),
          part(G.cyl(0.7, 0.7, 0.2, 8), { color: STONE_D, pos: [0, 2.65, 0] }),
          part(G.box, { color: STONE_D, pos: [0.9, 0.3, 0], scale: [0.6, 0.6, 0.8] }),
        ]),
        windows: merge([part(G.box, { color: "#ffffff", pos: [0.86, 0.6, 0], scale: [0.12, 0.4, 0.4] })]),
      };
    case "dock": {
      const parts = [part(G.box, { color: "#a07850", pos: [2.4, 0.35, 0], scale: [5.6, 0.12, 1.5] })];
      for (let i = 0; i < 4; i++) for (const z of [-0.7, 0.7]) parts.push(part(G.cyl(0.08, 0.08, 1.6, 5), { color: WOOD_D, pos: [0.4 + i * 1.6, -0.2, z] }));
      // 작은 배
      parts.push(part(G.box, { color: "#c2763d", pos: [3.6, 0.05, 1.5], scale: [2.0, 0.35, 0.7] }));
      parts.push(part(G.box, { color: "#e9e1d0", pos: [3.6, 0.25, 1.5], scale: [1.6, 0.1, 0.5] }));
      return { geo: merge(parts) };
    }
    case "library":
      return {
        geo: merge([
          part(G.box, { color: "#e8dcc0", pos: [0, 1.25, 0], scale: [3.6, 2.5, 4.0] }),
          part(G.box, { color: "#c9b48a", pos: [0, 0.1, 0], scale: [4.4, 0.2, 4.6] }),
          ...[-1.5, -0.5, 0.5, 1.5].map((z) => part(G.cyl(0.14, 0.16, 2.4, 8), { color: "#f3ead6", pos: [2.05, 1.3, z] })),
          part(G.box, { color: "#d9c79e", pos: [0.3, 2.6, 0], scale: [4.4, 0.2, 4.5] }),
          ...gable(4.4, 4.5, 0.9, 2.7, "#8a6a4a", "#e8dcc0"),
          part(G.box, { color: "#5a3b26", pos: [1.82, 0.85, 0], scale: [0.06, 1.5, 0.8] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [0, 1.5, 2.02], scale: [0.6, 0.8, 0.05] }),
          part(G.box, { color: "#ffffff", pos: [0, 1.5, -2.02], scale: [0.6, 0.8, 0.05] }),
        ]),
      };
    case "windmill":
      return {
        geo: merge([
          part(G.cyl(0.85, 1.3, 4.2, 8), { color: "#ece4d3", pos: [0, 2.1, 0] }),
          part(G.cone(1.1, 1.2, 8), { color: "#8a4b32", pos: [0, 4.8, 0] }),
          part(G.box, { color: "#5a3b26", pos: [1.18, 0.6, 0], scale: [0.08, 1.1, 0.6] }),
        ]),
        windows: merge([part(G.box, { color: "#ffffff", pos: [1.0, 2.6, 0], scale: [0.06, 0.45, 0.4] })]),
      };
    case "observatory":
      return {
        geo: merge([
          part(G.cyl(1.8, 1.9, 2.2, 12), { color: "#dcd6cc", pos: [0, 1.1, 0] }),
          part(new THREE.SphereGeometry(1.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), { color: "#9aa9b8", pos: [0, 2.2, 0] }),
          part(G.box, { color: "#2a3340", pos: [0.95, 3.0, 0], scale: [1.2, 0.9, 0.35], rot: [0, 0, -0.7] }),
          part(G.cyl(0.12, 0.12, 1.4, 6), { color: "#4a4f57", pos: [1.25, 3.25, 0], rot: [0, 0, -0.9] }),
          part(G.box, { color: "#5a3b26", pos: [1.86, 0.7, 0], scale: [0.08, 1.3, 0.7] }),
        ]),
      };
    case "lighthouse": {
      const parts = [];
      const bands = 6;
      for (let i = 0; i < bands; i++) {
        const r0 = 1.1 - i * 0.05, r1 = 1.1 - (i + 1) * 0.05;
        parts.push(part(G.cyl(r1, r0, 1.15, 12), { color: i % 2 ? "#d8473b" : "#f4f1ea", pos: [0, 0.575 + i * 1.15, 0] }));
      }
      parts.push(part(G.cyl(1.05, 1.05, 0.15, 12), { color: "#3d3d42", pos: [0, 7.0, 0] }));
      parts.push(part(G.cone(0.85, 0.9, 12), { color: "#d8473b", pos: [0, 8.35, 0] }));
      parts.push(part(G.box, { color: "#4f3a2a", pos: [1.08, 0.6, 0], scale: [0.08, 1.1, 0.6] }));
      return {
        geo: merge(parts),
        windows: merge([part(G.cyl(0.6, 0.6, 0.85, 10), { color: "#ffffff", pos: [0, 7.5, 0] })]),
      };
    }
    case "grave":
      return {
        geo: merge([
          part(G.ico(0.55, 0), { color: "#7b6248", scale: [1.3, 0.35, 0.8], pos: [0, 0.05, 0] }),
          part(G.box, { color: "#a8a39a", pos: [-0.65, 0.4, 0], scale: [0.12, 0.8, 0.45] }),
          part(G.ico(0.07, 0), { color: "#ffe066", pos: [0.2, 0.25, 0.25] }),
          part(G.ico(0.07, 0), { color: "#ff9ec7", pos: [0.35, 0.22, -0.2] }),
          part(G.ico(0.07, 0), { color: "#ffffff", pos: [0.05, 0.27, -0.05] }),
        ]),
      };
    case "raft": {
      const parts = [];
      for (let i = 0; i < 5; i++) parts.push(part(G.cyl(0.13, 0.13, 2.2, 6), { color: i % 2 ? "#8a6a48" : "#7a5c3e", pos: [0, 0.1, -0.56 + i * 0.28], rot: [0, 0, Math.PI / 2] }));
      parts.push(part(G.box, { color: "#c9b48a", pos: [0.6, 0.22, 0], scale: [0.08, 0.06, 1.5] }));
      parts.push(part(G.box, { color: "#c9b48a", pos: [-0.6, 0.22, 0], scale: [0.08, 0.06, 1.5] }));
      return { geo: merge(parts) };
    }
    case "bench":
      return {
        geo: merge([
          part(G.box, { color: WOOD, pos: [0, 0.45, 0], scale: [0.5, 0.08, 1.6] }),
          part(G.box, { color: WOOD_D, pos: [0, 0.22, 0.65], scale: [0.4, 0.44, 0.1] }),
          part(G.box, { color: WOOD_D, pos: [0, 0.22, -0.65], scale: [0.4, 0.44, 0.1] }),
          part(G.box, { color: WOOD, pos: [-0.22, 0.75, 0], scale: [0.06, 0.5, 1.6] }),
        ]),
      };
  }
}

const MODELS = new Map<StructureType, Model>();
const modelOf = (t: StructureType) => {
  let m = MODELS.get(t);
  if (!m) MODELS.set(t, (m = buildModel(t)));
  return m;
};

const windowMat = new THREE.MeshStandardMaterial({ color: "#bfe3ff", emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0, flatShading: true });
const scaffoldMat = new THREE.MeshStandardMaterial({ color: "#c9a26b", flatShading: true, transparent: true, opacity: 0.85 });
const ghostMat = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.18, depthWrite: false });
const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4);

const flameGeo = new THREE.ConeGeometry(0.32, 0.9, 6, 1, true);
const flameInnerGeo = new THREE.ConeGeometry(0.18, 0.55, 6);
const flameMat = new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const flameInnerMat = new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.95, depthWrite: false });
const beamGeo = new THREE.ConeGeometry(2.2, 26, 16, 1, true).rotateZ(Math.PI / 2).translate(13, 0, 0);
const beamMat = new THREE.MeshBasicMaterial({ color: "#fff3c4", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });

function StructureMesh({ s, terrain }: { s: Structure; terrain: Terrain }) {
  const model = modelOf(s.type);
  const def = STRUCTS[s.type];
  const flatOnGround = s.type === "farm" || s.type === "pen" || s.type === "grave";
  const groundY = s.type === "dock" ? 0 : s.type === "raft" ? Math.max(-0.15, terrain.height(s.x, s.z)) : terrain.height(s.x, s.z) - (flatOnGround ? 0.1 : 0.05);
  const done = s.prog >= 1;
  const sy = done ? 1 : 0.12 + 0.88 * s.prog;
  // 밭·우리는 땅의 기울기를 따라 눕힌다
  const tilt = useMemo(() => {
    if (!flatOnGround) return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.rot);
    const e = 1.5;
    const n = new THREE.Vector3(
      -(terrain.height(s.x + e, s.z) - terrain.height(s.x - e, s.z)) / (2 * e),
      1,
      -(terrain.height(s.x, s.z + e) - terrain.height(s.x, s.z - e)) / (2 * e),
    ).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.rot));
  }, [flatOnGround, s.x, s.z, s.rot, terrain]);
  return (
    <group position={[s.x, groundY, s.z]} quaternion={tilt}>
      <group scale={[1, sy, 1]}>
        <mesh geometry={model.geo} material={vcMat} castShadow receiveShadow />
        {model.windows && <mesh geometry={model.windows} material={windowMat} />}
      </group>
      {!done && (
        <>
          <mesh geometry={model.geo} material={ghostMat} />
          {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z], i) => (
            <mesh key={i} geometry={poleGeo} material={scaffoldMat} position={[x * def.radius * 0.8, 1, z * def.radius * 0.8]} scale={[1, 2, 1]} />
          ))}
        </>
      )}
    </group>
  );
}

export function Structures({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(150);
  // 건설 진행도는 구조 버전과 무관하게 천천히 갱신
  const [tick, setTick] = useState(0);
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < 1500) return;
    last.current = now;
    if (rt.world?.structures.some((s) => s.prog < 1)) setTick((t) => t + 1);
  });
  const list = useMemo(() => (rt.world ? rt.world.structures.map((s) => ({ ...s })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, tick]);

  return (
    <group>
      {list.map((s) => (
        <StructureMesh key={s.id} s={s} terrain={terrain} />
      ))}
      <Fires terrain={terrain} />
      <Specials terrain={terrain} />
      <Stockpile terrain={terrain} />
    </group>
  );
}

/** 모닥불·불타는 나무: 불꽃 메시는 모두, 실제 조명은 카메라 가까운 4개만 */
function Fires({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const { camera } = useThree();
  const flames = useRef<THREE.Group>(null);
  const lights = useRef<THREE.PointLight[]>([]);
  const POOL = 24;
  useFrame((state) => {
    const w = rt.world;
    const g = flames.current;
    if (!w || !g) return;
    const t = state.clock.elapsedTime;
    const fires: { x: number; y: number; z: number; s: number; d: number }[] = [];
    for (const s of w.structures) {
      if (s.type === "campfire" && s.lit) {
        const y = terrain.height(s.x, s.z);
        fires.push({ x: s.x, y: y + 0.1, z: s.z, s: 0.6 + Math.min(1, s.fuel / 60) * 0.6, d: 0 });
      }
    }
    for (const p of w.plants) {
      if (p.burn) fires.push({ x: p.x, y: terrain.height(p.x, p.z) + 1.2 * p.s, z: p.z, s: 2.4 * p.s, d: 0 });
    }
    let near = 0;
    for (const f of fires) {
      f.d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z);
      near = Math.max(near, 1 - Math.min(1, f.d / 30));
    }
    amb?.update({ rain: env.rain, wind: env.wind, day: env.day, fire: near, sea: 1 - Math.min(1, camera.position.y / 160) });
    fires.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const child = g.children[i] as THREE.Group;
      const f = fires[i];
      if (!f) {
        child.visible = false;
        continue;
      }
      child.visible = true;
      const flick = 1 + Math.sin(t * 13 + i * 3) * 0.08 + Math.sin(t * 23 + i) * 0.05;
      child.position.set(f.x, f.y + 0.35 * f.s, f.z);
      child.scale.set(f.s, f.s * flick, f.s);
      child.rotation.y = t * 1.5 + i;
    }
    for (let i = 0; i < lights.current.length; i++) {
      const L = lights.current[i];
      const f = fires[i];
      if (!L) continue;
      if (!f || f.d > 90) {
        L.intensity = 0;
        continue;
      }
      L.position.set(f.x, f.y + 0.9, f.z);
      L.intensity = (6 + Math.sin(t * 17 + i) * 1.2) * f.s * (0.35 + env.night * 0.9);
    }
  });
  return (
    <>
      <group ref={flames}>
        {Array.from({ length: POOL }, (_, i) => (
          <group key={i} visible={false}>
            <mesh geometry={flameGeo} material={flameMat} />
            <mesh geometry={flameInnerGeo} material={flameInnerMat} position-y={-0.1} />
          </group>
        ))}
      </group>
      {[0, 1, 2, 3].map((i) => (
        <pointLight
          key={i}
          ref={(l) => {
            if (l) lights.current[i] = l;
          }}
          color="#ff9a45"
          intensity={0}
          distance={14}
          decay={1.6}
        />
      ))}
    </>
  );
}

/** 풍차 날개, 등대 불빛, 창문 불빛 */
function Specials({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(500);
  const mills = useRef<THREE.Group[]>([]);
  const beams = useRef<THREE.Group[]>([]);
  const { windmills, lighthouses } = useMemo(() => {
    const w = rt.world;
    return {
      windmills: w ? w.structures.filter((s) => s.type === "windmill" && s.prog >= 1) : [],
      lighthouses: w ? w.structures.filter((s) => s.type === "lighthouse" && s.prog >= 1) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const bladeGeo = useMemo(
    () => merge([0, 1, 2, 3].map((i) => part(G.box, { color: "#efe6d2", pos: [0, Math.cos((i * Math.PI) / 2) * 1.5, Math.sin((i * Math.PI) / 2) * 1.5], scale: [0.06, i % 2 ? 0.45 : 3.0, i % 2 ? 3.0 : 0.45] }))),
    [],
  );
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    for (const m of mills.current) if (m) m.rotation.x += dt * (0.4 + env.wind * 1.6);
    for (const b of beams.current) {
      if (!b) continue;
      b.rotation.y = t * 0.6;
      b.visible = env.night > 0.3 || env.cloud > 0.8;
    }
    windowMat.emissiveIntensity = env.night * (env.electric ? 1.6 : 0.7) + (1 - env.day) * 0.3;
  });
  return (
    <>
      {windmills.map((s, i) => (
        <group key={s.id} position={[s.x, terrain.height(s.x, s.z), s.z]} rotation-y={-s.rot}>
          <group
            position={[1.25, 3.9, 0]}
            ref={(g) => {
              if (g) mills.current[i] = g;
            }}
          >
            <mesh geometry={bladeGeo} material={vcMat} castShadow />
          </group>
        </group>
      ))}
      {lighthouses.map((s, i) => (
        <group
          key={s.id}
          position={[s.x, terrain.height(s.x, s.z) + 7.5, s.z]}
          ref={(g) => {
            if (g) beams.current[i] = g;
          }}
        >
          <mesh geometry={beamGeo} material={beamMat} />
          <mesh geometry={beamGeo} material={beamMat} rotation-y={Math.PI} />
        </group>
      ))}
    </>
  );
}

/** 창고 옆에 쌓인 자원 */
function Stockpile({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const logs = useRef<THREE.InstancedMesh>(null);
  const stones = useRef<THREE.InstancedMesh>(null);
  const food = useRef<THREE.InstancedMesh>(null);
  const last = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const w = rt.world;
    if (!w) return;
    const now = performance.now();
    if (now - last.current < 1000) return;
    last.current = now;
    const st = w.structures.find((s) => s.type === "storage" && s.prog >= 1);
    const bx = st ? st.x - 1.6 : w.camp.x - 2.4;
    const bz = st ? st.z + 1.4 : w.camp.z + 1.6;
    const y = terrain.height(bx, bz);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const place = (mesh: THREE.InstancedMesh | null, n: number, fn: (i: number) => [number, number, number, number], lying = false) => {
      if (!mesh) return;
      const c = Math.min(n, mesh.instanceMatrix.count);
      for (let i = 0; i < c; i++) {
        const [x, yy, z, r] = fn(i);
        q.setFromEuler(e.set(lying ? Math.PI / 2 : 0, r, 0));
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, yy, z), q, new THREE.Vector3(1, 1, 1)));
      }
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    const wood = Math.min(24, Math.floor((w.stock.wood ?? 0) + (w.stock.stick ?? 0) / 3));
    place(logs.current, wood, (i) => [bx + (i % 4) * 0.24 - 0.36, y + 0.12 + Math.floor(i / 4) * 0.2, bz, 0], true);
    const stone = Math.min(16, Math.floor((w.stock.stone ?? 0) / 2));
    place(stones.current, stone, (i) => [bx + 1.4 + (i % 4) * 0.25 - 0.3, y + 0.12 + Math.floor(i / 8) * 0.2, bz + (Math.floor(i / 4) % 2) * 0.3, i]);
    let f = 0;
    for (const r of ["berry", "fruit", "meat", "fish", "cookedMeat", "cookedFish", "crop", "meal"] as const) f += w.stock[r] ?? 0;
    place(food.current, Math.min(14, Math.ceil(f / 3)), (i) => [bx - 0.3 + (i % 5) * 0.22, y + 0.12 + Math.floor(i / 5) * 0.18, bz - 1.0, i]);
  });
  return (
    <>
      <instancedMesh ref={logs} args={[undefined, undefined, 24]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.11, 0.11, 1.0, 6]} />
        <meshStandardMaterial color="#8a5a3b" flatShading />
      </instancedMesh>
      <instancedMesh ref={stones} args={[undefined, undefined, 16]} castShadow frustumCulled={false}>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#9b968e" flatShading />
      </instancedMesh>
      <instancedMesh ref={food} args={[undefined, undefined, 14]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial color="#e2453a" flatShading />
      </instancedMesh>
    </>
  );
}
