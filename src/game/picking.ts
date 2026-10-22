// 화면 클릭 → 월드의 무엇을 눌렀는지. 렌더링 메시가 아니라 시뮬레이션 상태로 판정한다.
import * as THREE from "three";
import { growthOf } from "@/sim/beasts";
import { heightOf } from "@/sim/building";
import { ageYears } from "@/sim/clock";
import { STRUCTS } from "@/sim/data";
import { isTree } from "@/sim/ecology";
import type { Terrain } from "@/sim/terrain";
import type { TargetKind, WorldState } from "@/sim/types";

export interface Pick {
  k: TargetKind;
  id?: number;
  x: number;
  z: number;
  t: number;
}

/** 반직선과 수직 선분(캡슐) 사이의 거리 */
function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, x: number, y0: number, y1: number, z: number, r: number) {
  // 선분 a→b, 반직선 o + t d
  const ax = x, ay = y0, az = z;
  const ux = 0, uy = y1 - y0, uz = 0;
  const wx = o.x - ax, wy = o.y - ay, wz = o.z - az;
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const b = d.x * ux + d.y * uy + d.z * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const dd = d.x * wx + d.y * wy + d.z * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const den = a * c - b * b;
  let t = den > 1e-9 ? (b * e - c * dd) / den : 0;
  let s = den > 1e-9 ? (a * e - b * dd) / den : 0;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, (b * s - dd) / a);
  const px = o.x + d.x * t - (ax + ux * s);
  const py = o.y + d.y * t - (ay + uy * s);
  const pz = o.z + d.z * t - (az + uz * s);
  const dist = Math.sqrt(px * px + py * py + pz * pz);
  return dist <= r ? t : Infinity;
}

/** 지형(또는 바다) 위의 점 */
export function groundHit(T: Terrain, o: THREE.Vector3, d: THREE.Vector3): { x: number; z: number; t: number; water: boolean } | null {
  let prevT = 0;
  let step = 0.5;
  for (let t = 0.5; t < 600; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = Math.max(T.height(x, z), 0);
    if (y <= h) {
      // 이분 탐색으로 다듬기
      let lo = prevT, hi = t;
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2;
        const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
        if (my <= Math.max(T.height(mx, mz), 0)) hi = m;
        else lo = m;
      }
      const hx = o.x + d.x * hi, hz = o.z + d.z * hi;
      return { x: hx, z: hz, t: hi, water: T.height(hx, hz) < 0.02 || T.inPond(hx, hz, -0.2) };
    }
    prevT = t;
    step = Math.min(2, 0.5 + t * 0.01);
  }
  return null;
}

export function pickWorld(w: WorldState, T: Terrain, ray: THREE.Ray, opts: { draggableOnly?: boolean } = {}): Pick | null {
  const o = ray.origin, d = ray.direction;
  let best: Pick | null = null;
  const consider = (k: TargetKind, id: number, x: number, z: number, t: number) => {
    if (t < Infinity && (!best || t < best.t)) best = { k, id, x, z, t };
  };
  const H = (x: number, z: number) => Math.max(T.height(x, z), -0.3);

  for (const it of w.items) {
    const y = H(it.x, it.z);
    consider("item", it.id, it.x, it.z, rayCapsule(o, d, it.x, y, y + 0.35, it.z, 0.55));
  }
  for (const a of w.animals) {
    const y = H(a.x, a.z);
    const r = a.kind === "boar" || a.kind === "goat" ? 0.75 : 0.55;
    consider("animal", a.id, a.x, a.z, rayCapsule(o, d, a.x, y, y + (a.kind === "crab" ? 0.25 : 0.7), a.z, r));
  }
  for (const f of w.fish) consider("fish", f.id, f.x, f.z, rayCapsule(o, d, f.x, -0.6, 0.2, f.z, f.kind === "bigfish" ? 0.8 : 0.6));
  for (const b of w.beasts) {
    if (b.st === "dead" || opts.draggableOnly) continue;
    const y = H(b.x, b.z);
    const s = (b.kind === "wolf" ? 0.8 : 1.15) * (0.85 + 0.45 * growthOf(b));
    consider("beast", b.id, b.x, b.z, rayCapsule(o, d, b.x, y, y + 1.2 * s, b.z, 0.85 * s));
  }
  if (!opts.draggableOnly) {
    for (const p of w.people) {
      const y = H(p.x, p.z);
      const s = 0.42 + 0.58 * Math.min(1, ageYears(p.birth, w.time) / 16);
      consider("person", p.id, p.x, p.z, rayCapsule(o, d, p.x, y, y + 1.75 * s, p.z, 0.5 * s + 0.1));
    }
    for (const p of w.plants) {
      const y = H(p.x, p.z);
      const g = 0.22 + 0.78 * p.g;
      if (p.stump) {
        consider("plant", p.id, p.x, p.z, rayCapsule(o, d, p.x, y, y + 0.4, p.z, 0.4));
      } else if (isTree(p.kind)) {
        const top = (p.kind === "palm" ? 4.0 : 3.4) * p.s * g;
        consider("plant", p.id, p.x, p.z, rayCapsule(o, d, p.x, y, y + top * 0.65, p.z, 0.45 * g + 0.1));
        consider("plant", p.id, p.x, p.z, rayCapsule(o, d, p.x, y + top * 0.65, y + top * 1.05, p.z, 1.4 * p.s * g));
      } else {
        const r = p.kind === "bush" ? 0.85 : 0.5;
        consider("plant", p.id, p.x, p.z, rayCapsule(o, d, p.x, y, y + 0.8 * p.s * g, p.z, r * p.s));
      }
    }
    for (const r of w.rocks) {
      const y = H(r.x, r.z);
      const s = r.s * (0.45 + 0.55 * r.amt / r.max) * (r.kind === "boulder" ? 1.7 : r.kind === "clay" ? 1.2 : 1);
      consider("rock", r.id, r.x, r.z, rayCapsule(o, d, r.x, y, y + 0.5 * s, r.z, 0.75 * s));
    }
    for (const s of w.structures) {
      if (s.type === "farm" || s.type === "pen") continue;
      const y = H(s.x, s.z);
      const r = STRUCTS[s.type].radius;
      consider("structure", s.id, s.x, s.z, rayCapsule(o, d, s.x, y, y + Math.max(0.4, heightOf(s) * (s.prog >= 1 ? 1 : 0.3 + 0.7 * s.prog)), s.z, s.type === "campfire" ? 0.8 : r * 0.85));
    }
  }
  const g = groundHit(T, o, d);
  const b = best as Pick | null;
  if (g && (!b || g.t < b.t - 0.3)) {
    if (opts.draggableOnly) return null;
    return { k: g.water ? "water" : "ground", x: g.x, z: g.z, t: g.t };
  }
  return b;
}
