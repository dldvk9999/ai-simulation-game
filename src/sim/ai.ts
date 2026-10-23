// 규칙 기반 Utility AI: 욕구·감정·성격·마을 상황을 점수로 바꿔 가장 높은 행동을 고른다.
import { act, spot } from "./acts";
import { DAY, HOUR, MIN, WALK_SPEED } from "./constants";
import { seasonOf } from "./clock";
import {
  active, BEAST_INFO, pickWeapon, safeFromBeast, shelterOk, strike, STRIKE_EVERY, teamPower, threatFor, TOWER, towerRange, weaponOf,
} from "./beasts";
import { finishDesign } from "./building";
import {
  assistFinish, assistWork, babyDecide, babyTick, careArrive, careCands, careFinish, careWork, CHILD_AGE, fussFinish, kidCands, THINK_AGE,
} from "./childcare";
import { FISH_INFO, FOOD, LUCKY, METAL_INFO, RECIPES, Recipe, RES_NAME, STRUCTS, TECH_BY_ID } from "./data";
import { shiftMorale } from "./morale";
import { countermeasure, damaged, floodPeak, repairCost, tsunamiThreat } from "./disaster";
import { discoverIngredient, giveMed, illOf, infect, infirmary, isolated, medForP } from "./disease";
import { isTree } from "./ecology";
import { douseArrive, douseFinish, dousePlan, dousersOf, fireEdge, fireToFight, fleePlan, threatens } from "./fire";
import { blessed, riteCand, riteFinish, riteStart } from "./religion";
import { payWage, tradeArrive, tradeCand, tradeFinish } from "./economy";
import { atWar, musterCand } from "./nation";
import { clamp } from "./noise";
import {
  age, Ctx, dominant, feel, homeOf, isAdult, lying, mood, nearFire, say,
} from "./people";
import { chance, int, rand, range } from "./rng";
import {
  addResearch, assignHomes, blockedByFound, buildMul, carryCap, completeStructure, houseCapacity, isHouse, projects, toolMul,
} from "./settlement";
import { campOf, easeWar, enemies, socialize, warOf } from "./society";
import { josa } from "./text";
import type { Act, ActKind, Anim, Animal, Beast, Metal, Person, Plant, Res, Role, Stock, Structure, WorldState } from "./types";
import { boardPoint, voyageOf } from "./voyage";
import {
  addFx, addStock, bump, chron, dist, findById, hasStock, knows, makePlant, makeStructure, nearest, onIsland,
  payStock, removeById, stockOf,
} from "./world";

type Cand = { tag: string; s: number; mk: () => Act | null };

const urg = (v: number, th: number) => clamp((th - v) / th, 0, 1);


// 맡은 역할의 일은 더 능숙하게, 앓는 동안에는 힘에 부친다
const ROLE_SKILL: Partial<Record<string, Role>> = {
  farm: "farmer", fish: "fisher", hunt: "hunter", build: "builder", think: "scholar", craft: "crafter", heal: "healer", cook: "cook",
};
const ILL_WORK = [1, 0.9, 0.75, 0.55, 0.4, 0.3];
const skill = (p: Person, k: string) =>
  (1 + (p.skills[k] ?? 0) * 0.6) * (p.role && ROLE_SKILL[k] === p.role ? 1.25 : 1) * ILL_WORK[illOf(p)];

/** 역할마다 더 먼저 하게 되는 일 */
const ROLE_TAGS: Record<Role, string[]> = {
  leader: ["council", "chat", "think"],
  farmer: ["farm", "tame"],
  fisher: ["fish"],
  hunter: ["hunt", "catch", "defend"],
  builder: ["build", "repair", "design", "gather:wood", "gather:stone"],
  scholar: ["think", "design"],
  crafter: ["craft", "gather:iron", "gather:copper", "gather:tin"],
  healer: ["nurse", "dig", "gather:herb", "craft:herbal", "craft:remedy", "craft:medicine"],
  cook: ["cook", "tend", "makefire"],
  sailor: ["fish", "board"],
  guard: ["fight", "defend", "muster"],
  king: ["council", "chat"],
  minister: ["council", "think", "trade"],
};
const roleBoost = (p: Person, tag: string) =>
  p.role && ROLE_TAGS[p.role].some((t) => tag === t || tag.startsWith(t + ":")) ? 0.22 : 0;

/** 많이 아플 때 할 수 있는 일 */
const SICK_OK = new Set(["eat", "drink", "sleep", "rest", "isolate", "medicate", "deposit", "shelter", "warm", "evacuate", "hide", "carried", "fuss", "flee"]);

/** 이 사람의 터에 있는 모닥불 (갈라져 나간 무리는 자기 불) */
function fireFor(w: WorldState, ctx: Ctx, p: Person) {
  const c = campOf(w, p);
  if (c === w.camp) return ctx.campFire;
  return nearest(w.structures, c.x, c.z, (s) => s.type === "campfire", 9);
}
function practice(p: Person, k: string) {
  p.skills[k] = Math.min(1, (p.skills[k] ?? 0) + 0.012);
}

function wearTool(w: WorldState, p: Person, tool: Res) {
  if (stockOf(w, tool) < 1) return;
  const pBreak = knows(w, "iron") ? 0.006 : knows(w, "polished") ? 0.015 : 0.03;
  if (chance(w, pBreak)) {
    addStock(w, tool, -1);
    feel(w, p, "anger", 0.15, false);
    say(w, p, "toolBreak", {}, "💢");
  }
}

const SOFT: ActKind[] = ["idle", "wander", "leisure", "think", "explore", "play", "follow", "chat", "warm", "mourn"];
const NEED_ACTS: ActKind[] = ["eat", "drink", "sleep", "warm", "shelter", "forage", "collect", "unconscious", "makefire", "hide", "defend", "carried", "douse", "flee"];

function abort(p: Person) {
  p.act = null;
}

// ─── 실행 ──────────────────────────────────────────────────────────────

export function runPerson(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  const a0 = p.act;
  const D = w.disaster;
  if (a0 && D?.type === "tsunami" && a0.k !== "evacuate" && a0.k !== "unconscious" && p.seen.evac !== D.start && tsunamiThreat(w, p.traits.openness)) {
    p.seen.evac = D.start;
    abort(p);
  }
  const lv = illOf(p);
  if (p.act && lv >= 3 && !SICK_OK.has(p.act.k) && p.act.k !== "unconscious" && p.seen.illAbort !== lv) {
    p.seen.illAbort = lv;
    abort(p);
  }
  if (a0 && p.act && a0.k !== "unconscious") {
    if (ctx.weather === "storm" && a0.k !== "shelter" && a0.k !== "sleep" && a0.k !== "carried" && a0.k !== "douse" && p.seen.storm !== w.weather.changedAt) {
      p.seen.storm = w.weather.changedAt;
      abort(p);
    } else if (p.seen.reeval === 0) {
      p.seen.reeval = w.time;
      if (!NEED_ACTS.includes(a0.k)) abort(p);
    } else if (
      (p.needs.thirst < 15 || p.needs.hunger < 12 || p.needs.warmth < 20 || p.needs.energy < 8) &&
      !NEED_ACTS.includes(a0.k) && w.time - (p.seen.urgent ?? 0) > HOUR
    ) {
      p.seen.urgent = w.time;
      abort(p);
    } else if (ctx.night && SOFT.includes(a0.k) && a0.k !== "chat" && p.needs.energy < 60 && w.time - (p.seen.night ?? 0) > HOUR) {
      p.seen.night = w.time;
      abort(p);
    }
  }

  if (age(w, p) < 3) babyTick(w, ctx, p);

  let budget = dt;
  for (let guard = 0; budget > 1e-6 && guard < 14 && p.alive; guard++) {
    const now = w.time - budget;
    if (p.gesture) {
      if (p.gestureUntil > now && !lying(p)) {
        const wait = Math.min(budget, p.gestureUntil - now);
        budget -= wait;
        p.anim = p.gesture as Anim;
        continue;
      }
      p.gesture = null;
    }
    if (!p.act) {
      p.act = decide(w, ctx, p);
      start(w, ctx, p, p.act);
      if (!p.act) break;
    }
    const a = p.act;
    if (a.ph === 0 || a.ph === 2) {
      if (!track(w, p, a)) continue;
      const sp = speedOf(w, p, a);
      const d = dist(p.x, p.z, a.tx, a.tz);
      if (d < 0.05) {
        arrive(w, ctx, p, a);
        continue;
      }
      p.rot = Math.atan2(a.tz - p.z, a.tx - p.x);
      const need = d / sp;
      if (need <= budget) {
        p.x = a.tx;
        p.z = a.tz;
        budget -= need;
        arrive(w, ctx, p, a);
      } else {
        const f = (sp * budget) / d;
        p.x += (a.tx - p.x) * f;
        p.z += (a.tz - p.z) * f;
        budget = 0;
        p.anim = a.k === "douse" && a.ph === 2 ? "bucket" : a.sub === "crawl" ? "crawl" : a.run ? "run" : p.carry ? "carry" : "walk";
      }
    } else {
      const wdt = Math.min(budget, a.t);
      work(w, ctx, p, a, wdt);
      if (p.act !== a) continue;
      a.t -= wdt;
      budget -= wdt;
      p.anim = animFor(a);
      if (a.t <= 1e-6) finish(w, ctx, p, a);
    }
  }
}

function speedOf(w: WorldState, p: Person, a: Act) {
  let s = WALK_SPEED;
  if (a.run) s *= 1.7;
  const yrs = age(w, p);
  if (yrs < 3) s *= 0.3;
  else if (yrs < 8) s *= 0.75;
  if (yrs > 65) s *= 0.75;
  const lv = illOf(p);
  if (lv) s *= [1, 0.95, 0.85, 0.7, 0.6, 0.5][lv];
  if (p.needs.energy < 20) s *= 0.8;
  if (p.emo.sadness > 0.5) s *= 0.85;
  if (p.emo.joy > 0.6) s *= 1.08;
  return s;
}

/** 움직이는 대상을 쫓는다. false면 행동이 끝났다. */
function track(w: WorldState, p: Person, a: Act) {
  if (a.ph === 0 && (a.k === "hunt" || a.k === "tame") && a.tid != null) {
    const an = findById(w.animals, a.tid);
    if (!an || an.held || (a.k === "tame" && an.tame)) {
      abort(p);
      return false;
    }
    a.tx = an.x;
    a.tz = an.z;
    if (w.time - a.started > 1.2 * HOUR) {
      feel(w, p, "anger", 0.12, false);
      say(w, p, "fail", {}, "💨");
      abort(p);
      return false;
    }
    if (dist(p.x, p.z, an.x, an.z) < 1.4) {
      arrive(w, null, p, a);
      return false;
    }
  }
  if (a.ph === 0 && (a.k === "follow" || a.k === "chat" || a.k === "nurse" || a.k === "fight" || (a.k === "trade" && a.sub === "buy")) && a.tid != null) {
    const q = findById(w.people, a.tid);
    if (!q || !onIsland(q)) {
      abort(p);
      return false;
    }
    if (a.k === "follow" || a.k === "nurse" || a.k === "fight" || a.k === "trade") {
      const s = spot(p, q.x, q.z, a.k === "fight" ? 0.9 : 1.2);
      a.tx = s.x;
      a.tz = s.z;
    }
    if (a.k === "fight" && w.time - a.started > 0.8 * HOUR) {
      abort(p);
      return false;
    }
  }
  if (a.ph === 0 && a.k === "defend" && a.tid != null) {
    const b = findById(w.beasts, a.tid);
    if (!b || !active(b) || w.time - a.started > 2 * HOUR) {
      abort(p);
      return false;
    }
    if (a.sub !== "tower") {
      const r = weaponOf(a.sub).range;
      const d = dist(p.x, p.z, b.x, b.z);
      if (d <= r && (r < 3 || d >= r * 0.45)) {
        arrive(w, null, p, a);
        return false;
      }
      const st = standoff(p, b, r);
      a.tx = st.x;
      a.tz = st.z;
    }
  }
  if ((a.k === "fuss" || a.k === "care") && a.ph === 0 && a.tid != null) {
    const q = findById(w.people, a.tid);
    if (!q || !onIsland(q) || !q.alive) {
      abort(p);
      return false;
    }
    // 이미 품에 안고 있는 아기면 그 자리에서
    if (a.k === "care" && q.act?.k === "carried" && q.act.tid === p.id) {
      arrive(w, null, p, a);
      return false;
    }
    const s = spot(p, q.x, q.z, 0.8);
    a.tx = s.x;
    a.tz = s.z;
  }
  if (a.k === "assist" && a.ph === 0) {
    const q = findById(w.people, a.tid);
    if (!q?.act) {
      abort(p);
      return false;
    }
    const s = spot(p, q.act.tx, q.act.tz, 1.3);
    a.tx = s.x;
    a.tz = s.z;
  }
  if (a.k === "douse") {
    const b = w.blazes.find((x) => x.id === a.tid);
    if (!b) {
      abort(p);
      return false;
    }
    if (a.ph === 2) {
      const e = fireEdge(b, p);
      a.tx = e.x;
      a.tz = e.z;
    }
  }
  if (a.ph === 0 && a.k === "collect" && a.tid != null) {
    const it = findById(w.items, a.tid);
    if (!it || it.held) {
      abort(p);
      return false;
    }
    a.tx = it.x;
    a.tz = it.z;
  }
  return true;
}

function animFor(a: Act): Anim {
  switch (a.k) {
    case "sleep": return "sleep";
    case "unconscious": return "lie";
    case "eat": return "eat";
    case "drink": return "drink";
    case "forage": case "collect": case "tend": case "tame": return "pick";
    case "gather":
      return a.res === "wood" ? "chop" : a.res && METAL_INFO[a.res as Metal] ? "mine" : a.res === "stone" || a.res === "ore" ? "knap" : a.res === "clay" ? "dig" : "pick";
    case "craft": return "knap";
    case "makefire": return "knap";
    case "build": return "hammer";
    case "think": return a.sub === "stars" ? "lie" : "think";
    case "hunt": return "throw";
    case "fish": return a.sub === "hand" ? "pick" : "fish";
    case "cook": return "stir";
    case "chat": return "talk";
    case "farm": return "dig";
    case "shelter": case "warm": return "sit";
    case "mourn": return "pray";
    case "play": return "play";
    case "leisure":
      return a.sub === "sing" ? "sing" : a.sub === "stars" ? "lie" : a.sub === "draw" ? "dig" : a.sub === "swim" ? "swim" : a.sub === "dance" ? "dance" : "sit";
    case "idle": return a.sub === "sit" || a.sub === "crawl" ? "sit" : "idle";
    case "rest": case "isolate": return "lie";
    case "nurse": return "pick";
    case "medicate": return "drink";
    case "dig": return "dig";
    case "council": return "talk";
    case "repair": return "hammer";
    case "fight": return "fight";
    case "board": return "wave";
    case "evacuate": return "cower";
    case "defend": return a.sub === "tower" || weaponOf(a.sub).range > 3 ? "aim" : "slash";
    case "hide": return "cower";
    case "design": return "think";
    case "rite": return "pray";
    case "trade": return "talk";
    case "muster": return weaponOf(a.sub).range > 3 ? "aim" : "slash";
    case "carried": return "held";
    case "douse": return a.sub === "scoop" ? "scoop" : a.sub === "throw" ? "douse" : "bucket";
    case "flee": return "startle";
    case "assist": return "pick";
    case "fuss":
      switch (a.sub) {
        case "cry": return "cry";
        case "tantrum": return "tantrum";
        case "cling": case "hug": return "hug";
        case "fed": return "eat";
        case "scolded": return "slump";
        case "lull": return "lie";
        case "play": return "play";
        default: return "beg";
      }
    case "care":
      return a.sub === "scold" ? "scold" : a.sub === "play" ? "play" : a.sub === "lull" ? "sing" : "hug";
    default: return "idle";
  }
}

// ─── 시작 / 도착 / 작업 / 완료 ─────────────────────────────────────────

function start(w: WorldState, ctx: Ctx, p: Person, a: Act | null) {
  if (!a) return;
  const r = rand(w);
  if (r > 0.35) return;
  const n = p.needs;
  switch (a.k) {
    case "eat": if (n.hunger < 25) say(w, p, n.hunger < 10 ? "starving" : "hungry", {}, "🍖"); break;
    case "drink": say(w, p, a.sub === "rain" ? "rainDrink" : "thirsty", {}, "💧"); break;
    case "sleep": if (n.energy < 40) say(w, p, "tired", {}, "💤"); break;
    case "warm": say(w, p, "cold", {}, "🥶"); break;
    case "gather": say(w, p, a.res === "wood" ? "chop" : "gather"); break;
    case "hunt": say(w, p, "hunt", {}, "🏹"); break;
    case "fish": say(w, p, "fish", {}, "🎣"); break;
    case "build": say(w, p, "build", {}, "🔨"); break;
    case "think": say(w, p, a.sub === "stars" ? "stars" : "think", {}, a.sub === "stars" ? "✨" : "🤔"); break;
    case "farm": say(w, p, "farm", {}, "🌱"); break;
    case "craft": say(w, p, "craft", {}, "🪨"); break;
    case "cook": say(w, p, "cook", {}, "🍳"); break;
    case "leisure":
      if (a.sub === "sea") say(w, p, ctx.evening ? "sunset" : "sea", {}, "🌊");
      else if (a.sub === "stars") say(w, p, "stars", {}, "✨");
      else if (a.sub === "sing") say(w, p, "happy", {}, "🎵");
      break;
    case "play": say(w, p, "play", {}, "🤸"); break;
    case "rest": say(w, p, "fever", {}, "🤒"); break;
    case "isolate": say(w, p, "isolate", {}, "🏕️", true); break;
    case "nurse": say(w, p, "nurse", {}, "🩹"); break;
    case "dig": say(w, p, "dig", {}, "⛏️"); break;
    case "repair": say(w, p, "repair", {}, "🔨"); break;
    case "fight": say(w, p, "fight", {}, "💢"); break;
    case "evacuate": say(w, p, "tsunami", {}, "🌊", true); break;
    case "defend": say(w, p, "defend", {}, a.sub === "tower" ? "🏹" : "⚔️", true); break;
    case "hide": say(w, p, "hide", {}, "🫣", true); break;
    case "design": say(w, p, "design", {}, "📐"); break;
    case "douse": say(w, p, "douse", {}, "🪣", true); break;
    case "rite": riteStart(w, p, a); break;
    case "flee": say(w, p, "fireHot", {}, "🔥", true); break;
    case "mourn": {
      const dead = findById(w.people, p.grief?.id);
      if (dead) say(w, p, "mourn", {}, "🕯️");
      break;
    }
  }
}

function arrive(w: WorldState, ctx: Ctx | null, p: Person, a: Act) {
  if (a.k === "douse") {
    if (!douseArrive(w, p, a)) abort(p);
    return;
  }
  if (a.k === "care") {
    a.ph = 1;
    if (!careArrive(w, p, a)) abort(p);
    return;
  }
  if (a.ph === 2) {
    if (a.k === "tame") settleTame(w, p, a);
    else deposit(w, p);
    abort(p);
    return;
  }
  a.ph = 1;
  switch (a.k) {
    case "forage": {
      if (a.tid != null) {
        const pl = findById(w.plants, a.tid);
        if (!pl || pl.fruit < 1 || pl.stump) return abort(p);
      }
      break;
    }
    case "gather": {
      if (a.tid != null && a.sub !== "item") {
        const pl = findById(w.plants, a.tid);
        const rk = pl ? undefined : findById(w.rocks, a.tid);
        if (!pl && !rk) return abort(p);
        if (pl && (pl.stump || pl.burn)) return abort(p);
        if (rk && rk.amt < 1) return abort(p);
        if (pl) p.rot = Math.atan2(pl.z - p.z, pl.x - p.x);
        if (rk) p.rot = Math.atan2(rk.z - p.z, rk.x - p.x);
      }
      break;
    }
    case "build": {
      const s = findById(w.structures, a.tid);
      if (!s || s.prog >= 1) return abort(p);
      if (!s.paid) {
        if (!payStock(w, STRUCTS[s.type].cost)) {
          p.seen.buildFail = w.time;
          return abort(p);
        }
        s.paid = 1;
      }
      p.rot = Math.atan2(s.z - p.z, s.x - p.x);
      break;
    }
    case "hunt": case "tame": {
      const an = findById(w.animals, a.tid);
      if (!an) return abort(p);
      p.rot = Math.atan2(an.z - p.z, an.x - p.x);
      break;
    }
    case "chat": {
      const q = findById(w.people, a.tid);
      if (q) p.rot = Math.atan2(q.z - p.z, q.x - p.x);
      break;
    }
    case "tend": case "cook": case "warm": {
      const f = findById(w.structures, a.tid);
      if (!f || (a.k !== "tend" && !f.lit)) return abort(p);
      p.rot = Math.atan2(f.z - p.z, f.x - p.x);
      break;
    }
    case "collect": {
      const it = findById(w.items, a.tid);
      if (!it || it.held) return abort(p);
      break;
    }
    case "fish": case "leisure": {
      if (a.n != null) p.rot = a.n;
      break;
    }
    case "repair": {
      const st = findById(w.structures, a.tid);
      if (!st || !st.dmg) return abort(p);
      if (!st.fix) {
        if (!payStock(w, repairCost(st))) return abort(p);
        st.fix = 1;
      }
      p.rot = Math.atan2(st.z - p.z, st.x - p.x);
      break;
    }
    case "nurse": {
      const q = findById(w.people, a.tid);
      if (!q || !illOf(q)) return abort(p);
      p.rot = Math.atan2(q.z - p.z, q.x - p.x);
      break;
    }
    case "defend": {
      const b = findById(w.beasts, a.tid);
      if (!b || !active(b)) return abort(p);
      if (a.sub === "tower") {
        const t = findById(w.structures, a.n);
        if (!t || t.prog < 1 || (t.dmg ?? 0) >= 0.6) return abort(p);
      }
      p.rot = Math.atan2(b.z - p.z, b.x - p.x);
      break;
    }
    case "design": {
      const st = findById(w.structures, a.tid);
      if (!st || st.plan !== 0) return abort(p);
      p.rot = Math.atan2(st.z - p.z, st.x - p.x);
      break;
    }
    case "trade": {
      if (!tradeArrive(w, p, a)) return abort(p);
      break;
    }
    case "fuss": case "assist": case "follow": {
      const q = findById(w.people, a.tid);
      if (q) p.rot = Math.atan2(q.z - p.z, q.x - p.x);
      break;
    }
    case "fight": {
      const q = findById(w.people, a.tid);
      if (!q || !onIsland(q) || lying(q)) return abort(p);
      p.rot = Math.atan2(q.z - p.z, q.x - p.x);
      // 상대도 맞선다
      if (q.act?.k !== "fight") {
        q.act = act(w, "fight", q.x, q.z, a.t, { tid: p.id, ph: 1 });
        q.rot = Math.atan2(p.z - q.z, p.x - q.x);
        q.gesture = null;
      }
      break;
    }
  }
  void ctx;
}

function work(w: WorldState, ctx: Ctx, p: Person, a: Act, dt: number) {
  const h = dt / HOUR;
  const n = p.needs;
  switch (a.k) {
    case "sleep": {
      const home = homeOf(w, p);
      const inside = !!home && dist(p.x, p.z, home.x, home.z) < STRUCTS[home.type].radius + 1.5;
      const wetOut = !inside && (ctx.weather === "rain" || ctx.weather === "storm");
      n.energy = Math.min(100, n.energy + h * (inside ? 14.5 : 11) * (wetOut ? 0.6 : 1));
      const wake = (n.energy >= 99 && !ctx.night) || (ctx.hour >= 6 && ctx.hour < 20 && n.energy >= 82) || n.hunger < 8 || n.thirst < 8;
      if (wake) {
        a.t = 0;
        if (ctx.hour >= 5 && ctx.hour < 10) {
          feel(w, p, "joy", ctx.weather === "clear" ? 0.12 : 0.04, false);
          if (chance(w, 0.4)) say(w, p, inside ? "morning" : "sleepOut", {}, "🌅");
        }
      }
      break;
    }
    case "unconscious":
      n.energy = Math.min(100, n.energy + h * 6);
      break;
    case "chat":
      n.social = Math.min(100, n.social + h * 50);
      n.fun = Math.min(100, n.fun + h * 14);
      break;
    case "leisure":
      n.fun = Math.min(100, n.fun + h * 30);
      p.emo.joy = Math.min(1, p.emo.joy + h * 0.08);
      if (a.sub === "stars") addResearch(w, p, h * 10, "astronomy");
      break;
    case "play":
      n.fun = Math.min(100, n.fun + h * 45);
      n.social = Math.min(100, n.social + h * 20);
      break;
    case "warm":
      n.fun = Math.min(100, n.fun + h * 6);
      break;
    case "think": {
      const lib = a.sub === "study";
      const fire = nearFire(ctx, p.x, p.z);
      addResearch(w, p, h * 60 * (0.55 + p.traits.openness) * skill(p, "think") * (lib ? 1.25 : 1) * (fire && ctx.evening ? 1.1 : 1));
      if (a.sub === "stars") addResearch(w, p, h * 25, "astronomy");
      n.fun = Math.min(100, n.fun + h * 8);
      break;
    }
    case "mourn":
      if (p.grief) p.grief.until -= dt * 0.6;
      break;
    case "rest": case "isolate":
      n.energy = Math.min(100, n.energy + h * 9);
      if ((a.k === "rest" && illOf(p) < 2 && n.energy > 70) || (a.k === "isolate" && illOf(p) < 5)) a.t = Math.min(a.t, 5 * MIN);
      break;
    case "council":
      n.social = Math.min(100, n.social + h * 30);
      break;
    case "repair": {
      const st = findById(w.structures, a.tid);
      if (!st || !st.dmg) {
        a.t = 0;
        break;
      }
      st.dmg = Math.max(0, st.dmg - (dt / (Math.max(0.5, STRUCTS[st.type].work * 0.6) * HOUR)) * skill(p, "build") * buildMul(w));
      if (st.dmg <= 0) {
        st.dmg = 0;
        st.fix = 0;
        if (isHouse(st.type)) assignHomes(w);
        feel(w, p, "joy", 0.3);
        say(w, p, "repaired", {}, "🏠", true);
        addFx(w, "complete", st.x, st.z, st.id);
        bump(w);
        a.t = 0;
      }
      break;
    }
    case "shelter":
      if (ctx.weather !== "storm" && ctx.weather !== "snow" && a.t > 10 * MIN) a.t = Math.min(a.t, 10 * MIN);
      break;
    case "hide":
      // 맹수가 물러갈 때까지
      if (!threatFor(w, p)) a.t = Math.min(a.t, 2 * MIN);
      n.energy = Math.min(100, n.energy + h * 3);
      break;
    case "care":
      careWork(w, p, a, dt);
      break;
    case "carried":
      // 품에 안겨 꾸벅꾸벅 졸고, 엄마 체온에 따뜻하다
      n.energy = Math.min(100, n.energy + h * 9);
      n.social = Math.min(100, n.social + h * 10);
      n.fun = Math.min(100, n.fun + h * 4);
      break;
    case "assist":
      assistWork(w, p, a, dt);
      break;
    case "design": {
      const st = findById(w.structures, a.tid);
      if (!st || st.plan !== 0) a.t = 0;
      else addResearch(w, p, h * 25 * skill(p, "think"), st.lv && st.lv > 1 ? "architecture" : "mathematics");
      break;
    }
    case "defend": {
      const b = findById(w.beasts, a.tid);
      if (!b || !active(b)) {
        a.t = 0;
        break;
      }
      const tower = a.sub === "tower" ? findById(w.structures, a.n) : undefined;
      if (a.sub === "tower" && (!tower || (tower.dmg ?? 0) >= 0.6)) {
        a.t = 0;
        break;
      }
      const reach = tower ? towerRange(tower) : weaponOf(a.sub).range + 0.6;
      const d = dist(tower?.x ?? p.x, tower?.z ?? p.z, b.x, b.z);
      if (!tower && (d > reach + 0.8 || (reach > 3 && d < reach * 0.35))) {
        // 다시 다가가거나, 활·총이면 거리를 벌린다
        a.ph = 0;
        break;
      }
      if (d > reach) break;
      p.rot = Math.atan2(b.z - p.z, b.x - p.x);
      p.seen.atk = (p.seen.atk ?? 0) + dt;
      while (p.seen.atk >= STRIKE_EVERY && active(b)) {
        p.seen.atk -= STRIKE_EVERY;
        strike(w, ctx.T, p, b, a);
      }
      if (!active(b)) a.t = 0;
      break;
    }
    case "build": {
      const s = findById(w.structures, a.tid);
      if (!s || s.prog >= 1) {
        a.t = 0;
        break;
      }
      const def = STRUCTS[s.type];
      s.prog = Math.min(1, s.prog + (dt / (def.work * HOUR)) * skill(p, "build") * buildMul(w));
      if (s.prog >= 1) {
        completeStructure(w, s, p);
        feel(w, p, "joy", 0.4);
        say(w, p, "buildDone", {}, "🏠", true);
        addResearch(w, p, 6, "hut");
        addResearch(w, p, 6, "loghouse");
        addResearch(w, p, 6, "masonry");
        addResearch(w, p, 4, "wheel");
        addResearch(w, p, 3, "mathematics");
        a.t = 0;
      }
      break;
    }
  }
}

function finish(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  const n = p.needs;
  // 불이 꺼질 때까지 물을 퍼 나른다
  if (a.k === "douse") {
    if (!douseFinish(w, ctx.T, p, a)) abort(p);
    return;
  }
  switch (a.k) {
    case "care": careFinish(w, ctx, p, a); break;
    case "rite": riteFinish(w, p, a); break;
    case "trade": tradeFinish(w, p, a); break;
    case "fuss": fussFinish(w, p, a); break;
    case "assist": assistFinish(w, p, a); break;
    case "unconscious": {
      say(w, p, "wake", {}, "😵", true);
      feel(w, p, "surprise", 0.4);
      feel(w, p, "fear", 0.25, false);
      break;
    }
    case "eat": {
      eat(w, p);
      break;
    }
    case "drink": {
      n.thirst = 100;
      feel(w, p, "joy", 0.05, false);
      break;
    }
    case "forage": {
      let got: Res = "berry";
      let qty = 0;
      if (a.tid != null) {
        const pl = findById(w.plants, a.tid);
        if (pl && pl.fruit > 0) {
          got = pl.kind === "bush" ? "berry" : "fruit";
          qty = Math.min(pl.fruit, carryCap(w));
          pl.fruit -= qty;
        }
      } else if (a.sub === "shell") {
        if (chance(w, 0.65)) {
          got = "fish";
          qty = 1;
        }
      }
      if (qty <= 0) {
        say(w, p, "fail");
        break;
      }
      if (n.hunger < 45) {
        n.hunger = Math.min(100, n.hunger + (FOOD[got] ?? 10));
        qty--;
        feel(w, p, "joy", 0.12, false);
      }
      if (qty > 0) return carryHome(w, ctx, p, a, got, qty);
      break;
    }
    case "gather": return finishGather(w, ctx, p, a);
    case "craft": return finishCraft(w, p, a);
    case "hunt": return finishHunt(w, ctx, p, a);
    case "tame": return finishTame(w, p, a);
    case "fish": return finishFish(w, ctx, p, a);
    case "cook": {
      let cooked = 0;
      const pots = stockOf(w, "pot") >= 1;
      for (let i = 0; i < 4; i++) {
        if (pots && stockOf(w, "meat") + stockOf(w, "fish") >= 1 && stockOf(w, "crop") + stockOf(w, "berry") >= 1) {
          addStock(w, stockOf(w, "meat") >= 1 ? "meat" : "fish", -1);
          addStock(w, stockOf(w, "crop") >= 1 ? "crop" : "berry", -1);
          addStock(w, "meal", 2);
          cooked++;
        } else if (stockOf(w, "meat") >= 1) {
          addStock(w, "meat", -1);
          addStock(w, "cookedMeat", 1);
          cooked++;
        } else if (stockOf(w, "fish") >= 1) {
          addStock(w, "fish", -1);
          addStock(w, "cookedFish", 1);
          cooked++;
        }
      }
      if (cooked) {
        practice(p, "cook");
        addResearch(w, p, 4, "drying");
        addResearch(w, p, 4, "pottery");
        feel(w, p, "joy", 0.08, false);
      }
      break;
    }
    case "tend": {
      const f = findById(w.structures, a.tid);
      if (!f) break;
      let fuel = 0;
      if (stockOf(w, "wood") >= 1) {
        addStock(w, "wood", -1);
        fuel = 38;
      } else if (stockOf(w, "stick") >= 2) {
        addStock(w, "stick", -2);
        fuel = 22;
      }
      if (fuel) {
        f.fuel = Math.min(100, f.fuel + fuel);
        if (!f.lit && knows(w, "fire") && ctx.weather !== "storm") {
          f.lit = 1;
          addFx(w, "ignite", f.x, f.z, f.id);
          bump(w);
        }
        addResearch(w, p, 2, "cooking");
      }
      break;
    }
    case "makefire": {
      let f = findById(w.structures, a.tid);
      if (!f) {
        if (stockOf(w, "stone") >= 3) addStock(w, "stone", -3);
        const c = campOf(w, p);
        f = makeStructure(w, "campfire", c.x, c.z, 0, true);
        w.structures.push(f);
        bump(w);
      }
      if (stockOf(w, "stick") < 2) break;
      addStock(w, "stick", -2);
      const wet = ctx.weather === "rain" ? 0.35 : ctx.weather === "snow" ? 0.55 : ctx.weather === "storm" ? 0.05 : 1;
      if (chance(w, Math.min(0.95, (0.55 + (p.skills.fire ?? 0) * 0.4) * wet))) {
        f.lit = 1;
        f.fuel = Math.max(f.fuel, 45);
        addFx(w, "ignite", f.x, f.z, f.id);
        bump(w);
        practice(p, "fire");
        feel(w, p, "joy", 0.25);
        say(w, p, "warmFire", {}, "🔥");
        addResearch(w, p, 5, "cooking");
        addResearch(w, p, 2, "pottery");
      } else {
        practice(p, "fire");
        feel(w, p, "anger", 0.12, false);
        say(w, p, "fail", {}, "💨");
      }
      break;
    }
    case "chat": {
      const q = findById(w.people, a.tid);
      if (q && q.alive) {
        const compat = 1 - Math.abs(p.traits.extraversion - q.traits.extraversion) * 0.5;
        const quarrel = p.emo.anger > 0.5 && chance(w, 0.5);
        const d = quarrel ? -0.05 : 0.05 * compat * (0.5 + (p.traits.agreeableness + q.traits.agreeableness) / 2);
        p.rel[q.id] = clamp((p.rel[q.id] ?? 0) + d, -1, 1);
        q.rel[p.id] = clamp((q.rel[p.id] ?? 0) + d * 0.9, -1, 1);
        socialize(w, p, q, !quarrel);
        if (quarrel) {
          feel(w, p, "anger", 0.2);
          feel(w, q, "sadness", 0.15);
          say(w, p, "angry", {}, "😤", true);
        } else {
          feel(w, p, "joy", 0.1, false);
          if (q.id === p.partner) feel(w, p, "love", 0.2);
          if (chance(w, 0.3)) say(w, p, (p.rel[q.id] ?? 0) > 0.5 ? "love" : "chat", { name: q.name }, "💬");
        }
      }
      break;
    }
    case "farm": return finishFarm(w, ctx, p, a);
    case "leisure": {
      feel(w, p, "joy", 0.12, false);
      if (a.sub === "dance" || a.sub === "sing") n.social = Math.min(100, n.social + 5);
      break;
    }
    case "think": {
      practice(p, "think");
      if (chance(w, 0.25)) say(w, p, "think", {}, "🤔");
      break;
    }
    case "mourn": {
      p.seen.mourn = w.time;
      break;
    }
    case "collect": {
      const it = findById(w.items, a.tid);
      if (!it) break;
      removeById(w.items, it.id);
      bump(w);
      if (it.gift) {
        feel(w, p, "joy", 0.25);
        feel(w, p, "surprise", 0.1, false);
      }
      let qty = it.qty;
      if (FOOD[it.res] && n.hunger < 55) {
        n.hunger = Math.min(100, n.hunger + (FOOD[it.res] ?? 10));
        qty--;
        say(w, p, "eat", {}, "😋");
      }
      if (qty > 0) return carryHome(w, ctx, p, a, it.res, qty);
      break;
    }
    case "explore": {
      n.fun = Math.min(100, n.fun + 10);
      addResearch(w, p, 8);
      break;
    }
    case "medicate": {
      const med = medForP(w, p);
      if (med) giveMed(w, p, med, p);
      break;
    }
    case "nurse": return finishNurse(w, p, a);
    case "dig": return finishDig(w, ctx, p, a);
    case "council": return finishCouncil(w, p);
    case "fight": return finishFight(w, p, a);
    case "design": {
      const st = findById(w.structures, a.tid);
      if (st && st.plan === 0) {
        finishDesign(w, st, p);
        practice(p, "build");
        practice(p, "think");
        feel(w, p, "joy", 0.25);
        say(w, p, "designDone", { name: STRUCTS[st.type].name }, "📐", true);
      }
      break;
    }
  }
  if (p.act === a) abort(p);
}

// ─── 돌봄 · 약재 · 의논 · 다툼 ─────────────────────────────────────────

function finishNurse(w: WorldState, p: Person, a: Act) {
  const q = findById(w.people, a.tid);
  if (!q || !onIsland(q) || !illOf(q)) return abort(p);
  const lv = illOf(q);
  const med = medForP(w, q);
  q.seen.nursed = w.time;
  q.needs.social = Math.min(100, q.needs.social + 25);
  q.needs.fun = Math.min(100, q.needs.fun + 10);
  q.needs.thirst = Math.max(q.needs.thirst, 80);
  if (med) giveMed(w, q, med, p);
  else {
    feel(w, q, "love", 0.15, false);
    say(w, q, "thanks", { name: p.name }, "🥹");
  }
  q.rel[p.id] = clamp((q.rel[p.id] ?? 0) + 0.06, -1, 1);
  p.rel[q.id] = clamp((p.rel[q.id] ?? 0) + 0.03, -1, 1);
  practice(p, "heal");
  addResearch(w, p, 3, "herbs");
  addResearch(w, p, 3, "remedy");
  addResearch(w, p, 2, "medicine");
  feel(w, p, "joy", 0.08, false);
  // 돌보다가 옮기도 한다
  if (lv >= 3 && chance(w, 0.03 * lv * (knows(w, "medicine") ? 0.4 : 1))) infect(w, p, "spread");
  abort(p);
}

function finishDig(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  practice(p, "gather");
  if (a.res === "mineral") {
    addResearch(w, p, 3, "medicine");
    const rock = discoverIngredient(w, p, "mineral", p.x, p.z);
    if (!rock) say(w, p, "fail", {}, "🕳️");
    return abort(p);
  }
  addResearch(w, p, 4, "remedy");
  const b = ctx.T.biome(p.x, p.z);
  if ((b === "forest" || b === "grass") && chance(w, 0.45)) {
    discoverIngredient(w, p, "root", p.x, p.z);
    return carryHome(w, ctx, p, a, "root", int(w, 1, 2));
  }
  say(w, p, "fail", {}, "🕳️");
  abort(p);
}

function finishCouncil(w: WorldState, p: Person) {
  const H = w.history;
  p.seen.council = w.time;
  const c = countermeasure(w, H.lastType);
  if (c) addResearch(w, p, TECH_BY_ID[c].cost * 0.04, c);
  else addResearch(w, p, 25);
  for (const q of w.people) {
    if (q === p || q.act?.k !== "council" || dist(p.x, p.z, q.x, q.z) > 6) continue;
    p.rel[q.id] = clamp((p.rel[q.id] ?? 0) + 0.04, -1, 1);
  }
  if (w.timers.council !== H.lastDisaster) {
    w.timers.council = H.lastDisaster;
    const name = c ? TECH_BY_ID[c].name : "";
    chron(w, "disaster", c
      ? `사람들이 모여 다음 재해를 어떻게 막을지 머리를 맞댔다. '${name}'${josa(name, "을/를").slice(name.length)} 궁리하기 시작했다.`
      : "사람들이 모여 부서진 것을 함께 고치고 서로를 다독이기로 했다.");
  }
  feel(w, p, "joy", 0.15, false);
  p.emo.fear *= 0.5;
  say(w, p, "council", {}, "🤝");
  abort(p);
}

function finishFight(w: WorldState, p: Person, a: Act) {
  const q = findById(w.people, a.tid);
  if (!q || !onIsland(q)) return abort(p);
  p.health = Math.max(1, p.health - range(w, 4, 11));
  feel(w, p, "anger", 0.08, false);
  feel(w, p, "fear", 0.1, false);
  p.rel[q.id] = clamp((p.rel[q.id] ?? 0) - 0.05, -1, 1);
  addFx(w, "clash", (p.x + q.x) / 2, (p.z + q.z) / 2, p.id);
  easeWar(w, p, 0.015);
  if (chance(w, 0.12) && !lying(q)) {
    q.act = act(w, "unconscious", q.x, q.z, 40 * MIN, { ph: 1 });
    q.anim = "lie";
  }
  abort(p);
}

function carryHome(w: WorldState, ctx: Ctx, p: Person, a: Act, res: Res, qty: number) {
  p.carry = { res, qty };
  let to = ctx.storage;
  if (a.k === "gather" && a.res && METAL_INFO[a.res as Metal]) {
    const mine = w.structures.find((x) => x.type === "mine" && x.prog >= 1 && (x.dmg ?? 0) < 0.6);
    if (mine && dist(p.x, p.z, mine.x, mine.z) < dist(p.x, p.z, to.x, to.z)) to = { x: mine.x + 1.6, z: mine.z };
  }
  const s = spot(p, to.x, to.z, 0.9);
  a.ph = 2;
  a.tx = s.x;
  a.tz = s.z;
}

function deposit(w: WorldState, p: Person) {
  if (!p.carry) return;
  // 품삯을 받고, 가끔은 하나를 제 몫으로 챙긴다
  addStock(w, p.carry.res, payWage(w, p, p.carry.res, p.carry.qty));
  p.carry = null;
}

function eat(w: WorldState, p: Person) {
  const n = p.needs;
  let ate = 0;
  let fav = false;
  let raw = false;
  const order: Res[] = [p.likes.food, "meal", "cookedMeat", "cookedFish", "fruit", "berry", "crop", "fish", "meat"];
  while (n.hunger < 88 && ate < 3) {
    let food: Res | null = null;
    if (p.carry && FOOD[p.carry.res]) {
      food = p.carry.res;
      p.carry.qty--;
      if (p.carry.qty <= 0) p.carry = null;
    } else {
      food = order.find((r) => stockOf(w, r) >= 1) ?? null;
      if (!food) break;
      addStock(w, food, -1);
    }
    n.hunger = Math.min(100, n.hunger + (FOOD[food] ?? 10));
    if (food === p.likes.food) fav = true;
    if (food === "meat" || food === "fish") raw = true;
    ate++;
  }
  if (!ate) return;
  if (fav) {
    feel(w, p, "joy", 0.3);
    say(w, p, "eatFav", { food: RES_NAME[p.likes.food] }, "😋");
  } else if (raw && !knows(w, "cooking")) {
    say(w, p, "eatRaw", {}, "😖");
  } else {
    feel(w, p, "joy", 0.12, false);
    if (chance(w, 0.5)) say(w, p, "eat", {}, "😋");
  }
  if (raw && chance(w, 0.12)) {
    p.health = Math.max(5, p.health - 6);
    feel(w, p, "sadness", 0.1, false);
    say(w, p, "sick", {}, "🤒", true);
  }
}

// ─── 채집 ──────────────────────────────────────────────────────────────

const GATHER_RES: Res[] = ["stick", "wood", "stone", "fiber", "clay", "ore", "herb", "mineral", "iron", "copper", "tin", "silver", "gold", "diamond"];

function gatherTarget(w: WorldState, p: Person, res: Res) {
  const R = 45;
  switch (res) {
    case "stick": {
      const it = nearest(w.items, p.x, p.z, (i) => i.res === "stick" && !i.held, 25);
      if (it) return { item: it };
      const t = nearest(w.plants, p.x, p.z, (q) => isTree(q.kind) && q.g >= 0.6 && !q.stump && !q.burn, R);
      return t ? { plant: t } : null;
    }
    case "wood": {
      if (stockOf(w, "axe") < 1 && stockOf(w, "handaxe") < 1) return null;
      const it = nearest(w.items, p.x, p.z, (i) => i.res === "wood" && !i.held, 25);
      if (it) return { item: it };
      // 열매 나무는 아껴둔다
      const t = nearest(w.plants, p.x, p.z, (q) => (q.kind === "tree" || q.kind === "pine" || q.kind === "palm") && q.g >= 1 && !q.stump && !q.burn && dist(q.x, q.z, w.camp.x, w.camp.z) > 5, R + 15);
      return t ? { plant: t } : null;
    }
    case "stone": {
      const it = nearest(w.items, p.x, p.z, (i) => i.res === "stone" && !i.held, 25);
      if (it) return { item: it };
      const r = nearest(w.rocks, p.x, p.z, (q) => (q.kind === "rock" || q.kind === "boulder") && q.amt >= 1, R + 20);
      return r ? { rock: r } : null;
    }
    case "fiber": case "herb": {
      const t = nearest(w.plants, p.x, p.z, (q) => q.kind === res && q.g >= 0.9, R + 10);
      return t ? { plant: t } : null;
    }
    case "clay": {
      if (!knows(w, "pottery")) return null;
      const r = nearest(w.rocks, p.x, p.z, (q) => q.kind === "clay" && q.amt >= 1, 200);
      return r ? { rock: r } : null;
    }
    case "ore": {
      if (!knows(w, "metallurgy")) return null;
      const r = nearest(w.rocks, p.x, p.z, (q) => q.kind === "ore" && q.amt >= 1, 200);
      return r ? { rock: r } : null;
    }
    case "mineral": {
      if (!knows(w, "medicine")) return null;
      const r = nearest(w.rocks, p.x, p.z, (q) => q.kind === "mineral" && q.amt >= 1, 200);
      return r ? { rock: r } : null;
    }
  }
  if (METAL_INFO[res as Metal]) {
    // 곡괭이가 있어야 광맥을 캔다
    if (!knows(w, "mining") || stockOf(w, "pickaxe") < 1) return null;
    const r = nearest(w.rocks, p.x, p.z, (q) => q.kind === "vein" && q.ore === res && q.amt >= 1, 400);
    return r ? { rock: r } : null;
  }
  return null;
}

function planGather(w: WorldState, p: Person, res: Res): Act | null {
  const tg = gatherTarget(w, p, res);
  if (!tg) return null;
  if ("item" in tg && tg.item) {
    return act(w, "collect", tg.item.x, tg.item.z, 2 * MIN, { tid: tg.item.id });
  }
  const e = ("plant" in tg ? tg.plant : tg.rock)!;
  const ang = Math.atan2(p.z - e.z, p.x - e.x);
  const off = "plant" in tg ? 0.9 : 1.0 + ((e as { s?: number }).s ?? 1) * 0.5;
  let t = 10 * MIN;
  if (res === "wood") t = (stockOf(w, "axe") >= 1 ? 16 : 34) * MIN;
  if (res === "stone") t = 12 * MIN;
  if (res === "fiber" || res === "herb") t = 8 * MIN;
  if (res === "clay") t = 15 * MIN;
  if (res === "ore" || res === "mineral") t = 24 * MIN;
  if (METAL_INFO[res as Metal]) t = (METAL_INFO[res as Metal].veins <= 2 ? 34 : 24) * MIN;
  t /= toolMul(w) * skill(p, "gather");
  return act(w, "gather", e.x + Math.cos(ang) * off, e.z + Math.sin(ang) * off, t, { tid: e.id, res });
}

function finishGather(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  const res = a.res!;
  const cap = carryCap(w);
  let qty = 0;
  const pl = findById(w.plants, a.tid);
  const rk = pl ? undefined : findById(w.rocks, a.tid);
  if (res === "stick" && pl) {
    qty = Math.min(cap, int(w, 2, 3));
    addResearch(w, p, 3, "fire");
    addResearch(w, p, 2, "leanto");
  } else if (res === "wood" && pl && !pl.stump) {
    qty = Math.min(cap, 3);
    pl.stump = 1;
    pl.fruit = 0;
    pl.regrow = w.time + range(w, 2, 3.5) * DAY;
    addFx(w, "chop", pl.x, pl.z, pl.id);
    bump(w);
    wearTool(w, p, stockOf(w, "axe") >= 1 ? "axe" : "handaxe");
    addStock(w, "stick", 1);
    addResearch(w, p, 4, "stoneaxe");
    addResearch(w, p, 2, "hut");
    addResearch(w, p, 2, "loghouse");
    addResearch(w, p, 1, "boat");
  } else if ((res === "fiber" || res === "herb") && pl) {
    qty = Math.min(cap, res === "fiber" ? 3 : 2);
    pl.g = 0.2;
    bump(w);
    if (res === "fiber") {
      addResearch(w, p, 4, "cordage");
      addResearch(w, p, 2, "basket");
      addResearch(w, p, 2, "weaving");
    } else {
      addResearch(w, p, 5, "herbs");
      addResearch(w, p, 3, "remedy");
      addResearch(w, p, 3, "medicine");
    }
  } else if (rk && rk.kind === "vein" && rk.ore && rk.amt >= 1) {
    return finishMine(w, ctx, p, a, rk);
  } else if (rk && rk.amt >= 1) {
    const y = res === "stone" ? int(w, 2, 3) : res === "clay" ? 3 : 2;
    qty = Math.min(cap, y, Math.floor(rk.amt));
    rk.amt -= qty;
    addFx(w, "chip", rk.x, rk.z, rk.id);
    if (res === "stone") {
      addResearch(w, p, 2, "spear");
      addResearch(w, p, 2, "polished");
    } else if (res === "clay") addResearch(w, p, 4, "pottery");
    else if (res === "ore") {
      addResearch(w, p, 4, "metallurgy");
      addResearch(w, p, 2, "iron");
    } else if (res === "mineral") addResearch(w, p, 4, "medicine");
    // 돌을 캐다가 숨은 광맥을 알아보기도 한다
    if ((res === "stone" || res === "ore") && knows(w, "herbs") && w.deposits.length) discoverIngredient(w, p, "mineral", rk.x, rk.z);
  }
  practice(p, "gather");
  if (qty > 0) return carryHome(w, ctx, p, a, res, qty);
  abort(p);
}

/** 광맥을 캔다: 흔한 금속은 잘 나오고, 귀한 것일수록 드물게 섞여 나온다 */
function finishMine(w: WorldState, ctx: Ctx, p: Person, a: Act, rk: { id: number; x: number; z: number; amt: number; ore?: Metal }) {
  const ore = rk.ore!;
  const n = Math.min(carryCap(w), 3, Math.floor(rk.amt));
  rk.amt -= n;
  addFx(w, "chip", rk.x, rk.z, rk.id);
  wearTool(w, p, "pickaxe");
  let main = 0, stone = 0;
  for (let i = 0; i < n; i++) {
    if (chance(w, METAL_INFO[ore].purity)) main++;
    else stone++;
    for (const [m, pr] of Object.entries(LUCKY) as [Metal, number][]) {
      if (m === ore || !chance(w, pr)) continue;
      addStock(w, m, 1);
      foundMetal(w, p, m);
    }
  }
  if (main) foundMetal(w, p, ore);
  practice(p, "gather");
  addResearch(w, p, 3, "mining");
  addResearch(w, p, 3, ore === "iron" ? "iron" : "metallurgy");
  addResearch(w, p, 2, ore === "iron" ? "ironweapon" : "bronzeweapon");
  if (main) return carryHome(w, ctx, p, a, ore, main);
  if (stone) return carryHome(w, ctx, p, a, "stone", stone);
  abort(p);
}

const SHINY = new Set<Metal>(["silver", "gold", "diamond"]);

function foundMetal(w: WorldState, p: Person, m: Metal) {
  const name = METAL_INFO[m].name;
  if (SHINY.has(m)) {
    feel(w, p, "joy", m === "diamond" ? 0.7 : 0.4);
    feel(w, p, "surprise", 0.4);
    say(w, p, "shiny", { what: name }, m === "diamond" ? "💎" : "✨", true);
  }
  if (w.found.includes(m)) {
    if (m === "diamond" || m === "gold") shiftMorale(w, m === "diamond" ? 3 : 1);
    return;
  }
  w.found.push(m);
  addFx(w, "eureka", p.x, p.z, p.id);
  shiftMorale(w, m === "diamond" ? 8 : m === "gold" ? 5 : m === "silver" ? 3 : 1);
  chron(w, "discover", m === "diamond"
    ? `${josa(p.name, "이/가")} 광맥 깊은 곳에서 눈부시게 반짝이는 다이아몬드를 캐냈다! 모두가 몰려와 구경했다.`
    : m === "gold"
    ? `${josa(p.name, "이/가")} 광맥에서 노랗게 빛나는 금을 캐냈다!`
    : `${josa(p.name, "이/가")} 광맥에서 처음으로 ${josa(name, "을/를")} 캐냈다.`);
}

// ─── 제작 ──────────────────────────────────────────────────────────────

function hasBuilt(w: WorldState, type: Structure["type"]) {
  return w.structures.some((s) => s.type === type && s.prog >= 1);
}

export function wantedRecipes(w: WorldState, ctx: Ctx): Recipe[] {
  const adults = Math.max(1, ctx.adults);
  const sick = sickCount(w, ctx);
  const want: Partial<Record<string, number>> = {
    handaxe: 1 + Math.floor(adults / 3),
    spear: Math.max(1, Math.floor(adults / 2)),
    rope: 2 + (ctx.need.rope ?? 0),
    axe: Math.max(1, Math.floor(adults / 2)),
    basket: 1 + Math.floor(adults / 4),
    rod: 1 + Math.floor(adults / 3),
    bow: 1 + Math.floor(adults / 3),
    hoe: w.structures.some((s) => s.type === "farm") ? 1 + Math.floor(adults / 3) : 0,
    pot: 2 + Math.floor(ctx.pop / 3),
    metal: (ctx.need.metal ?? 0) + 3,
    net: 1 + Math.floor(adults / 4),
    herbal: 1 + sick,
    remedy: 2 + Math.floor(ctx.pop / 6) + sick,
    medicine: 2 + Math.floor(ctx.pop / 8),
    pickaxe: 1 + Math.floor(adults / 4),
    bronze: (ctx.need.metal ?? 0) + 3,
    ironbar: (ctx.need.metal ?? 0) + 3,
    jewel_s: 2 + Math.floor(ctx.pop / 6),
    jewel_g: 2 + Math.floor(ctx.pop / 6),
  };
  // 맹수를 겪고 나면 그 시대의 가장 좋은 무기를 싸울 사람 수만큼
  const fighters = (w.history.beast ?? 0) > 0 ? Math.max(2, Math.ceil(adults / 2.5)) : 0;
  want.sword = knows(w, "ironweapon") ? 0 : fighters;
  want.ironsword = knows(w, "firearm") ? Math.ceil(fighters / 2) : fighters;
  want.musket = knows(w, "rifle") ? 0 : fighters;
  want.rifle = fighters;
  const out: Recipe[] = [];
  for (const r of RECIPES) {
    if (!knows(w, r.tech)) continue;
    if (r.needs && !hasBuilt(w, r.needs)) continue;
    if (r.out === "furOutfit") {
      if (w.people.some((q) => q.alive && q.outfit === "rag")) out.push(r);
      continue;
    }
    if (r.out === "clothOutfit") {
      if (w.people.some((q) => q.alive && (q.outfit === "rag" || q.outfit === "fur"))) out.push(r);
      continue;
    }
    const making = w.people.reduce((n, q) => n + (q.act?.k === "craft" && q.act.sub === r.id ? 1 : 0), 0);
    if (stockOf(w, r.out as Res) + making < (want[r.id] ?? 1)) out.push(r);
  }
  return out;
}

const recipesFor = (w: WorldState, ctx: Ctx) => (ctx.memo.recipes ??= wantedRecipes(w, ctx)) as Recipe[];
const sickCount = (w: WorldState, ctx: Ctx) => (ctx.memo.sick ??= w.people.filter((q) => onIsland(q) && illOf(q) >= 1).length) as number;

function finishCraft(w: WorldState, p: Person, a: Act) {
  const r = RECIPES.find((x) => x.id === a.sub);
  if (!r || !payStock(w, r.cost)) return abort(p);
  if (r.out === "furOutfit" || r.out === "clothOutfit") {
    const target = r.out === "furOutfit" ? "fur" : "cloth";
    const needy =
      (p.outfit === "rag" || (target === "cloth" && p.outfit === "fur")) ? p
        : w.people.find((q) => q.alive && (q.outfit === "rag" || (target === "cloth" && q.outfit === "fur")));
    if (needy) {
      needy.outfit = target;
      feel(w, needy, "joy", 0.3);
      if (needy !== p) {
        needy.rel[p.id] = clamp((needy.rel[p.id] ?? 0) + 0.08, -1, 1);
        feel(w, needy, "love", 0.15, false);
      }
      bump(w);
    }
  } else {
    addStock(w, r.out, r.qty);
    if (r.out === "jewelry") {
      // 반짝이는 장신구는 모두의 마음을 든든하게 한다
      shiftMorale(w, 1.5);
      feel(w, p, "joy", 0.3);
    }
  }
  practice(p, "craft");
  addResearch(w, p, 4, "polished");
  addResearch(w, p, 2, "metallurgy");
  addResearch(w, p, 2, "iron");
  addResearch(w, p, 1, "steam");
  feel(w, p, "joy", 0.1, false);
  abort(p);
}

// ─── 사냥 / 낚시 / 농사 / 목축 ─────────────────────────────────────────

const MEAT: Record<Animal["kind"], number> = { rabbit: 2, fowl: 2, crab: 1, goat: 4, boar: 5 };

function huntChance(w: WorldState, an: Animal) {
  if (an.st === "stun") return 1;
  if (an.tame) return 1;
  const spear = stockOf(w, "spear") >= 1;
  const bow = stockOf(w, "bow") >= 1;
  const base: Record<Animal["kind"], [number, number, number]> = {
    rabbit: [0.22, 0.45, 0.75],
    fowl: [0.25, 0.45, 0.75],
    crab: [0.8, 0.9, 0.9],
    goat: [0.12, 0.4, 0.7],
    boar: [0.03, 0.38, 0.65],
  };
  const [b0, b1, b2] = base[an.kind];
  // 풍요제가 통하면 사냥도 조금 더 잘 된다
  return Math.min(0.95, (bow ? b2 : spear ? b1 : b0) * (1 + 0.15 * blessed(w, "bounty")));
}

function planHunt(w: WorldState, ctx: Ctx, p: Person, prefer?: Animal): Act | null {
  const allowTame = ctx.foodDeficit > 0.6;
  const an = prefer ?? nearest(w.animals, p.x, p.z, (x) =>
    !x.held && x.lead == null && (x.tame ? allowTame && w.animals.filter((y) => y.tame === x.tame).length > 3 : true) &&
    (x.kind !== "boar" || stockOf(w, "spear") >= 1) && huntChance(w, x) > 0.1, 50);
  if (!an) return null;
  return act(w, "hunt", an.x, an.z, 4 * MIN, { tid: an.id, run: an.st === "stun" || an.tame ? 0 : 1 });
}

function finishHunt(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  const an = findById(w.animals, a.tid);
  if (!an || an.held) return abort(p);
  const ok = chance(w, huntChance(w, an) * (0.85 + skill(p, "hunt") * 0.15));
  if (stockOf(w, "bow") >= 1) wearTool(w, p, "bow");
  else if (stockOf(w, "spear") >= 1) wearTool(w, p, "spear");
  practice(p, "hunt");
  addResearch(w, p, 4, "bow");
  addResearch(w, p, 4, "clothing");
  addResearch(w, p, 3, "spear");
  addResearch(w, p, 2, "husbandry");
  if (ok) {
    removeById(w.animals, an.id);
    addFx(w, "catch", an.x, an.z, an.id);
    bump(w);
    if (an.kind !== "crab" && an.kind !== "fowl") addStock(w, "hide", 1);
    feel(w, p, "joy", 0.2);
    if (an.gift) say(w, p, "gift", {}, "🙏");
    return carryHome(w, ctx, p, a, "meat", MEAT[an.kind]);
  }
  an.st = "flee";
  const ang = Math.atan2(an.z - p.z, an.x - p.x);
  an.tx = an.x + Math.cos(ang) * 8;
  an.tz = an.z + Math.sin(ang) * 8;
  feel(w, p, "anger", 0.15);
  say(w, p, "fail", {}, "💨");
  if (an.kind === "boar" && chance(w, 0.25)) {
    p.health = Math.max(1, p.health - 14);
    feel(w, p, "fear", 0.4);
    say(w, p, "fear", {}, "🤕", true);
  }
  abort(p);
}

function planTame(w: WorldState, p: Person): Act | null {
  const pen = w.structures.find((s) => s.type === "pen" && s.prog >= 1);
  if (!pen) return null;
  const an = nearest(w.animals, p.x, p.z, (x) => !x.tame && !x.held && x.lead == null && x.kind !== "boar" && x.kind !== "crab", 50);
  if (!an) return null;
  return act(w, "tame", an.x, an.z, 6 * MIN, { tid: an.id, n: pen.id });
}

function finishTame(w: WorldState, p: Person, a: Act) {
  const pen = findById(w.structures, a.n);
  const an = findById(w.animals, a.tid);
  if (!pen || !an) return abort(p);
  if (chance(w, an.st === "stun" ? 1 : 0.45)) {
    // 우리까지 데려간다 (ph 2 = 귀환)
    an.lead = p.id;
    an.st = "move";
    a.ph = 2;
    a.run = 0;
    a.tx = pen.x;
    a.tz = pen.z;
    feel(w, p, "joy", 0.1, false);
    return;
  }
  an.st = "flee";
  say(w, p, "fail", {}, "💨");
  abort(p);
}

function settleTame(w: WorldState, p: Person, a: Act) {
  const pen = findById(w.structures, a.n);
  const an = findById(w.animals, a.tid);
  if (!pen || !an) return;
  an.lead = undefined;
  an.tame = pen.id;
  an.x = pen.x + range(w, -1, 1);
  an.z = pen.z + range(w, -1, 1);
  an.st = "idle";
  feel(w, p, "joy", 0.2);
  addResearch(w, p, 3, "husbandry");
}

/** 배를 타고 먼바다로: 깊은 곳의 큰 물고기를 노린다 */
function boatSpot(w: WorldState, ctx: Ctx, dock: Structure) {
  const T = ctx.T;
  const reach = knows(w, "navigation") ? 40 : 26;
  const f = nearest(w.fish, dock.x, dock.z, (x) => x.st === "swim" && (FISH_INFO[x.kind].boat || x.kind === "bigfish") && T.height(x.x, x.z) < -2.2, reach);
  if (f) return { x: f.x, z: f.z };
  for (let k = 0; k < 12; k++) {
    const a = dock.rot + range(w, -0.9, 0.9);
    const d = range(w, 8, reach);
    const x = dock.x + Math.cos(a) * d, z = dock.z + Math.sin(a) * d;
    const h = T.height(x, z);
    if (h < -2.5 && h > -7.8) return { x, z };
  }
  return null;
}

function fishSpot(w: WorldState, ctx: Ctx, p: Person) {
  const dock = w.structures.find((s) => s.type === "dock" && s.prog >= 1 && (s.dmg ?? 0) < 0.6);
  if (dock && knows(w, "boat") && chance(w, p.role === "fisher" || p.role === "sailor" ? 0.6 : 0.35)) {
    const b = boatSpot(w, ctx, dock);
    if (b) return { x: b.x, z: b.z, rot: Math.atan2(b.z - dock.z, b.x - dock.x), dock: false, boat: true };
  }
  if (dock && chance(w, 0.6)) return { x: dock.x, z: dock.z, rot: dock.rot, dock: true };
  const f = nearest(w.fish, p.x, p.z, (x) => x.st !== "held", 60);
  const ang = f ? Math.atan2(f.z, f.x) : Math.atan2(p.z, p.x) + range(w, -0.4, 0.4);
  const sp = ctx.T.shorePoint(ang, 0.3);
  return { x: sp.x, z: sp.z, rot: ang, dock: false, boat: false };
}

function planFish(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const s = fishSpot(w, ctx, p);
  const rod = stockOf(w, "rod") >= 1, spear = stockOf(w, "spear") >= 1;
  if (s.boat) return act(w, "fish", s.x, s.z, range(w, 45, 75) * MIN, { n: s.rot, sub: "boat", run: 0 });
  return act(w, "fish", s.x, s.z, range(w, 25, 45) * MIN, {
    n: s.rot, sub: rod ? "rod" : spear ? "spear" : "hand", run: 0, res: s.dock ? "fish" : undefined,
  });
}

function finishFish(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  const boat = a.sub === "boat";
  const base = boat ? 0.8 : a.sub === "rod" ? 0.75 : a.sub === "spear" ? 0.55 : 0.35;
  const dock = a.res === "fish";
  const net = stockOf(w, "net") >= 1;
  let qty = 0;
  if (chance(w, Math.min(0.95, base * (0.85 + skill(p, "fish") * 0.15) * (dock ? 1.3 : 1) * (net ? 1.15 : 1)))) {
    // 배가 없으면 먼바다 물고기는 잡을 수 없다
    const f = nearest(w.fish, p.x, p.z, (x) => x.st !== "held" && (boat || !FISH_INFO[x.kind].boat), boat ? 14 : 9);
    if (f) {
      qty = FISH_INFO[f.kind]?.qty ?? 1;
      removeById(w.fish, f.id);
      addFx(w, "splash", f.x, f.z, f.id);
      bump(w);
    } else qty = 1;
    if (dock) qty += 1;
    if (net) qty += 1;
    if (boat && knows(w, "navigation")) qty += 1;
  }
  if (a.sub === "rod") wearTool(w, p, "rod");
  if (net) wearTool(w, p, "net");
  practice(p, "fish");
  addResearch(w, p, 4, "fishing");
  addResearch(w, p, 3, "boat");
  addResearch(w, p, 3, "net");
  if (boat) {
    addResearch(w, p, 3, "navigation");
    addResearch(w, p, 2, "shipbuilding");
  }
  if (qty > 0) {
    feel(w, p, "joy", 0.2);
    return carryHome(w, ctx, p, a, "fish", qty);
  }
  say(w, p, "fail", {}, "💧");
  abort(p);
}

const FARM_SLOTS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

function farmWork(w: WorldState) {
  const farms = w.structures.filter((s) => s.type === "farm" && s.prog >= 1);
  if (!farms.length) return { ripe: [] as Plant[], empty: [] as { f: Structure; i: number }[] };
  const crops = w.plants.filter((c) => c.kind === "crop");
  const busy = new Set<string>();
  for (const q of w.people) {
    const a = q.act;
    if (a?.k === "farm") busy.add(a.sub === "plant" ? `${a.tid}:${a.n}` : `c${a.tid}`);
  }
  const ripe = crops.filter((c) => c.g >= 1 && !busy.has(`c${c.id}`));
  const empty: { f: Structure; i: number }[] = [];
  for (const f of farms) {
    for (let i = 0; i < FARM_SLOTS.length; i++) {
      if (busy.has(`${f.id}:${i}`)) continue;
      const [ox, oz] = FARM_SLOTS[i];
      const x = f.x + ox * 1.1, z = f.z + oz * 1.1;
      if (!crops.some((c) => c.farm === f.id && dist(c.x, c.z, x, z) < 0.5)) empty.push({ f, i });
    }
  }
  return { ripe, empty };
}

function planFarm(w: WorldState, p: Person, work: ReturnType<typeof farmWork>): Act | null {
  const ripe = nearest(work.ripe, p.x, p.z);
  if (ripe) {
    work.ripe.splice(work.ripe.indexOf(ripe), 1);
    return act(w, "farm", ripe.x + 0.6, ripe.z, 10 * MIN, { tid: ripe.id, sub: "harvest" });
  }
  if (seasonOf(w.time) === 3 || !work.empty.length) return null;
  const { f, i } = work.empty.shift()!;
  const [ox, oz] = FARM_SLOTS[i];
  return act(w, "farm", f.x + ox * 1.1 + 0.6, f.z + oz * 1.1, 10 * MIN, { tid: f.id, sub: "plant", n: i });
}

function finishFarm(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  practice(p, "farm");
  addResearch(w, p, 4, "agriculture");
  addResearch(w, p, 2, "husbandry");
  addResearch(w, p, 2, "weaving");
  addResearch(w, p, 2, "windmill");
  if (a.sub === "plant") {
    const f = findById(w.structures, a.tid);
    if (!f) return abort(p);
    const [ox, oz] = FARM_SLOTS[a.n ?? 0];
    const x = f.x + ox * 1.1, z = f.z + oz * 1.1;
    if (w.plants.some((q) => q.kind === "crop" && q.farm === f.id && dist(q.x, q.z, x, z) < 0.5)) return abort(p);
    const c = makePlant(w, "crop", x, z, 0.05);
    c.farm = f.id;
    w.plants.push(c);
    bump(w);
    return abort(p);
  }
  const c = findById(w.plants, a.tid);
  if (!c || c.g < 1) return abort(p);
  removeById(w.plants, c.id);
  bump(w);
  let y = 3;
  if (stockOf(w, "hoe") >= 1) {
    y *= 1.3;
    wearTool(w, p, "hoe");
  }
  if (hasBuilt(w, "windmill")) y *= 1.5;
  feel(w, p, "joy", 0.15, false);
  carryHome(w, ctx, p, a, "crop", Math.round(y));
}

// ─── 의사결정 ──────────────────────────────────────────────────────────

function materialWants(w: WorldState, ctx: Ctx): Stock {
  const want: Stock = { stick: 6, stone: 4 };
  if (knows(w, "fire")) {
    want.stick = 10;
    want.wood = 4;
  }
  if (knows(w, "cordage")) want.fiber = 6;
  if (knows(w, "pottery")) want.clay = 6;
  if (knows(w, "metallurgy")) want.ore = 6;
  if (knows(w, "herbs")) want.herb = 4 + sickCount(w, ctx) * 2;
  if (knows(w, "medicine")) want.mineral = 3;
  if (knows(w, "mining") && stockOf(w, "pickaxe") >= 1) {
    want.iron = Math.max(want.iron ?? 0, knows(w, "iron") ? 6 : 2);
    want.copper = Math.max(want.copper ?? 0, knows(w, "metallurgy") ? 4 : 1);
    want.tin = Math.max(want.tin ?? 0, knows(w, "metallurgy") ? 2 : 0);
  }
  for (const [r, n] of Object.entries(ctx.need) as [Res, number][]) want[r] = (want[r] ?? 0) + n;
  for (const rc of recipesFor(w, ctx)) {
    for (const [r, n] of Object.entries(rc.cost) as [Res, number][]) want[r] = Math.max(want[r] ?? 0, n + (r === "stone" ? 2 : 0));
  }
  return want;
}

function sleepSpot(w: WorldState, ctx: Ctx, p: Person) {
  const home = homeOf(w, p);
  if (home) {
    const i = w.people.filter((q) => q.alive && q.home === home.id).indexOf(p);
    const a = home.rot + Math.PI / 2 + i * 1.3;
    const r = STRUCTS[home.type].radius * 0.4;
    return { x: home.x + Math.cos(a) * r, z: home.z + Math.sin(a) * r };
  }
  const f = fireFor(w, ctx, p);
  const c = campOf(w, p);
  return spot(p, f?.x ?? c.x, f?.z ?? c.z, 2);
}

function drinkPlan(w: WorldState, ctx: Ctx, p: Person): Act {
  if (ctx.weather === "rain" || ctx.weather === "storm") return act(w, "drink", p.x, p.z, 3 * MIN, { ph: 1, sub: "rain" });
  const well = w.structures.find((s) => s.type === "well" && s.prog >= 1);
  const T = ctx.T;
  const ang = Math.atan2(p.z - T.pond.z, p.x - T.pond.x);
  const pond = { x: T.pond.x + Math.cos(ang) * (T.pond.r + 0.5), z: T.pond.z + Math.sin(ang) * (T.pond.r + 0.5) };
  const jar = stockOf(w, "pot") >= 1 ? ctx.storage : null;
  let best = pond;
  let bd = dist(p.x, p.z, pond.x, pond.z);
  for (const c of [well, jar]) {
    if (!c) continue;
    const s = spot(p, c.x, c.z, 1.1);
    const d = dist(p.x, p.z, s.x, s.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return act(w, "drink", best.x, best.z, 3 * MIN);
}

function partnerFor(w: WorldState, p: Person): Person | null {
  let best: Person | null = null;
  let bs = -Infinity;
  for (const q of w.people) {
    if (q === p || !onIsland(q) || lying(q) || age(w, q) < 3) continue;
    if (illOf(q) >= 3 || enemies(w, p, q)) continue;
    const kin = p.group != null && q.group === p.group ? 0.3 : 0;
    const d = dist(p.x, p.z, q.x, q.z);
    if (d > 45) continue;
    if (q.act && !SOFT.includes(q.act.k) && q.act.k !== "idle") continue;
    const s = (p.rel[q.id] ?? 0) * 2 - d * 0.03 + (q.id === p.partner ? 0.5 : 0) + kin;
    if (s > bs) {
      bs = s;
      best = q;
    }
  }
  return best;
}

function chatPlan(w: WorldState, p: Person, q: Person): Act | null {
  const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
  const t = range(w, 18, 32) * MIN;
  const a = act(w, "chat", mx + 0.6, mz, t, { tid: q.id });
  const b = act(w, "chat", mx - 0.6, mz, t, { tid: p.id });
  q.act = b;
  return a;
}

function leisurePlan(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const T = ctx.T;
  const summer = seasonOf(w.time) === 1;
  let sub = p.likes.leisure;
  if (ctx.night && (ctx.weather === "clear" || ctx.weather === "cloudy")) sub = "stars";
  else if (ctx.hour >= 17.5 && ctx.hour < 19.8 && ctx.weather !== "storm") sub = "sea";
  else if (sub === "swim" && !(summer && ctx.weather === "clear" && ctx.hour > 10 && ctx.hour < 17)) sub = "sing";
  else if (p.emo.joy > 0.55 && chance(w, 0.5)) sub = "dance";
  else if (sub === "stars") sub = "sea";
  const t = range(w, 30, 70) * MIN;
  if (sub === "sea" || sub === "draw" || sub === "swim") {
    const ang = Math.atan2(p.z, p.x) + range(w, -0.5, 0.5);
    const sp = T.shorePoint(ang, sub === "swim" ? -3 : sub === "draw" ? 1.5 : 3);
    return act(w, "leisure", sp.x, sp.z, t, { sub, n: ang });
  }
  const bench = nearest(w.structures, p.x, p.z, (s) => s.type === "bench" && s.prog >= 1, 30);
  if (bench && (sub === "sing" || sub === "sea")) {
    const s = spot(p, bench.x, bench.z, 0.4);
    return act(w, "leisure", s.x, s.z, t, { sub: "sing", n: bench.rot });
  }
  const c = campOf(w, p);
  const s = spot(p, c.x, c.z, range(w, 3, 7));
  return act(w, "leisure", s.x, s.z, t, { sub });
}

function thinkPlan(w: WorldState, ctx: Ctx, p: Person): Act {
  const lib = w.structures.find((s) => (s.type === "library" || s.type === "observatory") && s.prog >= 1);
  const t = range(w, 45, 90) * MIN;
  if (lib) {
    const s = spot(p, lib.x, lib.z, STRUCTS[lib.type].radius + 0.6);
    return act(w, "think", s.x, s.z, t, { sub: "study" });
  }
  const camp = campOf(w, p);
  if (ctx.night && ctx.weather === "clear") {
    const s = spot(p, camp.x, camp.z, 5);
    return act(w, "think", s.x, s.z, t, { sub: "stars" });
  }
  const ws = w.structures.find((s) => s.type === "workshop" && s.prog >= 1);
  const f = fireFor(w, ctx, p);
  const c = (camp === w.camp ? ws : null) ?? f ?? camp;
  const s = spot(p, c.x, c.z, 1.8);
  return act(w, "think", s.x, s.z, t);
}

function shelterPlan(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const home = homeOf(w, p) ?? nearest(w.structures, p.x, p.z, (s) => isHouse(s.type) && s.prog >= 1, 200);
  if (home) {
    const s = sleepSpot(w, ctx, p);
    if (p.home == null) {
      s.x = home.x;
      s.z = home.z;
    }
    return act(w, "shelter", s.x, s.z, 4 * HOUR, { run: 1 });
  }
  const tree = nearest(w.plants, p.x, p.z, (q) => (q.kind === "tree" || q.kind === "pine") && q.g >= 1 && !q.stump && !q.burn, 30);
  if (tree) return act(w, "shelter", tree.x + 0.8, tree.z, 2 * HOUR, { run: 1 });
  return null;
}

function forageTarget(w: WorldState, p: Person): Plant | null {
  return nearest(w.plants, p.x, p.z, (q) => (q.kind === "bush" || q.kind === "fruit" || q.kind === "palm") && q.fruit >= 1 && q.g >= 1 && !q.stump && !q.burn, 70);
}

function foragePlan(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const food = nearest(w.items, p.x, p.z, (i) => !!FOOD[i.res] && !i.held, 30);
  if (food) return act(w, "collect", food.x, food.z, 2 * MIN, { tid: food.id });
  const pl = forageTarget(w, p);
  if (pl) {
    const ang = Math.atan2(p.z - pl.z, p.x - pl.x);
    return act(w, "forage", pl.x + Math.cos(ang) * 0.9, pl.z + Math.sin(ang) * 0.9, range(w, 6, 10) * MIN, { tid: pl.id });
  }
  // 갯벌에서 조개 줍기
  const ang = Math.atan2(p.z, p.x) + range(w, -0.6, 0.6);
  const sp = ctx.T.shorePoint(ang, 0.2);
  return act(w, "forage", sp.x, sp.z, range(w, 15, 25) * MIN, { sub: "shell" });
}

/** 맹수와 사이를 두고 설 자리: 무기가 닿는 거리 */
function standoff(p: Person, b: Beast, r: number) {
  const a = Math.atan2(p.z - b.z, p.x - b.x);
  const k = Math.max(0.8, r * 0.8);
  return { x: b.x + Math.cos(a) * k, z: b.z + Math.sin(a) * k };
}

function defendPlan(w: WorldState, p: Person, b: Beast): Act | null {
  // 비어 있는 망루·성루·포대가 가까우면 올라가서 쏜다
  const tower = nearest(w.structures, b.x, b.z, (s) =>
    !!TOWER[s.type] && s.prog >= 1 && (s.dmg ?? 0) < 0.6 && dist(s.x, s.z, b.x, b.z) < towerRange(s) + 16 &&
    !w.people.some((q) => q.act?.k === "defend" && q.act.sub === "tower" && q.act.n === s.id), 60);
  if (tower && dist(p.x, p.z, tower.x, tower.z) < 45) return act(w, "defend", tower.x, tower.z, 2 * HOUR, { tid: b.id, n: tower.id, sub: "tower", run: 1 });
  const wp = pickWeapon(w);
  const st = standoff(p, b, wp.range);
  return act(w, "defend", st.x, st.z, 2 * HOUR, { tid: b.id, sub: wp.res || "bare", run: 1 });
}

/** 집이나 튼튼한 건물로 숨는다. 숨을 곳이 없으면 멀리 달아난다 */
function hidePlan(w: WorldState, ctx: Ctx, p: Person, b: Beast): Act {
  const home = homeOf(w, p);
  if (home && shelterOk(home) && dist(home.x, home.z, b.x, b.z) > 3) {
    const st = sleepSpot(w, ctx, p);
    return act(w, "hide", st.x, st.z, 6 * HOUR, { run: 1, tid: b.id });
  }
  const hut = nearest(w.structures, p.x, p.z, (s) => shelterOk(s) && dist(s.x, s.z, b.x, b.z) > 4, 90);
  if (hut) {
    const st = spot(p, hut.x, hut.z, STRUCTS[hut.type].radius * 0.4);
    return act(w, "hide", st.x, st.z, 6 * HOUR, { run: 1, tid: b.id });
  }
  const a = Math.atan2(p.z - b.z, p.x - b.x);
  for (const r of [28, 18, 10]) {
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (ctx.T.isLand(x, z)) return act(w, "hide", x, z, HOUR, { run: 1, tid: b.id });
  }
  return act(w, "hide", p.x, p.z, 30 * MIN, { ph: 1, tid: b.id });
}

/** 쓰나미를 피해 가장 가까운 높은 곳으로 */
function evacPlan(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const T = ctx.T;
  const safe = floodPeak(w) + 2.5;
  for (let r = 4; r <= 48; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + r * 0.37;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (T.isLand(x, z) && T.height(x, z) > safe) return act(w, "evacuate", x, z, 50 * MIN, { run: 1 });
    }
  }
  return null;
}

/** 아프면 집(또는 요양소)에서 앓아눕는다. 아주 위중하면 떨어져서 요양한다 */
function restPlan(w: WorldState, ctx: Ctx, p: Person, apart: boolean): Act | null {
  const inf = infirmary(w);
  if (apart || (!homeOf(w, p) && inf)) {
    if (inf) {
      const s = spot(p, inf.x, inf.z, STRUCTS.infirmary.radius * 0.45);
      return act(w, apart ? "isolate" : "rest", s.x, s.z, (apart ? 6 : 3) * HOUR);
    }
    // 요양소가 없으면 마을에서 떨어진 나무 그늘로
    const c = campOf(w, p);
    const tree = nearest(w.plants, c.x + 18, c.z, (q) => isTree(q.kind) && q.g >= 1 && !q.stump && dist(q.x, q.z, c.x, c.z) > 16 && dist(q.x, q.z, c.x, c.z) < 30, 40);
    const x = tree ? tree.x + 0.8 : c.x + 18, z = tree ? tree.z : c.z;
    if (ctx.T.isLand(x, z)) return act(w, "isolate", x, z, 6 * HOUR);
  }
  const sp = sleepSpot(w, ctx, p);
  return act(w, "rest", sp.x, sp.z, 3 * HOUR);
}

function digPlan(w: WorldState, ctx: Ctx, p: Person, what: "root" | "mineral"): Act | null {
  const T = ctx.T;
  const c = campOf(w, p);
  const pt = T.randomPoint(w, (x, z, b) => {
    const d = dist(x, z, c.x, c.z);
    if (what === "root") return (b === "forest" || b === "grass") && d > 8 && d < 40;
    return (b === "rock" || b === "forest" || (b === "grass" && T.height(x, z) > 4)) && T.slopeAt(x, z) < 0.8 && d < 75;
  }, 60);
  return pt ? act(w, "dig", pt.x, pt.z, 25 * MIN, { res: what }) : null;
}

function decide(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const yrs = age(w, p);
  const T = ctx.T;
  const threat = !!w.disaster && tsunamiThreat(w, p.traits.openness) && T.height(p.x, p.z) < floodPeak(w) + 1.5;
  if (threat) {
    const e = evacPlan(w, ctx, p);
    if (e) return e;
  }
  // 불길 한가운데면 먼저 빠져나온다
  if (w.blazes.length) {
    const f = fleePlan(w, T, p);
    if (f) return f;
  }
  const bst = yrs >= 3 ? threatFor(w, p) : null;
  // 걷지 못하는 아기는 안겨 다니고, 배고프거나 엄마가 멀어지면 운다
  if (yrs < 3) return babyDecide(w, ctx, p);
  const kid = yrs < 12;
  const teen = yrs >= 12 && yrs < 16;
  const elder = yrs >= 65;
  const n = p.needs;
  const { conscientiousness: C, openness: O, extraversion: E, agreeableness: A } = p.traits;
  const cands: Cand[] = [];
  const add = (tag: string, s: number, mk: () => Act | null) => {
    if (s > 0.01) cands.push({ tag, s: s + rand(w) * 0.07 + roleBoost(p, tag), mk });
  };
  const lv = illOf(p);
  const camp = campOf(w, p);
  // 열 살 전의 아이는 부모 곁에서만 지낸다 (돌봐 줄 어른이 없으면 혼자서도 꾸려 간다)
  const cared = yrs < CHILD_AGE && !!kidCands(w, ctx, p, add, bst);
  const neglected = !!p.kid?.want && p.kid.want === "hungry" && w.time - p.kid.since > 1.5 * HOUR;

  // 불이 났다: 물을 퍼 날라 끈다
  const blaze = w.blazes.length && yrs >= 12 && yrs <= 70 && lv < 2 && p.health > 35 ? fireToFight(w, p) : null;
  if (blaze) {
    const crew = dousersOf(w, blaze);
    const home = blaze.sid != null && (blaze.sid === p.home || w.people.some((q) => q.home === blaze.sid && (q.partner === p.id || q.parents.includes(p.id))));
    const near = threatens(w, blaze);
    if (crew < (blaze.sid != null ? 7 : 5)) add("douse", (near ? 1.1 : 0.5) + (home ? 0.35 : 0) + p.traits.conscientiousness * 0.1 - p.emo.fear * 0.15 - crew * 0.03, () => dousePlan(w, T, blaze));
  }
  // 아이를 먹이고, 달래고, 놀아 주고, 재우고, 혼낸다
  if (yrs >= 14 && lv < 3) careCands(w, p, add);
  // 믿는 종교가 의식을 올리자고 부르면 제단으로
  if (yrs >= 16 && lv < 3) {
    const rc = riteCand(w, p);
    if (rc) add("rite", rc.s, rc.mk);
  }
  // 다른 나라의 전함이 오면: 싸울 수 있는 백성은 바닷가로, 나머지는 집 안으로
  const mc = musterCand(w, T, p);
  if (mc) add("muster", mc.s, mc.mk);
  else if (atWar(w) && (yrs < 16 || yrs > 60 || p.health < 40)) add("shelter", 1.15, () => shelterPlan(w, ctx, p));
  // 갖고 싶은 것을 사고, 넘치게 챙긴 것은 판다
  if (yrs >= 16 && lv < 2) {
    const tc = tradeCand(w, p);
    if (tc) add("trade", tc.s, tc.mk);
  }

  // 맹수가 나타났을 때: 싸울 수 있는 사람은 무기를 들고, 나머지는 집으로 숨는다
  if (bst) {
    const N = p.traits.neuroticism;
    const able = yrs >= 16 && yrs <= 62 && p.health > 40 && lv < 2 && !p.preg;
    const fighting = w.people.filter((q) => q.act?.k === "defend" && q.act.tid === bst.id).length;
    const most = Math.max(2, Math.ceil(ctx.adults * 0.6));
    const others = w.people.filter((q) => q !== p && onIsland(q) && !lying(q) && age(w, q) >= 16 && age(w, q) <= 62 && q.health > 40).length;
    if (able && fighting < most) {
      const odds = (teamPower(w, Math.min(most, ctx.adults)) * 6) / Math.max(1, bst.hp);
      const wp = pickWeapon(w);
      const prey = findById(w.people, bst.target);
      const kin = !!prey && (prey.parents.includes(p.id) || prey.id === p.partner || age(w, prey) < 12);
      const s = 1.0 + (1 - N) * 0.35 - p.emo.fear * 0.25 + wp.dmg / 120 + (odds < 1 ? (kin || bst.siege != null ? -0.25 : -0.7) : odds > 2 ? 0.15 : 0) + (kin ? 0.3 : 0) - (fighting === 0 && others === 0 && odds < 2.5 ? 0.6 : 0);
      add("defend", s, () => defendPlan(w, p, bst));
    }
    add("hide", 0.92 + p.emo.fear * 0.3 + (kid || elder || lv >= 2 ? 0.8 : 0) + (able ? 0 : 0.3), () => hidePlan(w, ctx, p, bst));
  }

  // 아플 때
  if (lv >= 5 && !isolated(w, p)) add("isolate", 1.3, () => restPlan(w, ctx, p, true));
  else if (lv >= 3) add("rest", lv >= 4 ? 1.1 : 0.85, () => restPlan(w, ctx, p, lv >= 5));
  else if (lv === 2 && n.energy < 55) add("rest", 0.5, () => restPlan(w, ctx, p, false));
  if (lv >= 2 && lv <= 3 && w.time - (p.seen.medAt ?? -1e9) > 4 * HOUR) {
    const med = medForP(w, p);
    if (med) add("medicate", 0.8 + lv * 0.05, () => {
      const st = spot(p, ctx.storage.x, ctx.storage.z, 1.1);
      return act(w, "medicate", st.x, st.z, 4 * MIN);
    });
  }

  if (p.carry) {
    const st = ctx.storage;
    add("deposit", 0.6, () => act(w, "gather", st.x, st.z, 0, { ph: 2, res: p.carry!.res }));
  }

  // 수면
  const night = ctx.hour >= 21 || ctx.hour < 5.5;
  let sleepS = 0;
  if (night && n.energy < 92) sleepS = 0.78 + urg(n.energy, 100) * 0.4;
  else if (n.energy < 20) sleepS = 0.9;
  else if (n.energy < 35 && ctx.hour > 12.5) sleepS = 0.45;
  if (kid && ctx.hour >= 20) sleepS += 0.25;
  if (cared && yrs < THINK_AGE && p.kid?.want === "sleepy" && n.energy > 30) sleepS -= 0.35;
  add("sleep", sleepS, () => {
    const s = sleepSpot(w, ctx, p);
    return act(w, "sleep", s.x, s.z, 12 * HOUR);
  });

  // 먹기 / 마시기
  const carryFood = !!(p.carry && FOOD[p.carry.res]);
  if ((ctx.food >= 1 || carryFood) && n.hunger < 72 && (!cared || yrs >= THINK_AGE || neglected)) {
    add("eat", Math.pow(urg(n.hunger, 72), 1.2) * 1.25 + 0.06, () => {
      if (carryFood) return act(w, "eat", p.x, p.z, 10 * MIN, { ph: 1 });
      const s = spot(p, ctx.storage.x, ctx.storage.z, 1.2);
      return act(w, "eat", s.x, s.z, 10 * MIN);
    });
  }
  if (n.thirst < 70) add("drink", Math.pow(urg(n.thirst, 70), 1.1) * 1.35 + 0.06, () => drinkPlan(w, ctx, p));

  // 선물
  const gift = nearest(w.items, p.x, p.z, (i) => !i.held && i.gift > 0 && i.gift > w.time - 2 * HOUR, 16);
  if (gift) add("gift", 0.78 + (FOOD[gift.res] && n.hunger < 60 ? 0.15 : 0), () => act(w, "collect", gift.x, gift.z, 2 * MIN, { tid: gift.id }));
  if (!kid) {
    const stunned = nearest(w.animals, p.x, p.z, (x) => x.st === "stun" && !x.tame && !x.held, 22);
    if (stunned) add("catch", 0.84, () => planHunt(w, ctx, p, stunned));
  }

  // 먹을 것 구하기
  const hungerNoFood = ctx.food < 1 && !carryFood ? urg(n.hunger, 80) : 0;
  const foodNeed = Math.max(ctx.foodDeficit, hungerNoFood);
  if (foodNeed > 0.05 && !cared) {
    add("forage", 0.18 + foodNeed * 0.5 + hungerNoFood * 0.45, () => foragePlan(w, ctx, p));
    if (!kid || yrs >= 9) {
      add("fish", 0.12 + foodNeed * 0.42 + (stockOf(w, "rod") >= 1 ? 0.12 : 0) + hungerNoFood * 0.2, () => planFish(w, ctx, p));
    }
    if (!kid && !teen && !elder) {
      add("hunt", 0.08 + foodNeed * 0.45 + (stockOf(w, "spear") >= 1 ? 0.1 : 0) + (stockOf(w, "bow") >= 1 ? 0.08 : 0) + (1 - A) * 0.05, () => planHunt(w, ctx, p));
    }
  }

  // 추위 / 폭풍
  if (n.warmth < 58) {
    const u = urg(n.warmth, 58);
    const fire = nearest(ctx.fires, p.x, p.z, undefined, 70);
    if (fire) {
      add("warm", u * 1.1 + 0.12, () => {
        const s = spot(p, fire.x, fire.z, 1.5);
        return act(w, "warm", s.x, s.z, range(w, 30, 50) * MIN, { tid: fire.id });
      });
    }
    if (homeOf(w, p)) add("shelter", u * 0.7, () => shelterPlan(w, ctx, p));
  }
  if (ctx.weather === "storm" || (ctx.weather === "snow" && n.warmth < 50)) {
    add("shelter", 0.72 + p.emo.fear * 0.3, () => shelterPlan(w, ctx, p));
  }

  // 불
  const cf = fireFor(w, ctx, p);
  if (knows(w, "fire") && !kid) {
    const raw = stockOf(w, "meat") + stockOf(w, "fish");
    const wantsFire = ctx.evening || ctx.night || ctx.temp < 14 || n.warmth < 50 || (knows(w, "cooking") && raw >= 2);
    const fuel = stockOf(w, "wood") >= 1 || stockOf(w, "stick") >= 2;
    if (cf && cf.lit && cf.fuel < 50 && wantsFire && fuel) {
      add("tend", 0.42 + (50 - cf.fuel) / 120, () => {
        const s = spot(p, cf.x, cf.z, 1);
        return act(w, "tend", s.x, s.z, 3 * MIN, { tid: cf.id });
      });
    }
    if ((!cf || !cf.lit) && wantsFire && ctx.weather !== "storm" && stockOf(w, "stick") >= 2) {
      add("makefire", 0.5 + (ctx.evening ? 0.12 : 0) + (n.warmth < 45 ? 0.2 : 0), () => {
        const s = spot(p, camp.x, camp.z, 1);
        return act(w, "makefire", s.x, s.z, 20 * MIN, { tid: cf?.id });
      });
    }
    if (knows(w, "cooking") && raw >= 1 && cf && cf.lit) {
      add("cook", 0.42 + Math.min(0.3, raw * 0.04), () => {
        const s = spot(p, cf.x, cf.z, 1.1);
        return act(w, "cook", s.x, s.z, 15 * MIN, { tid: cf.id });
      });
    }
  }

  // 재료 모으기
  if (!kid || teen) {
    const wants = (ctx.memo.wants ??= materialWants(w, ctx)) as Stock;
    for (const res of GATHER_RES) {
      const want = wants[res] ?? 0;
      if (!want) continue;
      if (teen && (res === "wood" || res === "ore" || res === "clay")) continue;
      const deficit = want - stockOf(w, res);
      if (deficit <= 0) continue;
      const proj = (ctx.need[res] ?? 0) > 0 ? 0.08 : 0;
      add(`gather:${res}`, 0.16 + 0.42 * Math.min(1, deficit / want) * (0.7 + 0.6 * C) + proj, () => planGather(w, p, res));
    }
  }

  // 제작
  if (!kid) {
    for (const rc of recipesFor(w, ctx)) {
      if (!hasStock(w, rc.cost)) continue;
      const essential = (rc.id === "handaxe" && stockOf(w, "handaxe") < 1) || (rc.id === "rope" && (ctx.need.rope ?? 0) > stockOf(w, "rope"));
      add(`craft:${rc.id}`, 0.36 + (essential ? 0.25 : 0) + C * 0.08, () => {
        const ws = w.structures.find((s) => (s.type === (rc.needs ?? "workshop")) && s.prog >= 1);
        const c = ws ?? cf ?? w.camp;
        const s = spot(p, c.x, c.z, 1.6);
        return act(w, "craft", s.x, s.z, (rc.hours * HOUR) / (toolMul(w) * skill(p, "craft")), { sub: rc.id });
      });
    }
  }

  // 건설
  if (!kid && w.time - (p.seen.buildFail ?? -1e9) > 0.5 * HOUR) {
    const ps = projects(w);
    const grave = ps.find((s) => s.type === "grave");
    const proj = grave ?? ps.find((s) => s.plan !== 0 && (s.paid || hasStock(w, STRUCTS[s.type].cost)));
    if (proj && (proj.paid || hasStock(w, STRUCTS[proj.type].cost))) {
      const housing = isHouse(proj.type) && houseCapacity(w) < ctx.pop ? 0.12 : 0;
      add("build", 0.34 + 0.3 * C + (proj.type === "grave" ? 0.35 : 0) + housing - (elder ? 0.1 : 0), () => {
        const ang = Math.atan2(p.z - proj.z, p.x - proj.x);
        const r = STRUCTS[proj.type].radius + 0.5;
        return act(w, "build", proj.x + Math.cos(ang) * r, proj.z + Math.sin(ang) * r, 1 * HOUR, { tid: proj.id });
      });
    }
  }

  // 처음 짓는 건물은 누군가 용도에 맞게 설계부터 한다
  if (!kid && !teen) {
    const draft = projects(w).find((s) => s.plan === 0 && !w.people.some((q) => q !== p && q.act?.k === "design" && q.act.tid === s.id));
    if (draft) {
      add("design", 0.4 + O * 0.2 + C * 0.1, () => {
        const st = spot(p, draft.x, draft.z, STRUCTS[draft.type].radius + 0.8);
        return act(w, "design", st.x, st.z, (40 * MIN) / skill(p, "think"), { tid: draft.id });
      });
    }
  }

  // 부서진 것 고치기
  if (!kid) {
    const broken = (ctx.memo.broken ??= damaged(w).filter((x) => x.fix || hasStock(w, repairCost(x)))) as Structure[];
    const st = nearest(broken, p.x, p.z);
    if (st) {
      add("repair", 0.36 + 0.25 * C + (isHouse(st.type) ? 0.12 : 0) + ((st.dmg ?? 0) >= 0.6 ? 0.1 : 0), () => {
        const ang = Math.atan2(p.z - st.z, p.x - st.x);
        const r = STRUCTS[st.type].radius + 0.5;
        return act(w, "repair", st.x + Math.cos(ang) * r, st.z + Math.sin(ang) * r, 1 * HOUR, { tid: st.id });
      });
    }
  }

  // 재해가 지나간 뒤에는 모여서 의논한다
  const H = w.history;
  if (!kid && H.lastDisaster && !w.disaster && w.time - H.lastDisaster < 1.2 * DAY && (p.seen.council ?? 0) < H.lastDisaster) {
    add("council", 0.7, () => {
      const f = fireFor(w, ctx, p) ?? camp;
      const s = spot(p, f.x, f.z, 2.4);
      return act(w, "council", s.x, s.z, 45 * MIN);
    });
  }

  // 아픈 사람 돌보기
  if (!kid && lv <= 1) {
    const nursing = (ctx.memo.nursing ??= new Set(w.people.filter((q) => q.act?.k === "nurse").map((q) => q.act!.tid))) as Set<number | undefined>;
    let best: Person | null = null, bs = 0;
    for (const q of w.people) {
      if (q === p || !onIsland(q) || illOf(q) < 2 || nursing.has(q.id)) continue;
      if (w.time - (q.seen.nursed ?? -1e9) < 5 * HOUR) continue;
      const family = q.partner === p.id || q.parents.includes(p.id) || p.parents.includes(q.id);
      const med = medForP(w, q);
      if (illOf(q) >= 5 && isolated(w, q) && !family && p.role !== "healer" && !med) continue;
      const sc = 0.3 + A * 0.25 + (family ? 0.25 : 0) + illOf(q) * 0.06 + (med ? 0.15 : 0) - dist(p.x, p.z, q.x, q.z) * 0.004;
      if (sc > bs) {
        bs = sc;
        best = q;
      }
    }
    if (best) {
      const q = best;
      add("nurse", bs, () => {
        nursing.add(q.id);
        return act(w, "nurse", q.x, q.z, 20 * MIN, { tid: q.id });
      });
    }
  }

  // 약재 찾기: 뿌리는 숲의 땅속에, 약돌은 산자락 어딘가에
  if (!kid && knows(w, "herbs")) {
    const needRoot = !w.found.includes("root") || (knows(w, "remedy") && stockOf(w, "root") < 3);
    const needMineral = knows(w, "remedy") && !w.found.includes("mineral") && w.deposits.length > 0;
    if (needRoot || needMineral) {
      const blocked = (ctx.memo.blocked ??= blockedByFound(w).length > 0) as boolean;
      add("dig", 0.16 + O * 0.1 + (sickCount(w, ctx) ? 0.2 : 0) + (blocked ? 0.22 : 0), () =>
        digPlan(w, ctx, p, needMineral && (!needRoot || chance(w, 0.5)) ? "mineral" : "root"));
    }
  }

  // 무리끼리 싸움이 붙었을 때
  const wg = warOf(w, p);
  if (wg && !kid && !teen && !elder && lv < 2) {
    const fights = (ctx.memo.fights ??= w.people.filter((q) => q.act?.k === "fight").length) as number;
    if (fights < Math.max(2, ctx.adults / 4)) {
      const foe = nearest(w.people, p.x, p.z, (q) => onIsland(q) && enemies(w, p, q) && !lying(q) && isAdult(w, q), 45);
      if (foe) add("fight", 0.26 + p.emo.anger * 0.5 + (1 - A) * 0.25, () => act(w, "fight", foe.x, foe.z, 8 * MIN, { tid: foe.id, run: 1 }));
    }
  }

  // 섬 밖으로 떠날 채비
  const trip = voyageOf(w, p);
  if (trip && !trip.left) {
    add("board", 1.4, () => {
      const bp = boardPoint(w, trip);
      const s = spot(p, bp.x, bp.z, 1.2);
      return act(w, "board", s.x, s.z, 3 * HOUR);
    });
  }

  // 농사 / 목축
  if (!kid && knows(w, "agriculture")) {
    const fw = (ctx.memo.farm ??= farmWork(w)) as ReturnType<typeof farmWork>;
    const plenty = stockOf(w, "crop") > ctx.pop * 12;
    if (fw.ripe.length) add("farm", 0.48 + C * 0.1, () => planFarm(w, p, fw));
    else if (fw.empty.length && !plenty) add("farm", 0.24 + ctx.foodDeficit * 0.3 + C * 0.08, () => planFarm(w, p, fw));
  }
  if (!kid && !elder && knows(w, "husbandry") && w.animals.filter((a) => a.tame).length < 7) add("tame", 0.26, () => planTame(w, p));

  // 생각
  if (w.tech.focus && n.hunger > 35 && n.thirst > 35 && n.energy > 25 && (!kid || yrs >= 10)) {
    // 이미 여럿이 골똘히 생각 중이면 다른 일을 찾는다
    const thinkers = (ctx.memo.thinkers ??= w.people.filter((q) => q.alive && q.act?.k === "think").length) as number;
    const crowd = Math.max(0, thinkers - Math.max(1, ctx.adults / 4)) * 0.08;
    add("think", 0.1 + 0.3 * O + (mood(p) > 0.2 ? 0.08 : 0) + (ctx.evening ? 0.05 : 0) - crowd, () => thinkPlan(w, ctx, p));
  }

  // 사교 / 여가 / 애도
  if (n.social < 70 && !cared) {
    const q = partnerFor(w, p);
    if (q) add("chat", urg(n.social, 70) * 0.75 * (0.5 + E) + 0.05 + ((p.rel[q.id] ?? 0) > 0.5 ? 0.05 : 0), () => chatPlan(w, p, q));
  }
  // 여유는 즐거움이 바닥날 때만이 아니라 평소에도 조금씩
  if (!cared) add("leisure", urg(n.fun, 70) * 0.7 + 0.14 + (dominant(p)[0] === "joy" ? 0.05 : 0) + (ctx.hour >= 17.5 && ctx.hour < 20 ? 0.06 : 0), () => leisurePlan(w, ctx, p));
  if (p.grief && w.time - (p.seen.mourn ?? 0) > 0.6 * DAY) {
    add("mourn", 0.45, () => {
      const dead = findById(w.people, p.grief!.id);
      const g = w.structures.find((s) => s.type === "grave" && s.name === dead?.name) ?? w.structures.find((s) => s.type === "grave");
      if (!g) return null;
      const s = spot(p, g.x, g.z, 1);
      return act(w, "mourn", s.x, s.z, 30 * MIN);
    });
  }

  if (kid && !cared) {
    add("play", 0.32 + urg(n.fun, 85) * 0.4, () => {
      const s = spot(p, camp.x + range(w, -8, 8), camp.z + range(w, -8, 8), 1);
      if (!T.isLand(s.x, s.z)) return null;
      return act(w, "play", s.x, s.z, range(w, 10, 25) * MIN, { run: 1 });
    });
    const parent = p.parents.map((id) => findById(w.people, id)).find((q) => q?.alive);
    if (parent && dist(p.x, p.z, parent.x, parent.z) > 14) add("follow", 0.4, () => act(w, "follow", parent.x, parent.z, 15 * MIN, { tid: parent.id }));
  }

  // 탐험 / 배회
  const early = w.time < 3 * DAY;
  const prospect = !w.found.includes("vein") && knows(w, "polished") && !kid;
  if (!cared) add("explore", (0.1 + O * 0.12) * (early ? 1.5 : prospect ? 1.1 : 0.4), () => {
    const pt = prospect && chance(w, 0.6)
      ? T.randomPoint(w, (x, z) => T.isLand(x, z) && dist(x, z, w.camp.x, w.camp.z) > 40, 60)
      : T.randomPoint(w, (x, z) => T.isLand(x, z) && dist(x, z, p.x, p.z) > 15 && dist(x, z, p.x, p.z) < 45, 40);
    return pt ? act(w, "explore", pt.x, pt.z, range(w, 5, 15) * MIN) : null;
  });
  if (!cared) add("wander", 0.1, () => {
    const pt = T.randomPoint(w, (x, z) => T.isLand(x, z) && dist(x, z, p.x, p.z) < 10, 20);
    return pt ? act(w, "wander", pt.x, pt.z, range(w, 5, 15) * MIN) : null;
  });

  // 많이 아프면 쉬고 먹는 것 말고는 하지 않는다
  const list = lv >= 3 ? cands.filter((c) => SICK_OK.has(c.tag)) : cands;
  list.sort((a, b) => b.s - a.s);
  for (const c of list) {
    const a = c.mk();
    if (a) return a;
  }
  if (lv >= 3) return restPlan(w, ctx, p, lv >= 5);
  return act(w, "idle", p.x, p.z, range(w, 10, 20) * MIN, { ph: 1, sub: chance(w, 0.5) ? "sit" : undefined });
}

export const ACT_LABEL: Record<ActKind, string> = {
  idle: "쉬는 중", wander: "어슬렁거리는 중", sleep: "자는 중", eat: "먹는 중", drink: "물 마시는 중",
  forage: "먹을 것을 찾는 중", gather: "재료를 모으는 중", craft: "도구를 만드는 중", build: "짓는 중",
  think: "골똘히 생각하는 중", hunt: "사냥하는 중", fish: "물고기를 잡는 중", cook: "요리하는 중",
  tend: "불을 돌보는 중", makefire: "불을 피우는 중", chat: "이야기하는 중", leisure: "여유를 즐기는 중",
  farm: "밭일하는 중", shelter: "비바람을 피하는 중", warm: "불을 쬐는 중", mourn: "애도하는 중",
  care: "아이를 돌보는 중", collect: "줍는 중", react: "", unconscious: "정신을 잃은 상태",
  explore: "섬을 둘러보는 중", tame: "짐승을 길들이는 중", play: "노는 중", follow: "따라가는 중",
  rest: "앓아누워 쉬는 중", isolate: "떨어져서 요양하는 중", nurse: "아픈 사람을 돌보는 중", medicate: "약을 먹는 중",
  dig: "땅을 파며 약재를 찾는 중", council: "모여서 의논하는 중", repair: "부서진 곳을 고치는 중",
  evacuate: "높은 곳으로 피하는 중", fight: "다투는 중", board: "떠날 채비를 하는 중",
  defend: "맹수와 맞서 싸우는 중", hide: "맹수를 피해 숨은 중", design: "건물을 설계하는 중",
  douse: "물을 퍼 날라 불을 끄는 중", flee: "불길을 피해 달아나는 중",
  carried: "품에 안겨 있는 중", fuss: "보채는 중", assist: "어른 일을 거드는 중",
  rite: "제단에서 의식을 올리는 중", trade: "물건을 사고파는 중", muster: "나라를 지키러 바닷가에 모인 중",
};

const FUSS_LABEL: Record<string, string> = {
  cry: "엉엉 우는 중", tantrum: "떼쓰는 중", hungry: "배고프다고 보채는 중", play: "놀아 달라고 조르는 중", sleepy: "졸려서 칭얼대는 중",
  cling: "엄마 품을 파고드는 중", fed: "밥을 받아먹는 중", hug: "품에 안겨 달래지는 중", scolded: "혼나서 풀이 죽은 중", lull: "자장가를 듣는 중",
};
const CARE_LABEL: Record<string, string> = {
  feed: "아이를 먹이는 중", comfort: "아이를 달래는 중", play: "아이와 놀아 주는 중", scold: "아이를 혼내는 중", lull: "아이를 재우는 중", pickup: "아이를 안으러 가는 중",
};

export function actLabel(a: Act | null) {
  if (!a) return "";
  if (a.k === "gather" && a.ph === 2) return `${RES_NAME[a.res!] ?? "짐"}을(를) 나르는 중`;
  if (a.k === "gather" && a.res && METAL_INFO[a.res as Metal]) return `광맥에서 ${RES_NAME[a.res]} 캐는 중`;
  if (a.k === "gather" && a.res) return a.res === "wood" ? "나무를 베는 중" : `${RES_NAME[a.res]} 모으는 중`;
  if (a.k === "douse") return a.ph === 2 ? "물을 날라 오는 중" : a.sub === "throw" ? "불길에 물을 끼얹는 중" : a.sub === "scoop" ? "물을 퍼 담는 중" : ACT_LABEL.douse;
  if (a.ph === 2) return "짐을 나르는 중";
  if (a.k === "leisure") {
    return { sea: "바다를 바라보는 중", stars: "별을 보는 중", sing: "노래하는 중", draw: "모래에 그림 그리는 중", swim: "헤엄치는 중", dance: "춤추는 중" }[a.sub ?? "sea"] ?? ACT_LABEL.leisure;
  }
  if (a.k === "think" && a.sub === "study") return "기록을 읽으며 연구하는 중";
  if (a.k === "think" && a.sub === "stars") return "별을 관찰하는 중";
  if (a.k === "farm") return a.sub === "harvest" ? "수확하는 중" : "씨앗을 심는 중";
  if (a.k === "fish" && a.sub === "boat") return "배를 타고 고기를 잡는 중";
  if (a.k === "dig" && a.res === "mineral") return "땅을 파며 광맥을 찾는 중";
  if (a.k === "fuss") return FUSS_LABEL[a.sub ?? ""] ?? ACT_LABEL.fuss;
  if (a.k === "care") return CARE_LABEL[a.sub ?? ""] ?? ACT_LABEL.care;
  if (a.k === "idle" && a.sub === "crawl") return "엉금엉금 기어다니는 중";
  if (a.k === "wander" && a.sub === "stray") return "몰래 멀리까지 가 보는 중";
  if (a.k === "defend") return a.sub === "tower" ? "높은 곳에서 맹수를 겨누는 중" : `${weaponOf(a.sub).name}${a.sub && a.sub !== "bare" ? "을(를) 들고" : "으로"} 맹수와 맞서는 중`;
  return ACT_LABEL[a.k];
}
