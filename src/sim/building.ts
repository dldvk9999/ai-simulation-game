// 건물의 내구도 · 층수 · 설계. 재해든 맹수든 관찰자의 손길이든, 부서지고 무너지는 일은 모두 여기서 처리한다.
import { HOUR } from "./constants";
import { NO_DESIGN, PURPOSE_NAME, STORIED, STRUCTS, type Purpose } from "./data";
import { shiftMorale } from "./morale";
import { feel, lying, say } from "./people";
import { chance, range } from "./rng";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Disaster, DisasterType, Person, Res, Structure, StructureType, WorldState } from "./types";
import { addFx, bump, chron, dist, knows, living, makeItem, makeStructure } from "./world";

export const floorsOf = (s: Structure) => s.lv ?? 1;

/** 처음 내구도: 큰 건물일수록, 층이 많을수록 높다 */
export function maxHp(s: Structure) {
  return Math.round(STRUCTS[s.type].hp * (1 + 0.45 * (floorsOf(s) - 1)));
}
export const hpOf = (s: Structure) => Math.max(0, Math.round(maxHp(s) * (1 - (s.dmg ?? 0))));

/** 대략의 높이 (클릭 판정과 화면 표시) */
export function heightOf(s: Structure) {
  const d = STRUCTS[s.type];
  return STORIED.has(s.type) ? d.h * floorsOf(s) + 1.2 : d.h;
}

/** 시대가 발전할수록 같은 건물도 더 높게 설계한다 */
export function designLevel(w: WorldState, type: StructureType) {
  switch (type) {
    case "townhouse": return 2 + (knows(w, "electricity") ? 1 : 0);
    case "apartment": return 4 + (knows(w, "electricity") ? 1 : 0) + (knows(w, "quantum") ? 1 : 0);
    case "watchtower": return 2 + (knows(w, "mathematics") ? 1 : 0);
    case "fort": return 3 + (knows(w, "steam") ? 1 : 0);
    case "factory": return 2 + (knows(w, "electricity") ? 1 : 0);
    default: return 1;
  }
}

export const designKey = (type: StructureType, lv: number) => `${type}:${lv}`;

/** 새 건설 과제. 처음 짓는 모양이면 누군가 먼저 설계해야 한다 */
export function newProject(w: WorldState, type: StructureType, site: { x: number; z: number; rot: number }) {
  const s = makeStructure(w, type, site.x, site.z, site.rot);
  const lv = designLevel(w, type);
  if (lv > 1) s.lv = lv;
  if (!NO_DESIGN.has(type) && !w.designs.includes(designKey(type, lv))) s.plan = 0;
  w.structures.push(s);
  bump(w);
  return s;
}

const PURPOSE_VERB: Record<Purpose, string> = {
  home: "여럿이 잠잘", defense: "맹수를 막아 낼", craft: "도구를 만들", food: "먹을 것을 마련할", store: "물건을 쌓아 둘",
  civic: "함께 모일", sea: "바다로 나갈", mine: "광석을 캘", care: "아픈 사람을 돌볼", misc: "",
};

export function purposeOf(type: StructureType) {
  return PURPOSE_NAME[STRUCTS[type].use];
}

/** 설계를 마쳤다 */
export function finishDesign(w: WorldState, s: Structure, p: Person) {
  if (s.plan !== 0) return;
  s.plan = 1;
  const key = designKey(s.type, floorsOf(s));
  if (!w.designs.includes(key)) w.designs.push(key);
  const def = STRUCTS[s.type];
  const verb = PURPOSE_VERB[def.use];
  const floors = floorsOf(s) > 1 ? `${floorsOf(s)}층짜리 ` : "";
  chron(w, "build", `${josa(p.name, "이/가")} ${verb ? verb + " " : ""}${floors}${josa(def.name, "을/를")} 설계했다.`);
  bump(w);
}

// ─── 부서짐과 무너짐 ───────────────────────────────────────────────────

export type HarmCause = DisasterType | "beast" | "hand";

/** 무너지면 사기가 꺾이는 정도: 중요한 건물일수록 크다 */
export function lossFor(type: StructureType) {
  if (type === "grave" || type === "raft" || type === "bench" || type === "banner" || type === "campfire" || type === "rack") return 1.5;
  if (type === "portal" || type === "library" || type === "hall" || type === "observatory" || type === "lighthouse" || type === "apartment") return 15;
  if (type === "townhouse" || type === "fort" || type === "battery" || type === "factory" || type === "shipyard" || type === "windmill" || type === "smelter") return 12;
  if (STRUCTS[type].use === "home") return 7;
  if (type === "storage" || type === "workshop" || type === "forge" || type === "infirmary" || type === "well" || type === "mine" || type === "watchtower") return 8;
  return 4;
}

const SHELTERS = new Set<StructureType>(["leanto", "hut", "loghouse", "stonehouse", "townhouse", "apartment", "infirmary", "hall", "library"]);

/** 구조물을 부순다 (amount는 내구도 비율). 1을 넘으면 무너진다 */
export function harm(w: WorldState, T: Terrain, s: Structure, amount: number, cause: HarmCause, toll?: Disaster["toll"]) {
  if (s.prog < 1) {
    // 짓던 것은 공사가 뒤로 밀린다
    s.prog = Math.max(0, s.prog - amount * 0.6);
    addFx(w, "crack", s.x, s.z, s.id, 0.3);
    bump(w);
    return;
  }
  const disaster = cause === "quake" || cause === "typhoon" || cause === "tsunami";
  const before = s.dmg ?? 0;
  s.dmg = Math.min(1, before + amount);
  addFx(w, disaster ? "collapse" : "crack", s.x, s.z, s.id, s.dmg);
  if (disaster) {
    if (s.type === "storage") {
      // 창고가 부서지면 모아둔 것의 일부를 잃는다
      for (const r of Object.keys(w.stock) as Res[]) {
        const v = w.stock[r] ?? 0;
        const lost = v * Math.min(0.5, amount * 0.35);
        w.stock[r] = v - lost;
        if (toll) toll.lost += lost;
      }
    }
    if (s.type === "farm") {
      for (const c of w.plants.filter((p) => p.kind === "crop" && p.farm === s.id)) {
        if (chance(w, 0.6)) {
          w.plants = w.plants.filter((p) => p !== c);
          if (toll) toll.crops++;
        }
      }
    }
    // 안에 있던 사람이 다친다
    if (SHELTERS.has(s.type)) {
      for (const p of living(w)) {
        if (dist(p.x, p.z, s.x, s.z) > STRUCTS[s.type].radius + 0.5) continue;
        if (!chance(w, Math.min(0.9, amount))) continue;
        p.health = Math.max(1, p.health - range(w, 10, 25) * (cause === "quake" ? 1 : 0.6));
        feel(w, p, "fear", 0.4);
        say(w, p, "hurt", {}, "🤕", true);
        if (toll) toll.hurt++;
      }
    }
  }
  if (s.dmg >= 1) {
    const hurt = collapse(w, T, s, cause);
    if (toll) {
      toll.ruined++;
      toll.hurt += hurt;
    }
  } else if (before < 0.15 && toll) toll.broken++;
  bump(w);
}

/** 무너졌다: 곁에 있던 사람이 다치고, 사람들의 사기가 꺾인다 */
function collapse(w: WorldState, T: Terrain, s: Structure, cause: HarmCause) {
  const def = STRUCTS[s.type];
  let hurt = 0;
  for (const p of living(w)) {
    if (dist(p.x, p.z, s.x, s.z) > def.radius + 0.9) continue;
    const big = Math.min(1.6, 0.6 + def.hp / 500);
    p.health = Math.max(1, p.health - range(w, 12, 28) * big);
    feel(w, p, "fear", 0.5);
    say(w, p, "hurt", {}, "🤕", true);
    if (p.health < 35 && !lying(p)) {
      p.act = { k: "unconscious", ph: 1, tx: p.x, tz: p.z, t: range(w, 0.3, 0.8) * HOUR, started: w.time };
      p.anim = "lie";
    }
    hurt++;
  }
  if (s.type === "storage") for (const r of Object.keys(w.stock) as Res[]) w.stock[r] = (w.stock[r] ?? 0) * 0.75;
  ruin(w, T, s);
  const loss = lossFor(s.type) + hurt * 4;
  shiftMorale(w, -loss);
  for (const p of living(w)) {
    if (dist(p.x, p.z, s.x, s.z) < 30 || loss >= 10) feel(w, p, "sadness", Math.min(0.5, loss * 0.025), false);
    p.seen.reeval = 0;
  }
  // 재해 때는 재해가 지나간 뒤에 한꺼번에 기록한다
  if (cause === "hand" || cause === "beast") {
    const why = cause === "beast" ? "맹수가 들이받아 " : "";
    chron(w, "disaster", `${why}${josa(def.name, "이/가")} 무너졌다.${hurt ? ` ${hurt}명이 다쳤다.` : ""}${loss >= 10 ? " 사람들은 망연자실했다." : ""}`);
  }
  return hurt;
}

/** 무너진 자리에는 쓸 만한 잔해가 남는다 */
export function ruin(w: WorldState, T: Terrain, s: Structure) {
  const cost = STRUCTS[s.type].cost;
  for (const [r, n] of Object.entries(cost) as [Res, number][]) {
    if (r !== "wood" && r !== "stone" && r !== "stick") continue;
    const k = Math.min(4, Math.floor(n * 0.3));
    for (let i = 0; i < k; i++) {
      const x = s.x + range(w, -2, 2), z = s.z + range(w, -2, 2);
      if (T.height(x, z) > 0.1) w.items.push(makeItem(w, r, 1, x, z));
    }
  }
  if (s.type === "farm") for (const c of w.plants.filter((p) => p.kind === "crop" && p.farm === s.id)) w.plants = w.plants.filter((p) => p !== c);
  w.structures = w.structures.filter((x) => x !== s);
  for (const p of w.people) if (p.home === s.id) p.home = null;
  for (const x of w.structures) if (x.replaces === s.id) x.replaces = undefined;
  addFx(w, "collapse", s.x, s.z, s.id, 1);
  bump(w);
}

/** 관찰자가 세 번 연달아 두드리면 이만큼 내구도가 깎인다 */
export const SMASH_HP = 40;
const UNSMASHABLE = new Set<StructureType>(["campfire", "raft", "grave"]);
export const smashable = (s: Structure) => !UNSMASHABLE.has(s.type);

export function smash(w: WorldState, T: Terrain, s: Structure) {
  if (!smashable(s)) return false;
  const amount = SMASH_HP / maxHp(s);
  const gone = s.prog >= 1 && (s.dmg ?? 0) + amount >= 1;
  harm(w, T, s, amount, "hand");
  for (const p of living(w)) {
    const d = dist(p.x, p.z, s.x, s.z);
    if (d > 16 || lying(p)) continue;
    feel(w, p, "surprise", 0.45);
    feel(w, p, "fear", d < 5 ? 0.3 : 0.12, false);
    if (!gone && chance(w, 0.5)) say(w, p, "smash", {}, "😨", true);
    p.seen.reeval = 0;
  }
  return true;
}
