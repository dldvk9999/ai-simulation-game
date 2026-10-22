// 섬 밖으로: 과학 시대에 이르러야만 큰 돛배(조선술)나 차원문으로 바깥 세상에 다녀올 수 있다.
import { DAY, HOUR, MAX_POP } from "./constants";
import { ageYears } from "./clock";
import { TECH_BY_ID } from "./data";
import { feel, say } from "./people";
import { chance, int, range } from "./rng";
import { addResearch, currentEra } from "./settlement";
import { josa } from "./text";
import type { Person, Res, Structure, Voyage, WorldState } from "./types";
import { addFx, addStock, bump, chron, createPerson, dist, findById, knows, living, newId } from "./world";

/** 섬을 떠나려면 무조건 과학 시대에 들어서야 한다 */
export const canLeave = (w: WorldState) => currentEra(w) >= 4 && knows(w, "science");

const ready = (s: Structure) => s.prog >= 1 && (s.dmg ?? 0) < 0.6;
export const shipyardOf = (w: WorldState) => w.structures.find((s) => s.type === "shipyard" && ready(s));
export const portalOf = (w: WorldState) => w.structures.find((s) => s.type === "portal" && ready(s));

/** 배가 정박하는 자리 (조선소 바다 쪽) */
export function berth(s: Structure) {
  return { x: s.x + Math.cos(s.rot) * 3.2, z: s.z + Math.sin(s.rot) * 3.2, rot: s.rot };
}

/** 떠날 사람들이 모이는 자리 */
export function boardPoint(w: WorldState, v: Voyage) {
  return { x: v.from.x - Math.cos(v.from.rot) * (v.via === "ship" ? 2.2 : 1.6), z: v.from.z - Math.sin(v.from.rot) * (v.via === "ship" ? 2.2 : 1.6) };
}

export const voyageOf = (w: WorldState, p: Person) => w.voyages.find((v) => v.crew.includes(p.id));

function crewFor(w: WorldState, n: number) {
  const alive = living(w);
  const babies = new Set(alive.filter((k) => ageYears(k.birth, w.time) < 2).flatMap((k) => k.parents));
  const ok = alive.filter((p) => {
    const yrs = ageYears(p.birth, w.time);
    return yrs >= 18 && yrs <= 58 && !(p.ill ?? 0) && !p.preg && !babies.has(p.id) && p.health > 60;
  });
  ok.sort((a, b) => score(b) - score(a));
  return ok.slice(0, n);
  function score(p: Person) {
    // 다녀온 적 없는 사람에게 먼저 기회가 간다
    return (p.role === "sailor" ? 1 : 0) + (p.role === "scholar" ? 0.3 : 0) + p.traits.openness + (p.skills.fish ?? 0) - (p.seen.trips ?? 0) * 0.45;
  }
}

/** 하루에 한 번: 떠날 채비 */
export function dailyVoyage(w: WorldState) {
  if (!canLeave(w) || w.voyages.length || w.disaster) return;
  if (w.time < (w.timers.voyage ?? 0)) return;
  const ship = knows(w, "shipbuilding") ? shipyardOf(w) : undefined;
  const portal = knows(w, "portal") ? portalOf(w) : undefined;
  if (!ship && !portal) return;
  if (!chance(w, 0.2)) return;
  const via: Voyage["via"] = portal && (!ship || chance(w, 0.5)) ? "portal" : "ship";
  const pop = living(w).length;
  const want = via === "ship" ? int(w, 3, 4) : int(w, 1, 2);
  if (pop < want + 3) return;
  const crew = crewFor(w, want);
  if (crew.length < (via === "ship" ? 2 : 1)) return;
  const s = (via === "ship" ? ship : portal)!;
  const from = via === "ship" ? berth(s) : { x: s.x, z: s.z, rot: s.rot };
  const v: Voyage = { id: newId(w), via, crew: crew.map((p) => p.id), called: w.time, left: 0, back: 0, from };
  w.voyages.push(v);
  for (const p of crew) {
    p.seen.reeval = 0;
    feel(w, p, "joy", 0.3);
    feel(w, p, "surprise", 0.2, false);
    say(w, p, via === "ship" ? "voyage" : "portalGo", {}, via === "ship" ? "⛵" : "🌀", true);
  }
  const names = crew.map((p) => p.name).join(", ");
  chron(w, "voyage", via === "ship"
    ? `${names}${josa(crew[crew.length - 1].name, "이/가").slice(crew[crew.length - 1].name.length)} 큰 돛배를 타고 바다 너머 바깥 세상으로 떠날 채비를 한다.`
    : `${names}${josa(crew[crew.length - 1].name, "이/가").slice(crew[crew.length - 1].name.length)} 차원문 너머의 세상을 보러 가기로 했다.`);
  bump(w);
}

const FAR = 5000;

/** 매 스텝: 모이면 떠나고, 때가 되면 돌아온다 */
export function updateVoyages(w: WorldState) {
  for (const v of [...w.voyages]) {
    const crew = v.crew.map((id) => findById(w.people, id)).filter((p): p is Person => !!p && !!p.alive);
    if (!v.left) {
      if (!crew.length) {
        w.voyages = w.voyages.filter((x) => x !== v);
        continue;
      }
      const bp = boardPoint(w, v);
      const gathered = crew.every((p) => dist(p.x, p.z, bp.x, bp.z) < 3.5);
      if (gathered || w.time - v.called > 4 * HOUR) depart(w, v, crew);
      continue;
    }
    if (w.time >= v.back) homecoming(w, v, crew);
  }
}

function depart(w: WorldState, v: Voyage, crew: Person[]) {
  v.left = w.time;
  v.back = w.time + (v.via === "ship" ? range(w, 3, 7) : range(w, 1, 3)) * DAY;
  for (const p of crew) {
    p.away = { until: v.back, via: v.via, trip: v.id };
    p.act = null;
    p.carry = null;
    p.bubble = null;
    p.x = FAR + p.id;
    p.z = FAR;
  }
  if (v.via === "portal") addFx(w, "portal", v.from.x, v.from.z);
  for (const q of living(w)) {
    feel(w, q, "surprise", 0.25, false);
    if (crew.some((c) => c.partner === q.id || c.parents.includes(q.id) || q.parents.includes(c.id))) feel(w, q, "sadness", 0.2, false);
  }
  chron(w, "voyage", v.via === "ship" ? "돛을 활짝 편 배가 수평선 너머로 사라졌다." : "차원문이 눈부시게 빛나더니, 일행이 빛 속으로 걸어 들어갔다.");
  bump(w);
}

function homecoming(w: WorldState, v: Voyage, crew: Person[]) {
  const bp = boardPoint(w, v);
  const days = Math.max(1, Math.round((w.time - v.left) / DAY));
  const loot: string[] = [];
  const give = (r: Res, n: number, label: string) => {
    addStock(w, r, n);
    loot.push(`${label} ${n}`);
  };
  // 바깥 세상에 남기로 하는 사람도 있다
  let stayed: Person | null = null;
  const loner = crew.find((p) => p.partner == null && !w.people.some((k) => k.alive && k.parents.includes(p.id) && ageYears(k.birth, w.time) < 16));
  if (loner && crew.length > 1 && chance(w, v.via === "ship" ? 0.1 : 0.06)) stayed = loner;
  crew.forEach((p, i) => {
    if (p === stayed) return;
    const a = (i / crew.length) * Math.PI * 2;
    p.x = bp.x + Math.cos(a) * 1.2;
    p.z = bp.z + Math.sin(a) * 1.2;
    p.away = null;
    p.act = null;
    p.seen.trips = (p.seen.trips ?? 0) + 1;
    p.needs.fun = Math.min(100, p.needs.fun + 40);
    feel(w, p, "joy", 0.6);
    say(w, p, "back", {}, v.via === "ship" ? "⚓" : "✨", true);
  });
  if (v.via === "ship") {
    give("metal", int(w, 5, 12), "금속");
    give("rope", int(w, 3, 8), "끈");
    if (chance(w, 0.6)) give("crop", int(w, 8, 16), "낯선 곡식");
    if (chance(w, 0.5)) give("medicine", int(w, 1, 3), "약");
  } else {
    give("metal", int(w, 8, 16), "금속");
    give("mineral", int(w, 3, 6), "약돌");
    give("medicine", int(w, 2, 4), "약");
  }
  // 바깥에서 배워 온 것
  const focus = w.tech.focus;
  if (focus) {
    const def = TECH_BY_ID[focus];
    addResearch(w, crew[0] ?? null, def.cost * (v.via === "ship" ? 0.12 : 0.25), focus);
  }
  // 함께 오는 사람
  const newcomers: Person[] = [];
  if (w.people.filter((q) => q.alive).length < MAX_POP - 1 && chance(w, v.via === "ship" ? 0.45 : 0.25)) {
    const n = v.via === "ship" ? int(w, 1, 2) : 1;
    for (let i = 0; i < n; i++) {
      const q = createPerson(w, { x: bp.x + range(w, -1.5, 1.5), z: bp.z + range(w, -1.5, 1.5), age: range(w, 20, 36) });
      q.outfit = "modern";
      for (const c of crew) {
        q.rel[c.id] = 0.35;
        c.rel[q.id] = 0.35;
      }
      w.people.push(q);
      newcomers.push(q);
      w.stats.arrivals++;
      addFx(w, "arrive", q.x, q.z, q.id);
    }
  }
  const lead = crew.find((p) => p !== stayed) ?? crew[0];
  const where = v.via === "ship" ? "바다 건너" : "차원문 너머";
  let text = `${lead ? `${lead.name} 일행이 ` : ""}${days}일 만에 ${where}에서 돌아왔다. (가져온 것: ${loot.join(" · ")})`;
  if (newcomers.length) text += ` ${newcomers.map((q) => q.name).join(", ")}${josa(newcomers[newcomers.length - 1].name, "이/가").slice(newcomers[newcomers.length - 1].name.length)} 함께 왔다.`;
  chron(w, "voyage", text);
  if (stayed) {
    chron(w, "voyage", `${josa(stayed.name, "은/는")} ${v.via === "ship" ? "바깥 세상" : "차원문 너머"}에 남기로 했다. 언젠가 다시 만날 날을 기약하며.`);
    for (const q of living(w)) if ((q.rel[stayed.id] ?? 0) > 0.4) feel(w, q, "sadness", 0.3);
    w.people = w.people.filter((p) => p !== stayed);
  }
  if (v.via === "portal") addFx(w, "portal", v.from.x, v.from.z);
  for (const q of living(w)) if (!crew.includes(q)) feel(w, q, "joy", 0.3, false);
  w.voyages = w.voyages.filter((x) => x !== v);
  w.timers.voyage = w.time + range(w, 10, 20) * DAY;
  bump(w);
}

/** 렌더러용: 배가 지금 어디쯤 있는지 (null이면 보이지 않음) */
export function shipPose(w: WorldState, s: Structure, t = w.time) {
  const b = berth(s);
  const v = w.voyages.find((x) => x.via === "ship");
  if (!v || !v.left) return { ...b, k: 0 };
  // 떠난 뒤 한 시간 동안 수평선으로 멀어지고, 돌아오기 한 시간 전부터 다가온다
  const out = (t - v.left) / HOUR;
  const back = (v.back - t) / HOUR;
  const k = out < 1 ? out : back < 1 ? back : -1;
  if (k < 0) return null;
  const e = Math.pow(k, 1.4);
  return { x: b.x + Math.cos(b.rot) * e * 170, z: b.z + Math.sin(b.rot) * e * 170, rot: out < 1 ? b.rot : b.rot + Math.PI, k };
}

