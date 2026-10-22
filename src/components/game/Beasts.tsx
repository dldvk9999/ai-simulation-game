"use client";
// 맹수: 늑대 · 곰 · 호랑이 · 검치호. 강한 놈일수록 크게, 싸우는 동안에는 머리 위에 체력이 보인다.
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { growthOf } from "@/sim/beasts";
import type { Terrain } from "@/sim/terrain";
import type { BeastKind } from "@/sim/types";
import { useRuntime, useWorldVersion } from "./context";
import { env, follow, lerpAngle } from "./env";
import { G, merge, part, vcMat } from "./geo";

const legs = (color: string, x: number, z: number, h: number, t = 0.1) =>
  [[x, z], [x, -z], [-x, z], [-x, -z]].map(([a, b]) => part(G.box, { color, pos: [a, h / 2, b], scale: [t, h, t] }));

const stripes = (color: string, x0: number, x1: number, n: number, y: number, h: number, w: number) =>
  Array.from({ length: n }, (_, i) => part(G.box, { color, pos: [x0 + ((x1 - x0) * i) / (n - 1), y, 0], scale: [0.07, h, w], rot: [0, 0, 0.25] }));

const GEO: Record<BeastKind, THREE.BufferGeometry> = {
  wolf: merge([
    part(G.box, { color: "#8a8d91", pos: [0, 0.62, 0], scale: [1.0, 0.4, 0.36] }),
    part(G.box, { color: "#9b9ea2", pos: [0.36, 0.66, 0], scale: [0.4, 0.48, 0.4] }),
    part(G.box, { color: "#8a8d91", pos: [0.68, 0.86, 0], scale: [0.34, 0.3, 0.3] }),
    part(G.box, { color: "#b9bcc0", pos: [0.9, 0.79, 0], scale: [0.24, 0.14, 0.16] }),
    part(G.box, { color: "#1d1d1f", pos: [1.02, 0.82, 0], scale: [0.04, 0.05, 0.06] }),
    part(G.cone(0.06, 0.18, 4), { color: "#6f7276", pos: [0.62, 1.07, 0.09] }),
    part(G.cone(0.06, 0.18, 4), { color: "#6f7276", pos: [0.62, 1.07, -0.09] }),
    part(G.box, { color: "#7a7d81", pos: [-0.66, 0.72, 0], scale: [0.48, 0.11, 0.11], rot: [0, 0, 0.55] }),
    ...legs("#6f7276", 0.33, 0.12, 0.46, 0.09),
  ]),
  bear: merge([
    part(G.box, { color: "#6b4a32", pos: [0, 0.95, 0], scale: [1.5, 0.85, 0.8] }),
    part(G.box, { color: "#5e412b", pos: [0.2, 1.38, 0], scale: [0.65, 0.28, 0.66] }),
    part(G.box, { color: "#6b4a32", pos: [0.95, 1.1, 0], scale: [0.5, 0.46, 0.5] }),
    part(G.box, { color: "#a07a58", pos: [1.25, 1.0, 0], scale: [0.26, 0.22, 0.26] }),
    part(G.box, { color: "#1d1d1f", pos: [1.39, 1.04, 0], scale: [0.05, 0.07, 0.09] }),
    part(G.ico(0.1, 0), { color: "#5e412b", pos: [0.86, 1.38, 0.2] }),
    part(G.ico(0.1, 0), { color: "#5e412b", pos: [0.86, 1.38, -0.2] }),
    ...legs("#563b27", 0.5, 0.25, 0.62, 0.24),
  ]),
  tiger: merge([
    part(G.box, { color: "#e0882e", pos: [0, 0.76, 0], scale: [1.5, 0.5, 0.5] }),
    ...stripes("#2a1c14", -0.6, 0.5, 6, 0.82, 0.42, 0.52),
    part(G.box, { color: "#f2efe6", pos: [0.1, 0.55, 0], scale: [1.1, 0.12, 0.4] }),
    part(G.box, { color: "#e0882e", pos: [0.95, 0.92, 0], scale: [0.42, 0.38, 0.42] }),
    part(G.box, { color: "#f2efe6", pos: [1.16, 0.84, 0], scale: [0.16, 0.18, 0.3] }),
    part(G.box, { color: "#1d1d1f", pos: [1.25, 0.88, 0], scale: [0.04, 0.05, 0.08] }),
    part(G.cone(0.07, 0.14, 4), { color: "#e0882e", pos: [0.86, 1.16, 0.15] }),
    part(G.cone(0.07, 0.14, 4), { color: "#e0882e", pos: [0.86, 1.16, -0.15] }),
    part(G.box, { color: "#e0882e", pos: [-0.95, 0.85, 0], scale: [0.7, 0.1, 0.1], rot: [0, 0, 0.45] }),
    part(G.box, { color: "#2a1c14", pos: [-1.27, 1.0, 0], scale: [0.14, 0.11, 0.11], rot: [0, 0, 0.45] }),
    ...legs("#d27a26", 0.5, 0.17, 0.55, 0.14),
  ]),
  sabertooth: merge([
    part(G.box, { color: "#c49a62", pos: [0, 0.86, 0], scale: [1.6, 0.62, 0.62] }),
    part(G.box, { color: "#b38a55", pos: [0.3, 1.12, 0], scale: [0.7, 0.24, 0.6] }),
    ...stripes("#8a6640", -0.6, 0.4, 4, 0.95, 0.3, 0.64),
    part(G.box, { color: "#c49a62", pos: [1.02, 1.0, 0], scale: [0.48, 0.44, 0.48] }),
    part(G.box, { color: "#e8dcc4", pos: [1.26, 0.9, 0], scale: [0.18, 0.18, 0.34] }),
    part(G.cone(0.035, 0.34, 4), { color: "#fffdf4", pos: [1.3, 0.68, 0.09], rot: [Math.PI, 0, 0] }),
    part(G.cone(0.035, 0.34, 4), { color: "#fffdf4", pos: [1.3, 0.68, -0.09], rot: [Math.PI, 0, 0] }),
    part(G.box, { color: "#1d1d1f", pos: [1.35, 0.98, 0], scale: [0.05, 0.06, 0.1] }),
    part(G.cone(0.08, 0.16, 4), { color: "#b38a55", pos: [0.92, 1.28, 0.17] }),
    part(G.cone(0.08, 0.16, 4), { color: "#b38a55", pos: [0.92, 1.28, -0.17] }),
    part(G.box, { color: "#b38a55", pos: [-0.88, 0.95, 0], scale: [0.3, 0.12, 0.12], rot: [0, 0, 0.5] }),
    ...legs("#a8804f", 0.55, 0.2, 0.6, 0.18),
  ]),
};

const BASE: Record<BeastKind, number> = { wolf: 1, bear: 1, tiger: 1, sabertooth: 1.1 };
/** 머리 위치 (눈 · 체력 막대) */
const HEAD: Record<BeastKind, [number, number]> = { wolf: [0.86, 0.9], bear: [1.2, 1.15], tiger: [1.14, 0.95], sabertooth: [1.22, 1.06] };

const eyeGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const eyeMat = new THREE.MeshBasicMaterial({ color: "#ffd84d" });
const barGeo = new THREE.PlaneGeometry(1, 0.12);
const barBg = new THREE.MeshBasicMaterial({ color: "#2a2422", transparent: true, opacity: 0.75, depthWrite: false });
const barFg = new THREE.MeshBasicMaterial({ color: "#e5484d", depthWrite: false });
const starGeo = new THREE.TetrahedronGeometry(0.09);
const starMat = new THREE.MeshBasicMaterial({ color: "#ffe14d" });

type Disp = { x: number; z: number; r: number };

export function Beasts({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(200);
  const { camera } = useThree();
  const groups = useRef(new Map<number, THREE.Group>());
  const disp = useRef(new Map<number, Disp>());
  const list = useMemo(() => (rt.world ? rt.world.beasts.map((b) => ({ id: b.id, kind: b.kind })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);

  useFrame((state, dt) => {
    const w = rt.world;
    if (!w) return;
    const t = state.clock.elapsedTime;
    for (const b of w.beasts) {
      const g = groups.current.get(b.id);
      if (!g) continue;
      let d = disp.current.get(b.id);
      if (!d) disp.current.set(b.id, (d = { x: b.x, z: b.z, r: b.rot }));
      follow(d, b.x, b.z, dt, 6);
      d.r = lerpAngle(d.r, b.rot, 1 - Math.exp(-dt * 5));
      const ground = Math.max(terrain.height(d.x, d.z), 0);
      const sc = BASE[b.kind] * (0.85 + 0.45 * growthOf(b));
      const body = g.children[0] as THREE.Group;
      const stars = g.children[1] as THREE.Group;
      const bar = g.children[2] as THREE.Group;
      g.position.set(d.x, ground, d.z);
      g.rotation.set(0, -d.r, 0);
      body.scale.setScalar(sc);
      const moving = b.st === "prowl" || b.st === "chase" || b.st === "leave";
      const pace = b.st === "chase" ? 13 : 8;
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      if (b.st === "dead") {
        body.rotation.set(Math.PI / 2, 0, 0);
        body.position.y = 0.25 * sc;
      } else if (b.st === "stun") {
        body.rotation.set(0.5 + Math.sin(t * 9) * 0.1, 0, -0.15);
      } else if (b.st === "maul") {
        // 앞으로 덮쳤다가 물러난다
        const k = Math.max(0, Math.sin(t * 6 + b.id));
        body.position.x = k * 0.35 * sc;
        body.rotation.z = -k * 0.25;
      } else if (moving) {
        body.position.y = Math.abs(Math.sin(t * pace + b.id)) * 0.08 * sc;
        body.rotation.z = Math.sin(t * pace + b.id) * 0.04;
      }
      stars.visible = b.st === "stun";
      if (stars.visible) {
        stars.rotation.y = t * 4;
        stars.position.y = (HEAD[b.kind][1] + 0.5) * sc;
      }
      // 눈빛은 어두울 때 더 또렷하게
      const eyes = body.children[1] as THREE.Group;
      eyes.visible = b.st !== "dead" && env.night > 0.2;
      // 체력 막대: 다쳤을 때만, 카메라를 향해
      const hurt = b.st !== "dead" && b.hp < b.max - 0.5;
      bar.visible = hurt;
      if (hurt) {
        bar.position.set(0, (HEAD[b.kind][1] + 0.75) * sc, 0);
        bar.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion);
        const fg = bar.children[1] as THREE.Mesh;
        const k = Math.max(0.02, b.hp / b.max);
        fg.scale.x = k;
        fg.position.x = -(1 - k) / 2;
      }
    }
  });

  return (
    <group>
      {list.map(({ id, kind }) => (
        <group
          key={id}
          ref={(g) => {
            if (g) groups.current.set(id, g);
            else {
              groups.current.delete(id);
              disp.current.delete(id);
            }
          }}
        >
          <group>
            <mesh geometry={GEO[kind]} material={vcMat} castShadow />
            <group position={[HEAD[kind][0], HEAD[kind][1], 0]}>
              <mesh geometry={eyeGeo} material={eyeMat} position-z={0.09} />
              <mesh geometry={eyeGeo} material={eyeMat} position-z={-0.09} />
            </group>
          </group>
          <group visible={false}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} geometry={starGeo} material={starMat} position={[Math.cos((i * Math.PI * 2) / 3) * 0.35, 0, Math.sin((i * Math.PI * 2) / 3) * 0.35]} />
            ))}
          </group>
          <group visible={false}>
            <mesh geometry={barGeo} material={barBg} scale={[1.1, 1.4, 1]} renderOrder={5} />
            <mesh geometry={barGeo} material={barFg} position-z={0.01} renderOrder={6} />
          </group>
        </group>
      ))}
    </group>
  );
}
