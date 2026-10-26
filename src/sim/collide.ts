// 사람은 나무·바위·건물·다른 사람을 뚫고 지나가지 않는다. 앞이 막히면 옆으로 돌아가고,
// 오목하게 갇히면 격자로 길을 찾아 빠져나온다. 들어가 쉬는 집처럼 목적지인 건물에는 들어갈 수 있다.
import type { Act, Person, PlantKind, RockKind, Structure, StructureType, WorldState } from "./types";

/** 사람 몸의 반지름 */
export const BODY = 0.25;
const CELL = 4;

/** 건물의 바닥 모양 (모델 좌표: +x가 문 쪽). 원(r) 또는 사각형(hx, hz), 중심을 옮길 수도 있다 */
type Foot = { r?: number; hx?: number; hz?: number; ox?: number; oz?: number; in?: 1 };
/** in: 그 안이 목적지면 들어갈 수 있다 (집, 회관, 망루 위…) */
export const FOOT: Partial<Record<StructureType, Foot>> = {
  campfire: { r: 0.62 },
  leanto: { hx: 1.0, hz: 1.05, ox: 0.1, in: 1 },
  hut: { r: 1.6, in: 1 },
  loghouse: { hx: 1.75, hz: 1.45, in: 1 },
  stonehouse: { hx: 1.97, hz: 1.67, in: 1 },
  storage: { hx: 1.25, hz: 0.95 },
  rack: { hx: 0.4, hz: 1.0 },
  kiln: { r: 1.1 },
  well: { r: 0.85 },
  workshop: { hx: 0.82, hz: 0.45 },
  smelter: { r: 0.95 },
  library: { hx: 2.2, hz: 2.3, in: 1 },
  windmill: { r: 1.3 },
  observatory: { r: 1.9, in: 1 },
  lighthouse: { r: 1.15, in: 1 },
  grave: { r: 0.5 },
  bench: { hx: 0.3, hz: 0.8, in: 1 },
  infirmary: { hx: 1.6, hz: 1.4, in: 1 },
  seawall: { hx: 0.7, hz: 3.4 },
  hall: { hx: 2.6, hz: 2.2, in: 1 },
  watchtower: { hx: 1.15, hz: 1.15, in: 1 },
  fort: { hx: 2.0, hz: 2.0, in: 1 },
  battery: { r: 2.4, in: 1 },
  townhouse: { hx: 2.65, hz: 2.05, in: 1 },
  apartment: { hx: 2.9, hz: 2.7, in: 1 },
  forge: { hx: 1.7, hz: 1.5 },
  factory: { hx: 3.1, hz: 2.2, in: 1 },
  mine: { r: 2.2, ox: -0.9, in: 1 },
  shrine: { hx: 1.25, hz: 1.25 },
  palace: { hx: 4.3, hz: 3.7, in: 1 },
  casino: { hx: 2.4, hz: 2.0, in: 1 },
};

/** 나무 줄기 · 바위의 반지름 */
const TRUNK: Partial<Record<PlantKind, number>> = { tree: 0.32, fruit: 0.28, pine: 0.5, palm: 0.28 };
const STONE: Partial<Record<RockKind, number>> = { rock: 0.62, boulder: 1.15, ore: 0.75, vein: 0.8, mineral: 0.55 };

interface Ob {
  x: number;
  z: number;
  /** 원이면 r, 사각형이면 hx·hz와 방향 */
  r: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
  /** 들어갈 수 있는 건물 */
  enter: boolean;
  /** 감싸는 원 (빠른 거르기) */
  R: number;
  key: number;
}

interface Solids {
  rev: number;
  t: number;
  cells: Map<number, Ob[]>;
}

const CACHE = new WeakMap<WorldState, Solids>();
const cellKey = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);

function circle(x: number, z: number, r: number, key: number): Ob {
  return { x, z, r, hx: 0, hz: 0, c: 1, s: 0, enter: false, R: r, key };
}

export function structFoot(s: Structure): Ob | null {
  const f = FOOT[s.type];
  if (!f || s.prog < 1) return null;
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const ox = f.ox ?? 0, oz = f.oz ?? 0;
  const x = s.x + ox * c - oz * sn, z = s.z + ox * sn + oz * c;
  const key = 1e7 + s.id;
  if (f.r) return { ...circle(x, z, f.r, key), enter: !!f.in };
  const hx = f.hx ?? 1, hz = f.hz ?? 1;
  return { x, z, r: 0, hx, hz, c, s: sn, enter: !!f.in, R: Math.hypot(hx, hz), key };
}

function build(w: WorldState): Solids {
  const cells = new Map<number, Ob[]>();
  const put = (o: Ob) => {
    const R = o.R + BODY;
    const x0 = Math.floor((o.x - R) / CELL), x1 = Math.floor((o.x + R) / CELL);
    const z0 = Math.floor((o.z - R) / CELL), z1 = Math.floor((o.z + R) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = cellKey(cx, cz);
      const list = cells.get(k);
      if (list) list.push(o);
      else cells.set(k, [o]);
    }
  };
  for (const p of w.plants) {
    const t = TRUNK[p.kind];
    if (!t || p.stump || p.g < 0.35) continue;
    put(circle(p.x, p.z, t * p.s * (0.22 + 0.78 * p.g), p.id));
  }
  for (const r of w.rocks) {
    const t = STONE[r.kind];
    if (!t || r.amt <= 0) continue;
    put(circle(r.x, r.z, t * r.s * (0.45 + 0.55 * Math.max(0, r.amt / r.max)), 5e6 + r.id));
  }
  for (const s of w.structures) {
    const o = structFoot(s);
    if (o) put(o);
  }
  return { rev: w.rev, t: w.time, cells };
}

function solids(w: WorldState) {
  let S = CACHE.get(w);
  // 나무는 천천히 자라니 구조가 바뀌었을 때와 가끔만 새로 만든다
  if (!S || S.rev !== w.rev || Math.abs(w.time - S.t) > 1800) {
    S = build(w);
    CACHE.set(w, S);
  }
  return S;
}

/** 점이 장애물 안에 있으면 얼마나 파고들었는지 (>0) */
function depth(o: Ob, x: number, z: number, pad: number) {
  const dx = x - o.x, dz = z - o.z;
  if (o.r) return o.r + pad - Math.hypot(dx, dz);
  const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
  const qx = Math.abs(lx) - o.hx, qz = Math.abs(lz) - o.hz;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  return pad - out;
}

/** 장애물 밖으로 밀어낼 방향 */
function pushOut(o: Ob, x: number, z: number) {
  const dx = x - o.x, dz = z - o.z;
  if (o.r) {
    const d = Math.hypot(dx, dz) || 1;
    return { x: o.x + (dx / d) * (o.r + BODY + 0.02), z: o.z + (dz / d) * (o.r + BODY + 0.02) };
  }
  const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
  // 가장 가까운 벽 쪽으로
  const ex = o.hx + BODY + 0.02 - Math.abs(lx), ez = o.hz + BODY + 0.02 - Math.abs(lz);
  let nx = lx, nz = lz;
  if (ex < ez) nx = Math.sign(lx || 1) * (o.hx + BODY + 0.02);
  else nz = Math.sign(lz || 1) * (o.hz + BODY + 0.02);
  return { x: o.x + nx * o.c - nz * o.s, z: o.z + nx * o.s + nz * o.c };
}

// ─── 사람끼리 ──────────────────────────────────────────────────────────

/** 서로 비켜 가야 하는 사람인지 (안긴 아기, 집 안에 든 사람, 섬 밖의 사람은 아니다) */
function bodyOf(w: WorldState, q: Person) {
  if (!q.alive || q.away || q.act?.k === "carried") return false;
  return !indoors(w, q);
}

/** 들어갈 수 있는 건물 안에 있다 */
function indoors(w: WorldState, q: Person) {
  const S = solids(w);
  const list = S.cells.get(cellKey(Math.floor(q.x / CELL), Math.floor(q.z / CELL)));
  if (!list) return false;
  for (const o of list) if (o.enter && depth(o, q.x, q.z, 0) > 0) return true;
  return false;
}

/** 이 사람이 다가가는 상대 (그 사람에게는 닿아도 된다) */
function partnerOf(p: Person, a: Act) {
  return a.tid != null && (a.k === "follow" || a.k === "chat" || a.k === "nurse" || a.k === "fight" || a.k === "trade" || a.k === "care" || a.k === "fuss" || a.k === "assist" || a.k === "counsel") ? a.tid : -1;
}

// ─── 길 찾기 기억 (저장하지 않는다) ──────────────────────────────────

interface Nav {
  /** 이 행동에 대한 기억인지 */
  act: Act;
  /** 돌아가는 쪽 (1 왼쪽, -1 오른쪽) */
  side: number;
  /** 걸으려고 애쓴 시간, 목표에 가장 가까웠던 거리와 그때 */
  clock: number;
  best: number;
  bestAt: number;
  /** 쫓는 목표가 있던 자리 (움직이면 다시 잰다) */
  tgt: { x: number; z: number };
  /** 꼼짝 못 하고 서 있은 시간 */
  stuck: number;
  /** 이 시각까지는 사람 사이를 비집고 지나간다 (붐빌 때) */
  ghost: number;
  /** 격자로 찾은 길과 그때의 목적지 */
  path: { x: number; z: number }[] | null;
  pi: number;
  end: { x: number; z: number };
  /** 사람에게 · 물건에게 막힌 횟수 */
  hp: number;
  ho: number;
  /** 길을 찾아도 안 되면 이 행동 동안은 그냥 지나간다 */
  free: boolean;
}
const NAV = new WeakMap<Person, Nav>();
/** 시험용 집계 */
export const WALK_STATS = { steps: 0, turns: 0, waits: 0, paths: 0, nopath: 0, ghosts: 0, free: 0 };

function navOf(p: Person, a: Act) {
  let n = NAV.get(p);
  if (!n || n.act !== a) {
    n = {
      act: a, side: p.id % 2 ? 1 : -1, clock: 0, best: Infinity, bestAt: 0, tgt: { x: a.tx, z: a.tz }, stuck: 0, ghost: 0,
      path: null, pi: 0, end: { x: a.tx, z: a.tz }, hp: 0, ho: 0, free: false,
    };
    NAV.set(p, n);
  }
  return n;
}

// ─── 걷기 ──────────────────────────────────────────────────────────────

type Hit = { o: Ob | null; person: Person | null } | null;
/** 사람끼리는 이만큼 떨어져 지나간다 */
const APART = 0.42;

/**
 * 막는 것을 찾는다.
 * 들어갈 수 있는 건물이 목적지면 지나갈 수 있고, 이미 들어가 있는 장애물에서는 빠져나올 수 있다.
 */
function blocker(w: WorldState, p: Person, a: Act, x: number, z: number, nav: Nav, people: Person[]): Hit {
  const S = solids(w);
  const list = S.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) {
    for (const o of list) {
      const dn = depth(o, x, z, BODY);
      if (dn <= 0) continue;
      // 지금 그 안에 있으면 빠져나오는 중이다 (더 깊이 들어가지만 않으면)
      const now = depth(o, p.x, p.z, BODY);
      if (now > 0.02 && dn <= now + 0.01) continue;
      if (o.enter && depth(o, a.tx, a.tz, BODY + 0.6) > 0) continue;
      return { o, person: null };
    }
  }
  if (w.time < nav.ghost) return null;
  const mate = partnerOf(p, a);
  for (const q of people) {
    if (q === p || q.id === mate) continue;
    const dx = q.x - x, dz = q.z - z;
    const dd = dx * dx + dz * dz;
    if (dd >= APART * APART) continue;
    // 이미 겹쳐 있으면 떨어지는 쪽으로는 움직일 수 있다
    if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= dd) continue;
    return { o: null, person: q };
  }
  return null;
}

const TURNS = [0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45];

/** 막아선 사람이 목적지 곁에 머물러 있다 (모닥불 둘레처럼 붐비는 곳) */
function crowdAt(q: Person, a: Act) {
  const still = !q.act || q.act.ph === 1;
  return still && Math.hypot(q.x - a.tx, q.z - a.tz) < 2.4;
}

let PEOPLE: { t: number; w: WorldState | null; list: Person[] } = { t: -1, w: null, list: [] };
function bodies(w: WorldState) {
  if (PEOPLE.w !== w || PEOPLE.t !== w.time) PEOPLE = { t: w.time, w, list: w.people.filter((q) => bodyOf(w, q)) };
  return PEOPLE.list;
}

/**
 * 사람이 a의 목적지로 budget(게임 초) 동안 걷는다. 걸린 시간과 도착했는지를 돌려준다.
 * 막히면 옆으로 돌아가고, 붐비면 사람 사이를 비집고, 오래 막히면 길을 찾는다.
 */
export function walk(w: WorldState, p: Person, a: Act, speed: number, budget: number): { used: number; arrived: boolean; moved: boolean } {
  const nav = navOf(p, a);
  const people = bodies(w);
  let used = 0;
  let moved = false;
  const stepLen = Math.min(0.45, Math.max(0.12, speed * 6));
  while (used < budget - 1e-6) {
    // 쫓는 목표가 움직이면 다시 잰다 (찾아 둔 길도 버린다)
    if (Math.hypot(nav.tgt.x - a.tx, nav.tgt.z - a.tz) > 1) {
      nav.tgt = { x: a.tx, z: a.tz };
      nav.best = Infinity;
      nav.bestAt = nav.clock;
      if (nav.path && Math.hypot(nav.end.x - a.tx, nav.end.z - a.tz) > 2) nav.path = null;
    }
    const goal = nav.path && nav.pi < nav.path.length ? nav.path[nav.pi] : { x: a.tx, z: a.tz };
    const final = !nav.path || nav.pi >= nav.path.length;
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (d < (final ? 0.05 : 0.35)) {
      if (final) return { used, arrived: true, moved };
      nav.pi++;
      continue;
    }
    const left = (budget - used) * speed;
    const len = Math.min(stepLen, d, left);
    if (len < 1e-4) break;
    const base = Math.atan2(goal.z - p.z, goal.x - p.x);
    if (nav.free) {
      p.x += Math.cos(base) * len;
      p.z += Math.sin(base) * len;
      p.rot = base;
      used += len / speed;
      moved = true;
      continue;
    }
    let went = false;
    let ahead: Hit = null;
    for (const t of TURNS) {
      for (const sgn of t === 0 ? [0] : [nav.side, -nav.side]) {
        const ang = base + t * sgn;
        const nx = t === 0 && len >= d ? goal.x : p.x + Math.cos(ang) * len;
        const nz = t === 0 && len >= d ? goal.z : p.z + Math.sin(ang) * len;
        const hit = blocker(w, p, a, nx, nz, nav, people);
        if (t === 0) ahead = hit;
        if (!hit) {
          if (sgn) {
            nav.side = sgn;
            WALK_STATS.turns++;
          }
          p.x = nx;
          p.z = nz;
          p.rot = ang;
          went = true;
          break;
        }
        if (hit.person) nav.hp++;
        else nav.ho++;
      }
      if (went) break;
      // 목적지를 품은 것(창고·나무·바위)에 닿았거나, 목적지에 사람들이 모여 있으면 그 가장자리에서 한다
      if (t === 0 && ahead) {
        const df = Math.hypot(a.tx - p.x, a.tz - p.z);
        if (ahead.o ? depth(ahead.o, a.tx, a.tz, BODY + 0.05) > 0 || (final && df < 1.4) : final && (df < 1.4 || crowdAt(ahead.person!, a))) return { used, arrived: true, moved };
      }
    }
    if (went) {
      WALK_STATS.steps++;
      used += len / speed;
      nav.clock += len / speed;
      moved = true;
      const dd = Math.hypot(a.tx - p.x, a.tz - p.z);
      if (dd < nav.best - 0.3) {
        nav.best = dd;
        nav.bestAt = nav.clock;
      }
    } else {
      // 꼼짝 못 한다: 잠깐 기다렸다가, 사람에게 막힌 거면 비집고 지나간다
      const wait = Math.min(budget - used, 3);
      used += wait;
      nav.clock += wait;
      nav.stuck += wait;
      WALK_STATS.waits++;
      if (nav.stuck > 8 && ahead?.person) {
        nav.ghost = w.time + 90;
        nav.stuck = 0;
        WALK_STATS.ghosts++;
      }
    }
    // 오래도록 가까워지지 않으면: 붐벼서면 비집고, 물건에 갇혔으면 길을 찾는다
    if (nav.clock - nav.bestAt > 150 && nav.best > 1 && nav.hp + nav.ho > 20) {
      // 사람 사이는 비집고, 물건에 막혔으면 길을 찾아 돌아가고, 그래도 안 되면 그냥 지나간다
      nav.ghost = Math.max(nav.ghost, w.time + 150);
      WALK_STATS.ghosts++;
      if (nav.ho > 0 && !nav.path) {
        nav.path = findPath(w, p, a);
        nav.pi = 0;
        nav.end = { x: a.tx, z: a.tz };
        WALK_STATS.paths++;
        if (!nav.path) {
          nav.free = true;
          WALK_STATS.nopath++;
        }
      } else if (nav.path && nav.ho * 2 >= nav.hp) {
        nav.free = true;
        WALK_STATS.free++;
      } else nav.ghost = w.time + 600;
      nav.hp = nav.ho = 0;
      nav.bestAt = nav.clock;
    }
    if (!went) break;
  }
  return { used: Math.max(used, Math.min(budget, 1e-3)), arrived: false, moved };
}

/** 장애물 안에 들어가 버린 사람을 바깥으로 꺼낸다 (빠르게 따라잡은 뒤 등) */
export function unstick(w: WorldState, p: Person) {
  if (!p.alive || p.away || p.act?.k === "carried") return;
  const a = p.act;
  const S = solids(w);
  const list = S.cells.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  if (!list) return;
  for (const o of list) {
    if (depth(o, p.x, p.z, BODY) <= 0.02) continue;
    // 들어가 쉬는 집 안이면 그대로
    if (o.enter && (!a || a.ph === 1 || depth(o, a.tx, a.tz, BODY + 0.6) > 0)) continue;
    const q = pushOut(o, p.x, p.z);
    p.x = q.x;
    p.z = q.z;
    return;
  }
}

// ─── 격자 길 찾기 ──────────────────────────────────────────────────────

const GRID = 0.7;

function findPath(w: WorldState, p: Person, a: Act): { x: number; z: number }[] | null {
  const S = solids(w);
  const x0 = Math.min(p.x, a.tx) - 14, z0 = Math.min(p.z, a.tz) - 14;
  const W = Math.ceil((Math.abs(p.x - a.tx) + 28) / GRID), H = Math.ceil((Math.abs(p.z - a.tz) + 28) / GRID);
  if (W * H > 40000) return null;
  const free = (i: number, j: number) => {
    const x = x0 + (i + 0.5) * GRID, z = z0 + (j + 0.5) * GRID;
    const list = S.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return true;
    for (const o of list) {
      const dn = depth(o, x, z, BODY + 0.1);
      if (dn <= 0) continue;
      if (o.enter && depth(o, a.tx, a.tz, BODY + 0.6) > 0) continue;
      // 지금 들어가 있는 것은 바깥쪽으로만 빠져나간다
      const now = depth(o, p.x, p.z, BODY + 0.1);
      if (now > 0.02 && dn <= now) continue;
      if (depth(o, a.tx, a.tz, BODY + 0.05) > 0) continue;
      return false;
    }
    return true;
  };
  const si = Math.floor((p.x - x0) / GRID), sj = Math.floor((p.z - z0) / GRID);
  const gi = Math.floor((a.tx - x0) / GRID), gj = Math.floor((a.tz - z0) / GRID);
  const N = W * H;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const state = new Uint8Array(N); // 0 미정 1 열림 2 닫힘 3 막힘
  const fOf = new Float32Array(N);
  // 가장 나은 칸을 꺼내는 힙
  const heap: number[] = [];
  const push = (k: number) => {
    heap.push(k);
    for (let i = heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (fOf[heap[up]] <= fOf[heap[i]]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && fOf[heap[l]] < fOf[heap[m]]) m = l;
        if (r < heap.length && fOf[heap[r]] < fOf[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => Math.hypot(i - gi, j - gj);
  const s0 = sj * W + si;
  g[s0] = 0;
  fOf[s0] = h(si, sj);
  push(s0);
  state[s0] = 1;
  let found = -1;
  for (let it = 0; it < 9000 && heap.length; it++) {
    const cur = pop();
    if (state[cur] === 2) continue;
    state[cur] = 2;
    const ci = cur % W, cj = (cur - ci) / W;
    if (Math.abs(ci - gi) <= 1 && Math.abs(cj - gj) <= 1) {
      found = cur;
      break;
    }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (state[nk] >= 2) continue;
      if (!free(ni, nj) || (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj)))) {
        if (!free(ni, nj)) state[nk] = 3;
        continue;
      }
      const ng = g[cur] + (di && dj ? 1.414 : 1);
      if (ng < g[nk]) {
        g[nk] = ng;
        from[nk] = cur;
        fOf[nk] = ng + h(ni, nj);
        state[nk] = 1;
        push(nk);
      }
    }
  }
  if (found < 0) return null;
  const pts: { x: number; z: number }[] = [];
  for (let k = found; k >= 0 && k !== s0; k = from[k]) {
    const i = k % W, j = (k - i) / W;
    pts.push({ x: x0 + (i + 0.5) * GRID, z: z0 + (j + 0.5) * GRID });
  }
  pts.reverse();
  // 띄엄띄엄 남긴다
  return pts;
}

/** 테스트용: 이 자리가 막혀 있는지 */
export function solidAt(w: WorldState, x: number, z: number, wallsOnly = false) {
  const S = solids(w);
  const list = S.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  return !!list?.some((o) => (!wallsOnly || !o.enter) && depth(o, x, z, 0) > 0.05);
}
