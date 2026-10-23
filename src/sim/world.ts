import { AREA_MUL, CHRONICLE_LIMIT, DAY, HOUR, ISLAND_RADIUS, SCHEMA_VERSION, START_HOUR, YEAR } from "./constants";
import { dayOf } from "./clock";
import { FISH_INFO, METAL_INFO, METALS, STRUCTS } from "./data";
import { clamp } from "./noise";
import { chance, gauss, int, pick, rand, range, RngHolder, weighted } from "./rng";
import { getTerrain, Terrain } from "./terrain";
import { josa, randomName } from "./text";
import type {
  Animal, AnimalKind, ChronicleKind, Emotion, Fish, FishKind, FxType, Item, Metal, Person, Plant, PlantKind, Res, Rock,
  RockKind, Stock, Structure, StructureType, Trait, WorldState,
} from "./types";

export const newId = (w: WorldState) => w.nextId++;

export function addFx(w: WorldState, type: FxType, x: number, z: number, ref?: number, v?: number) {
  w.fx.push({ id: newId(w), t: w.time, type, x, z, ref, v });
}

export function chron(w: WorldState, k: ChronicleKind, text: string) {
  w.chronicle.push({ t: w.time, k, text: `${dayOf(w.time)}일째 · ${text}` });
  w.stats.chron = (w.stats.chron ?? w.chronicle.length - 1) + 1;
  if (w.chronicle.length > CHRONICLE_LIMIT) {
    // 날씨·계절 같은 가벼운 기록부터 지운다
    const light = w.chronicle.findIndex((c) => c.k === "weather" || c.k === "season");
    w.chronicle.splice(light >= 0 && light < w.chronicle.length - 20 ? light : 0, 1);
  }
}

export const bump = (w: WorldState) => {
  w.rev++;
};

export const stockOf = (w: WorldState, r: Res) => w.stock[r] ?? 0;
export function addStock(w: WorldState, r: Res, n: number) {
  w.stock[r] = Math.max(0, (w.stock[r] ?? 0) + n);
}
export function hasStock(w: WorldState, cost: Stock) {
  for (const [r, n] of Object.entries(cost) as [Res, number][]) if (stockOf(w, r) < n) return false;
  return true;
}
export function payStock(w: WorldState, cost: Stock) {
  if (!hasStock(w, cost)) return false;
  for (const [r, n] of Object.entries(cost) as [Res, number][]) addStock(w, r, -n);
  return true;
}
export function missing(w: WorldState, cost: Stock): Stock {
  const out: Stock = {};
  for (const [r, n] of Object.entries(cost) as [Res, number][]) {
    const d = n - stockOf(w, r);
    if (d > 0) out[r] = d;
  }
  return out;
}

export const knows = (w: WorldState, tech: string) => w.tech.known.includes(tech);
/** 섬에 있는 산 사람 (바다 건너 나가 있는 사람은 빼고) */
export const living = (w: WorldState) => w.people.filter((p) => p.alive && !p.away);
export const onIsland = (p: Person) => !!p.alive && !p.away;

export const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export function nearest<T extends { x: number; z: number }>(
  list: T[], x: number, z: number, ok?: (e: T) => boolean, maxD = Infinity,
): T | null {
  let best: T | null = null;
  let bd = maxD * maxD;
  for (const e of list) {
    const dx = e.x - x, dz = e.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd && (!ok || ok(e))) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export const findById = <T extends { id: number }>(list: T[], id: number | undefined | null) =>
  id == null ? undefined : list.find((e) => e.id === id);

export function removeById<T extends { id: number }>(list: T[], id: number) {
  const i = list.findIndex((e) => e.id === id);
  if (i >= 0) list.splice(i, 1);
  return i >= 0;
}

// ─── 생성 ──────────────────────────────────────────────────────────────

export function makePlant(w: WorldState, kind: PlantKind, x: number, z: number, g = 1): Plant {
  return {
    id: newId(w), kind, x, z, g, fruit: 0, rot: rand(w) * Math.PI * 2, s: range(w, 0.8, 1.2),
    stump: 0, regrow: 0, burn: 0,
  };
}

export function makeRock(w: WorldState, kind: RockKind, x: number, z: number, ore?: Metal): Rock {
  const max = kind === "boulder" ? 30 : kind === "ore" ? 14 : kind === "clay" ? 24 : kind === "vein" ? 28 : 12;
  const r: Rock = { id: newId(w), kind, x, z, amt: max, max, s: range(w, 0.7, 1.3), rot: rand(w) * Math.PI * 2 };
  if (ore) r.ore = ore;
  return r;
}

export function makeAnimal(w: WorldState, kind: AnimalKind, x: number, z: number, born = w.time - YEAR): Animal {
  return { id: newId(w), kind, x, z, rot: rand(w) * Math.PI * 2, st: "idle", tx: x, tz: z, until: w.time, born, tame: 0, gift: 0, held: null };
}

const FISH_W = Object.fromEntries(Object.entries(FISH_INFO).map(([k, f]) => [k, f.w])) as Record<FishKind, number>;

export function makeFish(w: WorldState, T: Terrain, kind?: FishKind, near?: { x: number; z: number }): Fish | null {
  const k = kind ?? weighted(w, FISH_W);
  const [d0, d1] = FISH_INFO[k].depth;
  let p: { x: number; z: number } | null = null;
  if (near) {
    const x = near.x + range(w, -1.5, 1.5), z = near.z + range(w, -1.5, 1.5);
    const h = T.height(x, z);
    if (h < -d0 * 0.8 && h > -d1 * 1.2) p = { x, z };
  }
  p ??= T.randomWaterPoint(w, d0, d1);
  if (!p) return null;
  return {
    id: newId(w), kind: k, x: p.x, z: p.z, rot: rand(w) * Math.PI * 2, st: "swim",
    tx: p.x, tz: p.z, until: w.time, dies: w.time + range(w, 1, 2.5) * 86400, gift: 0, held: null,
  };
}

/** 물고기를 한 마리(고등어는 떼로) 풀어 놓고 몇 마리인지 돌려준다 */
export function spawnFish(w: WorldState, T: Terrain) {
  const f = makeFish(w, T);
  if (!f) return 0;
  w.fish.push(f);
  if (f.kind !== "mackerel") return 1;
  let n = 1;
  for (let i = 0; i < 2; i++) {
    const g = makeFish(w, T, "mackerel", f);
    if (g) {
      w.fish.push(g);
      n++;
    }
  }
  return n;
}

export function makeItem(w: WorldState, res: Res, qty: number, x: number, z: number, gift = 0): Item {
  return { id: newId(w), res, qty, x, z, t: w.time, gift, held: null };
}

export function makeStructure(w: WorldState, type: StructureType, x: number, z: number, rot = 0, done = false): Structure {
  return { id: newId(w), type, x, z, rot, prog: done ? 1 : 0, paid: done ? 1 : 0, fuel: 0, lit: 0, t: w.time };
}

const t01 = (r: RngHolder, mean = 0.5, sd = 0.18) => clamp(gauss(r, mean, sd), 0.05, 0.95);

export function createPerson(
  w: WorldState,
  opts: { x: number; z: number; age: number; sex?: "M" | "F"; parents?: Person[] },
): Person {
  const sex = opts.sex ?? (chance(w, 0.5) ? "M" : "F");
  const taken = new Set(w.people.map((p) => p.name));
  const par = opts.parents ?? [];
  const inherit = (k: Trait) =>
    par.length === 2 ? clamp((par[0].traits[k] + par[1].traits[k]) / 2 + gauss(w, 0, 0.14), 0.05, 0.95) : t01(w);
  const traits: Record<Trait, number> = {
    openness: inherit("openness"),
    conscientiousness: inherit("conscientiousness"),
    extraversion: inherit("extraversion"),
    agreeableness: inherit("agreeableness"),
    neuroticism: inherit("neuroticism"),
  };
  const { openness: O, extraversion: E, agreeableness: A, neuroticism: N } = traits;
  // 뜻: 아이는 부모를 닮고, 어른은 성격에서 비롯된다
  const pv = par.length === 2 && par[0].vals && par[1].vals ? [par[0].vals, par[1].vals] : null;
  const vals: [number, number] = pv
    ? [clamp((pv[0][0] + pv[1][0]) / 2 + gauss(w, 0, 0.08), 0, 1), clamp((pv[0][1] + pv[1][1]) / 2 + gauss(w, 0, 0.08), 0, 1)]
    : [clamp(0.15 + 0.7 * O - 0.2 * traits.conscientiousness + gauss(w, 0, 0.14), 0, 1), clamp(0.2 + 0.6 * A + 0.15 * E + gauss(w, 0, 0.14), 0, 1)];
  const sens: Record<Emotion, number> = {
    joy: 0.6 + 0.5 * E + rand(w) * 0.3,
    sadness: 0.5 + 0.7 * N + rand(w) * 0.3,
    fear: Math.max(0.2, 0.4 + 0.8 * N - 0.2 * O + rand(w) * 0.3),
    anger: 0.4 + 0.6 * N + 0.5 * (1 - A) + rand(w) * 0.2,
    surprise: 0.6 + 0.6 * O + rand(w) * 0.2,
    love: 0.5 + 0.6 * A + rand(w) * 0.3,
  };
  const hue = par.length === 2
    ? { skin: (par[0].hue.skin + par[1].hue.skin) / 2, hair: pick(w, [par[0].hue.hair, par[1].hue.hair]), cloth: rand(w) }
    : { skin: rand(w), hair: rand(w), cloth: rand(w) };
  return {
    id: newId(w),
    name: randomName(w, sex, taken),
    sex,
    birth: w.time - opts.age * YEAR,
    x: opts.x,
    z: opts.z,
    rot: rand(w) * Math.PI * 2,
    traits,
    sens,
    likes: {
      food: pick(w, ["berry", "fruit", "cookedFish", "cookedMeat", "meal", "crop"] as Res[]),
      weather: pick(w, ["clear", "rain", "snow", "cloudy", "clear"] as const),
      leisure: pick(w, ["sea", "sing", "stars", "draw", "swim", "sea"]),
    },
    fears: chance(w, 0.15 + N * 0.4) ? "storm" : null,
    needs: { hunger: 62, thirst: 55, energy: 70, warmth: 85, social: 70, fun: 60 },
    health: 92,
    emo: { joy: 0.1, sadness: 0, fear: 0, anger: 0, surprise: 0, love: 0 },
    act: null,
    anim: "idle",
    gesture: null,
    gestureUntil: 0,
    bubble: null,
    carry: null,
    skills: {},
    home: null,
    partner: null,
    parents: par.map((p) => p.id),
    rel: {},
    preg: 0,
    pregBy: null,
    grief: null,
    outfit: knows(w, "electricity") ? "modern" : knows(w, "weaving") ? "cloth" : "rag",
    hue,
    alive: 1,
    died: 0,
    cause: "",
    lastThought: 0,
    seen: {},
    ill: 0,
    group: null,
    role: null,
    vals,
    core: [vals[0], vals[1]],
    away: null,
  };
}

/** 플레이어 클릭 판정을 위한 대략적인 크기 */
export function plantRadius(p: Plant) {
  if (p.kind === "bush") return 0.9;
  if (p.kind === "fiber" || p.kind === "herb" || p.kind === "crop") return 0.6;
  return 0.9;
}

function spacedOk(list: { x: number; z: number }[], x: number, z: number, d: number) {
  const d2 = d * d;
  for (const e of list) {
    const dx = e.x - x, dz = e.z - z;
    if (dx * dx + dz * dz < d2) return false;
  }
  return true;
}

export function createWorld(seed: number, createdAt = Date.now()): WorldState {
  const T = getTerrain(seed);
  const w: WorldState = {
    v: SCHEMA_VERSION,
    seed,
    rng: (seed ^ 0xa5a5a5a5) | 0,
    time: START_HOUR * HOUR,
    nextId: 1,
    rev: 1,
    weather: { type: "clear", prev: "clear", changedAt: 0, until: START_HOUR * HOUR + 6 * HOUR, temp: 18, wind: 0.3, snow: 0, wet: 0, nextStrike: 0 },
    people: [], plants: [], rocks: [], animals: [], fish: [], items: [], structures: [],
    stock: {},
    tech: { known: ["knapping"], prog: {}, focus: null },
    camp: { x: 0, z: 0 },
    chronicle: [],
    stats: { births: 0, deaths: 0, arrivals: 1, maxPop: 1, generation: 1, created: createdAt },
    timers: { castaway: 0, fish: 0, day: 1, strike: 0, animals: 0 },
    fx: [],
    groups: [],
    disaster: null,
    history: { quake: 0, typhoon: 0, tsunami: 0, sick: 0, wars: 0, lastDisaster: 0, lastType: null },
    found: [],
    deposits: [],
    voyages: [],
    beasts: [],
    morale: 70,
    designs: [],
    blazes: [],
  };

  // 식물 (처음 만든 섬보다 1.7배 빽빽하게)
  plantFlora(w, T, 1.7);
  placeRocks(w, T);
  placeVeins(w, T);
  w.deposits = makeDeposits(w, T);

  // 동물과 물고기 (섬이 넓어진 만큼 더)
  spawnFauna(w, T, 1.7 * AREA_MUL);
  for (let n = 0; n < 26; ) n += spawnFish(w, T) || 1;

  // 표류자와 야영지
  const { person, camp } = spawnCastaway(w, T, 26 + int(w, 0, 8), undefined, true);
  w.camp = camp;
  person.act = { k: "unconscious", ph: 1, tx: person.x, tz: person.z, t: 1.2 * HOUR, started: w.time };
  person.anim = "lie";
  w.people.push(person);
  chron(w, "arrive", `${josa(person.name, "이/가")} 무인도의 해변에서 눈을 떴다.`);
  w.timers.castaway = w.time + 4 * 86400;
  w.timers.disaster = w.time + 30 * DAY;
  w.timers.beast = w.time + 12 * DAY;
  return w;
}

/** 바위: avoid가 있으면 그 자리는 피한다 (예전 섬을 넓힐 때 새 땅에만) */
function placeRocks(w: WorldState, T: Terrain, avoid?: (x: number, z: number) => boolean, mul = AREA_MUL) {
  const rocks: { x: number; z: number }[] = w.rocks.map((r) => ({ x: r.x, z: r.z }));
  const big = w.plants.filter((p) => isBigPlant(p.kind));
  const placeRock = (kind: RockKind, n: number, ok: (x: number, z: number) => boolean) => {
    for (let i = 0, guard = 0; i < n && guard < 3000; guard++) {
      const pt = T.randomPoint(w, (x, z) => ok(x, z) && !avoid?.(x, z) && spacedOk(rocks, x, z, 3) && spacedOk(big, x, z, 1.6), 50);
      if (!pt) continue;
      rocks.push(pt);
      w.rocks.push(makeRock(w, kind, pt.x, pt.z));
      i++;
    }
  };
  placeRock("rock", Math.round(30 * mul), (x, z) => {
    const b = T.biome(x, z);
    return (b === "beach" || b === "grass" || b === "forest") && !T.inPond(x, z, 1.5);
  });
  placeRock("boulder", Math.round(12 * mul), (x, z) => T.biome(x, z) === "rock" || T.height(x, z) > 7 || (T.inMine(x, z, 4) && !T.inMine(x, z, -1)));
  if (!avoid) {
    placeRock("ore", 6, (x, z) => T.height(x, z) > 7.5 && Math.hypot(x - T.peak.x, z - T.peak.z) < 16);
    placeRock("clay", 4, (x, z) => {
      const d = Math.hypot(x - T.pond.x, z - T.pond.z);
      return d > T.pond.r + 1 && d < T.pond.r + 4;
    });
  }
}

/** 광맥 지대의 바위들: 흔한 금속일수록 많이, 귀한 것일수록 적게 */
function placeVeins(w: WorldState, T: Terrain) {
  const M = T.mine;
  const spots: { x: number; z: number }[] = w.rocks.map((r) => ({ x: r.x, z: r.z }));
  const order = [...METALS].sort((a, b) => METAL_INFO[a].veins - METAL_INFO[b].veins);
  for (const m of order) {
    // 귀한 것은 언덕 한가운데 깊숙이
    const reach = M.r * (METAL_INFO[m].veins <= 2 ? 0.45 : 0.85);
    for (let i = 0, guard = 0; i < METAL_INFO[m].veins && guard < 600; guard++) {
      const a = rand(w) * Math.PI * 2, d = Math.sqrt(rand(w)) * reach;
      const x = M.x + Math.cos(a) * d, z = M.z + Math.sin(a) * d;
      if (!T.isLand(x, z) || T.height(x, z) < 1.4 || !spacedOk(spots, x, z, 2.5)) continue;
      spots.push({ x, z });
      w.rocks.push(makeRock(w, "vein", x, z, m));
      i++;
    }
  }
}

const isBigPlant = (k: PlantKind) => k === "palm" || k === "tree" || k === "pine" || k === "fruit";

/** 섬에 식물을 흩뿌린다. D는 밀도 배율, avoid는 피할 자리 */
function plantFlora(w: WorldState, T: Terrain, D: number, avoid?: (x: number, z: number) => boolean) {
  const big: { x: number; z: number }[] = [];
  const small: { x: number; z: number }[] = [];
  for (const p of w.plants) (isBigPlant(p.kind) ? big : small).push(p);
  const R = ISLAND_RADIUS * 1.25;
  for (let k = 0, n = Math.round(4200 * AREA_MUL); k < n; k++) {
    const x = range(w, -R, R), z = range(w, -R, R);
    const b = T.biome(x, z);
    const h = T.height(x, z);
    if (b === "deep" || b === "shallow" || b === "pond") continue;
    if (T.inPond(x, z, 1.2)) continue;
    const roll = rand(w);
    let kind: PlantKind | null = null;
    if (b === "beach") {
      if (h > 0.45 && roll < 0.05 * D) kind = "palm";
      else if (roll < 0.065 * D) kind = "fiber";
    } else if (b === "grass") {
      if (roll < 0.03 * D) kind = "tree";
      else if (roll < 0.045 * D) kind = "fruit";
      else if (roll < 0.07 * D) kind = "bush";
      else if (roll < 0.1 * D) kind = "fiber";
      else if (roll < 0.11 * D) kind = "herb";
      else if (h < 2.2 && roll < 0.125 * D) kind = "palm";
    } else if (b === "forest") {
      if (roll < (h > 6 ? 0.08 : 0.15) * D) kind = h > 6 ? "pine" : "tree";
      else if (roll < 0.2 * D && h > 6) kind = "pine";
      else if (roll < 0.22 * D) kind = "fruit";
      else if (roll < 0.26 * D) kind = "bush";
      else if (roll < 0.28 * D) kind = "fiber";
      else if (roll < 0.3 * D) kind = "herb";
    } else if (b === "rock") {
      if (h < 11 && roll < 0.035 * D) kind = "pine";
    }
    if (!kind) continue;
    const isBig = isBigPlant(kind);
    if (!spacedOk(big, x, z, isBig ? 2.4 : 1.3)) continue;
    if (!spacedOk(small, x, z, 1.0)) continue;
    if (avoid?.(x, z)) continue;
    (isBig ? big : small).push({ x, z });
    const p = makePlant(w, kind, x, z, chance(w, 0.85) ? 1 : range(w, 0.3, 0.9));
    if (kind === "palm" || kind === "fruit") p.fruit = int(w, 0, 3);
    if (kind === "bush") p.fruit = int(w, 2, 6);
    w.plants.push(p);
  }
}

const FAUNA: [AnimalKind, number, (T: Terrain, b: string, x: number, z: number) => boolean][] = [
  ["rabbit", 8, (_, b) => b === "grass" || b === "forest"],
  ["boar", 4, (_, b) => b === "forest"],
  ["goat", 4, (T, b, x, z) => b === "rock" || (b === "grass" && T.height(x, z) > 5)],
  ["crab", 6, (_, b) => b === "beach"],
  ["fowl", 4, (_, b) => b === "grass" || b === "forest"],
];

function spawnFauna(w: WorldState, T: Terrain, mul: number) {
  for (const [kind, n, ok] of FAUNA) {
    for (let i = 0; i < Math.round(n * mul); i++) {
      const pt = T.randomPoint(w, (x, z, b) => ok(T, b, x, z));
      if (pt) w.animals.push(makeAnimal(w, kind, pt.x, pt.z, w.time - range(w, 0.5, 2) * YEAR));
    }
  }
}

/** 땅속에 숨은 약돌 광맥: 산자락의 바위 지대와 숲 */
function makeDeposits(w: WorldState, T: Terrain) {
  const out: { x: number; z: number }[] = [];
  for (let i = 0, guard = 0; i < 5 && guard < 400; guard++) {
    const pt = T.randomPoint(w, (x, z, b) => (b === "rock" || b === "forest" || (b === "grass" && T.height(x, z) > 4)) && T.slopeAt(x, z) < 0.8, 40);
    if (!pt || out.some((d) => dist(d.x, d.z, pt.x, pt.z) < 14)) continue;
    out.push(pt);
    i++;
  }
  return out;
}

/** 예전 저장본을 지금 규칙에 맞춘다 */
export function migrateWorld(w: WorldState) {
  const T = getTerrain(w.seed);
  const old = (w.v ?? 1) < 2;
  w.groups ??= [];
  w.disaster ??= null;
  w.history ??= { quake: 0, typhoon: 0, tsunami: 0, sick: 0, wars: 0, lastDisaster: 0, lastType: null };
  w.found ??= [];
  w.voyages ??= [];
  w.deposits ??= makeDeposits(w, T);
  w.timers.disaster ??= w.time + 10 * DAY;
  w.beasts ??= [];
  w.morale ??= 70;
  w.designs ??= [...new Set(w.structures.filter((s) => s.prog >= 1).map((s) => `${s.type}:${s.lv ?? 1}`))];
  w.timers.beast ??= w.time + 3 * DAY;
  w.history.beast ??= 0;
  w.history.lastBeast ??= 0;
  w.blazes ??= [];
  w.history.fire ??= 0;
  w.history.lastFire ??= 0;
  for (const p of w.people) {
    p.ill ??= 0;
    p.group ??= null;
    p.role ??= null;
    p.away ??= null;
    if (!p.vals) {
      const { openness: O, conscientiousness: C, agreeableness: A, extraversion: E } = p.traits;
      p.vals = [clamp(0.15 + 0.7 * O - 0.2 * C + gauss(w, 0, 0.14), 0, 1), clamp(0.2 + 0.6 * A + 0.15 * E + gauss(w, 0, 0.14), 0, 1)];
    }
    p.core ??= [p.vals[0], p.vals[1]];
  }
  if (old) {
    // 동식물을 새 기준(1.7배)에 맞춰 한 번 더 채운다
    const busy = (x: number, z: number) => !T.wasLand(x, z) || dist(x, z, w.camp.x, w.camp.z) < 9 || w.structures.some((s) => dist(x, z, s.x, s.z) < 4);
    plantFlora(w, T, 0.7, busy);
    spawnFauna(w, T, 0.7);
    for (let n = 0; n < 7; ) n += spawnFish(w, T) || 1;
    w.rev++;
  }
  if ((w.v ?? 1) < 3) widenIsland(w, T);
  w.v = SCHEMA_VERSION;
  return w;
}

/** 섬이 두 배로 넓어졌다: 새 땅에 숲과 짐승, 바위와 광맥을 채우고 바닷가 시설은 새 해안으로 옮긴다 */
function widenIsland(w: WorldState, T: Terrain) {
  const old = (x: number, z: number) => T.wasLand(x, z);
  plantFlora(w, T, 1.7, old);
  placeRocks(w, T, old, AREA_MUL - 1);
  placeVeins(w, T);
  spawnFauna(w, T, 1.7 * (AREA_MUL - 1));
  // 예전 바닷가는 이제 뭍이다
  w.structures = w.structures.filter((s) => s.type !== "raft");
  for (const s of w.structures) {
    if (s.type !== "dock" && s.type !== "seawall" && s.type !== "shipyard" && s.type !== "lighthouse") continue;
    const a = Math.atan2(s.z, s.x);
    const side = s.type === "dock" ? -0.4 : s.type === "shipyard" ? 0.6 : s.type === "seawall" ? 1.6 : 3.5;
    const sp = T.shorePoint(a, side);
    s.x = sp.x;
    s.z = sp.z;
    s.rot = a;
    const r = STRUCTS[s.type].radius + 0.5;
    w.plants = w.plants.filter((p) => dist(p.x, p.z, s.x, s.z) > r);
  }
  for (const v of w.voyages) {
    const yard = w.structures.find((s) => s.type === (v.via === "ship" ? "shipyard" : "portal"));
    if (yard) v.from = { x: yard.x + Math.cos(yard.rot) * 3.2, z: yard.z + Math.sin(yard.rot) * 3.2, rot: yard.rot };
  }
  // 뭍이 된 곳의 물고기는 새 바다로, 게는 새 모래밭으로
  const before = w.fish.length;
  w.fish = w.fish.filter((f) => {
    const [d0, d1] = FISH_INFO[f.kind]?.depth ?? [0.5, 4];
    const h = T.height(f.x, f.z);
    return h < -d0 * 0.6 && h > -d1 * 1.5;
  });
  for (let n = w.fish.length; n < Math.max(before, 26); ) n += spawnFish(w, T) || 1;
  for (const a of w.animals) {
    if (a.kind !== "crab" || T.biome(a.x, a.z) === "beach") continue;
    const sp = T.shorePoint(Math.atan2(a.z, a.x), 1.2);
    a.x = a.tx = sp.x;
    a.z = a.tz = sp.z;
  }
  chron(w, "misc", "바닷물이 물러나며 섬이 두 배로 넓어졌다. 새로 드러난 땅 한쪽에는 낯선 바위 언덕이 솟아 있다.");
  w.rev++;
}

/** 해변에 사람을 하나 떠밀려오게 하고, 처음이라면 야영지 위치도 정한다 */
export function spawnCastaway(w: WorldState, T: Terrain, age: number, sex?: "M" | "F", first = false) {
  let best: { x: number; z: number; wx: number; wz: number; a: number } | null = null;
  for (let k = 0; k < 40; k++) {
    const a = rand(w) * Math.PI * 2;
    const sp = T.shorePoint(a, 1.2);
    const b = T.biome(sp.x, sp.z);
    if (b === "beach" || b === "grass") {
      best = { ...sp, a };
      break;
    }
  }
  if (!best) {
    const a = rand(w) * Math.PI * 2;
    best = { ...T.shorePoint(a, 1.2), a };
  }
  const person = createPerson(w, { x: best.x, z: best.z, age, sex });
  // 뗏목 잔해
  const raft = makeStructure(w, "raft", best.wx * 0.15 + best.x * 0.85, best.wz * 0.15 + best.z * 0.85, best.a, true);
  w.structures.push(raft);

  if (!first) return { person, camp: w.camp };
  // 야영지: 해안에서 안쪽으로 평평한 풀밭
  let camp = { x: best.x * 0.8, z: best.z * 0.8 };
  const dirx = -Math.cos(best.a), dirz = -Math.sin(best.a);
  for (let d = 6; d < 26; d += 1.5) {
    for (const side of [0, 3, -3, 6, -6]) {
      const x = best.x + dirx * d - dirz * side;
      const z = best.z + dirz * d + dirx * side;
      const b = T.biome(x, z);
      if ((b === "grass" || b === "forest") && T.slopeAt(x, z) < 0.3 && !T.inPond(x, z, 3)) {
        camp = { x, z };
        d = 999;
        break;
      }
    }
  }
  // 야영지 주변 나무 정리
  for (let i = w.plants.length - 1; i >= 0; i--) {
    const p = w.plants[i];
    if (dist(p.x, p.z, camp.x, camp.z) < 4.5) w.plants.splice(i, 1);
  }
  return { person, camp };
}
