// 감기: 춥거나 젖은 채로 밖에 있으면 낮은 확률로 걸린다.
// 1~5단계로 나빠지거나 나아지며, 3단계는 독감, 5단계는 다른 사람과 떨어져 지내야 한다.
import { DAY, HOUR } from "./constants";
import { seasonOf } from "./clock";
import { MEDS, STRUCTS } from "./data";
import { clamp } from "./noise";
import { age, Ctx, feel, homeOf, say } from "./people";
import { chance, pRate, range } from "./rng";
import { josa } from "./text";
import type { Person, Res, Rock, WorldState } from "./types";
import { addFx, bump, chron, dist, knows, living, makeRock, nearest, stockOf } from "./world";

export const ILL_NAME = ["", "가벼운 감기", "감기", "독감", "심한 독감", "중증 · 격리 필요"];
export const illOf = (p: Person) => p.ill ?? 0;

const DRAIN = [0, 0, 0.25, 0.8, 1.5, 2.0];
const UP = [0, 0.26, 0.24, 0.2, 0.16, 0];
const DOWN = [0, 0.4, 0.32, 0.25, 0.2, 0.16];

const INDOOR_ACTS = new Set(["sleep", "shelter", "rest", "isolate"]);

export function infirmary(w: WorldState) {
  return w.structures.find((s) => s.type === "infirmary" && s.prog >= 1 && (s.dmg ?? 0) < 0.6);
}

/** 지붕 아래에서 쉬고 있는지 (집이나 요양소) */
export function indoors(w: WorldState, p: Person) {
  const a = p.act;
  if (!a || a.ph !== 1 || !INDOOR_ACTS.has(a.k)) return false;
  const h = a.k === "isolate" ? infirmary(w) : homeOf(w, p) ?? infirmary(w);
  return !!h && (h.dmg ?? 0) < 0.6 && dist(p.x, p.z, h.x, h.z) < STRUCTS[h.type].radius + 1.5;
}

/** 다른 사람에게 옮기지 않도록 떨어져 있는지 */
export function isolated(w: WorldState, p: Person) {
  const inf = infirmary(w);
  if (inf && dist(p.x, p.z, inf.x, inf.z) < STRUCTS.infirmary.radius + 2) return true;
  if (dist(p.x, p.z, w.camp.x, w.camp.z) < 14) return false;
  return !w.people.some((q) => q !== p && q.alive && !q.away && Math.abs(q.x - p.x) < 5 && Math.abs(q.z - p.z) < 5);
}

/** 추위와 비에 얼마나 내몰려 있는지 0..~2 */
export function exposure(w: WorldState, ctx: Ctx, p: Person) {
  if (indoors(w, p)) return 0;
  const W = ctx.weather;
  const wet = W === "rain" ? 0.6 : W === "storm" ? 1 : W === "snow" ? 0.7 : 0;
  const cold = clamp((12 - ctx.temp) / 14, 0, 1);
  const chill = clamp((40 - p.needs.warmth) / 40, 0, 1);
  return cold * 0.5 + wet * 0.7 + chill;
}

/** 감기에 걸린다. 넷에 하나쯤은 독한 독감이라 2단계부터 시작하고 더 빨리 나빠진다 */
export function infect(w: WorldState, p: Person, why: "cold" | "spread", flu?: boolean) {
  if (illOf(p) || w.time < (p.immune ?? 0)) return;
  const strong = flu ?? chance(w, seasonOf(w.time) === 3 ? 0.4 : 0.3);
  p.flu = strong ? 1 : 0;
  p.ill = strong ? 2 : 1;
  p.illAt = w.time;
  p.illNext = w.time + range(w, 6, 10) * HOUR;
  p.seen.illMax = p.ill;
  if (!w.history.sick) chron(w, "disease", `${josa(p.name, "이/가")} 콜록거리기 시작했다. 섬에 처음으로 감기가 찾아왔다.`);
  w.history.sick++;
  feel(w, p, "sadness", 0.12, false);
  say(w, p, why === "spread" ? "caught" : "sneeze", {}, "🤧", true);
  p.gesture = "cough";
  p.gestureUntil = w.time + 2.5 * 72;
  bump(w);
}

function heal(w: WorldState, p: Person, how: string) {
  const worst = p.seen.illMax ?? 1;
  p.ill = 0;
  p.flu = 0;
  p.immune = w.time + range(w, 5, 9) * DAY;
  delete p.seen.illMax;
  feel(w, p, "joy", 0.35);
  say(w, p, "cured", {}, "😮‍💨", true);
  if (worst >= 3) chron(w, "disease", `${josa(p.name, "이/가")} ${how}병을 이겨냈다.`);
  bump(w);
}

function setLevel(w: WorldState, p: Person, lv: number) {
  const before = illOf(p);
  lv = clamp(Math.round(lv), 0, 5);
  if (lv === before) return;
  if (lv === 0) return heal(w, p, "");
  p.ill = lv;
  p.seen.illMax = Math.max(p.seen.illMax ?? 0, lv);
  if (lv > before) {
    feel(w, p, "sadness", 0.15, false);
    feel(w, p, "fear", lv >= 4 ? 0.3 : 0.1, false);
    say(w, p, lv >= 3 ? "fever" : "sneeze", {}, "🤒", true);
    if (lv === 3) chron(w, "disease", `${josa(p.name, "이/가")} 독감으로 앓아누웠다.`);
    if (lv === 5) chron(w, "disease", `${p.name}의 병세가 위중해졌다. 다른 사람에게 옮지 않도록 떨어져 지내야 한다.`);
    for (const q of living(w)) {
      if (q === p) continue;
      const close = q.partner === p.id || q.parents.includes(p.id) || p.parents.includes(q.id) || (q.rel[p.id] ?? 0) > 0.5;
      if (close && lv >= 3) feel(w, q, "fear", 0.15 + 0.05 * lv, false);
    }
  }
  bump(w);
}

/** 매 스텝: 걸리고, 앓고, 나아지고, 나빠진다 */
export function updateIllness(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  const lv = illOf(p);
  if (!lv) {
    if (w.time < (p.immune ?? 0)) return;
    const e = exposure(w, ctx, p);
    if (e < 0.05) return;
    let rate = (e * 0.12) / DAY;
    const yrs = age(w, p);
    if (yrs < 8 || yrs > 62) rate *= 1.4;
    if (p.health < 50) rate *= 1.4;
    if (p.outfit !== "rag") rate *= 0.75;
    if (chance(w, pRate(rate, dt))) infect(w, p, "cold");
    return;
  }
  const h = dt / HOUR;
  p.health = clamp(p.health - DRAIN[lv] * h, 0, 100);
  p.needs.energy = clamp(p.needs.energy - lv * 0.6 * h, 0, 100);
  if (lv >= 4) p.needs.fun = clamp(p.needs.fun - 0.8 * h, 0, 100);
  if (lv <= 3 && p.act?.ph !== 1 && chance(w, pRate(lv / (2 * HOUR), dt)) && w.time > p.gestureUntil + 600) {
    p.gesture = "cough";
    p.gestureUntil = w.time + 2.5 * 72;
  }
  if (w.time < (p.illNext ?? 0)) return;
  p.illNext = w.time + range(w, 6, 10) * HOUR;
  const a = p.act;
  const resting = !!a && a.ph === 1 && (a.k === "rest" || a.k === "isolate" || a.k === "sleep");
  let up = UP[lv], down = DOWN[lv];
  if (exposure(w, ctx, p) > 0.3) up *= 1.7;
  if (resting) {
    up *= 0.55;
    down *= 1.4;
  }
  if (p.needs.warmth > 60) down *= 1.15;
  if (p.needs.hunger < 30 || p.needs.thirst < 30) {
    up *= 1.4;
    down *= 0.7;
  }
  const yrs = age(w, p);
  if (yrs < 8 || yrs > 62) up *= 1.3;
  if (knows(w, "medicine")) down *= 1.2;
  if (p.flu) {
    up *= 1.6;
    down *= 0.7;
  }
  if (w.time - (p.seen.nursed ?? -1e9) < 10 * HOUR) {
    down *= 1.35;
    up *= 0.75;
  }
  if (w.time - (p.seen.medAt ?? -1e9) < 14 * HOUR) {
    down *= 1.6;
    up *= 0.5;
  }
  const r = range(w, 0, 1);
  if (r < up) setLevel(w, p, lv + 1);
  else if (r < up + down) setLevel(w, p, lv - 1);
}

/** 매시간: 가까이 붙어 있으면 옮는다 */
export function spreadIllness(w: WorldState) {
  const alive = living(w);
  const sick = alive.filter((p) => illOf(p) >= 2);
  if (!sick.length) return;
  const careful = knows(w, "medicine") ? 0.6 : 1;
  for (const s of sick) {
    if (isolated(w, s)) continue;
    const k = 0.012 * illOf(s) * (illOf(s) === 5 ? 2 : 1) * careful;
    for (const q of alive) {
      if (q === s || illOf(q) || w.time < (q.immune ?? 0)) continue;
      if (Math.abs(q.x - s.x) > 3.5 || Math.abs(q.z - s.z) > 3.5) continue;
      if (chance(w, k)) infect(w, q, "spread", !!s.flu);
    }
  }
}

/** 이 단계에 들을 약 (없으면 그나마 나은 것). 독감에는 약초즙이 듣지 않는다 */
export function medFor(w: WorldState, lv: number, flu = false): Res | null {
  const meds = flu ? MEDS.filter((m) => m.res !== "herbal") : MEDS;
  for (const m of meds) if (m.upTo >= lv && stockOf(w, m.res) >= 1) return m.res;
  for (let i = meds.length - 1; i >= 0; i--) if (stockOf(w, meds[i].res) >= 1) return meds[i].res;
  return null;
}
export const medForP = (w: WorldState, p: Person) => medFor(w, illOf(p), !!p.flu);

export function giveMed(w: WorldState, p: Person, res: Res, by: Person | null) {
  const m = MEDS.find((x) => x.res === res);
  const lv = illOf(p);
  if (!m || !lv || stockOf(w, res) < 1) return false;
  w.stock[res] = stockOf(w, res) - 1;
  p.seen.medAt = w.time;
  p.health = Math.min(100, p.health + (res === "medicine" ? 12 : 5));
  addFx(w, "heal", p.x, p.z, p.id);
  const next = lv > m.upTo ? lv - 1 : Math.max(0, lv - m.drop);
  // 약 기운이 도는 동안 더 잘 낫는다 (단계 판정 때 반영)
  if (next === 0) {
    heal(w, p, by && by !== p ? `${josa(by.name, "이/가")} 지어 준 약 덕분에 ` : "약을 먹고 ");
    if (res === "medicine") p.immune = w.time + 12 * DAY;
  } else {
    setLevel(w, p, next);
    say(w, p, "medTaken", {}, "💊", true);
  }
  if (by && by !== p) {
    p.rel[by.id] = clamp((p.rel[by.id] ?? 0) + 0.12, -1, 1);
    feel(w, p, "love", 0.2, false);
  }
  return true;
}

/** 땅을 파다가 약재를 찾는다 */
export function discoverIngredient(w: WorldState, p: Person, what: "root" | "mineral", x: number, z: number): Rock | null {
  let rock: Rock | null = null;
  if (what === "mineral") {
    const d = nearest(w.deposits, x, z, undefined, 6);
    if (!d) return null;
    w.deposits = w.deposits.filter((q) => q !== d);
    rock = makeRock(w, "mineral", d.x, d.z);
    w.rocks.push(rock);
    bump(w);
  }
  if (w.found.includes(what)) return rock;
  w.found.push(what);
  feel(w, p, "surprise", 0.5);
  feel(w, p, "joy", 0.4);
  say(w, p, "foundIngredient", {}, what === "root" ? "🌱" : "💎", true);
  addFx(w, "eureka", p.x, p.z, p.id);
  chron(w, "discover", what === "root"
    ? `${josa(p.name, "이/가")} 땅을 파다가 약이 될 만한 뿌리를 찾아냈다.`
    : `${josa(p.name, "이/가")} 땅속에서 반짝이는 하얀 약돌 광맥을 찾아냈다.`);
  return rock;
}

/** 아픈 사람이 있는지, 몇 명인지 */
export const sickPeople = (w: WorldState, min = 1) => living(w).filter((p) => illOf(p) >= min);
