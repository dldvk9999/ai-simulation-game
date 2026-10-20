// 시드로부터 섬 지형을 결정적으로 생성한다. 지형은 저장하지 않고 매번 시드로 다시 만든다.
import { ISLAND_RADIUS, TERRAIN_RES, WORLD_SIZE } from "./constants";
import { clamp, createNoise2D, fbm, lerp, Noise2D, smoothstep } from "./noise";
import { makeRng, range, rand, RngHolder } from "./rng";

export type Biome = "deep" | "shallow" | "pond" | "beach" | "grass" | "forest" | "rock";

export interface Pond {
  x: number;
  z: number;
  r: number;
  level: number;
}

export class Terrain {
  readonly size = WORLD_SIZE;
  readonly res = TERRAIN_RES;
  readonly cell = WORLD_SIZE / (TERRAIN_RES - 1);
  readonly heights: Float32Array;
  readonly pond: Pond;
  readonly peak: { x: number; z: number };
  private forestNoise: Noise2D;
  private n1: Noise2D;
  private n2: Noise2D;
  private n3: Noise2D;

  constructor(readonly seed: number) {
    this.n1 = createNoise2D(seed);
    this.n2 = createNoise2D(seed ^ 0x9e3779b9);
    this.n3 = createNoise2D((seed + 1337) | 0);
    this.forestNoise = createNoise2D((seed * 31 + 7) | 0);
    const r = makeRng(seed ^ 0x5bd1e995);
    const pa = rand(r) * Math.PI * 2;
    const pd = ISLAND_RADIUS * range(r, 0.15, 0.35);
    this.peak = { x: Math.cos(pa) * pd, z: Math.sin(pa) * pd };

    const res = this.res;
    const h = new Float32Array(res * res);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = -this.size / 2 + i * this.cell;
        const z = -this.size / 2 + j * this.cell;
        h[j * res + i] = this.raw(x, z);
      }
    }
    this.heights = h;

    // 연못: 산 반대편 내륙의 평평한 곳
    let best: Pond | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 60; k++) {
      const a = pa + Math.PI + range(r, -1.4, 1.4);
      const d = ISLAND_RADIUS * range(r, 0.2, 0.5);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const hh = this.sample(x, z);
      if (hh < 1.8 || hh > 6) continue;
      const score = -this.slopeAt(x, z) * 4 - Math.abs(hh - 3);
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, r: range(r, 3.6, 4.6), level: hh - 0.25 };
      }
    }
    this.pond = best ?? { x: -ISLAND_RADIUS * 0.3, z: 0, r: 4, level: this.sample(-ISLAND_RADIUS * 0.3, 0) - 0.25 };
    this.carvePond();
  }

  private raw(x: number, z: number) {
    const R = ISLAND_RADIUS;
    const d = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const ca = Math.cos(a), sa = Math.sin(a);
    const rr = R * (1 + 0.16 * this.n1(ca * 1.1 + 7, sa * 1.1 + 3) + 0.07 * this.n1(ca * 3.1 - 2, sa * 3.1 + 5));
    const dn = d / rr;
    const coast = smoothstep(1.2, 0.6, dn);
    let h = lerp(-6.5, 2.1, coast);
    const inland = smoothstep(0.9, 0.35, dn);
    h += inland * (fbm(this.n2, x * 0.022, z * 0.022, 4) * 0.5 + 0.5) * 4.2;
    const dp = Math.hypot(x - this.peak.x, z - this.peak.z);
    const sig = R * 0.2;
    h += 12.5 * Math.exp(-(dp * dp) / (2 * sig * sig)) * smoothstep(1.0, 0.5, dn);
    h += fbm(this.n3, x * 0.08, z * 0.08, 3) * 0.35 * coast;
    return h;
  }

  private carvePond() {
    const { x: px, z: pz, r, level } = this.pond;
    const res = this.res;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = -this.size / 2 + i * this.cell;
        const z = -this.size / 2 + j * this.cell;
        const d = Math.hypot(x - px, z - pz);
        if (d > r * 1.8) continue;
        const idx = j * res + i;
        let hh = this.heights[idx];
        // 둑: 수면보다 약간 높게
        const rim = smoothstep(r * 1.8, r * 1.05, d);
        hh = lerp(hh, Math.max(hh, level + 0.2), rim);
        // 바닥
        if (d < r * 1.05) {
          const t = clamp(d / r);
          const bottom = level - 1.1 * (1 - t * t) - 0.05;
          hh = lerp(bottom, hh, smoothstep(0.85, 1.05, t));
          if (t < 0.95) hh = Math.min(hh, level - 0.1);
        }
        this.heights[idx] = hh;
      }
    }
  }

  private sample(x: number, z: number) {
    const res = this.res;
    const fx = clamp((x + this.size / 2) / this.cell, 0, res - 1.001);
    const fz = clamp((z + this.size / 2) / this.cell, 0, res - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.heights;
    const a = h[j * res + i], b = h[j * res + i + 1];
    const c = h[(j + 1) * res + i], d = h[(j + 1) * res + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  height(x: number, z: number) {
    if (Math.abs(x) > this.size / 2 || Math.abs(z) > this.size / 2) return -6.5;
    return this.sample(x, z);
  }

  slopeAt(x: number, z: number) {
    const e = 0.8;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  inPond(x: number, z: number, pad = 0) {
    return Math.hypot(x - this.pond.x, z - this.pond.z) < this.pond.r + pad;
  }

  isLand(x: number, z: number) {
    return this.height(x, z) > 0.15 && !this.inPond(x, z, 0.3);
  }

  forestDensity(x: number, z: number) {
    return fbm(this.forestNoise, x * 0.03, z * 0.03, 3) * 0.5 + 0.5;
  }

  biome(x: number, z: number): Biome {
    if (this.inPond(x, z)) return "pond";
    const h = this.height(x, z);
    if (h < -0.6) return "deep";
    if (h < 0.15) return "shallow";
    if (h < 1.35) return "beach";
    if (h > 10.5 || this.slopeAt(x, z) > 0.85) return "rock";
    return this.forestDensity(x, z) > 0.56 ? "forest" : "grass";
  }

  /** 섬 중심에서 바깥으로 나가며 해안선을 찾는다 */
  shorePoint(angle: number, landSide = 0.6) {
    let d = 5;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let last = { x: ca * d, z: sa * d };
    for (; d < this.size / 2; d += 0.5) {
      const x = ca * d, z = sa * d;
      if (this.height(x, z) < 0.05 && !this.inPond(x, z, 1)) {
        const back = Math.max(0, d - landSide);
        return { x: ca * back, z: sa * back, wx: ca * (d + 2.5), wz: sa * (d + 2.5) };
      }
      last = { x, z };
    }
    return { x: last.x, z: last.z, wx: last.x, wz: last.z };
  }

  randomPoint(r: RngHolder, ok: (x: number, z: number, b: Biome) => boolean, tries = 200) {
    const R = ISLAND_RADIUS * 1.25;
    for (let k = 0; k < tries; k++) {
      const x = range(r, -R, R);
      const z = range(r, -R, R);
      if (ok(x, z, this.biome(x, z))) return { x, z };
    }
    return null;
  }

  /** 물속 무작위 지점 (물고기) */
  randomWaterPoint(r: RngHolder, minDepth = 0.6, maxDepth = 3.2) {
    return this.randomPoint(r, (x, z) => {
      const h = this.height(x, z);
      return h < -minDepth && h > -maxDepth;
    }, 300);
  }
}

const cache = new Map<number, Terrain>();
export function getTerrain(seed: number) {
  let t = cache.get(seed);
  if (!t) {
    t = new Terrain(seed);
    cache.set(seed, t);
  }
  return t;
}
