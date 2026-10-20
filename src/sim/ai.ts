// 규칙 기반 Utility AI: 욕구·감정·성격·마을 상황을 점수로 바꿔 가장 높은 행동을 고른다.
import { DAY, HOUR, MIN, WALK_SPEED } from "./constants";
import { seasonOf } from "./clock";
import { FOOD, RECIPES, Recipe, RES_NAME, STRUCTS } from "./data";
import { isTree } from "./ecology";
import { clamp } from "./noise";
import {
  age, Ctx, dominant, feel, homeOf, isAdult, lying, mood, nearFire, say,
} from "./people";
import { chance, int, rand, range } from "./rng";
import {
  addResearch, buildMul, carryCap, completeStructure, houseCapacity, isHouse, projects, toolMul,
} from "./settlement";
import type { Act, ActKind, Anim, Animal, Person, Plant, Res, Stock, Structure, WorldState } from "./types";
import {
  addFx, addStock, bump, dist, findById, hasStock, knows, living, makePlant, makeStructure, nearest, payStock,
  removeById, stockOf,
} from "./world";

type Cand = { tag: string; s: number; mk: () => Act | null };

const urg = (v: number, th: number) => clamp((th - v) / th, 0, 1);

function act(w: WorldState, k: ActKind, x: number, z: number, t: number, extra: Partial<Act> = {}): Act {
  return { k, ph: 0, tx: x, tz: z, t, started: w.time, ...extra };
}

/** 같은 장소에 겹쳐 서지 않도록 사람마다 조금씩 다른 자리 */
function spot(p: Person, x: number, z: number, r = 1.4) {
  const a = (p.id * 2.399) % (Math.PI * 2);
  return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
}

const skill = (p: Person, k: string) => 1 + (p.skills[k] ?? 0) * 0.6;
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
const NEED_ACTS: ActKind[] = ["eat", "drink", "sleep", "warm", "shelter", "forage", "collect", "unconscious", "makefire"];

function abort(p: Person) {
  p.act = null;
}

// ─── 실행 ──────────────────────────────────────────────────────────────

export function runPerson(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  const a0 = p.act;
  if (a0 && a0.k !== "unconscious") {
    if (ctx.weather === "storm" && a0.k !== "shelter" && a0.k !== "sleep" && p.seen.storm !== w.weather.changedAt) {
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

  if (age(w, p) < 3) babyCare(w, ctx, p);

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
        p.anim = a.run ? "run" : p.carry ? "carry" : "walk";
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
  if (yrs < 8) s *= 0.75;
  if (yrs > 65) s *= 0.75;
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
  if (a.ph === 0 && (a.k === "follow" || a.k === "chat") && a.tid != null) {
    const q = findById(w.people, a.tid);
    if (!q || !q.alive) {
      abort(p);
      return false;
    }
    if (a.k === "follow") {
      const s = spot(p, q.x, q.z, 1.2);
      a.tx = s.x;
      a.tz = s.z;
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
      return a.res === "wood" ? "chop" : a.res === "stone" || a.res === "ore" ? "knap" : a.res === "clay" ? "dig" : "pick";
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
    case "idle": return a.sub === "sit" ? "sit" : "idle";
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
    case "mourn": {
      const dead = findById(w.people, p.grief?.id);
      if (dead) say(w, p, "mourn", {}, "🕯️");
      break;
    }
  }
}

function arrive(w: WorldState, ctx: Ctx | null, p: Person, a: Act) {
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
    case "shelter":
      if (ctx.weather !== "storm" && ctx.weather !== "snow" && a.t > 10 * MIN) a.t = Math.min(a.t, 10 * MIN);
      break;
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
  switch (a.k) {
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
        f = makeStructure(w, "campfire", w.camp.x, w.camp.z, 0, true);
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
  }
  if (p.act === a) abort(p);
}

function carryHome(w: WorldState, ctx: Ctx, p: Person, a: Act, res: Res, qty: number) {
  p.carry = { res, qty };
  const s = spot(p, ctx.storage.x, ctx.storage.z, 0.9);
  a.ph = 2;
  a.tx = s.x;
  a.tz = s.z;
}

function deposit(w: WorldState, p: Person) {
  if (!p.carry) return;
  addStock(w, p.carry.res, p.carry.qty);
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

const GATHER_RES: Res[] = ["stick", "wood", "stone", "fiber", "clay", "ore", "herb"];

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
  if (res === "ore") t = 24 * MIN;
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
    } else addResearch(w, p, 5, "medicine");
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
    }
  }
  practice(p, "gather");
  if (qty > 0) return carryHome(w, ctx, p, a, res, qty);
  abort(p);
}

// ─── 제작 ──────────────────────────────────────────────────────────────

function hasBuilt(w: WorldState, type: Structure["type"]) {
  return w.structures.some((s) => s.type === type && s.prog >= 1);
}

export function wantedRecipes(w: WorldState, ctx: Ctx): Recipe[] {
  const adults = Math.max(1, ctx.adults);
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
  };
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
  return bow ? b2 : spear ? b1 : b0;
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

function fishSpot(w: WorldState, ctx: Ctx, p: Person) {
  const dock = w.structures.find((s) => s.type === "dock" && s.prog >= 1);
  if (dock && chance(w, 0.6)) return { x: dock.x, z: dock.z, rot: dock.rot, dock: true };
  const f = nearest(w.fish, p.x, p.z, (x) => x.st !== "held", 60);
  const ang = f ? Math.atan2(f.z, f.x) : Math.atan2(p.z, p.x) + range(w, -0.4, 0.4);
  const sp = ctx.T.shorePoint(ang, 0.3);
  return { x: sp.x, z: sp.z, rot: ang, dock: false };
}

function planFish(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const s = fishSpot(w, ctx, p);
  const rod = stockOf(w, "rod") >= 1, spear = stockOf(w, "spear") >= 1;
  return act(w, "fish", s.x, s.z, range(w, 25, 45) * MIN, {
    n: s.rot, sub: rod ? "rod" : spear ? "spear" : "hand", run: 0, res: s.dock ? "fish" : undefined,
  });
}

function finishFish(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  const base = a.sub === "rod" ? 0.75 : a.sub === "spear" ? 0.55 : 0.35;
  const dock = a.res === "fish";
  let qty = 0;
  if (chance(w, Math.min(0.95, base * (0.85 + skill(p, "fish") * 0.15) * (dock ? 1.3 : 1)))) {
    const f = nearest(w.fish, p.x, p.z, (x) => x.st !== "held", 9);
    if (f) {
      qty = f.kind === "bigfish" ? 3 : 1;
      removeById(w.fish, f.id);
      addFx(w, "splash", f.x, f.z, f.id);
      bump(w);
    } else qty = 1;
    if (dock) qty += 1;
  }
  if (a.sub === "rod") wearTool(w, p, "rod");
  practice(p, "fish");
  addResearch(w, p, 4, "fishing");
  addResearch(w, p, 3, "boat");
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

// ─── 아기 돌봄 ─────────────────────────────────────────────────────────

function babyCare(w: WorldState, ctx: Ctx, p: Person) {
  const carers = p.parents.map((id) => findById(w.people, id)).filter((q): q is Person => !!q && q.alive === 1);
  const carer = carers[0] ?? living(w).find((q) => isAdult(w, q));
  if (!carer) return;
  if (dist(p.x, p.z, carer.x, carer.z) < 5 || dist(p.x, p.z, ctx.storage.x, ctx.storage.z) < 5) {
    if (p.needs.hunger < 55) {
      const food = (["meal", "cookedFish", "cookedMeat", "fruit", "berry", "crop", "fish", "meat"] as Res[]).find((r) => stockOf(w, r) >= 1);
      if (food) {
        addStock(w, food, -1);
        p.needs.hunger = Math.min(100, p.needs.hunger + 45);
      }
    }
    if (p.needs.thirst < 55) p.needs.thirst = 100;
    p.needs.social = Math.min(100, p.needs.social + 2);
    p.needs.fun = Math.min(100, p.needs.fun + 2);
    p.needs.warmth = Math.max(p.needs.warmth, carer.needs.warmth);
  }
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
  if (knows(w, "medicine")) want.herb = 4;
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
  const f = ctx.campFire;
  return spot(p, f?.x ?? w.camp.x, f?.z ?? w.camp.z, 2);
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
    if (q === p || !q.alive || lying(q) || age(w, q) < 3) continue;
    const d = dist(p.x, p.z, q.x, q.z);
    if (d > 45) continue;
    if (q.act && !SOFT.includes(q.act.k) && q.act.k !== "idle") continue;
    const s = (p.rel[q.id] ?? 0) * 2 - d * 0.03 + (q.id === p.partner ? 0.5 : 0);
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
  const s = spot(p, w.camp.x, w.camp.z, range(w, 3, 7));
  return act(w, "leisure", s.x, s.z, t, { sub });
}

function thinkPlan(w: WorldState, ctx: Ctx, p: Person): Act {
  const lib = w.structures.find((s) => (s.type === "library" || s.type === "observatory") && s.prog >= 1);
  const t = range(w, 45, 90) * MIN;
  if (lib) {
    const s = spot(p, lib.x, lib.z, STRUCTS[lib.type].radius + 0.6);
    return act(w, "think", s.x, s.z, t, { sub: "study" });
  }
  if (ctx.night && ctx.weather === "clear") {
    const s = spot(p, w.camp.x, w.camp.z, 5);
    return act(w, "think", s.x, s.z, t, { sub: "stars" });
  }
  const ws = w.structures.find((s) => s.type === "workshop" && s.prog >= 1);
  const f = ctx.campFire;
  const c = ws ?? f ?? w.camp;
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

function decide(w: WorldState, ctx: Ctx, p: Person): Act | null {
  const yrs = age(w, p);
  const T = ctx.T;
  if (yrs < 3) {
    const carer = p.parents.map((id) => findById(w.people, id)).find((q) => q?.alive) ?? living(w).find((q) => isAdult(w, q));
    if (carer && carer.act?.k === "sleep") {
      const s = spot(p, carer.x, carer.z, 0.6);
      return act(w, "sleep", s.x, s.z, 2 * HOUR);
    }
    if (carer && dist(p.x, p.z, carer.x, carer.z) > 3) return act(w, "follow", carer.x, carer.z, 15 * MIN, { tid: carer.id });
    return act(w, "idle", p.x, p.z, 20 * MIN, { ph: 1, sub: "sit" });
  }
  const kid = yrs < 12;
  const teen = yrs >= 12 && yrs < 16;
  const elder = yrs >= 65;
  const n = p.needs;
  const { conscientiousness: C, openness: O, extraversion: E, agreeableness: A } = p.traits;
  const cands: Cand[] = [];
  const add = (tag: string, s: number, mk: () => Act | null) => {
    if (s > 0.01) cands.push({ tag, s: s + rand(w) * 0.07, mk });
  };

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
  add("sleep", sleepS, () => {
    const s = sleepSpot(w, ctx, p);
    return act(w, "sleep", s.x, s.z, 12 * HOUR);
  });

  // 먹기 / 마시기
  const carryFood = !!(p.carry && FOOD[p.carry.res]);
  if ((ctx.food >= 1 || carryFood) && n.hunger < 72) {
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
  if (foodNeed > 0.05) {
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
  const cf = ctx.campFire;
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
        const s = spot(p, w.camp.x, w.camp.z, 1);
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
    const proj = grave ?? ps.find((s) => s.paid || hasStock(w, STRUCTS[s.type].cost));
    if (proj && (proj.paid || hasStock(w, STRUCTS[proj.type].cost))) {
      const housing = isHouse(proj.type) && houseCapacity(w) < ctx.pop ? 0.12 : 0;
      add("build", 0.34 + 0.3 * C + (proj.type === "grave" ? 0.35 : 0) + housing - (elder ? 0.1 : 0), () => {
        const ang = Math.atan2(p.z - proj.z, p.x - proj.x);
        const r = STRUCTS[proj.type].radius + 0.5;
        return act(w, "build", proj.x + Math.cos(ang) * r, proj.z + Math.sin(ang) * r, 1 * HOUR, { tid: proj.id });
      });
    }
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
  if (n.social < 70) {
    const q = partnerFor(w, p);
    if (q) add("chat", urg(n.social, 70) * 0.75 * (0.5 + E) + 0.05 + ((p.rel[q.id] ?? 0) > 0.5 ? 0.05 : 0), () => chatPlan(w, p, q));
  }
  // 여유는 즐거움이 바닥날 때만이 아니라 평소에도 조금씩
  add("leisure", urg(n.fun, 70) * 0.7 + 0.14 + (dominant(p)[0] === "joy" ? 0.05 : 0) + (ctx.hour >= 17.5 && ctx.hour < 20 ? 0.06 : 0), () => leisurePlan(w, ctx, p));
  if (p.grief && w.time - (p.seen.mourn ?? 0) > 0.6 * DAY) {
    add("mourn", 0.45, () => {
      const dead = findById(w.people, p.grief!.id);
      const g = w.structures.find((s) => s.type === "grave" && s.name === dead?.name) ?? w.structures.find((s) => s.type === "grave");
      if (!g) return null;
      const s = spot(p, g.x, g.z, 1);
      return act(w, "mourn", s.x, s.z, 30 * MIN);
    });
  }

  if (kid) {
    add("play", 0.32 + urg(n.fun, 85) * 0.4, () => {
      const s = spot(p, w.camp.x + range(w, -8, 8), w.camp.z + range(w, -8, 8), 1);
      if (!T.isLand(s.x, s.z)) return null;
      return act(w, "play", s.x, s.z, range(w, 10, 25) * MIN, { run: 1 });
    });
    const parent = p.parents.map((id) => findById(w.people, id)).find((q) => q?.alive);
    if (parent && dist(p.x, p.z, parent.x, parent.z) > 14) add("follow", 0.4, () => act(w, "follow", parent.x, parent.z, 15 * MIN, { tid: parent.id }));
  }

  // 탐험 / 배회
  const early = w.time < 3 * DAY;
  add("explore", (0.1 + O * 0.12) * (early ? 1.5 : 0.4), () => {
    const pt = T.randomPoint(w, (x, z) => T.isLand(x, z) && dist(x, z, p.x, p.z) > 15 && dist(x, z, p.x, p.z) < 45, 40);
    return pt ? act(w, "explore", pt.x, pt.z, range(w, 5, 15) * MIN) : null;
  });
  add("wander", 0.1, () => {
    const pt = T.randomPoint(w, (x, z) => T.isLand(x, z) && dist(x, z, p.x, p.z) < 10, 20);
    return pt ? act(w, "wander", pt.x, pt.z, range(w, 5, 15) * MIN) : null;
  });

  cands.sort((a, b) => b.s - a.s);
  for (const c of cands) {
    const a = c.mk();
    if (a) return a;
  }
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
};

export function actLabel(a: Act | null) {
  if (!a) return "";
  if (a.k === "gather" && a.ph === 2) return `${RES_NAME[a.res!] ?? "짐"}을(를) 나르는 중`;
  if (a.k === "gather" && a.res) return a.res === "wood" ? "나무를 베는 중" : `${RES_NAME[a.res]} 모으는 중`;
  if (a.ph === 2) return "짐을 나르는 중";
  if (a.k === "leisure") {
    return { sea: "바다를 바라보는 중", stars: "별을 보는 중", sing: "노래하는 중", draw: "모래에 그림 그리는 중", swim: "헤엄치는 중", dance: "춤추는 중" }[a.sub ?? "sea"] ?? ACT_LABEL.leisure;
  }
  if (a.k === "think" && a.sub === "study") return "기록을 읽으며 연구하는 중";
  if (a.k === "think" && a.sub === "stars") return "별을 관찰하는 중";
  if (a.k === "farm") return a.sub === "harvest" ? "수확하는 중" : "씨앗을 심는 중";
  return ACT_LABEL[a.k];
}
