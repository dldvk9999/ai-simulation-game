// 육아: 열 살이 되기 전의 아이는 부모의 손길이 있어야 자란다.
// 0~2살은 걷지 못해 안겨 다니고, 세 살부터 걷고 말하며, 일곱 살부터 제법 생각을 한다.
// 아이는 부모 곁에서만 놀고, 조르고, 떼쓰고, 울고, 지나치면 혼이 난다.
import { act, spot } from "./acts";
import { HOUR, MIN } from "./constants";
import { FOOD } from "./data";
import { illOf } from "./disease";
import { clamp } from "./noise";
import { age, type Ctx, feel, homeOf, lying, say } from "./people";
import { chance, rand, range } from "./rng";
import { josa } from "./text";
import type { Act, ActKind, Beast, KidMind, KidWant, Person, Res, WorldState } from "./types";
import { addFx, addStock, chron, dist, findById, onIsland, stockOf } from "./world";

/** 걷고 말하기 시작 · 기본적인 생각 · 어린이 시절이 끝나는 나이 */
export const WALK_AGE = 3;
export const THINK_AGE = 7;
export const CHILD_AGE = 10;

/** 열 살 전은 모두 '어린이'다. 그중 걷지 못하는 0~2살은 아기 */
export const stageName = (yrs: number) => (yrs < WALK_AGE ? "어린이 · 아기" : yrs < CHILD_AGE ? "어린이" : null);

export function mind(p: Person): KidMind {
  return (p.kid ??= { want: null, since: 0, mis: 0, good: 0, fuss: 0 });
}

function wish(w: WorldState, p: Person, k: KidWant) {
  const m = mind(p);
  if (m.want !== k) {
    m.want = k;
    m.since = w.time;
  }
}

const urg = (v: number, th: number) => clamp((th - v) / th, 0, 1);

/** 아이를 맡겨 둘 수 없는 일 (위험하거나 멀리 가야 하는 일) */
const AWAY = new Set<ActKind>(["hunt", "defend", "fight", "board", "douse", "tame", "explore", "dig", "unconscious", "isolate", "rest"]);
/** 아기를 안은 채로 할 수 있는 일 (그 밖의 일을 할 때는 곁에 내려놓는다) */
const HOLDING = new Set<ActKind>(["idle", "chat", "care", "leisure", "warm", "shelter", "eat", "drink", "mourn", "council", "evacuate", "hide", "follow", "wander", "flee"]);
/** 일곱 살이 넘으면 곁에서 거들 수 있는 일 */
const HELPABLE = new Set<ActKind>(["forage", "gather", "farm", "cook", "tend", "fish", "build", "repair", "craft"]);

/** 아이를 돌볼 사람: 엄마 → 아빠 → 곁의 어른 (한 번 맡으면 되도록 계속 맡는다) */
export function carerOf(w: WorldState, p: Person): Person | null {
  const ok = (q: Person | undefined): q is Person =>
    !!q && q !== p && q.alive === 1 && onIsland(q) && age(w, q) >= 14 && (!q.act || !AWAY.has(q.act.k)) && illOf(q) < 3;
  const parents = p.parents.map((id) => findById(w.people, id)).filter(ok);
  parents.sort((a, b) => (a.sex === "F" ? 0 : 1) - (b.sex === "F" ? 0 : 1));
  const cur = findById(w.people, p.seen.carer);
  if (ok(cur) && (!parents.length || parents.includes(cur))) return cur;
  let c: Person | null = parents[0] ?? null;
  if (!c) {
    let bd = 40;
    for (const q of w.people) {
      if (!ok(q)) continue;
      const d = dist(p.x, p.z, q.x, q.z);
      if (d < bd) {
        bd = d;
        c = q;
      }
    }
  }
  if (c) p.seen.carer = c.id;
  return c;
}

const holderOf = (w: WorldState, baby: Person) => (baby.act?.k === "carried" ? findById(w.people, baby.act.tid) : undefined);

/** 안고 있는 아기 (화면에서 팔 모양을 바꾸는 데 쓴다) */
export const holding = (w: WorldState, p: Person) => w.people.some((b) => b.act?.k === "carried" && b.act.tid === p.id && b.alive === 1);

function attach(b: Person, c: Person) {
  b.x = c.x + Math.cos(c.rot) * 0.3;
  b.z = c.z + Math.sin(c.rot) * 0.3;
  b.rot = c.rot;
}

export function pickUp(w: WorldState, baby: Person, c: Person) {
  baby.act = act(w, "carried", c.x, c.z, 12 * HOUR, { ph: 1, tid: c.id });
  baby.anim = "held";
  baby.gesture = null;
  baby.seen.carer = c.id;
  if (baby.kid?.want === "cling") baby.kid.want = null;
  attach(baby, c);
}

function putDown(baby: Person, c: Person) {
  const s = spot(baby, c.x, c.z, 0.8);
  baby.x = s.x;
  baby.z = s.z;
  baby.act = null;
}

/** 아기: 어른이 자리를 옮기면 안아 들고, 일을 시작하면 곁에 내려놓는다 */
export function babyTick(w: WorldState, ctx: Ctx, p: Person) {
  const c = carerOf(w, p);
  const held = p.act?.k === "carried";
  if (!c) {
    if (held) p.act = null;
    feedNear(w, ctx, p);
    return;
  }
  const ca = c.act;
  const moving = !!ca && (ca.ph === 0 || ca.ph === 2);
  if (held) {
    const h = holderOf(w, p);
    if (!h || h !== c) {
      if (h) putDown(p, h);
      else p.act = null;
      return;
    }
    if (!moving && !(ca && HOLDING.has(ca.k))) return putDown(p, c);
    attach(p, c);
    p.needs.warmth = Math.max(p.needs.warmth, c.needs.warmth);
    // 안긴 채로 배가 고프면 칭얼댄다
    if (p.needs.hunger < 40 && mind(p).want !== "hungry") {
      wish(w, p, "hungry");
      say(w, p, "babyCry", {}, "🍼", true);
      c.seen.reeval = 0;
    }
    return;
  }
  const d = dist(p.x, p.z, c.x, c.z);
  const flight = ca?.k === "evacuate" || ca?.k === "hide" || ca?.k === "flee";
  if ((moving && d < 6) || (flight && d < 40)) pickUp(w, p, c);
  // 오래 굶겼으면 곁의 누군가가 챙겨 준다
  else if (p.kid?.want === "hungry" && w.time - p.kid.since > 2 * HOUR) feedNear(w, ctx, p);
}

/** 창고 곁에 있으면 누군가 먹이고 입혀 준다 (부모가 없을 때) */
function feedNear(w: WorldState, ctx: Ctx, p: Person) {
  if (dist(p.x, p.z, ctx.storage.x, ctx.storage.z) > 6) return;
  if (p.needs.hunger < 55 && giveFood(w, p)) settle(p, "hungry");
  if (p.needs.thirst < 55) p.needs.thirst = 100;
  p.needs.warmth = Math.max(p.needs.warmth, 60);
}

/** 젖먹이는 엄마가 젖을 물린다 (창고에 먹을 것이 없어도) */
function nurseBaby(w: WorldState, baby: Person, mom: Person) {
  if (mom.sex !== "F" || !baby.parents.includes(mom.id) || age(w, baby) >= 1.5) return false;
  baby.needs.hunger = 100;
  baby.needs.thirst = 100;
  mom.needs.hunger = Math.max(0, mom.needs.hunger - 6);
  mom.needs.thirst = Math.max(0, mom.needs.thirst - 6);
  return true;
}

function giveFood(w: WorldState, p: Person) {
  p.needs.thirst = Math.max(p.needs.thirst, 90);
  const food = (["meal", "cookedFish", "cookedMeat", "fruit", "berry", "crop", "fish", "meat"] as Res[]).find((r) => stockOf(w, r) >= 1);
  if (!food) return false;
  addStock(w, food, -1);
  p.needs.hunger = Math.min(100, p.needs.hunger + (FOOD[food] ?? 30) * 1.4);
  return true;
}

function settle(p: Person, k?: KidWant) {
  if (p.kid && (!k || p.kid.want === k)) p.kid.want = null;
}

/** 어른에게 아이가 보채고 있다고 알린다 (하던 일을 내려놓고 돌아보게) */
function callFor(c: Person | null) {
  if (c && !lying(c)) c.seen.reeval = 0;
}

// ─── 아기의 하루 ───────────────────────────────────────────────────────

export function babyDecide(w: WorldState, ctx: Ctx, p: Person): Act {
  const c = carerOf(w, p);
  const m = mind(p);
  const n = p.needs;
  const yrs = age(w, p);
  if (n.hunger < 45 || n.thirst < 40) wish(w, p, "hungry");
  else settle(p, "hungry");
  // 엄마가 자면 곁에서 잔다. 배가 고프면 밤에도 깨서 엄마를 깨운다
  if (c?.act?.k === "sleep") {
    if (m.want === "hungry" && dist(p.x, p.z, c.x, c.z) < 6) {
      c.act = null;
      say(w, c, "nightFeed", {}, "🍼", true);
      return cry(w, p, "hungry", c);
    }
    const s = spot(p, c.x, c.z, 0.6);
    return act(w, "sleep", s.x, s.z, 2 * HOUR);
  }
  if (m.want === "hungry" && w.time - m.since < 3 * HOUR) return cry(w, p, "hungry", c);
  const night = ctx.hour >= 20 || ctx.hour < 6.5;
  if (n.energy < 40 || (night && n.energy < 85)) return act(w, "sleep", p.x, p.z, range(w, 1, 2.5) * HOUR, { ph: 1 });
  if (c && dist(p.x, p.z, c.x, c.z) > 6) {
    wish(w, p, "cling");
    return cry(w, p, "cling", c);
  }
  settle(p, "cling");
  // 한 살이 넘으면 엄마 곁을 기어다닌다
  if (c && yrs >= 1 && chance(w, 0.6)) {
    const a = rand(w) * Math.PI * 2;
    const r = range(w, 0.8, 2.2);
    return act(w, "idle", c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, range(w, 8, 16) * MIN, { sub: "crawl" });
  }
  return act(w, "idle", p.x, p.z, range(w, 10, 20) * MIN, { ph: 1, sub: "sit" });
}

function cry(w: WorldState, p: Person, why: KidWant, c: Person | null): Act {
  mind(p).fuss = w.time;
  say(w, p, "babyCry", {}, why === "hungry" ? "🍼" : "😭", true);
  addFx(w, "cry", p.x, p.z, p.id);
  callFor(c);
  return act(w, "fuss", p.x, p.z, range(w, 6, 12) * MIN, { ph: 1, sub: "cry" });
}

// ─── 어린이 (3~9살) ────────────────────────────────────────────────────

type Add = (tag: string, s: number, mk: () => Act | null) => void;

/** 어린이가 할 만한 일: 부모 곁에서 놀고, 조르고, 떼쓰고, 운다. 일곱 살부터는 일을 거든다 */
export function kidCands(w: WorldState, ctx: Ctx, p: Person, add: Add, bst: Beast | null): boolean {
  const yrs = age(w, p);
  const m = mind(p);
  const n = p.needs;
  const par = carerOf(w, p);
  const small = yrs < THINK_AGE;
  const R = small ? 6 : 10;
  const T = ctx.T;
  const N = p.traits.neuroticism, E = p.traits.extraversion, O = p.traits.openness, C = p.traits.conscientiousness;
  const good = w.time < m.good;
  // 다치거나 무서우면 운다
  if ((p.seen.hp ?? p.health) - p.health > 3 || p.emo.fear > 0.65) wish(w, p, "cry");
  p.seen.hp = p.health;
  if (!par) return false;
  const d = dist(p.x, p.z, par.x, par.z);
  // 맹수가 오면 어린아이는 엄마 품으로 달려간다
  if (bst && small) add("cling", 2.2, () => act(w, "fuss", par.x, par.z, 20 * MIN, { tid: par.id, sub: "cling", run: 1 }));
  // 멀어지면 따라간다
  // 따라잡으면 잠깐 곁에 섰다가 다시 둘러본다 (부모가 계속 걸으면 또 따라간다)
  if (d > R) add("follow", 0.95 + (d > R * 2 ? 0.35 : 0), () => act(w, "follow", par.x, par.z, range(w, 2, 4) * MIN, { tid: par.id, run: d > R * 2 ? 1 : undefined }));
  // 어린아이는 배가 고프면 먹여 달라고 하고, 밤이면 재워 달라고 한다
  const night = ctx.hour >= 20 || ctx.hour < 6;
  if (small && (n.hunger < 50 || n.thirst < 45)) wish(w, p, "hungry");
  else settle(p, "hungry");
  if (small && night && n.energy < 92 && !lying(par)) wish(w, p, "sleepy");
  else settle(p, "sleepy");
  // 실컷 놀고 싶으면 놀아 달라고 조른다
  if (!m.want && n.fun < 70 && w.time - m.fuss > HOUR && chance(w, 0.2 + E * 0.3 + (small ? 0.15 : 0))) wish(w, p, "play");
  if (m.want && w.time - m.since > 3 * HOUR) settle(p);
  const since = w.time - m.since;
  if (m.want === "cry") {
    add("cry", 1.15, () => {
      m.fuss = w.time;
      say(w, p, "kidCry", {}, "😭", true);
      addFx(w, "cry", p.x, p.z, p.id);
      callFor(par);
      return act(w, "fuss", p.x, p.z, range(w, 5, 11) * MIN, { ph: 1, sub: "cry" });
    });
  } else if (m.want) {
    const want = m.want;
    // 처음엔 졸라 보고, 오래 들어주지 않으면 떼를 쓴다
    const tantrum = since > 40 * MIN && !good && yrs < 9 && chance(w, 0.3 + N * 0.45 - C * 0.15);
    if (tantrum) {
      add("tantrum", 1.05, () => {
        m.fuss = w.time;
        m.mis = Math.min(1, m.mis + 0.18);
        say(w, p, "kidTantrum", {}, "😫", true);
        callFor(par);
        return act(w, "fuss", p.x, p.z, range(w, 6, 13) * MIN, { ph: 1, sub: "tantrum" });
      });
    } else {
      add("beg", want === "play" ? 0.7 : 0.9, () => {
        m.fuss = w.time;
        say(w, p, want === "hungry" ? "kidHungry" : want === "sleepy" ? "kidSleepy" : "kidPlay", { parent: callName(p, par) }, want === "hungry" ? "🍖" : want === "sleepy" ? "🥱" : "🧸", true);
        if (want !== "play") callFor(par);
        return act(w, "fuss", par.x, par.z, range(w, 4, 8) * MIN, { tid: par.id, sub: want });
      });
    }
  }
  // 부모 곁에서 혼자 놀거나 돌아다닌다
  const near = (r: number) => {
    for (let i = 0; i < 8; i++) {
      const a = rand(w) * Math.PI * 2;
      const rr = range(w, 1.5, r);
      const x = par.x + Math.cos(a) * rr, z = par.z + Math.sin(a) * rr;
      if (T.isLand(x, z)) return { x, z };
    }
    return null;
  };
  add("play", 0.34 + urg(n.fun, 85) * 0.4, () => {
    const pt = near(R * 0.7);
    return pt ? act(w, "play", pt.x, pt.z, range(w, 10, 22) * MIN, { run: 1 }) : null;
  });
  add("roam", 0.22 + O * 0.15, () => {
    const pt = near(R * 0.9);
    return pt ? act(w, "wander", pt.x, pt.z, range(w, 5, 12) * MIN) : null;
  });
  // 또래와 어울려 논다
  const mate = w.people.find((q) => q !== p && q.alive && onIsland(q) && age(w, q) >= 3 && age(w, q) < 12 && dist(q.x, q.z, par.x, par.z) < R + 4 && !lying(q));
  if (mate) add("playmate", 0.3 + E * 0.25, () => {
    const s = spot(p, mate.x, mate.z, 1.2);
    return act(w, "play", s.x, s.z, range(w, 12, 25) * MIN, { run: 1 });
  });
  // 말썽: 눈을 피해 멀리까지 가 본다
  if (!good && yrs >= 4) add("stray", 0.06 + O * 0.14 + N * 0.05 - C * 0.05, () => {
    const a = rand(w) * Math.PI * 2;
    const r = R * range(w, 1.6, 2.3);
    const x = par.x + Math.cos(a) * r, z = par.z + Math.sin(a) * r;
    if (!T.isLand(x, z)) return null;
    m.mis = Math.min(1, m.mis + 0.25);
    say(w, p, "kidWander", {}, "👀");
    return act(w, "wander", x, z, range(w, 8, 14) * MIN, { sub: "stray" });
  });
  // 일곱 살부터는 부모 일을 거든다
  const pa = par.act;
  if (!small && pa && HELPABLE.has(pa.k) && dist(p.x, p.z, pa.tx, pa.tz) < 30) {
    add("assist", 0.32 + C * 0.25 + (pa.ph === 1 ? 0.1 : 0), () => {
      const s = spot(p, pa.tx, pa.tz, 1.3);
      return act(w, "assist", s.x, s.z, range(w, 12, 20) * MIN, { tid: par.id });
    });
  }
  return true;
}

/** 아이가 부르는 이름: 엄마 · 아빠 · 이름 */
export const callName = (kid: Person, q: Person) => (kid.parents.includes(q.id) ? (q.sex === "F" ? "엄마" : "아빠") : q.name);

// ─── 부모의 손길 ───────────────────────────────────────────────────────

type CareSub = "feed" | "comfort" | "play" | "scold" | "lull" | "pickup";

/** 돌봐야 할 아이가 있으면 가장 급한 일 하나를 후보에 올린다 */
export function careCands(w: WorldState, p: Person, add: Add) {
  if (age(w, p) < 14) return;
  const A = p.traits.agreeableness, E = p.traits.extraversion, C = p.traits.conscientiousness;
  let best: { c: Person; sub: CareSub; s: number } | null = null;
  for (const c of w.people) {
    if (c === p || !c.alive || !onIsland(c) || !c.kid) continue;
    const cy = age(w, c);
    if (cy >= CHILD_AGE) continue;
    if (!c.parents.includes(p.id) && c.seen.carer !== p.id) continue;
    const d = dist(p.x, p.z, c.x, c.z);
    if (d > 45) continue;
    const m = c.kid;
    // 이미 다른 어른이 돌보러 가고 있다
    if (w.people.some((q) => q !== p && q.act?.k === "care" && q.act.tid === c.id)) continue;
    let sub: CareSub | null = null;
    let s = 0;
    if (cy < WALK_AGE) {
      const carried = c.act?.k === "carried";
      if (m.want === "hungry") [sub, s] = ["feed", 1.25];
      else if (m.want === "cling" || m.want === "cry") [sub, s] = [carried ? "comfort" : "pickup", 1.2];
    } else {
      const fussing = c.act?.k === "fuss" && c.act.sub === "tantrum";
      if (m.want === "hungry") [sub, s] = ["feed", 0.95 + A * 0.15];
      else if (m.want === "cry" || m.want === "cling") [sub, s] = ["comfort", 0.85 + A * 0.3];
      else if (fussing) {
        // 떼가 지나치거나 참을성이 적은 부모는 혼을 낸다
        const strict = m.mis > 0.55 || (m.mis > 0.3 && A < 0.45);
        [sub, s] = strict ? ["scold", 0.9 + (1 - A) * 0.2] : ["comfort", 0.85 + A * 0.2];
      } else if (m.want === "sleepy") [sub, s] = ["lull", 0.75 + A * 0.15];
      else if (m.want === "play") [sub, s] = ["play", 0.4 + A * 0.3 + E * 0.2 - C * 0.1 + urg(p.needs.fun, 70) * 0.3];
      else if (m.mis > 0.7 && d > (cy < THINK_AGE ? 9 : 14)) [sub, s] = ["scold", 0.9];
    }
    if (sub && s > (best?.s ?? 0)) best = { c, sub, s };
  }
  if (!best) return;
  const { c, sub, s } = best;
  add(`care:${sub}`, s, () => act(w, "care", c.x, c.z, 10 * MIN, { tid: c.id, sub, run: sub === "scold" || sub === "pickup" ? 1 : undefined }));
}

const CARE_TIME: Record<CareSub, number> = { feed: 8 * MIN, comfort: 6 * MIN, play: 18 * MIN, scold: 3 * MIN, lull: 12 * MIN, pickup: 0 };
/** 돌봄을 받는 아이의 모습 */
const REACT: Record<CareSub, string> = { feed: "fed", comfort: "hug", play: "play", scold: "scolded", lull: "lull", pickup: "hug" };

/** 부모가 아이 곁에 다다랐다 */
export function careArrive(w: WorldState, p: Person, a: Act) {
  const c = findById(w.people, a.tid);
  if (!c || !onIsland(c) || !c.alive) return false;
  const sub = a.sub as CareSub;
  p.rot = Math.atan2(c.z - p.z, c.x - p.x);
  if (sub === "pickup") {
    if (age(w, c) < WALK_AGE) pickUp(w, c, p);
    say(w, p, "parentPickup", { kid: c.name }, "🤱");
    return false;
  }
  a.t = CARE_TIME[sub];
  const carried = c.act?.k === "carried" && c.act.tid === p.id;
  if (!carried) {
    c.act = act(w, "fuss", c.x, c.z, a.t, { ph: 1, tid: p.id, sub: REACT[sub] });
    c.rot = Math.atan2(p.z - c.z, p.x - c.x);
    c.gesture = null;
  }
  const kid = { kid: c.name, me: callName(c, p) };
  switch (sub) {
    case "feed": say(w, p, "parentFeed", kid, "🥣", true); break;
    case "comfort": say(w, p, "parentComfort", kid, "🫂", true); break;
    case "play": say(w, p, "parentPlay", kid, "🤸", true); break;
    case "scold": say(w, p, "parentScold", kid, "😠", true); break;
    case "lull": say(w, p, "parentLull", kid, "🌙", true); break;
  }
  return true;
}

export function careWork(w: WorldState, p: Person, a: Act, dt: number) {
  const c = findById(w.people, a.tid);
  if (!c || !c.alive) {
    a.t = 0;
    return;
  }
  const h = dt / HOUR;
  if (a.sub === "play") {
    p.needs.fun = Math.min(100, p.needs.fun + h * 30);
    c.needs.fun = Math.min(100, c.needs.fun + h * 60);
    c.needs.social = Math.min(100, c.needs.social + h * 30);
  } else if (a.sub === "comfort") {
    c.emo.sadness = Math.max(0, c.emo.sadness - h * 2);
    c.emo.fear = Math.max(0, c.emo.fear - h * 2);
  }
}

/** 돌봄을 마쳤다: 아이가 달라진다 */
export function careFinish(w: WorldState, ctx: Ctx, p: Person, a: Act) {
  const c = findById(w.people, a.tid);
  if (!c || !c.alive || !onIsland(c)) return;
  const m = mind(c);
  const bond = (v: number) => {
    p.rel[c.id] = clamp((p.rel[c.id] ?? 0.5) + v, -1, 1);
    c.rel[p.id] = clamp((c.rel[p.id] ?? 0.5) + v * 1.5, -1, 1);
  };
  const kid = { kid: c.name, parent: callName(c, p) };
  switch (a.sub as CareSub) {
    case "feed": {
      if (nurseBaby(w, c, p) || giveFood(w, c)) {
        settle(c, "hungry");
        feel(w, c, "joy", 0.2, false);
        bond(0.02);
        if (age(w, c) >= WALK_AGE) say(w, c, "kidFed", kid, "😋", true);
      } else say(w, p, "noFoodKid", {}, "😟");
      break;
    }
    case "comfort": {
      settle(c);
      c.emo.sadness = Math.max(0, c.emo.sadness - 0.3);
      c.emo.fear = Math.max(0, c.emo.fear - 0.3);
      feel(w, c, "love", 0.25, false);
      m.mis = Math.max(0, m.mis - 0.1);
      bond(0.03);
      break;
    }
    case "play": {
      settle(c, "play");
      feel(w, c, "joy", 0.35);
      feel(w, p, "joy", 0.2, false);
      bond(0.04);
      if (chance(w, 0.5)) say(w, c, "kidHappy", kid, "😆", true);
      break;
    }
    case "scold": {
      settle(c);
      m.mis = 0.1;
      m.good = w.time + range(w, 2, 5) * HOUR;
      feel(w, c, "sadness", 0.35, false);
      feel(w, c, "fear", 0.15, false);
      bond(-0.01);
      const sobs = chance(w, 0.35 + c.traits.neuroticism * 0.5);
      say(w, c, sobs ? "kidCry" : "kidScolded", kid, sobs ? "😭" : "😔", true);
      c.act = act(w, "fuss", c.x, c.z, range(w, 4, 9) * MIN, { ph: 1, sub: sobs ? "cry" : "scolded" });
      if (w.time - (w.timers.scoldLog ?? -1e12) > 20 * 86400) {
        w.timers.scoldLog = w.time;
        chron(w, "family", `${josa(p.name, "이/가")} 떼를 쓰던 ${josa(c.name, "을/를")} 따끔하게 혼냈다. ${josa(c.name, "은/는")} 한참을 훌쩍였다.`);
      }
      break;
    }
    case "lull": {
      settle(c);
      const home = homeOf(w, c) ?? homeOf(w, p);
      const s = home ? spot(c, home.x, home.z, 0.8) : { x: c.x, z: c.z };
      c.act = act(w, "sleep", s.x, s.z, 12 * HOUR);
      bond(0.02);
      void ctx;
      break;
    }
  }
}

/** 아이의 행동이 끝났다 (졸랐는데 들어주지 않으면 말썽이 는다) */
export function fussFinish(w: WorldState, p: Person, a: Act) {
  const m = mind(p);
  if (a.sub === "tantrum") m.mis = Math.min(1, m.mis + 0.1);
  else if (a.sub === "cry") {
    if (chance(w, 0.5)) settle(p, "cry");
  } else if ((a.sub === "play" || a.sub === "hungry" || a.sub === "sleepy") && m.want) m.mis = Math.min(1, m.mis + 0.04);
}

/** 부모 곁에서 일을 거든다: 조금씩 손에 익고 생각이 자란다 */
export function assistWork(w: WorldState, p: Person, a: Act, dt: number) {
  const q = findById(w.people, a.tid);
  if (!q || !q.act || !HELPABLE.has(q.act.k)) {
    a.t = 0;
    return;
  }
  const k = q.act.k === "gather" ? "gather" : q.act.k;
  p.skills[k] = Math.min(1, (p.skills[k] ?? 0) + (dt / HOUR) * 0.01);
  p.needs.fun = Math.min(100, p.needs.fun + (dt / HOUR) * 6);
}

export function assistFinish(w: WorldState, p: Person, a: Act) {
  const q = findById(w.people, a.tid);
  if (!q) return;
  feel(w, p, "joy", 0.12, false);
  if (chance(w, 0.4)) say(w, p, "kidHelp", { parent: callName(p, q) }, "💪");
  if (chance(w, 0.3)) say(w, q, "parentPraise", { kid: p.name }, "😊");
}

// ─── 자라는 모습 ───────────────────────────────────────────────────────

/** 걸음마 · 철이 듦 · 어린이 티를 벗음 */
export function dailyKids(w: WorldState) {
  for (const p of w.people) {
    if (!p.alive) continue;
    const yrs = age(w, p);
    const stage = yrs < WALK_AGE ? 0 : yrs < THINK_AGE ? 1 : yrs < CHILD_AGE ? 2 : 3;
    const was = p.seen.stage;
    p.seen.stage = stage;
    if (stage < 3) mind(p);
    else if (p.kid) delete p.kid;
    if (was == null || was === stage) continue;
    const name = p.name;
    if (stage === 1) {
      const mom = p.parents.map((id) => findById(w.people, id)).find((q) => q?.alive);
      chron(w, "family", `${josa(name, "이/가")} 아장아장 걷기 시작하더니 처음으로 "${mom?.sex === "M" ? "아빠" : "엄마"}"라고 불렀다.`);
    } else if (stage === 2) chron(w, "family", `일곱 살이 된 ${josa(name, "이/가")} 제법 철이 들어 어른 일을 거들기 시작했다.`);
    else if (stage === 3) chron(w, "family", `${josa(name, "이/가")} 열 살이 되었다. 이제 부모 곁을 떠나 혼자서도 섬을 돌아다닌다.`);
  }
}
