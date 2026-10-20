import { DAY, HOUR, TIME_SCALE } from "./constants";
import { ageYears } from "./clock";
import { ERAS, FOOD, HOUSE_TYPES, STRUCTS, TECH_BY_ID, TECHS } from "./data";
import { range, rand } from "./rng";
import type { Terrain } from "./terrain";
import { josa, thought } from "./text";
import type { Person, Res, Stock, Structure, StructureType, WorldState } from "./types";
import { addFx, bump, chron, dist, findById, knows, living, makeStructure, stockOf } from "./world";

// ─── 연구 ──────────────────────────────────────────────────────────────

export const available = (w: WorldState) =>
  TECHS.filter((t) => !knows(w, t.id) && t.prereq.every((p) => knows(w, p)));

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
  return m;
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
    return p;
  };
  av.sort((a, b) => (a.cost / prio(a.id)) - (b.cost / prio(b.id)));
  w.tech.focus = av[0].id;
}

/** 연구 점수를 더한다. tech를 지정하면 그 기술에, 아니면 현재 목표에. */
export function addResearch(w: WorldState, p: Person | null, pts: number, tech?: string) {
  const id = tech ?? w.tech.focus;
  if (!id || knows(w, id)) return;
  const def = TECH_BY_ID[id];
  if (!def || !def.prereq.every((q) => knows(w, q))) return;
  const v = (w.tech.prog[id] ?? 0) + pts * researchMul(w);
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
  if (era > eraBefore) chron(w, "era", `섬의 문명이 '${ERAS[era]}'에 들어섰다.`);
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
  return m;
}

// ─── 집 ────────────────────────────────────────────────────────────────

export const isHouse = (t: StructureType) => HOUSE_TYPES.includes(t);
export const houses = (w: WorldState) => w.structures.filter((s) => isHouse(s.type) && s.prog >= 1);

export function houseCapacity(w: WorldState) {
  let c = 0;
  for (const s of houses(w)) c += STRUCTS[s.type].cap ?? 0;
  return c;
}

export function residents(w: WorldState, houseId: number) {
  return w.people.filter((p) => p.alive && p.home === houseId);
}

/** 집 없는 사람을 빈 집에 배정. 가족은 함께. */
export function assignHomes(w: WorldState) {
  const hs = houses(w).sort((a, b) => (STRUCTS[b.type].tier ?? 0) - (STRUCTS[a.type].tier ?? 0));
  for (const p of w.people) {
    if (!p.alive) continue;
    if (p.home != null && !hs.some((h) => h.id === p.home)) p.home = null;
  }
  for (const p of w.people) {
    if (!p.alive || p.home != null) continue;
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

/** 다음 건설 과제를 정한다 (한 번에 하나, 밭과 무덤은 예외) */
export function planProject(w: WorldState, T: Terrain) {
  const active = projects(w).filter((s) => s.type !== "grave" && s.type !== "farm");
  if (active.length >= 1) return;
  const pop = living(w).filter((p) => ageYears(p.birth, w.time) >= 3).length;
  if (!pop) return;
  const cap = houseCapacity(w);
  const best = bestHouse(w);
  const want: StructureType[] = [];

  if (best && cap < pop) want.push(best);
  if (knows(w, "basket") && !has(w, "storage")) want.push("storage");
  if (knows(w, "polished") && !has(w, "workshop")) want.push("workshop");
  if (knows(w, "drying") && !has(w, "rack")) want.push("rack");
  if (knows(w, "pottery") && !has(w, "kiln")) want.push("kiln");
  if (knows(w, "husbandry") && !has(w, "pen")) want.push("pen");
  if (knows(w, "well") && !has(w, "well")) want.push("well");
  // 집 업그레이드
  if (best && !want.length) {
    const tierBest = STRUCTS[best].tier ?? 0;
    const old = houses(w).find((h) => (STRUCTS[h.type].tier ?? 0) < tierBest && !w.structures.some((s) => s.replaces === h.id));
    if (old) {
      const site = findSite(w, T, best, { x: old.x, z: old.z });
      if (site) {
        const s = makeStructure(w, best, site.x, site.z, site.rot);
        s.replaces = old.id;
        w.structures.push(s);
        bump(w);
        return;
      }
    }
  }
  if (knows(w, "metallurgy") && !has(w, "smelter")) want.push("smelter");
  if (knows(w, "writing") && !has(w, "library")) want.push("library");
  if (knows(w, "boat") && !has(w, "dock")) want.push("dock");
  if (knows(w, "windmill") && !has(w, "windmill")) want.push("windmill");
  if (knows(w, "astronomy") && !has(w, "observatory")) want.push("observatory");
  if (knows(w, "electricity") && !has(w, "lighthouse")) want.push("lighthouse");
  if (best && cap < pop + 2 && pop >= 3) want.push(best);
  if (knows(w, "stoneaxe") && w.structures.filter((s) => s.type === "bench").length < Math.min(3, 1 + Math.floor(pop / 4))) want.push("bench");

  for (const t of want) {
    const site = findSite(w, T, t);
    if (site) {
      w.structures.push(makeStructure(w, t, site.x, site.z, site.rot));
      bump(w);
      return;
    }
  }
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
};

export function findSite(
  w: WorldState, T: Terrain, type: StructureType, near?: { x: number; z: number },
): { x: number; z: number; rot: number } | null {
  const def = STRUCTS[type];
  if (type === "dock" || type === "lighthouse") return coastSite(w, T, type);
  const [r0, r1] = near ? [def.radius + 3, def.radius + 9] : RING[type] ?? [5, 15];
  const cx = near?.x ?? w.camp.x, cz = near?.z ?? w.camp.z;
  for (let k = 0; k < 160; k++) {
    const grow = 1 + Math.floor(k / 40) * 0.4;
    const a = rand(w) * Math.PI * 2;
    const d = range(w, r0, r1 * grow);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (!T.isLand(x, z)) continue;
    if (T.height(x, z) < 0.9) continue;
    if (T.slopeAt(x, z) > (type === "farm" ? 0.28 : 0.38)) continue;
    if (T.inPond(x, z, def.radius + 1)) continue;
    const b = T.biome(x, z);
    if (b === "rock" && type !== "observatory") continue;
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
    const rot = Math.atan2(w.camp.z - z, w.camp.x - x);
    return { x, z, rot };
  }
  return null;
}

function clearSite(w: WorldState, x: number, z: number, r: number) {
  const before = w.plants.length;
  w.plants = w.plants.filter((p) => p.kind === "crop" || dist(p.x, p.z, x, z) > r);
  if (w.plants.length !== before) bump(w);
}

function coastSite(w: WorldState, T: Terrain, type: StructureType) {
  let best: { x: number; z: number; rot: number; score: number } | null = null;
  const dock = w.structures.find((s) => s.type === "dock");
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const sp = T.shorePoint(a, type === "dock" ? -0.4 : 3.5);
    const d = dist(sp.x, sp.z, w.camp.x, w.camp.z);
    let score: number;
    if (type === "dock") {
      score = -d;
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
