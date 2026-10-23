// 불: 번개나 관찰자의 불씨에서 시작해 나무 건물과 숲으로 번진다.
// 사람들은 우물·연못·바다에서 물을 퍼 날라 끄고, 청동기 시대부터는 불에 강한 재질로 집을 짓는다.
import { act } from "./acts";
import { harm } from "./building";
import { HOUR, MIN } from "./constants";
import { STRUCTS, WOODEN } from "./data";
import { isTree } from "./ecology";
import { shiftMorale } from "./morale";
import { clamp } from "./noise";
import { feel, lying, say } from "./people";
import { chance, pRate, range } from "./rng";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Act, Blaze, Person, Structure, WorldState } from "./types";
import { addFx, bump, chron, dist, findById, knows, living, newId, onIsland, stockOf } from "./world";

/** 한꺼번에 타오를 수 있는 불길 수 (온 섬이 다 타 버리지 않게) */
const MAX_BLAZES = 14;
/** 한 번 끼얹는 물이 줄이는 불의 세기 */
const SPLASH = 0.08;

export const burnable = (s: Structure) => WOODEN.has(s.type);
export const burningOf = (w: WorldState, s: Structure) => w.blazes.find((b) => b.sid === s.id);
const nameOf = (s: Structure) => STRUCTS[s.type].name;

function remember(w: WorldState) {
  w.history.fire = (w.history.fire ?? 0) + 1;
  w.history.lastFire = w.time;
}

/** 불이 났다: 곁의 사람들이 놀라 깨고, 물을 길어 올 채비를 한다 */
function alarm(w: WorldState, b: Blaze) {
  for (const p of living(w)) {
    const d = dist(p.x, p.z, b.x, b.z);
    if (d > 45) continue;
    if (p.act?.k === "sleep" && d < 25) p.act = null;
    if (lying(p)) continue;
    feel(w, p, "fear", d < 12 ? 0.35 : 0.15, false);
    feel(w, p, "surprise", 0.3, false);
    if (d < 30 && chance(w, 0.5)) say(w, p, "fireAlarm", {}, "🔥", true);
    p.seen.reeval = 0;
  }
}

/** 건물에 불이 붙는다 (불에 강한 재질이면 잘 붙지 않는다) */
export function igniteStructure(w: WorldState, s: Structure, why: Blaze["why"]) {
  if (!burnable(s) || burningOf(w, s) || w.blazes.length >= MAX_BLAZES) return null;
  const b: Blaze = { id: newId(w), x: s.x, z: s.z, r: STRUCTS[s.type].radius + 0.6, max: STRUCTS[s.type].radius + 0.6, heat: 0.3, sid: s.id, fuel: 0, t: w.time, why, by: [] };
  w.blazes.push(b);
  remember(w);
  addFx(w, "ignite", s.x, s.z, s.id);
  const name = nameOf(s);
  // 한 번에 여러 채로 번질 때는 처음 한 번만 적는다
  const quiet = why === "spread" && w.time - (w.timers.fireLog ?? -1e12) < HOUR;
  w.timers.fireLog = w.time;
  if (why === "lightning") chron(w, "fire", `번개가 ${name}에 내리꽂혀 불이 붙었다!`);
  else if (why === "hand") chron(w, "fire", `누군가 지핀 불씨가 ${josa(name, "으로/로")} 옮겨붙었다!`);
  else if (!quiet) chron(w, "fire", `불길이 ${josa(name, "으로/로")} 번졌다!`);
  shiftMorale(w, -2);
  alarm(w, b);
  bump(w);
  return b;
}

/** 땅에 불길이 인다 (번개). 그 자리에 있던 짐승은 빠져나오지 못한다 */
export function startWildfire(w: WorldState, T: Terrain, x: number, z: number) {
  if (w.blazes.length >= MAX_BLAZES) return null;
  const b: Blaze = { id: newId(w), x, z, r: 3, max: range(w, 6, 9), heat: 0.7, fuel: range(w, 1.5, 3) * HOUR, t: w.time, why: "lightning", by: [] };
  w.blazes.push(b);
  remember(w);
  const dead: Record<string, number> = {};
  for (let i = w.animals.length - 1; i >= 0; i--) {
    const a = w.animals[i];
    if (a.held || dist(a.x, a.z, x, z) > b.r + 1.5) continue;
    dead[a.kind] = (dead[a.kind] ?? 0) + 1;
    w.animals.splice(i, 1);
  }
  scorch(w, T, b, 1);
  for (const p of living(w)) {
    const d = dist(p.x, p.z, x, z);
    if (d < b.r) {
      p.health = Math.max(1, p.health - range(w, 8, 16));
      say(w, p, "fireHot", {}, "🔥", true);
    }
  }
  const NAME: Record<string, string> = { rabbit: "토끼", boar: "멧돼지", goat: "염소", crab: "게", fowl: "들새" };
  const lost = Object.entries(dead).map(([k, n]) => `${NAME[k] ?? k} ${n}마리`).join(", ");
  chron(w, "fire", `번개가 땅에 내리꽂혀 불길이 일었다.${lost ? ` 그 자리에 있던 ${lost}가 불길을 피하지 못했다.` : ""}`);
  addFx(w, "ignite", x, z);
  alarm(w, b);
  bump(w);
  return b;
}

/** 불길 안의 풀과 나무가 탄다 */
function scorch(w: WorldState, T: Terrain, b: Blaze, p: number) {
  for (const pl of w.plants) {
    if (pl.stump || pl.burn || dist(pl.x, pl.z, b.x, b.z) > b.r) continue;
    if (!chance(w, p)) continue;
    if (isTree(pl.kind)) pl.burn = w.time + range(w, 0.6, 1.4) * HOUR;
    else {
      pl.stump = 1;
      pl.fruit = 0;
      pl.regrow = w.time + range(w, 1, 2.5) * 86400;
    }
  }
  void T;
}

/** 관찰자가 불을 지폈다: 바로 곁의 나무 건물에 옮겨붙을 수 있다 */
export function sparkNear(w: WorldState, x: number, z: number) {
  for (const s of w.structures) {
    if (!burnable(s) || burningOf(w, s)) continue;
    if (dist(s.x, s.z, x, z) > STRUCTS[s.type].radius + 2.2) continue;
    if (chance(w, s.fp ? 0.08 : 0.55)) igniteStructure(w, s, "hand");
  }
}

function weatherDamp(w: WorldState) {
  const t = w.weather.type;
  return (t === "storm" ? 0.5 : t === "rain" ? 0.32 : t === "snow" ? 0.25 : 0) + w.weather.wet * 0.08;
}

export function updateFires(w: WorldState, T: Terrain, dt: number) {
  const h = dt / HOUR;
  // 관찰자가 지핀 불이 곁의 나무 건물로 번진다
  for (const f of w.structures) {
    if (f.type !== "campfire" || !f.byPlayer || !f.lit) continue;
    for (const s of w.structures) {
      if (!burnable(s) || dist(s.x, s.z, f.x, f.z) > STRUCTS[s.type].radius + 2.2 || burningOf(w, s)) continue;
      if (chance(w, pRate((s.fp ? 0.03 : 0.3) / HOUR, dt))) igniteStructure(w, s, "hand");
    }
  }
  if (!w.blazes.length) return;
  const damp = weatherDamp(w);
  for (const b of [...w.blazes]) {
    const s = b.sid != null ? findById(w.structures, b.sid) : undefined;
    if (b.sid != null && !s) {
      // 다 타서 무너졌다: 잠깐 잔불이 남는다
      b.sid = undefined;
      b.fuel = 0.4 * HOUR;
    }
    const grow = s ? (s.fp ? 0.1 : 0.4) : b.fuel > 0 ? 0.35 : -0.9;
    b.heat = clamp(b.heat + (grow - damp) * h, 0, 1);
    if (!s) {
      b.fuel -= dt;
      b.r = Math.min(b.max, b.r + h * 2.5 * b.heat);
    }
    if (b.heat <= 0.02) {
      putOut(w, b, s);
      continue;
    }
    if (s) burnStructure(w, T, s, (s.fp ? 0.1 : 0.42) * b.heat * h);
    // 번진다
    const pSpread = pRate((b.heat * (s ? 0.55 : 0.8)) / HOUR, dt);
    for (const o of w.structures) {
      if (o === s || !burnable(o) || burningOf(w, o)) continue;
      if (dist(o.x, o.z, b.x, b.z) > b.r + STRUCTS[o.type].radius + 1.5) continue;
      if (chance(w, pSpread * (o.fp ? 0.12 : 1))) igniteStructure(w, o, "spread");
    }
    if (!s) {
      scorch(w, T, b, pSpread);
      for (let i = w.animals.length - 1; i >= 0; i--) {
        const a = w.animals[i];
        if (!a.held && dist(a.x, a.z, b.x, b.z) < b.r * 0.8 && chance(w, pRate(1.5 / HOUR, dt))) w.animals.splice(i, 1);
      }
    } else if (w.blazes.length < MAX_BLAZES) {
      // 타오르는 건물 곁의 나무에도 옮겨붙는다
      for (const pl of w.plants) {
        if (!isTree(pl.kind) || pl.stump || pl.burn || dist(pl.x, pl.z, b.x, b.z) > b.r + 2.5) continue;
        if (chance(w, pSpread * 0.5)) pl.burn = w.time + range(w, 0.6, 1.4) * HOUR;
      }
    }
    // 불길 안에 있으면 덴다
    for (const p of living(w)) {
      if (!onIsland(p) || dist(p.x, p.z, b.x, b.z) > b.r - 0.3) continue;
      p.health = Math.max(1, p.health - 14 * b.heat * h);
      feel(w, p, "fear", 0.3 * h, false);
      if (p.act?.k !== "douse" && p.act?.k !== "flee" && p.act?.k !== "carried") p.seen.reeval = 0;
    }
  }
}

function burnStructure(w: WorldState, T: Terrain, s: Structure, amount: number) {
  if (s.prog < 1) {
    // 짓던 것은 뼈대가 타 버린다
    s.prog -= amount * 0.8;
    if (s.prog <= 0) {
      w.structures = w.structures.filter((x) => x !== s);
      chron(w, "fire", `짓고 있던 ${josa(nameOf(s), "이/가")} 불에 타 버렸다.`);
      bump(w);
    }
    return;
  }
  const before = s.dmg ?? 0;
  s.dmg = Math.min(1, before + amount);
  if (s.dmg >= 1) harm(w, T, s, 0, "fire");
  else if (Math.floor(before * 5) !== Math.floor(s.dmg * 5)) addFx(w, "crack", s.x, s.z, s.id, s.dmg);
}

function putOut(w: WorldState, b: Blaze, s: Structure | undefined) {
  w.blazes = w.blazes.filter((x) => x !== b);
  addFx(w, "fizzle", b.x, b.z, b.sid);
  bump(w);
  const crew = b.by.map((id) => findById(w.people, id)).filter((p): p is Person => !!p && p.alive === 1);
  // 함께 번진 불이 아직 타고 있으면 다 꺼진 뒤에 한 번만 적는다
  const more = w.blazes.some((x) => dist(x.x, x.z, b.x, b.z) < 30);
  if (more) {
    for (const p of crew) feel(w, p, "joy", 0.15, false);
  } else if (crew.length) {
    const lead = crew[0];
    const who = crew.length > 1 ? `${lead.name} 등 ${crew.length}명이` : josa(lead.name, "이/가");
    chron(w, "fire", `${who} 물을 퍼 날라 ${s ? `${nameOf(s)}의 ` : ""}불길을 잡았다.`);
    shiftMorale(w, Math.min(5, 1 + crew.length));
    for (const p of crew) {
      feel(w, p, "joy", 0.3, false);
      if (chance(w, 0.6)) say(w, p, "fireOut", {}, "💦", true);
    }
  } else if (s || b.r > 5) {
    chron(w, "fire", w.weather.type === "rain" || w.weather.type === "storm" ? "쏟아지는 비가 불길을 잠재웠다." : "불길이 사그라들었다.");
  }
}

// ─── 불 끄기 ───────────────────────────────────────────────────────────

/** 이 사람이 끄러 갈 만한 불 (마을을 위협하거나 가까운 불) */
export function fireToFight(w: WorldState, p: Person) {
  let best: Blaze | null = null;
  let bs = Infinity;
  for (const b of w.blazes) {
    const d = dist(p.x, p.z, b.x, b.z);
    const village = b.sid != null || w.structures.some((s) => s.type !== "campfire" && dist(s.x, s.z, b.x, b.z) < b.r + 18);
    if (d > (village ? 90 : 45)) continue;
    const score = d - (b.sid != null ? 20 : 0);
    if (score < bs) {
      bs = score;
      best = b;
    }
  }
  return best;
}

/** 불길이 마을을 위협하는지 (점수에 쓴다) */
export const threatens = (w: WorldState, b: Blaze) =>
  b.sid != null || w.structures.some((s) => burnable(s) && dist(s.x, s.z, b.x, b.z) < b.r + 12);

export const dousersOf = (w: WorldState, b: Blaze) => w.people.filter((q) => q.act?.k === "douse" && q.act.tid === b.id).length;

/** 불에서 가장 가까운 물: 우물 · 연못 · 바닷가 */
export function waterFor(w: WorldState, T: Terrain, x: number, z: number) {
  const cands: { x: number; z: number }[] = [];
  for (const s of w.structures) if (s.type === "well" && s.prog >= 1) cands.push({ x: s.x + 1.2, z: s.z });
  const a = Math.atan2(z - T.pond.z, x - T.pond.x);
  cands.push({ x: T.pond.x + Math.cos(a) * (T.pond.r + 0.6), z: T.pond.z + Math.sin(a) * (T.pond.r + 0.6) });
  // 섬 가운데에서 불 쪽으로 곧게 나가다 처음 만나는 바닷가
  const L = Math.hypot(x, z) || 1;
  const ux = x / L, uz = z / L;
  for (let r = L; r < L + 120; r += 1.5) {
    if (T.height(ux * r, uz * r) < 0.25) {
      const back = Math.max(0, r - 1.5);
      cands.push({ x: ux * back, z: uz * back });
      break;
    }
  }
  let best = cands[0];
  let bd = Infinity;
  for (const c of cands) {
    const d = dist(c.x, c.z, x, z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** 불길 가장자리: 사람이 서서 물을 끼얹는 자리 */
export function fireEdge(b: Blaze, p: Person) {
  const a = Math.atan2(p.z - b.z, p.x - b.x);
  return { x: b.x + Math.cos(a) * (b.r + 0.9), z: b.z + Math.sin(a) * (b.r + 0.9) };
}

/** 물을 끼얹는다 (항아리가 있으면 더 많이 담아 온다) */
export function splash(w: WorldState, p: Person, b: Blaze) {
  const amount = SPLASH * (stockOf(w, "pot") >= 1 ? 1.4 : 1) * (knows(w, "wheel") ? 1.1 : 1);
  b.heat = Math.max(0, b.heat - amount);
  if (!b.by.includes(p.id)) b.by.push(p.id);
  addFx(w, "douse", b.x + (p.x - b.x) * 0.4, b.z + (p.z - b.z) * 0.4, b.id);
}

/** 불이 꺼질 때까지 (오래 걸리면 지쳐서 그만둔다) */
export const DOUSE_LIMIT = 3 * HOUR;
export const SCOOP_TIME = 1.2 * MIN;
export const THROW_TIME = 0.8 * MIN;

/** 물을 길으러 간다 */
export function dousePlan(w: WorldState, T: Terrain, b: Blaze): Act {
  const water = waterFor(w, T, b.x, b.z);
  return act(w, "douse", water.x, water.z, DOUSE_LIMIT, { tid: b.id, run: 1 });
}

/** 물가(물을 퍼 담는다) 또는 불길 가장자리(끼얹는다)에 다다랐다. false면 그만둔다 */
export function douseArrive(w: WorldState, p: Person, a: Act) {
  const b = w.blazes.find((x) => x.id === a.tid);
  if (!b) return false;
  if (a.ph === 0) {
    a.ph = 1;
    a.sub = "scoop";
    a.t = SCOOP_TIME;
  } else {
    a.ph = 1;
    a.sub = "throw";
    a.t = THROW_TIME;
    p.rot = Math.atan2(b.z - p.z, b.x - p.x);
  }
  return true;
}

/** 한 번 퍼 담거나 끼얹었다. true면 불이 꺼질 때까지 되풀이한다 */
export function douseFinish(w: WorldState, T: Terrain, p: Person, a: Act) {
  const b = w.blazes.find((x) => x.id === a.tid);
  if (!b) return false;
  if (a.sub === "scoop") {
    const e = fireEdge(b, p);
    Object.assign(a, { ph: 2, n: 1, sub: undefined, tx: e.x, tz: e.z, t: DOUSE_LIMIT });
    return true;
  }
  splash(w, p, b);
  if (w.time - a.started > DOUSE_LIMIT || p.needs.energy < 12 || p.needs.thirst < 10 || p.health < 30) return false;
  const water = waterFor(w, T, b.x, b.z);
  Object.assign(a, { ph: 0, n: 0, sub: undefined, tx: water.x, tz: water.z, t: DOUSE_LIMIT });
  return true;
}

/** 불길 한가운데 있으면 바깥으로 달아난다 */
export function fleePlan(w: WorldState, T: Terrain, p: Person): Act | null {
  const b = w.blazes.find((x) => dist(p.x, p.z, x.x, x.z) < x.r + 2);
  if (!b) return null;
  const a0 = Math.atan2(p.z - b.z, p.x - b.x);
  for (let i = 0; i < 6; i++) {
    const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.6;
    const x = b.x + Math.cos(a) * (b.r + 7), z = b.z + Math.sin(a) * (b.r + 7);
    if (T.isLand(x, z)) return act(w, "flee", x, z, 3 * MIN, { run: 1 });
  }
  return null;
}
