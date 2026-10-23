import { ANIMAL_SPEED, DAY, HOUR, TIME_SCALE } from "./constants";
import { FISH_INFO } from "./data";
import { blessed } from "./religion";
import { hourOf, seasonOf } from "./clock";
import { chance, pick, pRate, rand, range } from "./rng";
import type { Terrain } from "./terrain";
import type { AnimalKind, PlantKind, WorldState } from "./types";
import { addFx, bump, dist, findById, makeAnimal, makeItem, makePlant, nearest, spawnFish } from "./world";

const GROW_DAYS: Record<PlantKind, number> = {
  palm: 5, tree: 5, pine: 6, fruit: 5, bush: 2, fiber: 1, herb: 1.5, crop: 2.5,
};
// 처음보다 1.7배 넉넉하게, 섬이 넓어진 만큼 또 두 배
const CAP: Partial<Record<PlantKind, number>> = { palm: 136, tree: 374, pine: 170, fruit: 102, bush: 238, fiber: 238, herb: 68 };
const TREE_KINDS = new Set<PlantKind>(["palm", "tree", "pine", "fruit"]);
export const isTree = (k: PlantKind) => TREE_KINDS.has(k);

export function updatePlants(w: WorldState, T: Terrain, dt: number) {
  const season = seasonOf(w.time);
  const growMul = season === 3 ? 0.3 : season === 1 ? 1.2 : 1;
  const counts: Partial<Record<PlantKind, number>> = {};
  for (const p of w.plants) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  // 같은 dt에 대한 확률은 한 번만 계산
  const pBush = pRate(1 / (3 * HOUR), dt);
  const pPalm = pRate(1 / (0.6 * DAY), dt);
  const pFruit = pRate(1 / (0.4 * DAY), dt);
  const pSeed = pRate(1 / (2.5 * DAY), dt) * (season === 3 ? 0.2 : 1);
  const pDouse = w.weather.wet > 0.6 ? pRate(1 / HOUR, dt) : 0;

  for (let i = 0; i < w.plants.length; i++) {
    const p = w.plants[i];
    if (p.burn) {
      if (w.time >= p.burn || (pDouse && chance(w, pDouse))) {
        p.burn = 0;
        p.stump = 1;
        p.fruit = 0;
        p.regrow = w.time + range(w, 1.5, 3) * DAY;
        bump(w);
      }
      continue;
    }
    if (p.stump) {
      if (w.time >= p.regrow) {
        p.stump = 0;
        p.g = 0.05;
        bump(w);
      }
      continue;
    }
    if (p.g < 1) {
      p.g = Math.min(1, p.g + (dt / (GROW_DAYS[p.kind] * DAY)) * (p.kind === "crop" ? 1 : growMul));
      continue;
    }
    // 열매
    if (season !== 3) {
      if (p.kind === "bush") {
        if (p.fruit < 6 && chance(w, pBush)) p.fruit++;
      } else if (p.kind === "palm") {
        if (p.fruit < 3 && chance(w, pPalm)) p.fruit++;
      } else if (p.kind === "fruit") {
        if (p.fruit < 4 && chance(w, pFruit)) p.fruit++;
      }
    }
    if (p.kind === "crop") continue;
    // 번식
    const cap = CAP[p.kind] ?? 50;
    if ((counts[p.kind] ?? 0) < cap && chance(w, pSeed)) {
      const a = rand(w) * Math.PI * 2;
      const d = range(w, 2.5, 6);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const b = T.biome(x, z);
      const okBiome =
        p.kind === "palm" ? b === "beach" || (b === "grass" && T.height(x, z) < 2.2)
        : p.kind === "pine" ? b === "forest" || b === "rock" || b === "grass"
        : b === "grass" || b === "forest";
      if (okBiome && !T.inPond(x, z, 1) && !nearCamp(w, x, z) && !crowded(w, x, z, isTree(p.kind) ? 2.4 : 1.2)) {
        w.plants.push(makePlant(w, p.kind, x, z, 0.05));
        counts[p.kind] = (counts[p.kind] ?? 0) + 1;
        bump(w);
      }
    }
  }
}

function nearCamp(w: WorldState, x: number, z: number) {
  if (dist(x, z, w.camp.x, w.camp.z) < 7) return true;
  for (const s of w.structures) if (dist(x, z, s.x, s.z) < 3.5) return true;
  return false;
}

function crowded(w: WorldState, x: number, z: number, d: number) {
  return nearest(w.plants, x, z, undefined, d) != null || nearest(w.rocks, x, z, undefined, 1.5) != null;
}

// ─── 동물 ──────────────────────────────────────────────────────────────

const FLEE: Record<AnimalKind, number> = { rabbit: 5, boar: 3.2, goat: 6, crab: 2.4, fowl: 4.5 };
const SPEED: Record<AnimalKind, number> = { rabbit: 1.5, boar: 1.1, goat: 1.2, crab: 0.5, fowl: 1.0 };
export const ANIMAL_CAP: Record<AnimalKind, number> = { rabbit: 48, boar: 20, goat: 24, crab: 34, fowl: 28 };
export const ANIMAL_NAME: Record<AnimalKind, string> = { rabbit: "토끼", boar: "멧돼지", goat: "산양", crab: "게", fowl: "들닭" };

function habitatOk(T: Terrain, kind: AnimalKind, x: number, z: number) {
  const b = T.biome(x, z);
  if (kind === "crab") return b === "beach";
  if (kind === "goat") return b === "rock" || b === "grass" || b === "forest";
  return b === "grass" || b === "forest" || (kind === "boar" && b === "beach");
}

export function updateAnimals(w: WorldState, T: Terrain, dt: number) {
  const night = hourOf(w.time) >= 21.5 || hourOf(w.time) < 5;
  for (const a of w.animals) {
    if (a.st === "held") continue;
    if (a.lead != null) {
      const p = findById(w.people, a.lead);
      if (!p || !p.alive || !p.act || p.act.k !== "tame") {
        a.lead = undefined;
      } else {
        a.x = p.x + Math.cos(p.rot + Math.PI) * 0.9;
        a.z = p.z + Math.sin(p.rot + Math.PI) * 0.9;
        a.rot = p.rot;
        a.st = "move";
        continue;
      }
    }
    if (a.st === "stun") {
      if (w.time < a.until) continue;
      a.st = "idle";
      a.until = w.time;
    }
    const pen = a.tame ? findById(w.structures, a.tame) : undefined;
    if (a.tame && !pen) a.tame = 0;

    // 물에 빠졌으면 뭍으로
    const inWater = T.height(a.x, a.z) < (a.kind === "crab" ? -0.6 : 0.1) || T.inPond(a.x, a.z, -0.4);
    if (inWater && a.st !== "flee") {
      const sp = T.shorePoint(Math.atan2(a.z, a.x), 2);
      a.st = "flee";
      a.tx = sp.x;
      a.tz = sp.z;
    }

    // 사람을 보면 도망
    if (!pen && a.st !== "flee") {
      const near = nearest(w.people, a.x, a.z, (p) => p.alive === 1 && p.act?.k !== "sleep", FLEE[a.kind]);
      if (near) {
        const ang = Math.atan2(a.z - near.z, a.x - near.x) + range(w, -0.6, 0.6);
        const d = range(w, 6, 10);
        let tx = a.x + Math.cos(ang) * d, tz = a.z + Math.sin(ang) * d;
        if (!habitatOk(T, a.kind, tx, tz)) {
          tx = a.x - Math.cos(ang) * 2;
          tz = a.z - Math.sin(ang) * 2;
        }
        a.st = "flee";
        a.tx = tx;
        a.tz = tz;
      }
    }

    if (a.st === "sleep") {
      if (!night) a.st = "idle";
      continue;
    }

    if (a.st === "idle") {
      if (night && a.kind !== "crab" && !pen) {
        a.st = "sleep";
        continue;
      }
      if (w.time >= a.until) {
        for (let k = 0; k < 6; k++) {
          const ang = rand(w) * Math.PI * 2;
          const d = range(w, 2, pen ? 2.2 : 7);
          const cx = pen ? pen.x : a.x, cz = pen ? pen.z : a.z;
          const tx = cx + Math.cos(ang) * d, tz = cz + Math.sin(ang) * d;
          if (pen || habitatOk(T, a.kind, tx, tz)) {
            a.tx = tx;
            a.tz = tz;
            a.st = "move";
            break;
          }
        }
        if (a.st === "idle") a.until = w.time + range(w, 10, 30) * 60;
      }
      continue;
    }

    // 이동
    const sp = ANIMAL_SPEED * SPEED[a.kind] * (a.st === "flee" ? 2.4 : 1);
    const d = dist(a.x, a.z, a.tx, a.tz);
    const step = sp * dt;
    if (d <= step || d < 0.05) {
      a.x = a.tx;
      a.z = a.tz;
      a.st = "idle";
      a.until = w.time + range(w, 8, 40) * 60;
    } else {
      a.x += ((a.tx - a.x) / d) * step;
      a.z += ((a.tz - a.z) / d) * step;
      a.rot = Math.atan2(a.tz - a.z, a.tx - a.x);
    }
  }
}

/** 하루에 한 번: 번식과 이주 */
export function dailyAnimals(w: WorldState, T: Terrain) {
  const kinds: AnimalKind[] = ["rabbit", "boar", "goat", "crab", "fowl"];
  const season = seasonOf(w.time);
  for (const kind of kinds) {
    const list = w.animals.filter((a) => a.kind === kind);
    const wild = list.filter((a) => !a.tame);
    const tame = list.filter((a) => a.tame);
    if (list.length < ANIMAL_CAP[kind] && wild.length >= 2 && season !== 3) {
      const births = Math.floor(wild.length / 2);
      // 풍요제가 통하면 짐승이 더 자주 새끼를 친다
      const pBirth = 0.3 * (1 + 0.7 * blessed(w, "bounty"));
      for (let i = 0; i < births; i++) {
        if (chance(w, pBirth) && list.length + i < ANIMAL_CAP[kind]) {
          const mom = pick(w, wild);
          w.animals.push(makeAnimal(w, kind, mom.x + range(w, -1, 1), mom.z + range(w, -1, 1), w.time));
          bump(w);
        }
      }
    }
    if (tame.length >= 2 && tame.length < 8 && chance(w, 0.35)) {
      const mom = pick(w, tame);
      const baby = makeAnimal(w, kind, mom.x, mom.z, w.time);
      baby.tame = mom.tame;
      w.animals.push(baby);
      bump(w);
    }
    // 멸종 방지: 다른 곳에서 건너온다
    if (wild.length < 2 && chance(w, 0.35)) {
      const pt = T.randomPoint(w, (x, z) => habitatOk(T, kind, x, z) && dist(x, z, w.camp.x, w.camp.z) > 20);
      if (pt) {
        w.animals.push(makeAnimal(w, kind, pt.x, pt.z));
        bump(w);
      }
    }
  }
}

// ─── 물고기 ────────────────────────────────────────────────────────────

export function updateFish(w: WorldState, T: Terrain, dt: number) {
  const season = seasonOf(w.time);
  const cap = season === 1 ? 46 : season === 3 ? 22 : 36;
  if (w.fish.length < cap && chance(w, pRate(1 / (0.75 * HOUR), dt))) {
    if (spawnFish(w, T)) bump(w);
  }
  for (let i = w.fish.length - 1; i >= 0; i--) {
    const f = w.fish[i];
    if (f.st === "held") continue;
    if (w.time >= f.dies && f.st !== "stun") {
      w.fish.splice(i, 1);
      bump(w);
      continue;
    }
    if (f.st === "stun") {
      if (w.time >= f.until) f.st = "swim";
      continue;
    }
    if (w.time >= f.until || dist(f.x, f.z, f.tx, f.tz) < 0.2) {
      const [d0, d1] = FISH_INFO[f.kind]?.depth ?? [0.45, 4];
      for (let k = 0; k < 5; k++) {
        const a = rand(w) * Math.PI * 2;
        const d = range(w, 1.5, f.kind === "tuna" ? 10 : 6);
        const tx = f.x + Math.cos(a) * d, tz = f.z + Math.sin(a) * d;
        const h = T.height(tx, tz);
        if (h < -Math.min(0.45, d0) && h > -d1 - 0.5) {
          f.tx = tx;
          f.tz = tz;
          break;
        }
      }
      f.until = w.time + range(w, 3, 12) * 60;
    }
    const d = dist(f.x, f.z, f.tx, f.tz);
    const step = ((f.kind === "tuna" ? 1.6 : f.kind === "flatfish" ? 0.4 : 0.8) / TIME_SCALE) * dt;
    if (d > 0.01) {
      const k = Math.min(1, step / d);
      f.x += (f.tx - f.x) * k;
      f.z += (f.tz - f.z) * k;
      f.rot = Math.atan2(f.tz - f.z, f.tx - f.x);
    }
    // 뭍으로 올라왔으면 (플레이어가 놓았을 때 등) 생선으로
    if (T.height(f.x, f.z) > 0.05 && !T.inPond(f.x, f.z)) {
      w.items.push(makeItem(w, "fish", FISH_INFO[f.kind]?.qty ?? 1, f.x, f.z, f.gift || w.time));
      w.fish.splice(i, 1);
      bump(w);
    }
  }
}

// ─── 구조물 / 땅 위의 물건 ─────────────────────────────────────────────

export function updateStructures(w: WorldState, dt: number) {
  const h = dt / HOUR;
  const W = w.weather.type;
  for (let i = w.structures.length - 1; i >= 0; i--) {
    const s = w.structures[i];
    if (s.type === "campfire" && s.lit) {
      const rainLoss = W === "storm" ? 55 : W === "rain" ? 16 : W === "snow" ? 10 : 0;
      s.fuel -= h * (10 + rainLoss);
      if (s.fuel <= 0) {
        s.fuel = 0;
        s.lit = 0;
        addFx(w, "fizzle", s.x, s.z, s.id);
        bump(w);
      }
    }
    if (s.type === "campfire" && s.byPlayer && !s.lit && w.time - s.t > 2 * DAY) {
      // 플레이어가 만든 작은 불자리는 오래 방치되면 사라진다
      if (dist(s.x, s.z, w.camp.x, w.camp.z) > 6) {
        w.structures.splice(i, 1);
        bump(w);
      }
    }
    if (s.type === "raft" && w.time - s.t > 8 * DAY) {
      w.structures.splice(i, 1);
      bump(w);
    }
  }
}

export function updateItems(w: WorldState, T: Terrain, dt: number) {
  void dt;
  for (let i = w.items.length - 1; i >= 0; i--) {
    const it = w.items[i];
    if (it.held) continue;
    const age = w.time - it.t;
    const wet = T.height(it.x, it.z) < -0.25 || T.inPond(it.x, it.z, -0.3);
    const food = it.res === "berry" || it.res === "fruit" || it.res === "meat" || it.res === "fish";
    if ((wet && age > 0.5 * HOUR) || (food && age > 2 * DAY) || age > 6 * DAY) {
      w.items.splice(i, 1);
      bump(w);
    }
  }
  if (w.items.length > 70) {
    w.items.sort((a, b) => a.t - b.t);
    w.items.splice(0, w.items.length - 70);
    bump(w);
  }
}
