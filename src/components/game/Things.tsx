"use client";
// 바위 · 동물 · 물고기 · 땅에 떨어진 물건
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Terrain } from "@/sim/terrain";
import type { AnimalKind, Res, RockKind } from "@/sim/types";
import { useRuntime, useWorldVersion } from "./context";
import { follow, lerpAngle } from "./env";
import { G, merge, part, vcMat } from "./geo";

// ─── 바위 ──────────────────────────────────────────────────────────────

const ROCK_GEO: Record<RockKind, THREE.BufferGeometry> = {
  rock: merge([part(G.dodec(0.55), { color: "#9b968e", scale: [1.2, 0.7, 1] , pos: [0, 0.22, 0] }), part(G.dodec(0.3), { color: "#aaa59c", pos: [0.45, 0.12, 0.2] })]),
  boulder: merge([part(G.dodec(1.0), { color: "#8c877f", scale: [1.2, 0.85, 1], pos: [0, 0.5, 0] }), part(G.dodec(0.55), { color: "#9d978e", pos: [0.8, 0.25, -0.3] })]),
  ore: merge([
    part(G.dodec(0.7), { color: "#5d5753", scale: [1.1, 0.8, 1], pos: [0, 0.35, 0] }),
    part(G.ico(0.14, 0), { color: "#e08a3c", pos: [0.35, 0.55, 0.3] }),
    part(G.ico(0.12, 0), { color: "#d9a441", pos: [-0.3, 0.45, 0.35] }),
    part(G.ico(0.1, 0), { color: "#e08a3c", pos: [0.1, 0.72, -0.3] }),
  ]),
  clay: merge([part(G.ico(0.7, 0), { color: "#b0664a", scale: [1.4, 0.35, 1.1], pos: [0, 0.08, 0] }), part(G.ico(0.35, 0), { color: "#c07656", scale: [1, 0.5, 1], pos: [0.6, 0.1, 0.3] })]),
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export function Rocks({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(500);
  const refs = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const last = useRef(0);
  const rebuild = () => {
    const w = rt.world;
    if (!w) return;
    for (const kind of Object.keys(ROCK_GEO) as RockKind[]) {
      const mesh = refs.current[kind];
      if (!mesh) continue;
      let n = 0;
      for (const r of w.rocks) {
        if (r.kind !== kind) continue;
        const s = r.s * (0.45 + 0.55 * Math.max(0, r.amt / r.max));
        tmpP.set(r.x, terrain.height(r.x, r.z) - 0.05, r.z);
        tmpQ.setFromEuler(tmpE.set(0, r.rot, 0));
        mesh.setMatrixAt(n++, tmpM.compose(tmpP, tmpQ, tmpS.setScalar(s)));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(rebuild, [version, terrain]);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current > 3000) {
      last.current = now;
      rebuild();
    }
  });
  return (
    <>
      {(Object.keys(ROCK_GEO) as RockKind[]).map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            refs.current[k] = m;
          }}
          args={[ROCK_GEO[k], vcMat, 60]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </>
  );
}

// ─── 동물 ──────────────────────────────────────────────────────────────

const legs = (color: string, x: number, z: number, h: number) =>
  [[x, z], [x, -z], [-x, z], [-x, -z]].map(([a, b]) => part(G.box, { color, pos: [a, h / 2, b], scale: [0.09, h, 0.09] }));

export const ANIMAL_GEO: Record<AnimalKind, THREE.BufferGeometry> = {
  rabbit: merge([
    part(G.ico(0.26, 1), { color: "#efe6da", scale: [1.25, 0.9, 0.95], pos: [0, 0.27, 0] }),
    part(G.ico(0.17, 1), { color: "#f4ece2", pos: [0.27, 0.46, 0] }),
    part(G.box, { color: "#f4ece2", pos: [0.22, 0.7, 0.06], scale: [0.05, 0.28, 0.08], rot: [0.15, 0, -0.15] }),
    part(G.box, { color: "#f4ece2", pos: [0.22, 0.7, -0.06], scale: [0.05, 0.28, 0.08], rot: [-0.15, 0, -0.15] }),
    part(G.ico(0.08, 0), { color: "#ffffff", pos: [-0.32, 0.32, 0] }),
    part(G.box, { color: "#222222", pos: [0.4, 0.5, 0.08], scale: [0.03, 0.04, 0.03] }),
    part(G.box, { color: "#222222", pos: [0.4, 0.5, -0.08], scale: [0.03, 0.04, 0.03] }),
  ]),
  boar: merge([
    part(G.box, { color: "#5b3d2e", pos: [0, 0.5, 0], scale: [0.9, 0.48, 0.45] }),
    part(G.box, { color: "#4c3226", pos: [0.55, 0.52, 0], scale: [0.34, 0.32, 0.32] }),
    part(G.cyl(0.09, 0.1, 0.16, 6), { color: "#c59384", pos: [0.77, 0.45, 0], rot: [0, 0, Math.PI / 2] }),
    part(G.cone(0.03, 0.14, 4), { color: "#f3ede0", pos: [0.72, 0.38, 0.1], rot: [0, 0, -0.6] }),
    part(G.cone(0.03, 0.14, 4), { color: "#f3ede0", pos: [0.72, 0.38, -0.1], rot: [0, 0, -0.6] }),
    part(G.cone(0.07, 0.14, 4), { color: "#4c3226", pos: [0.5, 0.74, 0.12] }),
    part(G.cone(0.07, 0.14, 4), { color: "#4c3226", pos: [0.5, 0.74, -0.12] }),
    part(G.box, { color: "#111111", pos: [0.72, 0.58, 0.1], scale: [0.03, 0.04, 0.03] }),
    part(G.box, { color: "#111111", pos: [0.72, 0.58, -0.1], scale: [0.03, 0.04, 0.03] }),
    ...legs("#3e291f", 0.3, 0.15, 0.3),
  ]),
  goat: merge([
    part(G.box, { color: "#dcd7cf", pos: [0, 0.6, 0], scale: [0.75, 0.42, 0.36] }),
    part(G.box, { color: "#e6e2da", pos: [0.45, 0.82, 0], scale: [0.26, 0.26, 0.22] }),
    part(G.cone(0.04, 0.24, 4), { color: "#6b5a48", pos: [0.42, 1.02, 0.07], rot: [0, 0, 0.5] }),
    part(G.cone(0.04, 0.24, 4), { color: "#6b5a48", pos: [0.42, 1.02, -0.07], rot: [0, 0, 0.5] }),
    part(G.cone(0.04, 0.12, 4), { color: "#bdb6aa", pos: [0.55, 0.64, 0], rot: [Math.PI, 0, 0] }),
    part(G.box, { color: "#111111", pos: [0.58, 0.86, 0.08], scale: [0.03, 0.04, 0.03] }),
    part(G.box, { color: "#111111", pos: [0.58, 0.86, -0.08], scale: [0.03, 0.04, 0.03] }),
    ...legs("#b8b1a6", 0.27, 0.12, 0.4),
  ]),
  crab: merge([
    part(G.ico(0.2, 0), { color: "#e0553c", scale: [1.3, 0.5, 1], pos: [0, 0.12, 0] }),
    part(G.ico(0.08, 0), { color: "#e86a4c", pos: [0.24, 0.13, 0.18] }),
    part(G.ico(0.08, 0), { color: "#e86a4c", pos: [0.24, 0.13, -0.18] }),
    part(G.box, { color: "#111111", pos: [0.18, 0.22, 0.05], scale: [0.03, 0.06, 0.03] }),
    part(G.box, { color: "#111111", pos: [0.18, 0.22, -0.05], scale: [0.03, 0.06, 0.03] }),
  ]),
  fowl: merge([
    part(G.ico(0.2, 1), { color: "#b8682a", pos: [0, 0.32, 0], scale: [1.15, 0.95, 0.85] }),
    part(G.ico(0.11, 0), { color: "#c47634", pos: [0.18, 0.52, 0] }),
    part(G.box, { color: "#d8312a", pos: [0.18, 0.64, 0], scale: [0.1, 0.07, 0.03] }),
    part(G.cone(0.035, 0.1, 4), { color: "#f0c33c", pos: [0.3, 0.52, 0], rot: [0, 0, -Math.PI / 2] }),
    part(G.cone(0.1, 0.28, 4), { color: "#3b4a2e", pos: [-0.22, 0.42, 0], rot: [0, 0, 0.9] }),
    part(G.cyl(0.02, 0.02, 0.18, 3), { color: "#e3a32b", pos: [0.02, 0.09, 0.06] }),
    part(G.cyl(0.02, 0.02, 0.18, 3), { color: "#e3a32b", pos: [0.02, 0.09, -0.06] }),
  ]),
};

const starGeo = new THREE.TetrahedronGeometry(0.07);
const starMat = new THREE.MeshBasicMaterial({ color: "#ffe14d" });

type Disp = { x: number; z: number; r: number; seen: boolean };

export function Animals({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(200);
  const groups = useRef(new Map<number, THREE.Group>());
  const disp = useRef(new Map<number, Disp>());
  const list = useMemo(() => (rt.world ? rt.world.animals.map((a) => ({ id: a.id, kind: a.kind })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);

  useFrame((state, dt) => {
    const w = rt.world;
    if (!w) return;
    const t = state.clock.elapsedTime;
    const drag = rt.dragLocal;
    for (const a of w.animals) {
      const g = groups.current.get(a.id);
      if (!g) continue;
      let d = disp.current.get(a.id);
      const local = drag && drag.k === "animal" && drag.id === a.id;
      const tx = local ? drag.x : a.x, tz = local ? drag.z : a.z;
      if (!d) disp.current.set(a.id, (d = { x: tx, z: tz, r: a.rot, seen: true }));
      follow(d, tx, tz, dt, local ? 25 : 8);
      d.r = lerpAngle(d.r, a.rot, 1 - Math.exp(-dt * 6));
      const held = local || a.st === "held";
      const ground = Math.max(terrain.height(d.x, d.z), a.kind === "crab" ? -0.5 : -0.2);
      const moving = a.st === "move" || a.st === "flee";
      const speed = a.st === "flee" ? 16 : 9;
      let y = ground;
      if (moving && (a.kind === "rabbit")) y += Math.abs(Math.sin(t * speed + a.id)) * 0.22;
      else if (moving) y += Math.abs(Math.sin(t * speed + a.id)) * 0.04;
      if (held) y = ground + 1.5 + Math.sin(t * 6) * 0.05;
      g.position.set(d.x, y, d.z);
      g.rotation.set(0, -d.r, 0);
      const body = g.children[0] as THREE.Mesh;
      const stars = g.children[1] as THREE.Group;
      if (a.st === "stun") {
        body.rotation.set(Math.PI / 2.2, 0, 0);
        body.position.y = 0.15;
        stars.visible = true;
        stars.rotation.y = t * 4;
      } else if (held) {
        body.rotation.set(Math.sin(t * 9) * 0.25, 0, Math.sin(t * 7) * 0.2);
        body.position.y = 0;
        stars.visible = false;
      } else if (a.st === "sleep") {
        body.rotation.set(0, 0, 0);
        body.position.y = -0.08;
        stars.visible = false;
      } else {
        const peck = a.kind === "fowl" && !moving ? Math.max(0, Math.sin(t * 3 + a.id)) * 0.4 : 0;
        body.rotation.set(0, a.kind === "crab" && moving ? Math.sin(t * 10) * 0.2 : 0, -peck);
        body.position.y = 0;
        stars.visible = false;
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
          <mesh geometry={ANIMAL_GEO[kind]} material={vcMat} castShadow />
          <group position-y={0.95} visible={false}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} geometry={starGeo} material={starMat} position={[Math.cos((i * Math.PI * 2) / 3) * 0.3, 0, Math.sin((i * Math.PI * 2) / 3) * 0.3]} />
            ))}
          </group>
        </group>
      ))}
    </group>
  );
}

// ─── 물고기 ────────────────────────────────────────────────────────────

const FISH_GEO = merge([
  part(G.ico(0.16, 1), { color: "#8fb8d6", scale: [1.9, 0.7, 0.55] }),
  part(G.cone(0.12, 0.2, 4), { color: "#6f9cc0", pos: [-0.36, 0, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.3] }),
  part(G.box, { color: "#1b2733", pos: [0.22, 0.04, 0.07], scale: [0.03, 0.03, 0.02] }),
  part(G.box, { color: "#1b2733", pos: [0.22, 0.04, -0.07], scale: [0.03, 0.03, 0.02] }),
]);
const BIGFISH_GEO = merge([
  part(G.ico(0.16, 1), { color: "#d98f6a", scale: [1.9, 0.8, 0.55] }),
  part(G.cone(0.12, 0.2, 4), { color: "#c4714c", pos: [-0.36, 0, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.3] }),
  part(G.box, { color: "#1b2733", pos: [0.22, 0.05, 0.07], scale: [0.03, 0.03, 0.02] }),
  part(G.box, { color: "#1b2733", pos: [0.22, 0.05, -0.07], scale: [0.03, 0.03, 0.02] }),
]);

export function FishSchool({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(200);
  const groups = useRef(new Map<number, THREE.Group>());
  const disp = useRef(new Map<number, Disp & { jump: number }>());
  const list = useMemo(() => (rt.world ? rt.world.fish.map((f) => ({ id: f.id, big: f.kind === "bigfish" })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);

  useFrame((state, dt) => {
    const w = rt.world;
    if (!w) return;
    const t = state.clock.elapsedTime;
    const drag = rt.dragLocal;
    for (const f of w.fish) {
      const g = groups.current.get(f.id);
      if (!g) continue;
      const local = drag && drag.k === "fish" && drag.id === f.id;
      const tx = local ? drag.x : f.x, tz = local ? drag.z : f.z;
      let d = disp.current.get(f.id);
      if (!d) disp.current.set(f.id, (d = { x: tx, z: tz, r: f.rot, seen: true, jump: t + 5 + Math.random() * 30 }));
      follow(d, tx, tz, dt, local ? 25 : 5);
      d.r = lerpAngle(d.r, f.rot, 1 - Math.exp(-dt * 3));
      const held = local || f.st === "held";
      let y = -0.32 + Math.sin(t * 2 + f.id) * 0.04;
      let rz = Math.sin(t * 8 + f.id) * 0.08;
      let rx = 0;
      if (f.st === "stun") {
        y = 0.02;
        rx = Math.PI;
      } else if (held) {
        y = Math.max(0, terrain.height(d.x, d.z)) + 1.3;
        rz = Math.sin(t * 14) * 0.5;
      } else if (t > d.jump) {
        // 가끔 물 위로 뛰어오른다
        const k = t - d.jump;
        if (k < 0.9) {
          y = -0.3 + Math.sin((k / 0.9) * Math.PI) * 0.9;
          rz = Math.cos((k / 0.9) * Math.PI) * 0.9;
        } else d.jump = t + 8 + Math.random() * 40;
      }
      g.position.set(d.x, y, d.z);
      g.rotation.set(rx, -d.r, rz);
    }
  });

  return (
    <group>
      {list.map(({ id, big }) => (
        <group
          key={id}
          scale={big ? 1.7 : 1}
          ref={(g) => {
            if (g) groups.current.set(id, g);
            else {
              groups.current.delete(id);
              disp.current.delete(id);
            }
          }}
        >
          <mesh geometry={big ? BIGFISH_GEO : FISH_GEO} material={vcMat} />
        </group>
      ))}
    </group>
  );
}

// ─── 물건 ──────────────────────────────────────────────────────────────

function itemGeo(res: Res): THREE.BufferGeometry {
  switch (res) {
    case "wood":
      return merge([
        part(G.cyl(0.13, 0.13, 0.8, 7), { color: "#8a5a3b", rot: [0, 0, Math.PI / 2], pos: [0, 0.13, 0] }),
        part(G.cyl(0.12, 0.12, 0.02, 7), { color: "#d9b88a", rot: [0, 0, Math.PI / 2], pos: [0.41, 0.13, 0] }),
      ]);
    case "stick":
      return merge([
        part(G.cyl(0.035, 0.035, 0.8, 4), { color: "#9b6b45", rot: [0, 0.3, Math.PI / 2], pos: [0, 0.05, 0] }),
        part(G.cyl(0.03, 0.03, 0.7, 4), { color: "#8a5f3d", rot: [0, -0.5, Math.PI / 2], pos: [0, 0.1, 0.05] }),
      ]);
    case "stone": case "ore":
      return merge([part(G.dodec(0.16), { color: res === "ore" ? "#5d5753" : "#a09a91", pos: [0, 0.12, 0] }), ...(res === "ore" ? [part(G.ico(0.05, 0), { color: "#e08a3c", pos: [0.08, 0.2, 0.05] })] : [])]);
    case "fruit":
      return merge([part(G.ico(0.16, 1), { color: "#e9823a", pos: [0, 0.16, 0] }), part(G.cone(0.05, 0.1, 4), { color: "#4f9e3e", pos: [0, 0.33, 0] })]);
    case "berry":
      return merge([
        part(G.ico(0.07, 0), { color: "#c2265a", pos: [0, 0.07, 0] }),
        part(G.ico(0.07, 0), { color: "#a51f4e", pos: [0.1, 0.07, 0.04] }),
        part(G.ico(0.07, 0), { color: "#d0306a", pos: [0.04, 0.15, -0.05] }),
      ]);
    case "fish": case "cookedFish":
      return merge([part(G.ico(0.16, 1), { color: res === "fish" ? "#8fb8d6" : "#c98a4a", scale: [1.9, 0.6, 0.55], pos: [0, 0.1, 0], rot: [Math.PI / 2, 0, 0] })]);
    case "meat": case "cookedMeat":
      return merge([part(G.box, { color: res === "meat" ? "#d77a7a" : "#9a5a34", pos: [0, 0.1, 0], scale: [0.32, 0.18, 0.24] }), part(G.cyl(0.03, 0.03, 0.25, 4), { color: "#f3ede0", pos: [0.2, 0.1, 0], rot: [0, 0, Math.PI / 2] })]);
    case "clay":
      return merge([part(G.ico(0.18, 0), { color: "#b0664a", scale: [1.2, 0.6, 1], pos: [0, 0.1, 0] })]);
    case "fiber": case "herb":
      return merge([0, 1, 2].map((i) => part(G.cone(0.05, 0.45, 3), { color: res === "fiber" ? "#bcd46a" : "#9a7ad6", pos: [Math.cos(i * 2.1) * 0.06, 0.2, Math.sin(i * 2.1) * 0.06], rot: [Math.sin(i * 2.1) * 0.4, 0, -Math.cos(i * 2.1) * 0.4] })));
    case "crop":
      return merge([part(G.cyl(0.08, 0.1, 0.45, 5), { color: "#d9c25a", pos: [0, 0.22, 0] })]);
    default:
      return merge([part(G.box, { color: "#a07850", pos: [0, 0.1, 0], scale: [0.25, 0.2, 0.25] })]);
  }
}

const ITEM_GEOS = new Map<Res, THREE.BufferGeometry>();
const getItemGeo = (r: Res) => {
  let g = ITEM_GEOS.get(r);
  if (!g) ITEM_GEOS.set(r, (g = itemGeo(r)));
  return g;
};
const glowMat = new THREE.MeshBasicMaterial({ color: "#fff3b0", transparent: true, opacity: 0.5, depthWrite: false });
const glowGeo = new THREE.RingGeometry(0.28, 0.4, 18);

export function Items({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(100);
  const groups = useRef(new Map<number, THREE.Group>());
  const disp = useRef(new Map<number, Disp>());
  const list = useMemo(() => (rt.world ? rt.world.items.map((i) => ({ id: i.id, res: i.res })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);

  useFrame((state, dt) => {
    const w = rt.world;
    if (!w) return;
    const t = state.clock.elapsedTime;
    const drag = rt.dragLocal;
    for (const it of w.items) {
      const g = groups.current.get(it.id);
      if (!g) continue;
      const local = drag && drag.k === "item" && drag.id === it.id;
      const tx = local ? drag.x : it.x, tz = local ? drag.z : it.z;
      let d = disp.current.get(it.id);
      if (!d) disp.current.set(it.id, (d = { x: tx, z: tz, r: (it.id * 1.7) % 6.28, seen: true }));
      follow(d, tx, tz, dt, local ? 25 : 12);
      const held = local || !!it.held;
      const ground = Math.max(terrain.height(d.x, d.z), -0.25);
      g.position.set(d.x, held ? ground + 1.3 + Math.sin(t * 5) * 0.05 : ground, d.z);
      g.rotation.set(0, d.r + (held ? t * 1.5 : 0), 0);
      const glow = g.children[1] as THREE.Mesh;
      const fresh = it.gift > 0 && w.time - it.gift < 3600;
      glow.visible = fresh && !held;
      if (glow.visible) glow.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
    }
  });

  return (
    <group>
      {list.map(({ id, res }) => (
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
          <mesh geometry={getItemGeo(res)} material={vcMat} castShadow />
          <mesh geometry={glowGeo} material={glowMat} rotation-x={-Math.PI / 2} position-y={0.03} />
        </group>
      ))}
    </group>
  );
}
