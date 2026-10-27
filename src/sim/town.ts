// 마을 계획: 모닥불(광장)을 한가운데 둔 바둑판이다. 길과 길 사이에 집터(필지)가 두 줄씩 있어서 모든 건물이 길을 바라보고,
// 모닥불을 지나는 두 길이 큰길(중앙도로)이 된다. 길은 건물이 들어선 필지 앞과, 그곳에서 광장까지 가장 짧게 잇는 곳에만 낸다.
// 나라가 길을 닦으면 큰길이 섬을 한 바퀴 두르는 둘레길까지 뻗고, 선착장·광산 같은 바깥 건물에도 갈림길을 낸다.
import { STRUCTS } from "./data";
import { getTerrain, type Terrain } from "./terrain";
import type { Structure, StructureType, WorldState } from "./types";

/** 필지 한 변 */
export const LOT = 6.4;
/** 길 폭 (필지와 필지 사이) */
export const STREET = 2.2;
/** 길에서 다음 길까지 */
export const MOD = LOT * 2 + STREET;
const OFF = STREET / 2 + LOT / 2;
/** 모닥불 둘레의 광장 */
export const PLAZA = 4;
/** 작은 것(의자·건조대·우물)은 필지를 넷으로 나눠 쓴다 */
const Q = LOT / 4;
/** 무덤은 묘역(필지 넷) 안에 2칸 간격으로 */
const GRAVE_ROWS = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];
const SPAN = 16;

// ─── 좌표 ──────────────────────────────────────────────────────────────

/** 바둑판의 축: 섬 가운데에서 야영지를 지나 바다로 향하는 쪽이 +u */
export interface Frame { ox: number; oz: number; ux: number; uz: number; base: number }

export function frame(w: WorldState): Frame {
  const base = Math.atan2(w.camp.z, w.camp.x);
  return { ox: w.camp.x, oz: w.camp.z, ux: Math.cos(base), uz: Math.sin(base), base };
}
const toU = (F: Frame, x: number, z: number) => (x - F.ox) * F.ux + (z - F.oz) * F.uz;
const toV = (F: Frame, x: number, z: number) => -(x - F.ox) * F.uz + (z - F.oz) * F.ux;
const wx = (F: Frame, u: number, v: number) => F.ox + u * F.ux - v * F.uz;
const wz = (F: Frame, u: number, v: number) => F.oz + u * F.uz + v * F.ux;

/** 필지 번호 → 필지 가운데 (길 하나를 사이에 두고 두 줄씩) */
export const lotPos = (a: number) => Math.floor(a / 2) * MOD + (a & 1 ? MOD - OFF : OFF);
export function lotIdx(u: number) {
  const k = Math.floor(u / MOD);
  return u - k * MOD < MOD / 2 ? 2 * k : 2 * k + 1;
}
/** 필지 앞의 길: 몇 번째 길이고, 필지에서 어느 쪽(±1)인지 */
const streetOf = (a: number) => (a & 1 ? { k: (a >> 1) + 1, dir: 1 } : { k: a >> 1, dir: -1 });
const lotKey = (a: number, b: number) => (a + 128) * 512 + (b + 128);
const blockKey = (i: number, j: number) => (i + 128) * 512 + (j + 128);
/** 길 한 토막: u축 길(u = k·MOD)의 j번째 토막이면 axis 0 */
const edgeKey = (axis: number, k: number, j: number) => axis * 1e6 + (k + 128) * 512 + (j + 128);
const isPlaza = (a: number, b: number) => (a === 0 || a === -1) && (b === 0 || b === -1);
const norm = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));

// ─── 건물마다 들어설 곳 ────────────────────────────────────────────────

type Cat = "core" | "home" | "craft" | "field" | "care" | "guard" | "high" | "free";
const CAT: Partial<Record<StructureType, Cat>> = {
  hall: "core", palace: "core", library: "core", market: "core", casino: "core", shrine: "core", storage: "core", well: "core", bench: "core", rack: "core",
  leanto: "home", hut: "home", loghouse: "home", stonehouse: "home", townhouse: "home", apartment: "home",
  workshop: "craft", kiln: "craft", smelter: "craft", forge: "craft", factory: "craft",
  farm: "field", pen: "field", windmill: "field",
  infirmary: "care",
  watchtower: "guard", fort: "guard", battery: "guard",
  observatory: "high", portal: "free",
};
/** 광장 둘레 네 필지에는 창고·우물·의자·건조대만 (누구나 자주 오가는 것) */
const PLAZA_OK = new Set<StructureType>(["storage", "well", "bench", "rack"]);
const SMALL = new Set<StructureType>(["bench", "rack", "well"]);
/** 구역(필지 넷)을 통째로 쓰는 큰 건물 */
const BIG = new Set<StructureType>(["palace"]);
/** 바둑판 밖에 따로 짓는 것 */
export const OFFGRID = new Set<StructureType>(["campfire", "raft", "banner", "mine", "dock", "lighthouse", "seawall", "shipyard"]);

export interface Site { x: number; z: number; rot: number }
/** 터를 닦으며 치울 수 있는 돌 (광맥·점토는 남긴다) */
export const MOVABLE_ROCK = new Set(["rock", "boulder"]);

// ─── 땅 (지형은 바뀌지 않으니 필지마다 한 번만 살핀다) ─────────────────

interface LotInfo { ok: boolean; rocky: boolean; slope: number; h: number }
interface EdgeInfo { ok: boolean; slope: number }
interface Static {
  lots: Map<number, LotInfo>; edges: Map<number, EdgeInfo>; side?: number; ring?: { x: number; z: number; ok: boolean }[];
  /** 집을 지을 수 있는 필지들의 광장까지 거리 (가까운 순) */
  dists?: number[];
}
const STATIC = new Map<string, Static>();

let lastStatic: { T: Terrain; ox: number; oz: number; s: Static } | null = null;

function staticOf(T: Terrain, F: Frame): Static {
  const L = lastStatic;
  if (L && L.T === T && L.ox === F.ox && L.oz === F.oz) return L.s;
  const k = `${T.seed}:${F.ox.toFixed(2)}:${F.oz.toFixed(2)}`;
  let s = STATIC.get(k);
  if (!s) STATIC.set(k, (s = { lots: new Map(), edges: new Map() }));
  lastStatic = { T, ox: F.ox, oz: F.oz, s };
  return s;
}

function lotInfo(T: Terrain, F: Frame, a: number, b: number): LotInfo {
  const S = staticOf(T, F);
  const key = lotKey(a, b);
  let L = S.lots.get(key);
  if (L) return L;
  const u = lotPos(a), v = lotPos(b);
  const e = LOT / 2 - 0.7;
  let ok = true, rocky = false, slope = 0;
  for (const [du, dv] of [[0, 0], [e, e], [e, -e], [-e, e], [-e, -e], [e, 0], [-e, 0], [0, e], [0, -e]]) {
    const x = wx(F, u + du, v + dv), z = wz(F, u + du, v + dv);
    if (T.height(x, z) < 0.9 || T.inPond(x, z, 1.2)) {
      ok = false;
      break;
    }
    const bm = T.biome(x, z);
    if (bm === "mine") {
      ok = false;
      break;
    }
    if (bm === "rock") rocky = true;
    slope = Math.max(slope, T.slopeAt(x, z));
  }
  const x0 = wx(F, u, v), z0 = wz(F, u, v);
  L = { ok: ok && slope < 0.6, rocky, slope: ok ? T.slopeAt(x0, z0) : 9, h: T.height(x0, z0) };
  S.lots.set(key, L);
  return L;
}

/** 길 한 토막을 낼 수 있는 땅인지 (물·연못·바위산·광맥 지대는 안 된다) */
function edgeInfo(T: Terrain, F: Frame, axis: number, k: number, j: number): EdgeInfo {
  const S = staticOf(T, F);
  const key = edgeKey(axis, k, j);
  let E = S.edges.get(key);
  if (E) return E;
  let ok = true, slope = 0;
  for (let t = 0; t <= 8; t++) {
    const along = (j + t / 8) * MOD;
    const u = axis === 0 ? k * MOD : along, v = axis === 0 ? along : k * MOD;
    const x = wx(F, u, v), z = wz(F, u, v);
    const bm = T.biome(x, z);
    if (T.height(x, z) < 0.35 || T.inPond(x, z, 0.6) || bm === "rock" || bm === "mine") {
      ok = false;
      break;
    }
    slope = Math.max(slope, T.slopeAt(x, z));
  }
  E = { ok: ok && slope < 0.9, slope };
  S.edges.set(key, E);
  return E;
}

/** 집은 땅이 넓은 쪽, 일터는 그 반대쪽에 모은다 */
function homeSide(T: Terrain, F: Frame) {
  const S = staticOf(T, F);
  if (S.side == null) {
    let n = 0;
    for (let a = -8; a < 8; a++) for (let b = -8; b < 8; b++) if (b !== 0 && b !== -1 && lotInfo(T, F, a, b).ok) n += b > 0 ? 1 : -1;
    S.side = n >= 0 ? 1 : -1;
  }
  return S.side;
}

/**
 * 마을 터의 반지름: 지금까지 가장 많았던 사람 수에 맞는 만큼 집과 일터가 들어설 필지를 가까운 곳부터 셈한다.
 * 밭·망루·묘역은 그 바깥에 둔다 (마을이 커지면 터도 넓어지고, 갇힌 밭은 바깥으로 옮긴다).
 */
function reachOf(w: WorldState, T: Terrain, F: Frame) {
  const S = staticOf(T, F);
  if (!S.dists) {
    const ds: number[] = [];
    for (let a = -SPAN; a < SPAN; a++) for (let b = -SPAN; b < SPAN; b++) {
      if (isPlaza(a, b)) continue;
      const L = lotInfo(T, F, a, b);
      if (L.ok && !L.rocky && L.slope <= 0.42) ds.push(Math.hypot(lotPos(a), lotPos(b)));
    }
    S.dists = ds.sort((x, y) => x - y);
  }
  const n = Math.max(18, Math.min(46, Math.round((w.stats?.maxPop ?? 0) * 0.6) + 12));
  return S.dists[Math.min(n, S.dists.length) - 1] ?? 30;
}

/** 필지 앞 길: 큰길에 가까운 쪽을 고르되, 물이나 바위로 막힌 길은 피한다 */
function frontOf(T: Terrain, F: Frame, a: number, b: number) {
  const su = streetOf(a), sv = streetOf(b);
  const eu = edgeInfo(T, F, 0, su.k, b >> 1).ok, ev = edgeInfo(T, F, 1, sv.k, a >> 1).ok;
  const useU = eu && (!ev || Math.abs(su.k) <= Math.abs(sv.k));
  return useU
    ? { axis: 0, k: su.k, j: b >> 1, rot: norm(F.base + (su.dir > 0 ? 0 : Math.PI)) }
    : { axis: 1, k: sv.k, j: a >> 1, rot: norm(F.base + (sv.dir > 0 ? Math.PI / 2 : -Math.PI / 2)) };
}

/** 구역(필지 넷)의 앞 길 */
function blockFront(T: Terrain, F: Frame, i: number, j: number) {
  const opts = [
    { axis: 0, k: i, j, dir: -1 }, { axis: 0, k: i + 1, j, dir: 1 },
    { axis: 1, k: j, j: i, dir: -1 }, { axis: 1, k: j + 1, j: i, dir: 1 },
  ].filter((o) => edgeInfo(T, F, o.axis, o.k, o.j).ok);
  if (!opts.length) return null;
  const o = opts.reduce((m, x) => (Math.abs(x.k) < Math.abs(m.k) ? x : m));
  return { ...o, rot: norm(F.base + (o.axis === 0 ? (o.dir > 0 ? 0 : Math.PI) : o.dir > 0 ? Math.PI / 2 : -Math.PI / 2)) };
}

// ─── 지금 쓰고 있는 필지 ───────────────────────────────────────────────

interface Occ {
  lots: Map<number, Structure[]>;
  /** 무덤이 반듯하게 들어선 묘역 */
  cem: Set<number>;
  /** 바위가 걸친 필지 */
  rocks: Map<number, { u: number; v: number; r: number }[]>;
  /** 마을의 반지름 (밭을 뺀 건물들), 집이 들어선 가장 먼 곳, 마을 터의 반지름 */
  townR: number;
  homeR: number;
  reach: number;
}

function occupancy(w: WorldState, F: Frame, T: Terrain = getTerrain(w.seed)): Occ {
  const lots = new Map<number, Structure[]>();
  const cem = new Set<number>();
  const rocks = new Map<number, { u: number; v: number; r: number }[]>();
  let townR = 0, homeR = 0;
  const mark = <T>(m: Map<number, T[]>, u: number, v: number, R: number, x: T) => {
    for (let a = lotIdx(u - R); a <= lotIdx(u + R); a++) {
      if (Math.abs(u - lotPos(a)) >= LOT / 2 + R - 0.15) continue;
      for (let b = lotIdx(v - R); b <= lotIdx(v + R); b++) {
        if (Math.abs(v - lotPos(b)) >= LOT / 2 + R - 0.15) continue;
        const k = lotKey(a, b);
        const l = m.get(k);
        if (l) l.push(x);
        else m.set(k, [x]);
      }
    }
  };
  for (const s of w.structures) {
    if (s.type === "raft" || s.type === "banner" || s.type === "campfire") continue;
    const u = toU(F, s.x, s.z), v = toV(F, s.x, s.z);
    if (s.type === "grave" && graveSited(u, v)) cem.add(blockKey(Math.floor(u / MOD), Math.floor(v / MOD)));
    mark(lots, u, v, s.type === "grave" ? 0.5 : STRUCTS[s.type].radius * 0.8, s);
    const c = CAT[s.type];
    if (c && c !== "field" && s.prog >= 1) townR = Math.max(townR, Math.hypot(u, v));
    if (c === "home" && s.raze == null) homeR = Math.max(homeR, Math.hypot(u, v));
  }
  for (const r of w.rocks) {
    if (MOVABLE_ROCK.has(r.kind)) continue;
    const u = toU(F, r.x, r.z), v = toV(F, r.x, r.z);
    if (Math.abs(u) > SPAN * LOT * 1.3 || Math.abs(v) > SPAN * LOT * 1.3) continue;
    const R = r.kind === "boulder" ? 1.3 : 0.8;
    mark(rocks, u, v, R, { u, v, r: R });
  }
  return { lots, cem, rocks, townR, homeR, reach: reachOf(w, T, F) };
}

function graveSited(u: number, v: number) {
  const ok = (x: number) => {
    const o = x - (Math.floor(x / MOD) * MOD + MOD / 2);
    return GRAVE_ROWS.some((g) => Math.abs(o - g) < 0.2);
  };
  return ok(u) && ok(v);
}

// ─── 자리 고르기 ───────────────────────────────────────────────────────

function score(cat: Cat, u: number, v: number, d: number, L: LotInfo, side: number, O: Occ, free: boolean) {
  let s: number;
  switch (cat) {
    case "core": s = d; break;
    // 집은 집끼리, 일터는 일터끼리 큰길을 사이에 두고 모은다
    case "home": s = d + (free && v * side < 0 ? 4 : 0); break;
    case "craft": s = d + (free && v * side > 0 ? 4 : 0); break;
    // 밭과 우리는 마을 터 바깥에 둘러, 바다 쪽이 아닌 안쪽에
    case "field": s = Math.abs(d - O.reach - 4) * 0.6 + (d < O.reach ? 12 : 0) + (free && u > 4 ? 8 : 0); break;
    // 요양소는 마을 터 가장자리의 조용한 곳에
    case "care": s = Math.abs(d - O.reach * 0.7); break;
    // 망루는 마을 터 가장자리에
    case "guard": s = Math.abs(d - O.reach); break;
    case "high": s = d * 0.5 - L.h * 1.5; break;
    default: s = Math.abs(d - 18);
  }
  return s + L.slope * 6;
}

/** 필지에 짓는다: 마을 계획에 맞는 빈 필지 가운데 가장 알맞은 곳. near를 주면 그 근처 (갈라져 나간 무리의 터) */
export function lotSite(w: WorldState, T: Terrain, type: StructureType, near?: { x: number; z: number }): Site | null {
  if (OFFGRID.has(type)) return null;
  if (type === "grave") return graveSite(w, T);
  return bestLot(w, T, type, near)?.site ?? null;
}

function bestLot(w: WorldState, T: Terrain, type: StructureType, near?: { x: number; z: number }, occ?: Occ) {
  const F = frame(w);
  const O = occ ?? occupancy(w, F);
  const cat = CAT[type] ?? "free";
  const cu = near ? toU(F, near.x, near.z) : 0, cv = near ? toV(F, near.x, near.z) : 0;
  const side = homeSide(T, F);
  const r = STRUCTS[type].radius;
  const ca = lotIdx(cu), cb = lotIdx(cv);
  let best: Site | null = null;
  let bs = Infinity;
  const usable = (a: number, b: number) => {
    if (O.cem.has(blockKey(a >> 1, b >> 1))) return null;
    const L = lotInfo(T, F, a, b);
    if (!L.ok || (L.rocky && type !== "observatory")) return null;
    if (L.slope > (type === "farm" ? 0.28 : 0.42)) return null;
    return L;
  };
  if (BIG.has(type)) {
    for (let i = (ca >> 1) - SPAN / 2; i < (ca >> 1) + SPAN / 2; i++) for (let j = (cb >> 1) - SPAN / 2; j < (cb >> 1) + SPAN / 2; j++) {
      const ls = [[2 * i, 2 * j], [2 * i + 1, 2 * j], [2 * i, 2 * j + 1], [2 * i + 1, 2 * j + 1]];
      // 밭·우리만 있는 필지는 걷어 내고 쓸 수 있다
      let fields = 0;
      if (ls.some(([a, b]) => {
        if (isPlaza(a, b) || !usable(a, b) || O.rocks.has(lotKey(a, b))) return true;
        const here = O.lots.get(lotKey(a, b));
        if (!here) return false;
        if (here.some((s) => CAT[s.type] !== "field" || s.prog < 1)) return true;
        fields += here.length;
        return false;
      })) continue;
      const fr = blockFront(T, F, i, j);
      if (!fr) continue;
      const u = i * MOD + MOD / 2, v = j * MOD + MOD / 2;
      const L = lotInfo(T, F, 2 * i, 2 * j);
      const s = score(cat, u, v, Math.hypot(u - cu, v - cv), L, side, O, !near) + fields * 5;
      if (s < bs) {
        bs = s;
        best = { x: wx(F, u, v), z: wz(F, u, v), rot: fr.rot };
      }
    }
    return best ? { site: best, score: bs } : null;
  }
  for (let a = ca - SPAN; a < ca + SPAN; a++) for (let b = cb - SPAN; b < cb + SPAN; b++) {
    const plaza = isPlaza(a, b);
    if (plaza && !PLAZA_OK.has(type)) continue;
    const L = usable(a, b);
    if (!L) continue;
    const here = O.lots.get(lotKey(a, b));
    const stones = O.rocks.get(lotKey(a, b));
    let u = lotPos(a), v = lotPos(b);
    if (SMALL.has(type)) {
      if (here?.some((s) => !SMALL.has(s.type))) continue;
      let found = false;
      for (const [qu, qv] of [[-Q, -Q], [Q, -Q], [-Q, Q], [Q, Q]]) {
        const pu = u + qu, pv = v + qv;
        const clear = (here ?? []).every((s) => Math.hypot(toU(F, s.x, s.z) - pu, toV(F, s.x, s.z) - pv) > STRUCTS[s.type].radius + r + 0.3)
          && (stones ?? []).every((k) => Math.hypot(k.u - pu, k.v - pv) > k.r + r + 0.3);
        if (clear) {
          u = pu;
          v = pv;
          found = true;
          break;
        }
      }
      if (!found) continue;
    } else if (here?.length || stones?.length) continue;
    const d = Math.hypot(u - cu, v - cv);
    // 작은 것은 이미 작은 것이 놓인 필지에 모아 둔다 (필지를 덜 쪼갠다)
    const s = score(cat, u, v, d, L, side, O, !near) - (plaza ? 4 : 0) - (SMALL.has(type) && here?.length ? 3 : 0);
    if (s < bs) {
      bs = s;
      const rot = SMALL.has(type) && plaza ? Math.atan2(-wz(F, u, v) + F.oz, -wx(F, u, v) + F.ox) : frontOf(T, F, a, b).rot;
      best = { x: wx(F, u, v), z: wz(F, u, v), rot };
    }
  }
  return best ? { site: best, score: bs } : null;
}

/** 무덤: 마을 바깥 묘역에 줄지어. 묘역이 차면 곁에 새 묘역을 연다 */
export function graveSite(w: WorldState, T: Terrain): Site | null {
  const F = frame(w);
  const O = occupancy(w, F);
  const graves = w.structures.filter((s) => s.type === "grave");
  const slot = (i: number, j: number) => {
    for (const gu of GRAVE_ROWS) for (const gv of GRAVE_ROWS) {
      const u = i * MOD + MOD / 2 + gu, v = j * MOD + MOD / 2 + gv;
      const x = wx(F, u, v), z = wz(F, u, v);
      if (graves.some((g) => Math.abs(g.x - x) < 1 && Math.abs(g.z - z) < 1)) continue;
      if (T.height(x, z) < 0.5) continue;
      return { x, z, rot: F.base };
    }
    return null;
  };
  const blocks = [...O.cem].sort((a, b) => a - b);
  for (const k of blocks) {
    const s = slot(Math.floor(k / 512) - 128, (k % 512) - 128);
    if (s) return s;
  }
  let best: { i: number; j: number } | null = null;
  let bs = Infinity;
  for (let i = -SPAN / 2; i < SPAN / 2; i++) for (let j = -SPAN / 2; j < SPAN / 2; j++) {
    const ls = [[2 * i, 2 * j], [2 * i + 1, 2 * j], [2 * i, 2 * j + 1], [2 * i + 1, 2 * j + 1]];
    if (ls.some(([a, b]) => isPlaza(a, b) || !lotInfo(T, F, a, b).ok || O.lots.has(lotKey(a, b)) || O.rocks.has(lotKey(a, b)))) continue;
    const u = i * MOD + MOD / 2, v = j * MOD + MOD / 2;
    const d = Math.hypot(u, v);
    const next = blocks.some((k) => Math.abs(Math.floor(k / 512) - 128 - i) + Math.abs((k % 512) - 128 - j) === 1);
    // 집들과 떨어진 마을 바깥, 바다 쪽이 아닌 곳
    const s = next ? d * 0.1 : Math.abs(d - O.reach - 10) + (u > 0 ? 10 : 0) + 20;
    if (s < bs) {
      bs = s;
      best = { i, j };
    }
  }
  return best ? slot(best.i, best.j) : null;
}

/** 집들에 둘러싸여 마을 안쪽에 갇힌 밭·우리·풍차 (집 지을 자리를 차지하고 있다) */
export function engulfed(w: WorldState) {
  const F = frame(w);
  const O = occupancy(w, F);
  let best: Structure | null = null, bd = Infinity;
  for (const s of w.structures) {
    if (CAT[s.type] !== "field" || s.prog < 1 || s.raze != null) continue;
    const d = Math.hypot(toU(F, s.x, s.z), toV(F, s.x, s.z));
    if (d < O.reach - MOD * 0.5 && O.homeR > d + MOD * 0.5 && d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 마을 계획대로 서 있는지 (반듯한 필지 위에서 길을 바라보는지) */
export function sited(w: WorldState, s: Structure) {
  if (OFFGRID.has(s.type)) return true;
  const F = frame(w);
  const u = toU(F, s.x, s.z), v = toV(F, s.x, s.z);
  if (s.type === "grave") return graveSited(u, v);
  if (BIG.has(s.type)) {
    const near = (x: number) => Math.abs(x - (Math.floor(x / MOD) * MOD + MOD / 2)) < 0.3;
    return near(u) && near(v);
  }
  const a = lotIdx(u), b = lotIdx(v);
  if (isPlaza(a, b) && !PLAZA_OK.has(s.type)) return false;
  const du = u - lotPos(a), dv = v - lotPos(b);
  if (SMALL.has(s.type)) return Math.abs(Math.abs(du) - Q) < 0.3 && Math.abs(Math.abs(dv) - Q) < 0.3;
  if (Math.abs(du) > 0.3 || Math.abs(dv) > 0.3) return false;
  const T = getTerrain(w.seed);
  return Math.abs(norm(s.rot - frontOf(T, F, a, b).rot)) < 0.15;
}

/**
 * 계획대로 섰지만 훨씬 알맞은 빈 필지가 생긴 건물 (오가기 불편해서 옮길 만한 것).
 * 가장 많이 나아지는 것 하나를 고른다 (같은 쓰임의 건물은 가장 좋은 빈 필지가 같다).
 */
export function misplaced(w: WorldState, T: Terrain, cands: Structure[]): { s: Structure; site: Site } | null {
  if (!cands.length) return null;
  const F = frame(w);
  const O = occupancy(w, F);
  const side = homeSide(T, F);
  const best = new Map<StructureType, { site: Site; score: number } | null>();
  let pick: { s: Structure; site: Site } | null = null, gain = 14;
  for (const s of cands) {
    const u = toU(F, s.x, s.z), v = toV(F, s.x, s.z);
    const sc = score(CAT[s.type] ?? "free", u, v, Math.hypot(u, v), lotInfo(T, F, lotIdx(u), lotIdx(v)), side, O, true);
    if (sc - gain <= 0) continue;
    if (!best.has(s.type)) best.set(s.type, bestLot(w, T, s.type, undefined, O));
    const b = best.get(s.type);
    if (b && sc - b.score > gain) {
      gain = sc - b.score;
      pick = { s, site: b.site };
    }
  }
  return pick;
}

// ─── 길 ────────────────────────────────────────────────────────────────

export interface Seg { ax: number; az: number; bx: number; bz: number; main?: 1; ring?: 1 }
export interface RoadNet {
  /** 0이면 사람들이 밟아 다진 오솔길, 1~4는 나라가 닦은 길 */
  lv: number;
  segs: Seg[];
  /** 바둑판 길 가운데 낸 토막 */
  edges: Set<number>;
  /** 둘레길·큰길의 연장·갈림길 (빠른 찾기용) */
  extra: Map<number, Seg[]>;
  F: Frame;
  /** 건물을 지나는 길 토막 (그 건물을 옮겨 지어야 길이 이어진다) */
  blocked: Set<number>;
}

const EMPTY = (F: Frame): RoadNet => ({ lv: 0, segs: [], edges: new Set(), extra: new Map(), F, blocked: new Set() });
const NETS = new WeakMap<WorldState, { rev: number; sig: number; net: RoadNet }>();
const NODE = 10;
const nodeKey = (i: number, j: number) => (i + NODE) * (NODE * 2 + 1) + (j + NODE);

/** 둘레길: 해안에서 10걸음쯤 안쪽으로 섬을 한 바퀴 (지형만으로 정해진다) */
function ringOf(T: Terrain, F: Frame) {
  const S = staticOf(T, F);
  if (S.ring) return S.ring;
  const N = 200;
  const rad: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const sp = T.shorePoint(a, 0);
    rad.push(Math.hypot(sp.x, sp.z));
  }
  const pts: { x: number; z: number; ok: boolean }[] = [];
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let k = -3; k <= 3; k++) r += rad[(i + k + N) % N];
    r /= 7;
    const a = (i / N) * Math.PI * 2;
    let got: { x: number; z: number; ok: boolean } = { x: Math.cos(a) * (r - 10), z: Math.sin(a) * (r - 10), ok: false };
    for (const inset of [10, 8, 13, 6, 16, 19]) {
      const x = Math.cos(a) * (r - inset), z = Math.sin(a) * (r - inset);
      const bm = T.biome(x, z);
      if (T.height(x, z) > 0.6 && !T.inPond(x, z, 1.5) && bm !== "rock" && bm !== "mine" && T.slopeAt(x, z) < 0.7) {
        got = { x, z, ok: true };
        break;
      }
    }
    pts.push(got);
  }
  S.ring = pts;
  return pts;
}

function signature(w: WorldState) {
  let h = (w.structures.length * 7919 + (w.civic?.lv.road ?? 0) * 31 + (w.groups?.some((g) => g.kind === "nation") ? 1 : 0)) | 0;
  for (const s of w.structures) h = (h * 33 + s.id * 3 + (s.prog >= 1 ? 1 : 0) + Math.round(s.x) * 7 + Math.round(s.z) * 13) | 0;
  return h;
}

export function roadNet(w: WorldState, T: Terrain = getTerrain(w.seed)): RoadNet {
  const c = NETS.get(w);
  if (c && c.rev === w.rev) return c.net;
  const sig = signature(w);
  if (c && c.sig === sig) {
    c.rev = w.rev;
    return c.net;
  }
  const net = buildNet(w, T);
  NETS.set(w, { rev: w.rev, sig, net });
  return net;
}

function buildNet(w: WorldState, T: Terrain): RoadNet {
  const F = frame(w);
  const lv = w.groups?.some((g) => g.kind === "nation") ? w.civic?.lv.road ?? 0 : 0;
  // 길을 낼 만큼 마을이 서야 한다 (아직 옮겨 짓지 않은 예전 건물은 가장 가까운 필지 앞 길을 쓴다)
  const placed = w.structures.filter((s) => s.prog >= 1 && !OFFGRID.has(s.type) && s.type !== "grave" && s.raze == null);
  if (placed.length < 3) return EMPTY(F);
  const net = EMPTY(F);
  net.lv = lv;
  // 건물 앞 길 토막
  const want = new Set<number>();
  const fronts: { axis: number; k: number; j: number }[] = [];
  const addFront = (f: { axis: number; k: number; j: number } | null) => {
    if (!f || !edgeInfo(T, F, f.axis, f.k, f.j).ok) return;
    const key = edgeKey(f.axis, f.k, f.j);
    if (!want.has(key)) {
      want.add(key);
      fronts.push(f);
    }
  };
  for (const s of placed) {
    const u = toU(F, s.x, s.z), v = toV(F, s.x, s.z);
    if (BIG.has(s.type)) addFront(blockFront(T, F, Math.floor(u / MOD), Math.floor(v / MOD)));
    else addFront(frontOf(T, F, lotIdx(u), lotIdx(v)));
  }
  const cems = new Set<number>();
  for (const g of w.structures) {
    if (g.type !== "grave") continue;
    const u = toU(F, g.x, g.z), v = toV(F, g.x, g.z);
    if (!graveSited(u, v)) continue;
    const i = Math.floor(u / MOD), j = Math.floor(v / MOD);
    if (cems.has(blockKey(i, j))) continue;
    cems.add(blockKey(i, j));
    addFront(blockFront(T, F, i, j));
  }
  // 건물이 걸쳐 있는 길 토막 (옮겨 짓기 전까지는 돌아가야 한다)
  const blockedBy = new Map<number, number[]>();
  const block = (k: number, id: number) => {
    const l = blockedBy.get(k);
    if (l) l.push(id);
    else blockedBy.set(k, [id]);
  };
  for (const s of w.structures) {
    if (s.type === "raft" || s.type === "banner" || s.type === "campfire" || s.type === "grave") continue;
    const u = toU(F, s.x, s.z), v = toV(F, s.x, s.z);
    const r = STRUCTS[s.type].radius * 0.75;
    const R = r + STREET / 2;
    const ku = Math.round(u / MOD), kv = Math.round(v / MOD);
    if (Math.abs(u - ku * MOD) < R) block(edgeKey(0, ku, Math.floor(v / MOD)), s.id);
    if (Math.abs(v - kv * MOD) < R) block(edgeKey(1, kv, Math.floor(u / MOD)), s.id);
    // 광장 한가운데를 차지한 것도 비켜 줘야 한다
    if (Math.hypot(u, v) < PLAZA + r) net.blocked.add(s.id);
  }
  // 광장에서 가장 짧은 길로 잇는다 (큰길을 먼저 탄다)
  const W = NODE * 2 + 1;
  const dist = new Float64Array(W * W).fill(Infinity);
  const prev = new Int32Array(W * W).fill(-1);
  const prevEdge = new Float64Array(W * W);
  const done = new Uint8Array(W * W);
  dist[nodeKey(0, 0)] = 0;
  for (;;) {
    let n = -1, nd = Infinity;
    for (let i = 0; i < W * W; i++) if (!done[i] && dist[i] < nd) {
      nd = dist[i];
      n = i;
    }
    if (n < 0) break;
    done[n] = 1;
    const ni = Math.floor(n / W) - NODE, nj = (n % W) - NODE;
    // u축 길: 같은 i(u = i·MOD)에서 j를 따라, v축 길: 같은 j에서 i를 따라
    for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const mi = ni + di, mj = nj + dj;
      if (Math.abs(mi) > NODE || Math.abs(mj) > NODE) continue;
      const axis = di === 0 ? 0 : 1;
      const ek = axis === 0 ? edgeKey(0, ni, Math.min(nj, mj)) : edgeKey(1, nj, Math.min(ni, mi));
      const E = axis === 0 ? edgeInfo(T, F, 0, ni, Math.min(nj, mj)) : edgeInfo(T, F, 1, nj, Math.min(ni, mi));
      if (!E.ok) continue;
      const main = (axis === 0 ? ni : nj) === 0;
      const cost = MOD * (1 + E.slope) * (main ? 0.8 : 1) * (blockedBy.has(ek) ? 2.5 : 1) * (want.has(ek) ? 0.9 : 1);
      const m = nodeKey(mi, mj);
      if (dist[n] + cost < dist[m]) {
        dist[m] = dist[n] + cost;
        prev[m] = n;
        prevEdge[m] = ek;
      }
    }
  }
  const on = new Set<number>();
  for (const f of fronts) {
    const a = f.axis === 0 ? nodeKey(f.k, f.j) : nodeKey(f.j, f.k);
    const b = f.axis === 0 ? nodeKey(f.k, f.j + 1) : nodeKey(f.j + 1, f.k);
    const start = dist[a] <= dist[b] ? a : b;
    if (!Number.isFinite(dist[start])) continue;
    on.add(edgeKey(f.axis, f.k, f.j));
    for (let n = start; prev[n] >= 0; n = prev[n]) on.add(prevEdge[n]);
  }
  net.edges = on;
  const nodes: { x: number; z: number; i: number; j: number }[] = [];
  const seen = new Set<number>();
  for (const ek of on) {
    const axis = ek >= 1e6 ? 1 : 0;
    const r = ek - axis * 1e6;
    const k = Math.floor(r / 512) - 128, j = (r % 512) - 128;
    const [u0, v0, u1, v1] = axis === 0 ? [k * MOD, j * MOD, k * MOD, (j + 1) * MOD] : [j * MOD, k * MOD, (j + 1) * MOD, k * MOD];
    net.segs.push({ ax: wx(F, u0, v0), az: wz(F, u0, v0), bx: wx(F, u1, v1), bz: wz(F, u1, v1), main: k === 0 ? 1 : undefined });
    for (const id of blockedBy.get(ek) ?? []) net.blocked.add(id);
    for (const [u, v] of [[u0, v0], [u1, v1]]) {
      const i = Math.round(u / MOD), jj = Math.round(v / MOD);
      if (seen.has(nodeKey(i, jj))) continue;
      seen.add(nodeKey(i, jj));
      nodes.push({ x: wx(F, u, v), z: wz(F, u, v), i, j: jj });
    }
  }
  // 광장 한가운데의 길은 놓지 않는다 (광장 바닥은 따로 깐다)
  if (lv >= 1) roadsBeyond(w, T, F, net, nodes);
  return net;
}

/** 나라가 길을 닦으면: 큰길을 둘레길까지 뻗고, 둘레길이 마을에서 끊긴 곳과 바깥 건물에 갈림길을 낸다 */
function roadsBeyond(w: WorldState, T: Terrain, F: Frame, net: RoadNet, nodes: { x: number; z: number; i: number; j: number }[]) {
  const ring = ringOf(T, F);
  // 마을 길이 난 곳(교차로 둘레)과 광장은 둘레길이 비켜 가고, 마을 길이 그 몫을 한다
  const inTown = (x: number, z: number) =>
    Math.hypot(x - F.ox, z - F.oz) < MOD || nodes.some((n) => Math.abs(n.x - x) < MOD * 0.8 && Math.abs(n.z - z) < MOD * 0.8 && Math.hypot(n.x - x, n.z - z) < MOD * 0.78);
  const keep = ring.map((p) => p.ok && !inTown(p.x, p.z));
  const extra: Seg[] = [];
  const N = ring.length;
  const ringPts: { x: number; z: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (!keep[i]) continue;
    ringPts.push(ring[i]);
    const n = (i + 1) % N;
    if (keep[n]) extra.push({ ax: ring[i].x, az: ring[i].z, bx: ring[n].x, bz: ring[n].z, main: 1, ring: 1 });
  }
  const nearestNode = (x: number, z: number) => nodes.reduce<{ x: number; z: number } | null>((m, p) => (!m || Math.hypot(p.x - x, p.z - z) < Math.hypot(m.x - x, m.z - z) ? p : m), null);
  // 마을 때문에 끊긴 둘레길의 끝은 가까운 마을 길로 잇는다
  for (let i = 0; i < N; i++) {
    if (!keep[i]) continue;
    const p = ring[(i - 1 + N) % N], n = ring[(i + 1) % N];
    const cut = (q: { x: number; z: number; ok: boolean }) => q.ok && inTown(q.x, q.z);
    if (!cut(p) && !cut(n)) continue;
    const t = nearestNode(ring[i].x, ring[i].z);
    if (t && Math.hypot(t.x - ring[i].x, t.z - ring[i].z) < 40 && clearLine(T, ring[i].x, ring[i].z, t.x, t.z)) {
      extra.push({ ax: ring[i].x, az: ring[i].z, bx: t.x, bz: t.z, main: 1 });
    }
  }
  // 큰길(모닥불을 지나는 두 길)을 네 방향으로 둘레길까지 뻗는다
  for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const onAxis = nodes.filter((n) => (du ? n.j === 0 && n.i * du >= 0 : n.i === 0 && n.j * dv >= 0));
    const far = onAxis.reduce((m, n) => Math.max(m, du ? n.i * du : n.j * dv), 0);
    let u = du * far * MOD, v = dv * far * MOD;
    const sx = wx(F, u, v), sz = wz(F, u, v);
    let hit: { x: number; z: number } | null = null;
    for (let s = 0; s < 140; s += 1) {
      u += du;
      v += dv;
      const x = wx(F, u, v), z = wz(F, u, v);
      const bm = T.biome(x, z);
      if (T.height(x, z) < 0.35 || T.inPond(x, z, 0.6) || bm === "rock" || bm === "mine") break;
      if (ringPts.some((p) => Math.abs(p.x - x) < 2.2 && Math.abs(p.z - z) < 2.2)) {
        hit = { x, z };
        break;
      }
    }
    if (hit && Math.hypot(hit.x - sx, hit.z - sz) > 3) extra.push({ ax: sx, az: sz, bx: hit.x, bz: hit.z, main: 1 });
  }
  // 선착장·조선소·등대·광산으로 가는 갈림길
  const ends = [...nodes, ...ringPts];
  for (const s of w.structures) {
    if (s.prog < 1 || !(s.type === "dock" || s.type === "shipyard" || s.type === "lighthouse" || s.type === "mine")) continue;
    const r = STRUCTS[s.type].radius + 0.8;
    const fx = s.x - Math.cos(s.rot) * r, fz = s.z - Math.sin(s.rot) * r;
    const t = ends.reduce<{ x: number; z: number } | null>((m, p) => (!m || Math.hypot(p.x - fx, p.z - fz) < Math.hypot(m.x - fx, m.z - fz) ? p : m), null);
    if (t && Math.hypot(t.x - fx, t.z - fz) < 45) extra.push({ ax: t.x, az: t.z, bx: fx, bz: fz });
  }
  for (const s of extra) {
    net.segs.push(s);
    const x0 = Math.floor(Math.min(s.ax, s.bx) / 6), x1 = Math.floor(Math.max(s.ax, s.bx) / 6);
    const z0 = Math.floor(Math.min(s.az, s.bz) / 6), z1 = Math.floor(Math.max(s.az, s.bz) / 6);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = (cx + 100) * 256 + (cz + 100);
      const l = net.extra.get(k);
      if (l) l.push(s);
      else net.extra.set(k, [s]);
    }
  }
}

function clearLine(T: Terrain, ax: number, az: number, bx: number, bz: number) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az));
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
    if (T.height(x, z) < 0.35 || T.inPond(x, z, 0.6)) return false;
  }
  return true;
}

/** 길의 폭: 오솔길 → 흙길 → 자갈길 → 돌길 → 포장도로 (큰길은 더 넓다) */
export const roadWidth = (lv: number, main?: number) => [0.9, 1.3, 1.5, 1.7, 2.0][Math.min(4, lv)] * (main ? 1.2 : 1);

/** 길 위에 있는지 */
export const onRoad = (w: WorldState, x: number, z: number) => onNet(roadNet(w), x, z);

export function onNet(net: RoadNet, x: number, z: number) {
  if (!net.segs.length) return false;
  const F = net.F;
  const u = toU(F, x, z), v = toV(F, x, z);
  if (u * u + v * v < PLAZA * PLAZA) return true;
  const half = roadWidth(net.lv, 1) / 2 + 0.25;
  const ku = Math.round(u / MOD);
  if (Math.abs(u - ku * MOD) < half && net.edges.has(edgeKey(0, ku, Math.floor(v / MOD)))) return true;
  const kv = Math.round(v / MOD);
  if (Math.abs(v - kv * MOD) < half && net.edges.has(edgeKey(1, kv, Math.floor(u / MOD)))) return true;
  if (!net.extra.size) return false;
  const list = net.extra.get((Math.floor(x / 6) + 100) * 256 + (Math.floor(z / 6) + 100));
  if (!list) return false;
  for (const s of list) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    if (Math.hypot(s.ax + dx * t - x, s.az + dz * t - z) < half) return true;
  }
  return false;
}

/** 마을 터의 반지름 (갈라져 나간 무리는 그 바깥에 터를 잡는다) */
export const townReach = (w: WorldState) => reachOf(w, getTerrain(w.seed), frame(w));

/** 이 건물이 길을 막고 있는지 */
export const blocksRoad = (w: WorldState, s: Structure) => roadNet(w).blocked.has(s.id);
