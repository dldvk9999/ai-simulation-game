// 시뮬레이션의 모든 무작위성은 월드에 저장된 시드 상태를 사용한다.
// 같은 저장본에서 이어 돌리면 같은 결과가 나온다.

export interface RngHolder {
  rng: number;
}

export function rand(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (h: RngHolder, a: number, b: number) => a + (b - a) * rand(h);
export const int = (h: RngHolder, a: number, b: number) => Math.floor(range(h, a, b + 1));
export const chance = (h: RngHolder, p: number) => rand(h) < p;
export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[Math.floor(rand(h) * arr.length) % arr.length];
}
export function gauss(h: RngHolder, mean = 0, sd = 1) {
  const u = Math.max(1e-9, rand(h));
  const v = rand(h);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function weighted<T extends string>(h: RngHolder, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let r = rand(h) * total;
  for (const [k, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** 시간 dt 동안 비율 rate(초당)로 일어나는 사건의 확률 */
export const pRate = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** 독립 시드 RNG (지형 생성 등 저장되지 않는 결정적 생성용) */
export function makeRng(seed: number): RngHolder {
  return { rng: seed | 0 };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
