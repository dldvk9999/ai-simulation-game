import { CHRONICLE_LIMIT, HOUR, ISLAND_RADIUS, SCHEMA_VERSION, START_HOUR, YEAR } from "./constants";
import { dayOf } from "./clock";
import { clamp } from "./noise";
import { chance, gauss, int, pick, rand, range, RngHolder } from "./rng";
import { getTerrain, Terrain } from "./terrain";
import { josa, randomName } from "./text";
import type {
  Animal, AnimalKind, ChronicleKind, Emotion, Fish, FxType, Item, Person, Plant, PlantKind, Res, Rock,
  RockKind, Stock, Structure, StructureType, Trait, WorldState,
} from "./types";

export const newId = (w: WorldState) => w.nextId++;

export function addFx(w: WorldState, type: FxType, x: number, z: number, ref?: number, v?: number) {
  w.fx.push({ id: newId(w), t: w.time, type, x, z, ref, v });
}

export function chron(w: WorldState, k: ChronicleKind, text: string) {
  w.chronicle.push({ t: w.time, k, text: `${dayOf(w.time)}일째 · ${text}` });
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
export const living = (w: WorldState) => w.people.filter((p) => p.alive);

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

export function makeRock(w: WorldState, kind: RockKind, x: number, z: number): Rock {
  const max = kind === "boulder" ? 30 : kind === "ore" ? 14 : kind === "clay" ? 24 : 12;
  return { id: newId(w), kind, x, z, amt: max, max, s: range(w, 0.7, 1.3), rot: rand(w) * Math.PI * 2 };
}

export function makeAnimal(w: WorldState, kind: AnimalKind, x: number, z: number, born = w.time - YEAR): Animal {
  return { id: newId(w), kind, x, z, rot: rand(w) * Math.PI * 2, st: "idle", tx: x, tz: z, until: w.time, born, tame: 0, gift: 0, held: null };
}

export function makeFish(w: WorldState, T: Terrain): Fish | null {
  const p = T.randomWaterPoint(w, 0.5, 3.4);
  if (!p) return null;
  const big = chance(w, 0.18);
  return {
    id: newId(w), kind: big ? "bigfish" : "fish", x: p.x, z: p.z, rot: rand(w) * Math.PI * 2, st: "swim",
    tx: p.x, tz: p.z, until: w.time, dies: w.time + range(w, 1, 2.5) * 86400, gift: 0, held: null,
  };
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
  };

  // 식물
  const big: { x: number; z: number }[] = [];
  const small: { x: number; z: number }[] = [];
  const R = ISLAND_RADIUS * 1.25;
  for (let k = 0; k < 4200; k++) {
    const x = range(w, -R, R), z = range(w, -R, R);
    const b = T.biome(x, z);
    const h = T.height(x, z);
    if (b === "deep" || b === "shallow" || b === "pond") continue;
    if (T.inPond(x, z, 1.2)) continue;
    const roll = rand(w);
    let kind: PlantKind | null = null;
    if (b === "beach") {
      if (h > 0.45 && roll < 0.05) kind = "palm";
      else if (roll < 0.065) kind = "fiber";
    } else if (b === "grass") {
      if (roll < 0.03) kind = "tree";
      else if (roll < 0.045) kind = "fruit";
      else if (roll < 0.07) kind = "bush";
      else if (roll < 0.1) kind = "fiber";
      else if (roll < 0.105) kind = "herb";
      else if (h < 2.2 && roll < 0.12) kind = "palm";
    } else if (b === "forest") {
      if (roll < (h > 6 ? 0.08 : 0.15)) kind = h > 6 ? "pine" : "tree";
      else if (roll < 0.2 && h > 6) kind = "pine";
      else if (roll < 0.22) kind = "fruit";
      else if (roll < 0.26) kind = "bush";
      else if (roll < 0.28) kind = "fiber";
      else if (roll < 0.29) kind = "herb";
    } else if (b === "rock") {
      if (h < 11 && roll < 0.035) kind = "pine";
    }
    if (!kind) continue;
    const isBig = kind === "palm" || kind === "tree" || kind === "pine" || kind === "fruit";
    if (!spacedOk(big, x, z, isBig ? 2.6 : 1.4)) continue;
    if (!spacedOk(small, x, z, 1.1)) continue;
    (isBig ? big : small).push({ x, z });
    const p = makePlant(w, kind, x, z, chance(w, 0.85) ? 1 : range(w, 0.3, 0.9));
    if (kind === "palm" || kind === "fruit") p.fruit = int(w, 0, 3);
    if (kind === "bush") p.fruit = int(w, 2, 6);
    w.plants.push(p);
  }

  // 바위
  const rocks: { x: number; z: number }[] = [];
  const placeRock = (kind: RockKind, n: number, ok: (x: number, z: number) => boolean) => {
    for (let i = 0, guard = 0; i < n && guard < 2000; guard++) {
      const pt = T.randomPoint(w, (x, z) => ok(x, z) && spacedOk(rocks, x, z, 3) && spacedOk(big, x, z, 1.6), 50);
      if (!pt) continue;
      rocks.push(pt);
      w.rocks.push(makeRock(w, kind, pt.x, pt.z));
      i++;
    }
  };
  placeRock("rock", 30, (x, z) => {
    const b = T.biome(x, z);
    return (b === "beach" || b === "grass" || b === "forest") && !T.inPond(x, z, 1.5);
  });
  placeRock("boulder", 12, (x, z) => T.biome(x, z) === "rock" || T.height(x, z) > 7);
  placeRock("ore", 6, (x, z) => T.height(x, z) > 7.5 && Math.hypot(x - T.peak.x, z - T.peak.z) < 16);
  placeRock("clay", 4, (x, z) => {
    const d = Math.hypot(x - T.pond.x, z - T.pond.z);
    return d > T.pond.r + 1 && d < T.pond.r + 4;
  });

  // 동물
  const spawnAnimals = (kind: AnimalKind, n: number, ok: (b: string, x: number, z: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      const pt = T.randomPoint(w, (x, z, b) => ok(b, x, z));
      if (pt) w.animals.push(makeAnimal(w, kind, pt.x, pt.z, w.time - range(w, 0.5, 2) * YEAR));
    }
  };
  spawnAnimals("rabbit", 8, (b) => b === "grass" || b === "forest");
  spawnAnimals("boar", 4, (b) => b === "forest");
  spawnAnimals("goat", 4, (b, x, z) => b === "rock" || (b === "grass" && T.height(x, z) > 5));
  spawnAnimals("crab", 6, (b) => b === "beach");
  spawnAnimals("fowl", 4, (b) => b === "grass" || b === "forest");
  for (let i = 0; i < 10; i++) {
    const f = makeFish(w, T);
    if (f) w.fish.push(f);
  }

  // 표류자와 야영지
  const { person, camp } = spawnCastaway(w, T, 26 + int(w, 0, 8), undefined, true);
  w.camp = camp;
  person.act = { k: "unconscious", ph: 1, tx: person.x, tz: person.z, t: 1.2 * HOUR, started: w.time };
  person.anim = "lie";
  w.people.push(person);
  chron(w, "arrive", `${josa(person.name, "이/가")} 무인도의 해변에서 눈을 떴다.`);
  w.timers.castaway = w.time + 4 * 86400;
  return w;
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
