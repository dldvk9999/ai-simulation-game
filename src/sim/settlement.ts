import { DAY, ERA_PACE, HOUR, TIME_SCALE } from "./constants";
import { ageYears } from "./clock";
import { newProject } from "./building";
import { ERAS, FOOD, HOUSE_TYPES, STRUCTS, TECH_BY_ID, TECHS, type TechDef } from "./data";
import { moraleMul, shiftMorale } from "./morale";
import { range, rand } from "./rng";
import type { Terrain } from "./terrain";
import { josa, thought } from "./text";
import type { Person, Res, Stock, Structure, StructureType, WorldState } from "./types";
import { addFx, bump, chron, dist, findById, knows, living, makeStructure, stockOf } from "./world";

// ─── 연구 ──────────────────────────────────────────────────────────────

/** 직접 겪거나 찾아낸 것이 있어야 고민을 시작하는 지식 */
export function needsMet(w: WorldState, t: TechDef) {
  const n = t.needs;
  if (!n) return true;
  if (n.found && !n.found.every((x) => w.found?.includes(x))) return false;
  if (n.event && !n.event.some((e) => (w.history?.[e] ?? 0) > 0)) return false;
  return true;
}

export const available = (w: WorldState) =>
  TECHS.filter((t) => !knows(w, t.id) && t.prereq.every((p) => knows(w, p)) && needsMet(w, t));

/** 선행 지식은 갖췄는데 약재를 못 찾아 막혀 있는 지식 */
export const blockedByFound = (w: WorldState) =>
  TECHS.filter((t) => !knows(w, t.id) && t.prereq.every((p) => knows(w, p)) && t.needs?.found && !needsMet(w, t));

export function currentEra(w: WorldState) {
  let e = 0;
  for (const id of w.tech.known) e = Math.max(e, TECH_BY_ID[id]?.era ?? 0);
  return e;
}

export function researchMul(w: WorldState) {
  let m = 1;
  if (knows(w, "writing")) m *= 1.2;
  if (knows(w, "mathematics")) m *= 1.1;
  if (knows(w, "science")) m *= 1.25;
  if (w.structures.some((s) => s.type === "library" && s.prog >= 1)) m *= 1.12;
  if (w.structures.some((s) => s.type === "observatory" && s.prog >= 1)) m *= 1.08;
  // 조직을 이루면 체계적으로, 문명을 세우면 더욱 빠르게 배운다
  if (w.groups?.some((g) => g.kind === "civ")) m *= w.structures.some((s) => s.type === "hall" && s.prog >= 1) ? 1.32 : 1.25;
  else if (w.groups?.length) m *= 1.1;
  return m * moraleMul(w) * ERA_PACE[currentEra(w)];
}

export function chooseFocus(w: WorldState) {
  const av = available(w);
  if (!av.length) {
    w.tech.focus = null;
    return;
  }
  const pop = living(w).length;
  const food = foodTotal(w);
  const cold = w.weather.temp < 12;
  const houses = houseCapacity(w);
  const sick = living(w).some((p) => (p.ill ?? 0) >= 1);
  // 겪은 재해에 맞서는 방법은 모두가 머리를 맞대고 먼저 궁리한다
  const recent = !!w.history && w.time - w.history.lastDisaster < 20 * DAY;
  const counter = recent ? ["bracing", "forecast", "seawall", "quakeproof"] : [];
  // 불을 겪은 뒤에는 불에 강한 집을 궁리한다
  if (w.history?.lastFire && w.time - w.history.lastFire < 30 * DAY) counter.push("fireproof");
  // 맹수에게 시달린 뒤에는 무기와 망루부터
  const hunted = !!w.history?.lastBeast && w.time - w.history.lastBeast < 30 * DAY;
  const arms = ["bronzeweapon", "ironweapon", "firearm", "rifle", "watchtower", "fortress"];
  const prio = (id: string) => {
    let p = 1;
    if (id === "fire") p = cold ? 3 : 2.2;
    if (id === "leanto" && houses < pop) p = 2.4;
    if (id === "spear" && food < pop * 5) p = 1.8;
    if (id === "cooking") p = 1.6;
    if (id === "hut" && houses < pop) p = 1.6;
    if (id === "agriculture") p = 1.4;
    if (id === "clothing" && cold) p = 1.8;
    if (id === "writing") p = 1.3;
    if (id === "herbs" || id === "remedy") p = sick ? 3 : 1.4;
    if (id === "medicine") p = sick ? 2.2 : 1.3;
    if (counter.includes(id)) p = 2.6;
    if (id === "net" || id === "navigation") p = 1.3;
    if (id === "shipbuilding") p = 1.4;
    if (arms.includes(id)) p = hunted ? 2.5 : 1.3;
    if (id === "mining") p = 1.6;
    if ((id === "architecture" || id === "highrise") && houses < pop + 2) p = 1.4;
    return p;
  };
  av.sort((a, b) => (a.cost / prio(a.id)) - (b.cost / prio(b.id)));
  w.tech.focus = av[0].id;
}

/** 목숨이 걸린 지식(약초·약)은 시대가 느리게 흘러도 덜 더디게 깨친다 */
const LIFESAVING = new Set(["herbs", "remedy"]);

/** 연구 점수를 더한다. tech를 지정하면 그 기술에, 아니면 현재 목표에. */
export function addResearch(w: WorldState, p: Person | null, pts: number, tech?: string) {
  const id = tech ?? w.tech.focus;
  if (!id || knows(w, id)) return;
  const def = TECH_BY_ID[id];
  if (!def || !def.prereq.every((q) => knows(w, q)) || !needsMet(w, def)) return;
  const v = (w.tech.prog[id] ?? 0) + pts * researchMul(w) * (LIFESAVING.has(id) ? 2.5 : 1);
  w.tech.prog[id] = v;
  if (v >= def.cost) discover(w, p, id);
}

export function discover(w: WorldState, p: Person | null, id: string, how?: string) {
  if (knows(w, id)) return;
  const def = TECH_BY_ID[id];
  const eraBefore = currentEra(w);
  w.tech.known.push(id);
  delete w.tech.prog[id];
  if (w.tech.focus === id) chooseFocus(w);
  const who = p ? josa(p.name, "이/가") : "누군가가";
  chron(w, "discover", how ?? `${who} '${def.name}'${josa(def.name, "을/를").slice(def.name.length)} 터득했다.`);
  if (p) {
    p.emo.joy = Math.min(1, p.emo.joy + 0.6 * p.sens.joy);
    p.emo.surprise = Math.min(1, p.emo.surprise + 0.5 * p.sens.surprise);
    p.needs.fun = Math.min(100, p.needs.fun + 30);
    p.gesture = "cheer";
    p.gestureUntil = w.time + 4 * TIME_SCALE;
    p.bubble = { text: thought(w, "eureka", { tech: def.name }), emoji: "💡", until: w.time + 6 * TIME_SCALE };
    p.lastThought = w.time;
    addFx(w, "eureka", p.x, p.z, p.id);
  }
  const era = currentEra(w);
  if (era > eraBefore) {
    chron(w, "era", `섬의 문명이 '${ERAS[era]}'에 들어섰다.`);
    shiftMorale(w, 5);
  }
  if (id === "electricity") for (const q of w.people) if (q.alive) q.outfit = "modern";
  bump(w);
}

// ─── 창고 ──────────────────────────────────────────────────────────────

export function foodTotal(w: WorldState) {
  let s = 0;
  for (const r of Object.keys(FOOD) as Res[]) s += stockOf(w, r);
  return s;
}

export function storagePoint(w: WorldState) {
  const st = w.structures.find((s) => s.type === "storage" && s.prog >= 1);
  return st ? { x: st.x + 1.6, z: st.z } : { x: w.camp.x + 1.2, z: w.camp.z + 1.2 };
}

export function carryCap(w: WorldState) {
  return 3 + (stockOf(w, "basket") >= 1 ? 3 : 0) + (knows(w, "wheel") ? 4 : 0);
}

export function toolMul(w: WorldState) {
  let m = 1;
  if (knows(w, "polished")) m *= 1.15;
  if (knows(w, "metallurgy")) m *= 1.25;
  if (knows(w, "iron")) m *= 1.3;
  return m;
}

export function buildMul(w: WorldState) {
  let m = toolMul(w);
  if (knows(w, "wheel")) m *= 1.2;
  if (knows(w, "mathematics")) m *= 1.15;
  if (knows(w, "steam")) m *= 1.3;
  if (w.groups?.some((g) => g.kind === "civ")) m *= 1.15;
  else if (w.groups?.length) m *= 1.08;
  return m * moraleMul(w);
}

// ─── 집 ────────────────────────────────────────────────────────────────

export const isHouse = (t: StructureType) => HOUSE_TYPES.includes(t);
/** 쓸 수 있는 집 (크게 부서진 집은 고치기 전까지 못 쓴다) */
export const houses = (w: WorldState) => w.structures.filter((s) => isHouse(s.type) && s.prog >= 1 && (s.dmg ?? 0) < 0.6);

export function houseCapacity(w: WorldState) {
  let c = 0;
  for (const s of houses(w)) c += STRUCTS[s.type].cap ?? 0;
  return c;
}

export function residents(w: WorldState, houseId: number) {
  return w.people.filter((p) => p.alive && p.home === houseId);
}

/** 갈라져 나간 무리는 자기 터의 집에서 지내고, 다른 사람은 그 집을 쓰지 않는다 */
function homeOk(w: WorldState, p: { group?: number | null }, h: Structure) {
  const g = p.group != null ? w.groups?.find((x) => x.id === p.group) : undefined;
  if (g?.camp) return h.group === g.id;
  return h.group == null || !w.groups?.some((x) => x.id === h.group && x.camp);
}

/** 집 없는 사람을 빈 집에 배정. 가족은 함께. */
export function assignHomes(w: WorldState) {
  const all = houses(w).sort((a, b) => (STRUCTS[b.type].tier ?? 0) - (STRUCTS[a.type].tier ?? 0));
  for (const p of w.people) {
    if (!p.alive) continue;
    if (p.home != null && !all.some((h) => h.id === p.home && homeOk(w, p, h))) p.home = null;
  }
  for (const p of w.people) {
    if (!p.alive || p.home != null) continue;
    const hs = all.filter((h) => homeOk(w, p, h));
    const partner = findById(w.people, p.partner);
    const parent = p.parents.map((id) => findById(w.people, id)).find((q) => q?.alive && q.home != null);
    const prefer = partner?.home ?? (ageYears(p.birth, w.time) < 16 ? parent?.home : null);
    if (prefer != null) {
      const h = findById(hs, prefer);
      if (h && residents(w, h.id).length < (STRUCTS[h.type].cap ?? 0) + 1) {
        p.home = h.id;
        continue;
      }
    }
    for (const h of hs) {
      if (residents(w, h.id).length < (STRUCTS[h.type].cap ?? 0)) {
        p.home = h.id;
        break;
      }
    }
  }
}

// ─── 건설 계획 ─────────────────────────────────────────────────────────

export const projects = (w: WorldState) =>
  w.structures.filter((s) => s.prog < 1 && s.type !== "raft");

export function projectNeed(w: WorldState): Stock {
  const out: Stock = {};
  for (const s of projects(w)) {
    if (s.paid) continue;
    for (const [r, n] of Object.entries(STRUCTS[s.type].cost) as [Res, number][]) out[r] = (out[r] ?? 0) + n;
  }
  // 부서진 것을 고칠 재료
  for (const s of w.structures) {
    if (!s.dmg || s.fix || s.prog < 1) continue;
    for (const [r, n] of Object.entries(STRUCTS[s.type].cost) as [Res, number][]) out[r] = (out[r] ?? 0) + Math.max(1, Math.ceil(n * s.dmg * 0.5));
  }
  return out;
}

function has(w: WorldState, type: StructureType, includePlanned = true) {
  return w.structures.some((s) => s.type === type && (includePlanned || s.prog >= 1));
}

export function bestHouse(w: WorldState): StructureType | null {
  for (let i = HOUSE_TYPES.length - 1; i >= 0; i--) {
    const t = HOUSE_TYPES[i];
    if (knows(w, STRUCTS[t].tech!)) return t;
  }
  return null;
}

/** 다음 건설 과제를 정한다 (한 번에 하나, 밭과 무덤은 예외). 용도에 맞는 건물을 그때그때 고른다 */
export function planProject(w: WorldState, T: Terrain) {
  const active = projects(w).filter((s) => s.type !== "grave" && s.type !== "farm");
  if (active.length >= 1) return;
  const pop = living(w).filter((p) => ageYears(p.birth, w.time) >= 3).length;
  if (!pop) return;
  const cap = houseCapacity(w);
  const best = bestHouse(w);
  const want: StructureType[] = [];
  const count = (t: StructureType) => w.structures.filter((s) => s.type === t).length;
  const hunted = (w.history?.beast ?? 0) > 0;

  if (best && cap < pop) want.push(best);
  // 많이 아픈 사람이 있으면 떨어져 쉴 요양소부터
  const sickest = living(w).reduce((m, p) => Math.max(m, p.ill ?? 0), 0);
  if (knows(w, "leanto") && !has(w, "infirmary") && (sickest >= 4 || (knows(w, "remedy") && pop >= 8))) want.unshift("infirmary");
  // 맹수에게 시달렸다면 마을을 지킬 건물을
  if (hunted && knows(w, "watchtower") && count("watchtower") < (pop >= 12 ? 2 : 1)) want.unshift("watchtower");
  if (hunted && knows(w, "fortress") && !has(w, "fort")) want.unshift("fort");
  if (hunted && knows(w, "firearm") && !has(w, "battery")) want.push("battery");
  if (planGroupHouse(w, T)) return;
  if (knows(w, "basket") && !has(w, "storage")) want.push("storage");
  if (knows(w, "polished") && !has(w, "workshop")) want.push("workshop");
  if (knows(w, "drying") && !has(w, "rack")) want.push("rack");
  if (knows(w, "pottery") && !has(w, "kiln")) want.push("kiln");
  if (knows(w, "husbandry") && !has(w, "pen")) want.push("pen");
  if (knows(w, "well") && !has(w, "well")) want.push("well");
  if (knows(w, "mining") && w.found.includes("vein") && !has(w, "mine")) want.push("mine");
  // 집 업그레이드: 오래된 집을 허물고 더 높고 튼튼한 집을 짓는다
  if (best && !want.length) {
    const tierBest = STRUCTS[best].tier ?? 0;
    const old = houses(w)
      .filter((h) => (STRUCTS[h.type].tier ?? 0) < tierBest && !w.structures.some((s) => s.replaces === h.id))
      .sort((x, y) => (STRUCTS[x.type].tier ?? 0) - (STRUCTS[y.type].tier ?? 0))[0];
    if (old) {
      const site = findSite(w, T, best, { x: old.x, z: old.z });
      if (site) {
        newProject(w, best, site).replaces = old.id;
        return;
      }
    }
  }
  if (knows(w, "metallurgy") && !has(w, "smelter")) want.push("smelter");
  if (knows(w, "metallurgy") && !has(w, "forge")) want.push("forge");
  if (knows(w, "writing") && !has(w, "library")) want.push("library");
  if (knows(w, "boat") && !has(w, "dock")) want.push("dock");
  if (knows(w, "windmill") && !has(w, "windmill")) want.push("windmill");
  if (knows(w, "astronomy") && !has(w, "observatory")) want.push("observatory");
  if (knows(w, "steam") && !has(w, "factory")) want.push("factory");
  if (knows(w, "electricity") && !has(w, "lighthouse")) want.push("lighthouse");
  if (knows(w, "seawall") && count("seawall") < 3) want.unshift("seawall");
  if (knows(w, "shipbuilding") && !has(w, "shipyard")) want.push("shipyard");
  if (knows(w, "portal") && !has(w, "portal")) want.push("portal");
  if (knows(w, "hut") && w.groups?.some((g) => g.kind === "civ") && !has(w, "hall")) want.push("hall");
  if (best && cap < pop + 2 && pop >= 3) want.push(best);
  if (knows(w, "stoneaxe") && count("bench") < Math.min(3, 1 + Math.floor(pop / 4))) want.push("bench");

  for (const t of want) {
    const site = t === "mine" ? findSite(w, T, t, T.mine, { min: T.mine.r * 0.8, max: T.mine.r * 1.35 }) : findSite(w, T, t);
    if (site) {
      newProject(w, t, site);
      return;
    }
  }
}

/** 갈라져 나간 무리는 자기 터에 집을 짓는다 */
function planGroupHouse(w: WorldState, T: Terrain) {
  const best = bestHouse(w);
  if (!best) return false;
  for (const g of w.groups ?? []) {
    if (!g.camp) continue;
    const ms = w.people.filter((p) => p.alive && !p.away && p.group === g.id && ageYears(p.birth, w.time) >= 3).length;
    const cap = houses(w).filter((h) => h.group === g.id).reduce((c, h) => c + (STRUCTS[h.type].cap ?? 0), 0);
    if (cap >= ms) continue;
    const site = findSite(w, T, best, g.camp);
    if (!site) continue;
    newProject(w, best, site).group = g.id;
    return true;
  }
  return false;
}

/** 밭은 따로: 인구에 맞춰 늘린다 */
export function planFarms(w: WorldState, T: Terrain) {
  if (!knows(w, "agriculture")) return;
  const farms = w.structures.filter((s) => s.type === "farm");
  if (farms.some((f) => f.prog < 1)) return;
  const pop = living(w).length;
  if (farms.length >= Math.min(8, Math.ceil(pop / 2) + 1)) return;
  const site = findSite(w, T, "farm");
  if (site) {
    w.structures.push(makeStructure(w, "farm", site.x, site.z, site.rot));
    bump(w);
  }
}

export function planGrave(w: WorldState, T: Terrain, p: Person) {
  const site = findSite(w, T, "grave");
  const s = makeStructure(w, "grave", site?.x ?? p.x, site?.z ?? p.z, site?.rot ?? 0);
  s.name = p.name;
  w.structures.push(s);
  bump(w);
  return s;
}

const RING: Partial<Record<StructureType, [number, number]>> = {
  campfire: [0, 1],
  leanto: [4, 11],
  hut: [5, 13],
  loghouse: [6, 15],
  stonehouse: [7, 17],
  storage: [3, 6],
  rack: [3, 7],
  kiln: [6, 11],
  farm: [10, 22],
  pen: [12, 20],
  well: [2.5, 5],
  workshop: [5, 11],
  smelter: [8, 14],
  library: [6, 14],
  windmill: [14, 24],
  observatory: [12, 28],
  grave: [15, 19],
  bench: [5, 16],
  infirmary: [16, 24],
  hall: [4, 9],
  portal: [10, 20],
  watchtower: [9, 17],
  fort: [11, 19],
  battery: [13, 22],
  townhouse: [6, 17],
  apartment: [7, 19],
  forge: [6, 12],
  factory: [14, 26],
};

export function findSite(
  w: WorldState, T: Terrain, type: StructureType, near?: { x: number; z: number }, ring?: { min: number; max: number },
): { x: number; z: number; rot: number } | null {
  const def = STRUCTS[type];
  if (type === "dock" || type === "lighthouse" || type === "seawall" || type === "shipyard") return coastSite(w, T, type);
  const [r0, r1] = ring ? [ring.min, ring.max] : near ? [def.radius + 3, def.radius + 9] : RING[type] ?? [5, 15];
  const cx = near?.x ?? w.camp.x, cz = near?.z ?? w.camp.z;
  const grid = layoutGrid(w, type);
  for (let k = 0; k < 160; k++) {
    const grow = 1 + Math.floor(k / 40) * 0.4;
    const a = rand(w) * Math.PI * 2;
    const d = range(w, r0, r1 * grow);
    let x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (grid) [x, z] = grid.snap(x, z);
    if (!T.isLand(x, z)) continue;
    if (T.height(x, z) < 0.9) continue;
    if (T.slopeAt(x, z) > (type === "farm" ? 0.28 : type === "mine" ? 0.8 : 0.38)) continue;
    if (T.inPond(x, z, def.radius + 1)) continue;
    const b = T.biome(x, z);
    if (b === "rock" && type !== "observatory" && type !== "mine") continue;
    if (b === "mine" && type !== "mine") continue;
    let blocked = false;
    for (const s of w.structures) {
      if (s.type === "raft") continue;
      const gap = type === "grave" && s.type === "grave" ? 0.4 : 1.2;
      if (dist(x, z, s.x, s.z) < def.radius + STRUCTS[s.type].radius + gap) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    if (type !== "campfire" && type !== "grave" && dist(x, z, w.camp.x, w.camp.z) < def.radius + 2.2) continue;
    for (const r of w.rocks) if (dist(x, z, r.x, r.z) < def.radius + 1) blocked = true;
    if (blocked) continue;
    clearSite(w, x, z, def.radius + 0.6);
    const rot = grid ? grid.face(x, z) : Math.atan2(cz - z, cx - x);
    return { x, z, rot };
  }
  return null;
}

/**
 * 수학을 알면 건물이 같은 방향을 바라보게 짓고, 건축학을 알면 마을을 바둑판처럼 반듯하게 나눈다.
 * 축은 야영지에서 바다를 바라보는 방향에 맞춘다.
 */
function layoutGrid(w: WorldState, type: StructureType) {
  if (!knows(w, "mathematics") || type === "farm" || type === "grave" || type === "campfire" || type === "mine") return null;
  const base = Math.atan2(w.camp.z, w.camp.x);
  const ux = Math.cos(base), uz = Math.sin(base);
  const step = 3.6;
  const squared = knows(w, "architecture");
  return {
    snap(x: number, z: number): [number, number] {
      if (!squared) return [x, z];
      const dx = x - w.camp.x, dz = z - w.camp.z;
      const u = Math.round((dx * ux + dz * uz) / step) * step;
      const v = Math.round((-dx * uz + dz * ux) / step) * step;
      return [w.camp.x + u * ux - v * uz, w.camp.z + u * uz + v * ux];
    },
    /** 마을 가운데를 향하는 네 방향 가운데 하나 */
    face(x: number, z: number) {
      const a = Math.atan2(w.camp.z - z, w.camp.x - x) - base;
      return base + Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    },
  };
}

function clearSite(w: WorldState, x: number, z: number, r: number) {
  const before = w.plants.length;
  w.plants = w.plants.filter((p) => p.kind === "crop" || dist(p.x, p.z, x, z) > r);
  if (w.plants.length !== before) bump(w);
}

function coastSite(w: WorldState, T: Terrain, type: StructureType) {
  let best: { x: number; z: number; rot: number; score: number } | null = null;
  const dock = w.structures.find((s) => s.type === "dock");
  const side = type === "dock" ? -0.4 : type === "shipyard" ? 0.6 : type === "seawall" ? 1.6 : 3.5;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const sp = T.shorePoint(a, side);
    const d = dist(sp.x, sp.z, w.camp.x, w.camp.z);
    let score: number;
    if (type === "dock") {
      score = -d;
    } else if (type === "shipyard") {
      score = -d - (dock && dist(sp.x, sp.z, dock.x, dock.z) < 12 ? 40 : 0);
    } else if (type === "seawall") {
      // 마을 앞바다를 막는다
      score = -d - (T.height(sp.x, sp.z) > 3 ? 30 : 0);
    } else {
      score = T.height(sp.x, sp.z) * 2 - d * 0.1 - (dock && dist(sp.x, sp.z, dock.x, dock.z) < 15 ? 50 : 0);
      if (!T.isLand(sp.x, sp.z)) score -= 100;
    }
    if (w.structures.some((s) => dist(sp.x, sp.z, s.x, s.z) < STRUCTS[s.type].radius + STRUCTS[type].radius + 1)) continue;
    if (!best || score > best.score) best = { x: sp.x, z: sp.z, rot: a, score };
  }
  if (best) clearSite(w, best.x, best.z, STRUCTS[type].radius + 0.5);
  return best;
}

/** 완공 처리 */
export function completeStructure(w: WorldState, s: Structure, by: Person | null) {
  s.prog = 1;
  const def = STRUCTS[s.type];
  if (s.replaces != null) {
    const old = findById(w.structures, s.replaces);
    if (old) {
      for (const p of w.people) if (p.home === old.id) p.home = s.id;
      w.structures = w.structures.filter((x) => x.id !== old.id);
    }
    s.replaces = undefined;
  }
  if (s.type !== "grave" && s.type !== "bench" && s.type !== "farm") {
    chron(w, "build", `${by ? josa(by.name, "이/가") + " " : ""}${josa(def.name, "을/를")} 완성했다.`);
  }
  addFx(w, "complete", s.x, s.z, s.id);
  if (isHouse(s.type)) assignHomes(w);
  if (s.type !== "grave" && s.type !== "farm") shiftMorale(w, STRUCTS[s.type].hp >= 300 ? 3 : 1);
  bump(w);
}

export function campFire(w: WorldState) {
  let best: Structure | null = null;
  let bd = 9;
  for (const s of w.structures) {
    if (s.type !== "campfire") continue;
    const d = dist(s.x, s.z, w.camp.x, w.camp.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export const litFires = (w: WorldState) => w.structures.filter((s) => s.type === "campfire" && s.lit);

export function evidencePresent(w: WorldState, techId: string) {
  const ev = TECH_BY_ID[techId]?.evidence;
  if (!ev) return false;
  if (w.structures.some((s) => s.type === ev && s.prog >= 1)) return true;
  return stockOf(w, ev as Res) > 0;
}

/** 모두가 떠난 뒤: 기록(문자)이 없으면 흔적이 남은 지식만 이어진다 */
export function forgetOnExtinction(w: WorldState) {
  if (knows(w, "writing")) return;
  const keep = w.tech.known.filter((id) => id === "knapping" || evidencePresent(w, id));
  // 남긴 지식의 선행 지식도 남아야 한다
  const set = new Set(keep);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set]) for (const q of TECH_BY_ID[id].prereq) if (!set.has(q)) { set.add(q); changed = true; }
  }
  const lost = w.tech.known.filter((id) => !set.has(id));
  w.tech.known = w.tech.known.filter((id) => set.has(id));
  for (const id of lost) w.tech.prog[id] = TECH_BY_ID[id].cost * 0.5;
  chooseFocus(w);
}

export const DAY_HOURS = DAY / HOUR;
