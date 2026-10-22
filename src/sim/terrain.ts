// 시드로부터 섬 지형을 결정적으로 생성한다. 지형은 저장하지 않고 매번 시드로 다시 만든다.
// 섬은 처음 모습(CORE_RADIUS)을 그대로 둔 채 바깥으로 넓어졌다. 예전 저장본이 그대로 이어지도록
// 산과 연못은 처음 섬의 지형으로 정하고, 새로 생긴 땅 한쪽에는 광맥 지대가 솟아 있다.
import { CORE_RADIUS, ISLAND_RADIUS, TERRAIN_RES, WORLD_SIZE } from "./constants";
import { clamp, createNoise2D, fbm, lerp, Noise2D, smoothstep } from "./noise";
import { makeRng, range, rand, RngHolder } from "./rng";

export type Biome = "deep" | "shallow" | "pond" | "beach" | "grass" | "forest" | "rock" | "mine";

export interface Pond {
  x: number;
  z: number;
  r: number;
  level: number;
}

/** 넓어지기 전 섬의 격자 (연못 자리와 예전 땅을 알아내는 데만 쓴다) */
const LEGACY = { size: 240, res: 257 };

export class Terrain {
  readonly size = WORLD_SIZE;
  readonly res = TERRAIN_RES;
  readonly cell = WORLD_SIZE / (TERRAIN_RES - 1);
  readonly heights: Float32Array;
  readonly pond: Pond;
  readonly peak: { x: number; z: number };
  /** 광맥 지대: 구리·주석·철, 드물게 금과 다이아몬드가 묻힌 바위 언덕 */
  readonly mine: { x: number; z: number; r: number };
  private legacy: Float32Array;
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
    const pd = CORE_RADIUS * range(r, 0.15, 0.35);
    this.peak = { x: Math.cos(pa) * pd, z: Math.sin(pa) * pd };
    const mr = makeRng(seed ^ 0x2545f491);
    const am = rand(mr) * Math.PI * 2;
    const dm = ISLAND_RADIUS * 0.69 * this.shape(am);
    this.mine = { x: Math.cos(am) * dm, z: Math.sin(am) * dm, r: range(mr, 10, 11.5) };

    this.legacy = this.grid(LEGACY.size, LEGACY.res, CORE_RADIUS, false);
    this.heights = this.grid(this.size, this.res, ISLAND_RADIUS, true);

    // 연못: 산 반대편 내륙의 평평한 곳 (처음 섬의 지형으로 고른다)
    let best: Pond | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 60; k++) {
      const a = pa + Math.PI + range(r, -1.4, 1.4);
      const d = CORE_RADIUS * range(r, 0.2, 0.5);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const hh = this.legacyHeight(x, z);
      if (hh < 1.8 || hh > 6) continue;
      const score = -this.legacySlope(x, z) * 4 - Math.abs(hh - 3);
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, r: range(r, 3.6, 4.6), level: 0 };
      }
    }
    const pond = best ?? { x: -CORE_RADIUS * 0.3, z: 0, r: 4, level: 0 };
    pond.level = this.sample(this.heights, this.size, this.res, pond.x, pond.z) - 0.25;
    this.pond = pond;
    this.carvePond();
  }

  /** 각도마다 해안선이 들쭉날쭉한 정도 */
  private shape(a: number) {
    const ca = Math.cos(a), sa = Math.sin(a);
    return 1 + 0.16 * this.n1(ca * 1.1 + 7, sa * 1.1 + 3) + 0.07 * this.n1(ca * 3.1 - 2, sa * 3.1 + 5);
  }

  private grid(size: number, res: number, R: number, mine: boolean) {
    const cell = size / (res - 1);
    const h = new Float32Array(res * res);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) h[j * res + i] = this.raw(-size / 2 + i * cell, -size / 2 + j * cell, R, mine);
    }
    return h;
  }

  private raw(x: number, z: number, R: number, mine: boolean) {
    const d = Math.hypot(x, z);
    const rr = R * this.shape(Math.atan2(z, x));
    const dn = d / rr;
    const coast = smoothstep(1.2, 0.6, dn);
    let h = lerp(-6.5, 2.1, coast);
    const inland = smoothstep(0.9, 0.35, dn);
    h += inland * (fbm(this.n2, x * 0.022, z * 0.022, 4) * 0.5 + 0.5) * 4.2;
    const dp = Math.hypot(x - this.peak.x, z - this.peak.z);
    const sig = CORE_RADIUS * 0.2;
    h += 12.5 * Math.exp(-(dp * dp) / (2 * sig * sig)) * smoothstep(1.0, 0.5, dn);
    h += fbm(this.n3, x * 0.08, z * 0.08, 3) * 0.35 * coast;
    if (mine) {
      // 울퉁불퉁한 바위 언덕
      const M = this.mine;
      const dm = Math.hypot(x - M.x, z - M.z);
      if (dm < M.r * 1.4) {
        const k = smoothstep(M.r * 1.25, M.r * 0.55, dm);
        const top = 3.4 + 2.4 * smoothstep(M.r * 0.95, 0, dm);
        h = lerp(h, Math.max(h, top), k) + k * fbm(this.n3, x * 0.17 + 40, z * 0.17, 3) * 1.1;
      }
    }
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

  private sample(h: Float32Array, size: number, res: number, x: number, z: number) {
    const cell = size / (res - 1);
    const fx = clamp((x + size / 2) / cell, 0, res - 1.001);
    const fz = clamp((z + size / 2) / cell, 0, res - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = h[j * res + i], b = h[j * res + i + 1];
    const c = h[(j + 1) * res + i], d = h[(j + 1) * res + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  private legacyHeight(x: number, z: number) {
    if (Math.abs(x) > LEGACY.size / 2 || Math.abs(z) > LEGACY.size / 2) return -6.5;
    return this.sample(this.legacy, LEGACY.size, LEGACY.res, x, z);
  }

  private legacySlope(x: number, z: number) {
    const e = 0.8;
    const dx = this.legacyHeight(x + e, z) - this.legacyHeight(x - e, z);
    const dz = this.legacyHeight(x, z + e) - this.legacyHeight(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /** 섬이 넓어지기 전에도 땅이었는지 (예전 저장본을 새 땅에 맞출 때) */
  wasLand(x: number, z: number) {
    return this.legacyHeight(x, z) > 0.15 && !this.inPond(x, z, 0.3);
  }

  height(x: number, z: number) {
    if (Math.abs(x) > this.size / 2 || Math.abs(z) > this.size / 2) return -6.5;
    return this.sample(this.heights, this.size, this.res, x, z);
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

  inMine(x: number, z: number, pad = 0) {
    return Math.hypot(x - this.mine.x, z - this.mine.z) < this.mine.r + pad;
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
    if (this.inMine(x, z, -this.mine.r * 0.08)) return "mine";
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
