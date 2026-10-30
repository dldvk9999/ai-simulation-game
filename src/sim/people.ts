import { dailyArrivals, nextArrival } from "./arrivals";
import { DAY, HOUR, MAX_POP, TIME_SCALE } from "./constants";
import { ageYears, hourOf, isEvening, isNight } from "./clock";
import { STRUCTS, TECH_BY_ID } from "./data";
import { moraleOf, shiftMorale } from "./morale";
import { clamp } from "./noise";
import { chance, pick, range } from "./rng";
import {
  addResearch, assignHomes, campFire, chooseFocus, completeStructure, discover, foodTotal, forgetOnExtinction,
  available, houseCapacity, litFires, planGrave, projectNeed, storagePoint,
} from "./settlement";
import type { Terrain } from "./terrain";
import { EMOJI, josa, KID_TALK, thought } from "./text";
import type { Emotion, Gesture, Need, Person, Stock, Structure, WeatherType, WorldState } from "./types";
import { addFx, bump, chron, createPerson, deathless, dist, findById, knows, living, spawnCastaway } from "./world";

export interface Ctx {
  T: Terrain;
  hour: number;
  night: boolean;
  evening: boolean;
  temp: number;
  weather: WeatherType;
  fires: Structure[];
  campFire: Structure | null;
  pop: number;
  adults: number;
  food: number;
  foodDeficit: number;
  storage: { x: number; z: number };
  need: Stock;
  /** 한 스텝 안에서 재사용하는 계산 결과 */
  memo: Record<string, unknown>;
}

export function makeCtx(w: WorldState, T: Terrain): Ctx {
  const alive = living(w);
  const pop = alive.length;
  const adults = alive.filter((p) => ageYears(p.birth, w.time) >= 16).length;
  const food = foodTotal(w);
  const target = Math.max(6, pop * 8);
  return {
    T,
    hour: hourOf(w.time),
    night: isNight(w.time),
    evening: isEvening(w.time),
    temp: w.weather.temp,
    weather: w.weather.type,
    fires: litFires(w),
    campFire: campFire(w),
    pop,
    adults,
    food,
    foodDeficit: clamp((target - food) / target, 0, 1),
    storage: storagePoint(w),
    need: projectNeed(w),
    memo: {},
  };
}

export const age = (w: WorldState, p: Person) => ageYears(p.birth, w.time);
export const isAdult = (w: WorldState, p: Person) => age(w, p) >= 16;

// ─── 감정 / 말풍선 ─────────────────────────────────────────────────────

const GESTURE: Record<Emotion, Gesture[]> = {
  joy: ["cheer", "dance", "stretch"],
  sadness: ["slump"],
  fear: ["cower"],
  anger: ["stomp"],
  surprise: ["startle"],
  love: ["heart"],
};

export function lying(p: Person) {
  return !!p.act && p.act.ph === 1 && (p.act.k === "sleep" || p.act.k === "unconscious");
}

export function feel(w: WorldState, p: Person, e: Emotion, amt: number, gesture = true) {
  const before = p.emo[e];
  p.emo[e] = clamp(before + amt * (amt > 0 ? p.sens[e] : 1), 0, 1);
  if (gesture && amt > 0 && p.emo[e] - before > 0.25 && w.time > p.gestureUntil + 25 * TIME_SCALE && !lying(p)) {
    p.gesture = pick(w, GESTURE[e]);
    p.gestureUntil = w.time + range(w, 3.5, 5) * TIME_SCALE;
  }
}

export function dominant(p: Person): [Emotion | "calm", number] {
  let best: Emotion | "calm" = "calm";
  let v = 0.22;
  for (const e of Object.keys(p.emo) as Emotion[]) {
    if (p.emo[e] > v) {
      v = p.emo[e];
      best = e;
    }
  }
  return [best, v];
}

export function say(w: WorldState, p: Person, key: string, vars: Record<string, string> = {}, emoji?: string, force = false) {
  if (!force && w.time - p.lastThought < 20 * TIME_SCALE) return;
  // 세 살 전에는 말을 못 하고, 일곱 살 전에는 어른처럼 생각하지 못한다
  const yrs = ageYears(p.birth, w.time);
  let k = key;
  if (yrs < 3) k = key === "babyCry" ? key : "babyBabble";
  else if (yrs < 7 && !key.startsWith("kid")) k = KID_TALK[dominant(p)[0]] ?? "kidCalm";
  if (k !== key && k.startsWith("kid")) vars = { parent: "엄마", ...vars };
  const text = thought(w, k, vars);
  if (!text) return;
  p.bubble = { text, emoji: emoji ?? EMOJI[dominant(p)[0]] ?? "", until: w.time + 5.5 * TIME_SCALE };
  p.lastThought = w.time;
}

export function mood(p: Person) {
  const n = p.needs;
  const needs = (n.hunger + n.thirst + n.energy + n.warmth + n.social + n.fun) / 600;
  const e = p.emo;
  return clamp(
    (needs - 0.55) * 1.4 + e.joy * 0.5 + e.love * 0.25 - e.sadness * 0.5 - e.fear * 0.35 - e.anger * 0.35,
    -1, 1,
  );
}

// ─── 욕구 ──────────────────────────────────────────────────────────────

const OUTFIT_WARM = { rag: 0, fur: 28, cloth: 30, modern: 36 } as const;

export function homeOf(w: WorldState, p: Person) {
  return findById(w.structures, p.home);
}

export function sheltered(w: WorldState, p: Person) {
  const a = p.act;
  if (!a || a.ph !== 1) return false;
  if (a.k !== "sleep" && a.k !== "shelter" && a.k !== "rest" && a.k !== "isolate" && a.k !== "hide" && a.k !== "addict") return false;
  const h = a.k === "isolate"
    ? w.structures.find((s) => s.type === "infirmary" && s.prog >= 1)
    : homeOf(w, p) ?? (a.k === "rest" ? w.structures.find((s) => s.type === "infirmary" && s.prog >= 1) : undefined);
  return !!h && (h.dmg ?? 0) < 0.6 && dist(p.x, p.z, h.x, h.z) < STRUCTS[h.type].radius + 1.5;
}

export function nearFire(ctx: Ctx, x: number, z: number, r = 4.5) {
  for (const f of ctx.fires) if (dist(x, z, f.x, f.z) < r) return f;
  return null;
}

export function updateNeeds(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  // 기계의 몸은 먹지도 자지도 않는다
  if (p.robot) {
    for (const k of Object.keys(p.needs) as Need[]) p.needs[k] = 100;
    p.health = 100;
    return;
  }
  const h = dt / HOUR;
  const a = p.act;
  const asleep = !!a && a.ph === 1 && (a.k === "sleep" || a.k === "unconscious");
  const yrs = age(w, p);
  const kid = yrs < 12 ? 0.75 : 1;
  const n = p.needs;
  n.hunger -= h * (asleep ? 1.8 : 4.3) * kid;
  n.thirst -= h * (asleep ? 2.2 : 5.4) * (ctx.temp > 25 ? 1.3 : 1) * kid;
  if (!asleep) {
    const hard = a && (a.k === "gather" || a.k === "build" || a.k === "hunt" || a.k === "farm") ? 1.25 : 1;
    n.energy -= h * 4.9 * hard * (yrs > 65 ? 1.2 : 1);
  }
  const home = homeOf(w, p);
  const inside = sheltered(w, p);
  let target = ctx.temp >= 20 ? 100 : 100 - (20 - ctx.temp) * 4.2;
  target += OUTFIT_WARM[p.outfit];
  if (!inside && (ctx.weather === "rain" || ctx.weather === "storm")) target -= 15;
  if (!inside && ctx.weather === "snow") target -= 8;
  if (nearFire(ctx, p.x, p.z)) target += 50;
  if (inside) target += (25 + (home ? STRUCTS[home.type].tier ?? 1 : 1) * 5) * (1 - (home?.dmg ?? 0) * 0.6);
  target = clamp(target, 0, 100);
  n.warmth += (target - n.warmth) * (1 - Math.exp(-dt / (1.2 * HOUR)));
  n.social -= h * (0.8 + 2.4 * p.traits.extraversion) * (asleep ? 0.3 : 1);
  n.fun -= h * (asleep ? 0.4 : 1.8);
  if (!asleep) {
    for (const q of w.people) {
      if (q !== p && q.alive && !q.away && Math.abs(q.x - p.x) < 6 && Math.abs(q.z - p.z) < 6) {
        n.social += h * 1.2;
        break;
      }
    }
  }
  for (const k of Object.keys(n) as (keyof typeof n)[]) n[k] = clamp(n[k], 0, 100);

  // 건강 (앓는 동안에는 저절로 낫지 않는다)
  let dh = 0;
  if (n.hunger < 5) dh -= 4;
  if (n.thirst < 5) dh -= 8;
  if (n.warmth < 15) dh -= 3.5 * (1 - n.warmth / 15);
  if (n.hunger > 35 && n.thirst > 35 && n.warmth > 30 && (p.ill ?? 0) < 2) dh += (asleep ? 3 : 1.2) * (knows(w, "medicine") ? 1.8 : 1) * (p.wound ? 0.5 : 1);
  p.health = clamp(p.health + dh * h, 0, 100);
  // 상처가 아문다
  if (p.wound && w.time >= p.wound.until) {
    p.wound = null;
    say(w, p, "healed", {}, "😌");
  }
}

/** 다친다: 깊이 다칠수록 오래 가고, 의료가 나아질수록 빨리 낫는다 */
export function injure(w: WorldState, p: Person, dmg: number, by: string) {
  const sev: 1 | 2 = dmg >= 20 || p.health < 40 ? 2 : 1;
  const care = 1 - 0.15 * (w.civic?.lv.medical ?? 0) - (knows(w, "medicine") ? 0.15 : 0);
  const days = (sev === 2 ? range(w, 3, 4.5) : range(w, 1, 1.8)) * care;
  const cur = p.wound;
  p.wound = { sev: cur && cur.sev > sev ? cur.sev : sev, until: Math.max(cur?.until ?? 0, w.time + days * DAY), by: sev >= (cur?.sev ?? 0) ? by : cur!.by };
}

export const WOUND_NAME = ["", "가벼운 상처", "큰 상처"] as const;

export function updateEmotions(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  const N = p.traits.neuroticism;
  const e = p.emo;
  const decay = (k: Emotion, tau: number) => (e[k] *= Math.exp(-dt / tau));
  decay("joy", 3 * HOUR);
  decay("surprise", 0.8 * HOUR);
  decay("love", 8 * HOUR);
  decay("sadness", 3 * HOUR * (0.6 + N));
  decay("fear", 1.5 * HOUR * (0.6 + N));
  decay("anger", 2 * HOUR * (0.6 + N));
  const h = dt / HOUR;
  const n = p.needs;
  if (n.social < 25) e.sadness += 0.05 * h * p.sens.sadness;
  if (n.hunger < 15) e.anger += 0.03 * h * p.sens.anger;
  if (n.warmth < 25) e.sadness += 0.03 * h * p.sens.sadness;
  if (p.grief) {
    if (w.time > p.grief.until) p.grief = null;
    else e.sadness = Math.max(e.sadness, 0.45 * Math.min(1, (p.grief.until - w.time) / DAY));
  }
  if (ctx.weather === "storm" && !sheltered(w, p)) e.fear = Math.max(e.fear, 0.25 * p.sens.fear * (p.fears === "storm" ? 1.6 : 1));
  if (ctx.weather === "clear" && n.hunger > 50 && n.energy > 40) e.joy += 0.02 * h * p.sens.joy;
  // 마을의 사기가 마음에도 번진다
  const mo = moraleOf(w);
  if (mo < 40) e.sadness += ((40 - mo) / 40) * 0.05 * h * p.sens.sadness;
  else if (mo > 78) e.joy += ((mo - 78) / 22) * 0.03 * h * p.sens.joy;
  for (const k of Object.keys(e) as Emotion[]) e[k] = clamp(e[k], 0, 1);
}

// ─── 지각 ──────────────────────────────────────────────────────────────

export function perceive(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  if (lying(p)) return;
  const W = w.weather;
  if (p.seen.weather !== W.changedAt) {
    p.seen.weather = W.changedAt;
    const likes = p.likes.weather === W.type;
    if (W.type === "storm") {
      feel(w, p, "fear", p.fears === "storm" ? 0.6 : 0.35);
      say(w, p, "storm", {}, "⛈️", true);
    } else if (W.type === "rain") {
      if (likes) {
        feel(w, p, "joy", 0.25);
        say(w, p, "rainLike", {}, "🌧️");
      } else {
        feel(w, p, "sadness", 0.12, false);
        say(w, p, "rainDislike", {}, "🌧️");
      }
    } else if (W.type === "snow") {
      feel(w, p, "surprise", 0.3);
      if (likes) feel(w, p, "joy", 0.4);
      say(w, p, "snow", {}, "❄️");
    } else if (W.type === "clear" && (W.prev === "rain" || W.prev === "storm")) {
      feel(w, p, "joy", 0.18);
      say(w, p, "clear", {}, "☀️");
    }
  }

  // 불을 본다
  if (!knows(w, "fire")) {
    let fire: { x: number; z: number; id: number } | null = null;
    for (const f of ctx.fires) if (dist(p.x, p.z, f.x, f.z) < 14) fire = f;
    if (!fire) for (const t of w.plants) if (t.burn && dist(p.x, p.z, t.x, t.z) < 16) fire = t;
    if (fire) {
      addResearch(w, p, (dt / HOUR) * 40, "fire");
      const key = `f${fire.id}`;
      if (!p.seen[key]) {
        p.seen[key] = w.time;
        feel(w, p, "surprise", 0.5);
        feel(w, p, "fear", 0.15, false);
        say(w, p, "fireSeen", {}, "🔥", true);
        addResearch(w, p, 25, "fire");
      }
    }
  }

  // 선물(관찰자가 옮겨놓은 것)을 알아챈다
  const recent = w.time - 2 * HOUR;
  const notice = (id: number, x: number, z: number, gift: number) => {
    if (gift < recent || gift === 0) return;
    if (Math.abs(x - p.x) > 10 || Math.abs(z - p.z) > 10) return;
    const key = `g${id}`;
    if (p.seen[key]) return;
    p.seen[key] = w.time;
    feel(w, p, "surprise", 0.4);
    feel(w, p, "joy", 0.2, false);
    say(w, p, "gift", {}, "🎁", true);
    p.seen.reeval = 0;
  };
  for (const it of w.items) if (!it.held) notice(it.id, it.x, it.z, it.gift);
  for (const a of w.animals) if (!a.held) notice(a.id, a.x, a.z, a.gift);

  // 섬 바깥쪽의 광맥 지대를 알아본다
  if (!w.found.includes("vein") && ctx.T.inMine(p.x, p.z, 12)) {
    w.found.push("vein");
    feel(w, p, "surprise", 0.5);
    feel(w, p, "joy", 0.3, false);
    say(w, p, "foundVein", {}, "⛰️", true);
    addFx(w, "eureka", p.x, p.z, p.id);
    chron(w, "discover", `${josa(p.name, "이/가")} 섬 바깥쪽 바위 언덕에서 울긋불긋한 광석이 박힌 광맥 지대를 발견했다.`);
    addResearch(w, p, 30, "mining");
  }
}

// ─── 생과 사 ───────────────────────────────────────────────────────────

const CAUSE: Record<string, string> = {
  hunger: "굶주림",
  thirst: "목마름",
  cold: "추위",
  old: "노환",
  injury: "부상",
  ill: "병",
  beast: "맹수의 습격",
};

export function checkDeath(w: WorldState, T: Terrain, p: Person) {
  if (p.health > 0) return;
  const n = p.needs;
  const cause = n.thirst < 5 ? "thirst" : n.hunger < 5 ? "hunger" : n.warmth < 15 ? "cold" : (p.ill ?? 0) >= 2 ? "ill" : "injury";
  die(w, T, p, cause);
}

export function die(w: WorldState, T: Terrain, p: Person, cause: string) {
  // 로봇과 영원한 삶을 얻은 사람은 쓰러져도 다시 일어난다
  if (deathless(w, p)) {
    p.health = Math.max(p.health, 20);
    return;
  }
  p.alive = 0;
  p.died = w.time;
  p.cause = cause;
  p.act = null;
  p.anim = "lie";
  p.gesture = null;
  p.bubble = null;
  p.carry = null;
  p.ill = 0;
  p.role = null;
  const yrs = Math.floor(age(w, p));
  w.stats.deaths++;
  if (cause === "old") chron(w, "death", `${josa(p.name, "이/가")} 평화롭게 눈을 감았다. (향년 ${yrs}세)`);
  else chron(w, "death", `${josa(p.name, "이/가")} ${josa(CAUSE[cause] ?? cause, "으로/로")} 세상을 떠났다. (${yrs}세)`);
  shiftMorale(w, cause === "old" ? -2 : -6);
  const partner = findById(w.people, p.partner);
  if (partner) partner.partner = null;
  p.partner = null;
  const others = living(w);
  const abroad = w.people.some((q) => q.alive && q.away);
  for (const q of others) {
    const family = q.partner === p.id || q.parents.includes(p.id) || p.parents.includes(q.id);
    const g = Math.max(q.rel[p.id] ?? 0, family ? 0.85 : 0, others.length <= 3 ? 0.4 : 0);
    if (g > 0.1) {
      q.grief = { id: p.id, until: w.time + (1.5 + 4 * g) * DAY };
      feel(w, q, "sadness", 0.4 + 0.5 * g);
      say(w, q, "grief", { name: p.name }, "🕯️", true);
    }
  }
  if (others.length === 0 && !abroad) {
    const g = planGrave(w, T, p);
    g.prog = 1;
    g.paid = 1;
    forgetOnExtinction(w);
    chron(w, "misc", "섬에 아무도 남지 않았다. 파도 소리만이 남았다...");
    w.timers.castaway = w.time + range(w, 0.5, 1.5) * DAY;
  } else {
    planGrave(w, T, p);
  }
  bump(w);
}

/** 매일 한 번 */
/** 가족 말고 마음에 두는 사람 수 */
const REL_KEEP = 24;
/** 마지막으로 그 일을 겪은 시각만 담는 기억 */
const STALE = new Set(["reeval", "bst", "urgent", "night", "medAt", "nursed", "evac", "council", "mourn", "buildFail", "trade"]);

export function dailyPeople(w: WorldState, T: Terrain) {
  // 섬을 떠난(세상을 떠난) 사람과의 정과 거의 모르는 사이는 잊는다 (저장이 불어나지 않게)
  const ids = new Set(w.people.map((q) => String(q.id)));
  for (const q of w.people) for (const [k, v] of Object.entries(q.rel)) if (!ids.has(k) || Math.abs(v) < 0.02) delete q.rel[k];
  // 사람이 많아지면 가족 말고는 가장 가까운 이들만 마음에 둔다
  for (const q of w.people) {
    const list = Object.entries(q.rel);
    if (list.length <= REL_KEEP) continue;
    const fam = new Set([...q.parents, ...(q.partner != null ? [q.partner] : [])].map(String));
    for (const c of w.people) if (c.parents.includes(q.id)) fam.add(String(c.id));
    list.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    let n = 0;
    for (const [k] of list) if (!fam.has(k) && n++ >= REL_KEEP) delete q.rel[k];
  }
  const alive = living(w);
  // 노환
  for (const p of alive) {
    const yrs = age(w, p);
    if (yrs > 60 && chance(w, 0.0006 * Math.pow(yrs - 60, 1.8))) die(w, T, p, "old");
  }
  const now = living(w);
  const adults = now.filter((p) => isAdult(w, p));

  // 짝
  for (const a of adults) {
    if (a.partner != null || age(w, a) > 55 || a.robot) continue;
    for (const b of adults) {
      if (b === a || b.sex === a.sex || b.partner != null || age(w, b) > 55 || b.robot) continue;
      if (a.parents.some((x) => b.parents.includes(x))) continue;
      if (a.parents.includes(b.id) || b.parents.includes(a.id)) continue;
      if ((a.rel[b.id] ?? 0) > 0.55 && (b.rel[a.id] ?? 0) > 0.55) {
        a.partner = b.id;
        b.partner = a.id;
        feel(w, a, "love", 0.6);
        feel(w, b, "love", 0.6);
        say(w, a, "love", { name: b.name }, "💕", true);
        chron(w, "couple", `${josa(a.name, "과/와")} ${josa(b.name, "이/가")} 서로를 아끼는 사이가 되었다.`);
        if (b.home != null) a.home = b.home;
        else if (a.home != null) b.home = a.home;
        break;
      }
    }
  }

  // 임신
  const food = foodTotal(w);
  const cap = houseCapacity(w);
  // 사람들이 기계의 몸을 얻는 동안에는 아이를 갖지 않는다
  const machines = w.ending?.kind === "robot";
  for (const f of adults) {
    if (f.sex !== "F" || f.preg || f.partner == null || f.robot || machines) continue;
    const m = findById(w.people, f.partner);
    if (!m || !m.alive || m.robot) continue;
    const yrs = age(w, f);
    if (yrs < 18 || yrs > 42) continue;
    if (w.people.filter((q) => q.alive).length >= MAX_POP) continue;
    if (food < now.length * 3 || cap < now.length - 1) continue;
    const kids = now.filter((k) => k.parents.includes(f.id));
    if (kids.some((k) => age(w, k) < 1.5)) continue;
    if (kids.length >= 4) continue;
    if (chance(w, 0.12 * (mood(f) > -0.2 ? 1 : 0.3))) {
      f.preg = w.time + 6 * DAY;
      f.pregBy = m.id;
      feel(w, f, "joy", 0.5);
      feel(w, m, "joy", 0.5);
      chron(w, "misc", `${josa(f.name, "과/와")} ${m.name}에게 기쁜 소식이 생겼다.`);
    }
  }

  // 표류자
  const settled = cap > 0 && knows(w, "fire");
  const abroad = w.people.some((q) => q.alive && q.away);
  if (now.length === 0 && abroad) {
    // 바다 건너 나간 사람들이 돌아오기를 기다린다
  } else if (now.length === 0 && w.time >= w.timers.castaway) {
    arrive(w, T, true);
  } else if (now.length > 0) {
    // 표류 · 이주 가족 · 피난 · 탐험대 · 상인 · 순례 · 차원문 (한 번에 최대 10명)
    dailyArrivals(w, T, settled);
  }

  // 오래된 기억 정리 (지난 일의 시각은 사흘이 지나면 없던 일과 같다)
  for (const p of now) {
    for (const k of Object.keys(p.seen)) {
      if ((k.startsWith("g") || k.startsWith("f")) && w.time - p.seen[k] > DAY) delete p.seen[k];
      else if (STALE.has(k) && p.seen[k] > 0 && w.time - p.seen[k] > 3 * DAY) delete p.seen[k];
    }
  }
  assignHomes(w);
  chooseFocus(w);
}

export function hourlyPeople(w: WorldState) {
  // 출산
  for (const f of w.people) {
    if (!f.alive || f.away || !f.preg || w.time < f.preg) continue;
    const father = findById(w.people, f.pregBy);
    f.preg = 0;
    const parents = father ? [f, father] : [f];
    const baby = createPerson(w, { x: f.x + 0.6, z: f.z, age: 0, parents: parents.length === 2 ? parents : undefined });
    baby.parents = parents.map((q) => q.id);
    baby.home = f.home;
    baby.needs = { hunger: 90, thirst: 90, energy: 90, warmth: 90, social: 90, fun: 80 };
    baby.health = 100;
    baby.outfit = f.outfit;
    baby.group = f.group ?? null;
    for (const q of parents) {
      baby.rel[q.id] = 0.8;
      q.rel[baby.id] = 0.9;
      feel(w, q, "love", 0.7);
      feel(w, q, "joy", 0.6);
      say(w, q, "birth", {}, "👶", true);
    }
    for (const q of living(w)) {
      if (q !== baby && !parents.includes(q)) feel(w, q, "joy", 0.25, false);
    }
    w.people.push(baby);
    w.stats.births++;
    shiftMorale(w, 3);
    addFx(w, "birth", f.x, f.z, baby.id);
    const parentsLabel = father ? `${josa(f.name, "과/와")} ${father.name}` : f.name;
    chron(w, "birth", `${parentsLabel}의 아이 '${baby.name}'${josa(baby.name, "이/가").slice(baby.name.length)} 태어났다.`);
    bump(w);
  }
  // 시신 정리 (반나절 뒤)
  const before = w.people.length;
  w.people = w.people.filter((p) => p.alive || w.time - p.died < 0.5 * DAY);
  if (w.people.length !== before) bump(w);
  // 무덤: 아무도 묻어주지 못하면 하루 뒤 자연스럽게 흙더미가 된다
  for (const s of w.structures) {
    if (s.type === "grave" && s.prog < 1 && w.time - s.t > DAY) completeStructure(w, s, null);
  }
  w.stats.maxPop = Math.max(w.stats.maxPop, living(w).length);
}

function arrive(w: WorldState, T: Terrain, afterExtinction: boolean) {
  const yrs = range(w, 18, 38);
  const { person } = spawnCastaway(w, T, yrs);
  person.act = { k: "unconscious", ph: 1, tx: person.x, tz: person.z, t: range(w, 0.6, 1.4) * HOUR, started: w.time };
  person.anim = "lie";
  w.people.push(person);
  w.stats.arrivals++;
  addFx(w, "arrive", person.x, person.z, person.id);
  if (afterExtinction) {
    w.stats.generation++;
    chron(w, "arrive", `새로운 표류자 ${josa(person.name, "이/가")} 섬에 닿았다. 누군가 남긴 흔적이 보인다.`);
    // 집과 불자리를 물려받는다
    w.timers.castaway = w.time + range(w, 5 / 1.5, 10 / 1.5) * DAY;
  } else {
    chron(w, "arrive", `새로운 표류자 ${josa(person.name, "이/가")} 해변으로 떠밀려 왔다.`);
    w.timers.castaway = nextArrival(w);
    for (const q of living(w)) {
      if (q === person) continue;
      feel(w, q, "surprise", 0.5);
      if (q.traits.extraversion > 0.4) feel(w, q, "joy", 0.35);
      else feel(w, q, "fear", 0.2, false);
      q.rel[person.id] = 0.1;
      person.rel[q.id] = 0.15;
    }
  }
  // 새로운 지식을 가지고 오기도 한다
  if (chance(w, 0.3)) {
    const era = w.tech.known.reduce((e, id) => Math.max(e, TECH_BY_ID[id]?.era ?? 0), 0);
    const av = available(w).filter((t) => t.era <= Math.min(2, era));
    if (av.length) {
      const t = pick(w, av);
      discover(w, person, t.id, `${josa(person.name, "은/는")} 고향에서 '${t.name}'에 대해 알고 있었다.`);
    }
  }
  bump(w);
}
