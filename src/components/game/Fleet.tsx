"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { shipSpots } from "@/sim/nation";
import type { Terrain } from "@/sim/terrain";
import { useRuntime } from "./context";
import { G, merge, part, vcMat } from "./geo";

/** 바다 건너 나라의 배: 무역선은 선착장 곁에, 전함은 앞바다에 늘어선다 */
const hull = merge([
  part(G.box, { color: "#6e4a30", pos: [0, 0.35, 0], scale: [5.2, 0.9, 1.7] }),
  part(G.cone(0.85, 1.4, 4), { color: "#6e4a30", pos: [3.2, 0.35, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 1.2] }),
  part(G.box, { color: "#8f6a45", pos: [-0.3, 0.84, 0], scale: [5.0, 0.1, 1.5] }),
  part(G.box, { color: "#7a5235", pos: [-2.2, 1.2, 0], scale: [1.1, 0.7, 1.5] }),
  part(G.cyl(0.08, 0.1, 5.2, 6), { color: "#5a3b26", pos: [0.4, 3.4, 0] }),
  part(G.cyl(0.06, 0.08, 3.6, 6), { color: "#5a3b26", pos: [-1.6, 2.7, 0] }),
]);
const cannons = merge([-1.2, 0, 1.2].flatMap((x) => [
  part(G.cyl(0.1, 0.12, 0.7, 6), { color: "#2f3033", pos: [x, 0.62, 0.92], rot: [Math.PI / 2, 0, 0] }),
  part(G.cyl(0.1, 0.12, 0.7, 6), { color: "#2f3033", pos: [x, 0.62, -0.92], rot: [Math.PI / 2, 0, 0] }),
]));
const sailGeo = new THREE.PlaneGeometry(1, 1);

export function Fleet({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const ships = useRef<THREE.Group>(null);
  const sails = useMemo(() => Array.from({ length: 3 }, () => new THREE.MeshStandardMaterial({ color: "#f3efe6", side: THREE.DoubleSide, flatShading: true })), []);
  useFrame((state) => {
    const w = rt.world;
    const g = ships.current;
    if (!w || !g) return;
    const list = shipSpots(w, terrain);
    const t = state.clock.elapsedTime;
    for (let i = 0; i < 3; i++) {
      const s = list[i];
      const o = g.children[i] as THREE.Group;
      if (!s) {
        o.visible = false;
        continue;
      }
      o.visible = true;
      o.position.set(s.x, 0.05 + Math.sin(t * 0.9 + i) * 0.12, s.z);
      o.rotation.set(Math.sin(t * 0.7 + i) * 0.04, -s.rot, Math.sin(t * 0.8 + i * 2) * 0.03);
      // 나라의 빛깔을 띤 돛 (전함은 짙게)
      sails[i].color.setHSL(s.hue, s.war ? 0.55 : 0.35, s.war ? 0.32 : 0.82);
      o.children[1].visible = s.war;
    }
  });
  return (
    <group ref={ships}>
      {sails.map((m, i) => (
        <group key={i} visible={false} scale={1.1}>
          <mesh geometry={hull} material={vcMat} castShadow />
          <mesh geometry={cannons} material={vcMat} />
          <mesh geometry={sailGeo} material={m} position={[0.4, 3.6, 0]} scale={[2.6, 3.0, 1]} castShadow />
          <mesh geometry={sailGeo} material={m} position={[-1.6, 2.9, 0]} scale={[1.8, 2.0, 1]} castShadow />
        </group>
      ))}
    </group>
  );
}
