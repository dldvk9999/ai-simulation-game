// 도박장: 나라를 세우면 지을 수 있다. 백성만 그 시대의 돈으로 1·10·50·100씩 걸 수 있고, 왕과 대신은 하지 않는다.
// 이기면 건 돈의 세 배를 받고 지면 건 돈을 잃는다. 크게 걸수록 이기기 어렵다. 이기면 즐겁고 지면 시무룩하다.
// 너무 자주 이기면 게임중독에 빠져 사흘 동안 집에서 나오지 못하고 몸이 상한다.
// 도박장에 쌓인 돈은 나라 살림으로 옮겨 세금·복지에 쓴다. 왕과 대신은 적당한 놀이는 권하되 중독될 만한 사람은 타이른다.
// 섬 사람 절반이 중독되면 왕은 곧바로 문을 닫고, 그들 가운데 아홉 할이 나아야 다시 연다.
import { act, spot } from "./acts";
import { DAY, HOUR, MIN } from "./constants";
import { FOOD } from "./data";
import { money } from "./economy";
import { shiftMorale } from "./morale";
import { clamp } from "./noise";
import { age, feel, homeOf, say } from "./people";
import { chance, int, range } from "./rng";
import { josa } from "./text";
import type { Act, Casino, Gamble, Person, Res, Structure, WorldState } from "./types";
import { addFx, addStock, bump, chron, dist, findById, living, onIsland, stockOf } from "./world";

/** 걸 수 있는 돈과 그때 이길 확률 (세 배를 주니 모두 1/3보다 낮다) */
export const BETS = [1, 10, 50, 100] as const;
export const WIN_P: Record<number, number> = { 1: 0.31, 10: 0.27, 50: 0.23, 100: 0.19 };
const PAYOUT = 3;
/** 한 판에 걸리는 시간 */
const ROUND = 8 * MIN;
const ADDICT_DAYS = 3;

const nation = (w: WorldState) => w.groups.find((g) => g.kind === "nation");
export const casinoHouse = (w: WorldState) => w.structures.find((s) => s.type === "casino" && s.prog >= 1 && (s.dmg ?? 0) < 0.6);

/** 도박장을 지을 때 */
export const wantCasino = (w: WorldState) => !!nation(w) && !!w.economy && !w.structures.some((s) => s.type === "casino");

function stateOf(w: WorldState): Casino {
  return (w.casino ??= { open: true, bank: 0, plays: 0, took: 0, paid: 0, closed: 0, ids: [], cap: 100, push: 0.3, addicts: 0 });
}
const recOf = (p: Person): Gamble => (p.gamble ??= { plays: 0, wins: 0, last: -1e12, won: 0, lost: 0 });

export const addicted = (w: WorldState, p: Person) => !!p.gamble?.addict && p.gamble.addict > w.time;
export const addicts = (w: WorldState) => living(w).filter((p) => addicted(w, p));
/** 섬 사람 가운데 중독된 사람의 몫 (사기 · 연구에 미친다) */
export function addictShare(w: WorldState) {
  const all = living(w);
  if (!all.length || !w.casino) return 0;
  return all.filter((p) => addicted(w, p)).length / all.length;
}

/** 도박장을 쓸 수 있는 백성: 나라 사람, 어른, 왕과 대신이 아님 */
export function citizen(w: WorldState, p: Person) {
  const g = nation(w);
  return !!g && p.group === g.id && age(w, p) >= 18 && p.role !== "king" && p.role !== "minister";
}

/** 이번에 걸 돈: 가진 돈과 성격에 따라 (겁 없는 사람일수록, 요즘 잘 따는 사람일수록 크게) */
function pickBet(w: WorldState, p: Person, cap: number) {
  const purse = p.purse ?? 0;
  const g = recOf(p);
  const risk = clamp(p.traits.openness * 0.45 + (1 - p.traits.conscientiousness) * 0.35 + p.traits.neuroticism * 0.15 + g.wins * 0.06 + range(w, -0.15, 0.15), 0, 1.2);
  const limit = Math.max(1, purse * (0.08 + risk * 0.35));
  let bet = 1;
  for (const b of BETS) if (b <= cap && b <= limit && b <= purse) bet = b;
  return purse >= 1 ? bet : 0;
}

/** 백성의 놀거리 후보 (일 · 쉼 사이에) */
export function gambleCand(w: WorldState, p: Person, night: boolean): { s: number; mk: () => Act | null } | null {
  const C = w.casino;
  const house = casinoHouse(w);
  if (!house || !C?.open || night || !citizen(w, p)) return null;
  const g = recOf(p);
  if (addicted(w, p) || (g.rest ?? 0) > w.time || (p.purse ?? 0) < 1) return null;
  // 요즘 잘 따는 사람은 더 자주 가고 싶어진다
  const hooked = Math.min(0.25, g.wins * 0.06);
  if (w.time - g.last < (hooked > 0.12 ? 6 : 12) * HOUR) return null;
  const n = p.needs;
  const s = 0.12 + ((100 - n.fun) / 100) * 0.32 + p.traits.extraversion * 0.08 + p.traits.openness * 0.05 + C.push * 0.15 + hooked - p.traits.conscientiousness * 0.1 - (p.ill ?? 0) * 0.1;
  if (s < 0.2) return null;
  return {
    s,
    mk: () => {
      const bet = pickBet(w, p, C.cap);
      if (!bet) return null;
      g.last = w.time;
      const at = tableSpot(house, p);
      return act(w, "gamble", at.x, at.z, int(w, 3, 6) * ROUND, { n: bet, tid: house.id });
    },
  };
}

/** 도박장 안 탁자 둘레의 자리 */
function tableSpot(s: Structure, p: Person) {
  const side = p.id % 2 ? 1 : -1;
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const lx = 0.3, lz = side * 0.95;
  const t = { x: s.x + lx * c - lz * sn, z: s.z + lx * sn + lz * c };
  return spot(p, t.x, t.z, 0.6);
}

/** 판이 돈다: 몇 분마다 한 판 (남은 시간이 판의 길이를 넘어설 때마다) */
export function gambleWork(w: WorldState, p: Person, a: Act, dt: number) {
  const before = Math.ceil(a.t / ROUND - 1e-6);
  const after = Math.ceil((a.t - dt) / ROUND - 1e-6);
  for (let k = after; k < before && p.act === a; k++) round(w, p, a);
}

function round(w: WorldState, p: Person, a: Act) {
  const C = stateOf(w);
  const g = recOf(p);
  let bet = Math.min(a.n ?? 1, C.cap);
  while (bet > (p.purse ?? 0) && bet > 1) bet = BETS[BETS.indexOf(bet as (typeof BETS)[number]) - 1] ?? 1;
  if ((p.purse ?? 0) < bet || !C.open) {
    p.act = null;
    say(w, p, "gambleBroke", {}, "😮‍💨");
    return;
  }
  a.n = bet;
  p.purse = (p.purse ?? 0) - bet;
  C.bank += bet;
  C.took += bet;
  C.plays++;
  g.plays++;
  p.needs.fun = Math.min(100, p.needs.fun + 5);
  addFx(w, "dice", p.x, p.z, p.id, bet);
  const big = Math.log10(bet);
  if (chance(w, WIN_P[bet] ?? 0.2)) {
    const pay = bet * PAYOUT;
    p.purse += pay;
    C.bank -= pay;
    C.paid += pay;
    g.wins += bet >= 50 ? 2 : 1;
    g.won += pay - bet;
    feel(w, p, "joy", 0.18 + big * 0.1);
    feel(w, p, "surprise", 0.15, false);
    p.needs.fun = Math.min(100, p.needs.fun + 8);
    addFx(w, "coin", p.x, p.z, p.id);
    say(w, p, bet >= 50 ? "gambleBig" : "gambleWin", { won: money(w, pay) }, "🤑", true);
    p.gesture = "cheer";
    p.gestureUntil = w.time + 60;
    // 너무 자주, 너무 많이 이기면 중독된다
    if (g.wins >= 5 && g.wins / Math.max(1, g.plays) >= 0.34 && chance(w, 0.3)) hook(w, p);
  } else {
    g.lost += bet;
    feel(w, p, "joy", -(0.08 + big * 0.06), false);
    p.emo.joy = Math.max(0, p.emo.joy);
    feel(w, p, "sadness", 0.06 + big * 0.05, false);
    if (bet >= 50) feel(w, p, "anger", 0.08, false);
    say(w, p, "gambleLose", { lost: money(w, bet) }, "😩");
  }
}

/** 게임중독: 사흘 동안 집에 틀어박힌다 */
function hook(w: WorldState, p: Person) {
  const C = stateOf(w);
  const g = recOf(p);
  g.addict = w.time + ADDICT_DAYS * DAY;
  C.addicts++;
  p.act = null;
  p.gesture = null;
  say(w, p, "addicted", {}, "🎰", true);
  if (C.addicts <= 2 || w.time - (w.timers.casinoLog ?? -1e12) > 6 * DAY) {
    w.timers.casinoLog = w.time;
    chron(w, "casino", `도박장에서 연거푸 돈을 딴 ${josa(p.name, "이/가")} 게임중독에 빠졌다. 사흘 동안 집 밖으로 나오지 않을 것 같다.`);
  }
  shiftMorale(w, -1);
  bump(w);
  checkClose(w);
}

/** 중독된 사람은 집으로 가서 나오지 않는다 */
export function addictPlan(w: WorldState, p: Person, fallback: { x: number; z: number }): Act | null {
  if (!addicted(w, p)) return null;
  const home = homeOf(w, p);
  const at = home ? spot(p, home.x, home.z, 0.5) : fallback;
  return act(w, "addict", at.x, at.z, Math.max(10 * MIN, p.gamble!.addict! - w.time));
}

/** 집 안에서: 밤낮없이 놀음 생각뿐이라 몸이 축난다. 배고프면 집에 있는 것을 대충 집어 먹는다 */
export function addictWork(w: WorldState, p: Person, a: Act, dt: number) {
  const h = dt / HOUR;
  const n = p.needs;
  p.health = Math.max(18, p.health - 0.4 * h);
  n.energy = Math.max(12, n.energy);
  n.fun = Math.max(n.fun, 40);
  if (n.thirst < 30) n.thirst = 65;
  if (n.hunger < 28) {
    const food = (["meal", "crop", "fruit", "berry", "cookedFish", "cookedMeat"] as Res[]).find((r) => stockOf(w, r) >= 1);
    if (food) {
      addStock(w, food, -1);
      n.hunger = Math.min(100, n.hunger + (FOOD[food] ?? 10));
    } else n.hunger = Math.max(n.hunger, 20);
  }
  if (!addicted(w, p)) a.t = Math.min(a.t, 1);
  else if (chance(w, Math.min(1, h * 0.25))) say(w, p, "addictHome", {}, "🎲");
}

/** 사흘이 지나 정신을 차렸다 */
export function addictFinish(w: WorldState, p: Person) {
  const g = p.gamble;
  if (!g || addicted(w, p)) return;
  g.addict = undefined;
  g.rest = w.time + range(w, 8, 14) * DAY;
  g.wins = 0;
  g.plays = 0;
  say(w, p, "addictOver", {}, "😮‍💨", true);
  feel(w, p, "sadness", 0.2, false);
  bump(w);
}

// ─── 왕과 대신의 관리 ───────────────────────────────────────────────

/** 중독될 것 같은 사람 (요즘 자주, 많이 딴다) */
const atRisk = (w: WorldState, p: Person) => !!p.gamble && !addicted(w, p) && (p.gamble.rest ?? 0) <= w.time && (p.gamble.wins >= 2.5 || p.gamble.plays >= 6);

/** 대신이 중독될 것 같은 백성을 찾아가 타이른다 */
export function counselCand(w: WorldState, p: Person): { s: number; mk: () => Act | null } | null {
  if ((p.role !== "minister" && p.role !== "king") || !w.casino || w.time - (p.seen.counsel ?? -1e12) < 4 * HOUR) return null;
  const busy = new Set(w.people.filter((q) => q.act?.k === "counsel").map((q) => q.act!.tid));
  let best: Person | null = null;
  let bs = 0;
  for (const q of w.people) {
    if (!onIsland(q) || busy.has(q.id) || !atRisk(w, q)) continue;
    const sc = q.gamble!.wins + q.gamble!.plays * 0.3 - dist(p.x, p.z, q.x, q.z) * 0.02;
    if (sc > bs) {
      bs = sc;
      best = q;
    }
  }
  if (!best) return null;
  const q = best;
  return {
    s: 0.55 + Math.min(0.3, bs * 0.04),
    mk: () => {
      p.seen.counsel = w.time;
      return act(w, "counsel", q.x, q.z, 15 * MIN, { tid: q.id });
    },
  };
}

export function counselFinish(w: WorldState, p: Person, a: Act) {
  const q = findById(w.people, a.tid);
  if (!q || !onIsland(q) || !q.gamble) return;
  const g = q.gamble;
  // 남의 말을 잘 듣는 사람일수록 오래 멀리한다
  g.rest = w.time + (1.5 + q.traits.agreeableness * 2.5) * DAY;
  g.wins *= 0.35;
  g.plays *= 0.5;
  say(w, p, "counselGive", { name: q.name }, "🧑‍⚖️", true);
  say(w, q, "counselTake", {}, "😅", true);
  q.rel[p.id] = clamp((q.rel[p.id] ?? 0) + 0.02, -1, 1);
}

/** 섬 사람 절반이 중독되면 왕은 곧바로 문을 닫는다 */
function checkClose(w: WorldState) {
  const C = w.casino;
  if (!C?.open) return;
  const all = living(w);
  const ids = all.filter((p) => addicted(w, p)).map((p) => p.id);
  if (!all.length || ids.length < all.length * 0.5) return;
  C.open = false;
  C.closed = w.time;
  C.ids = ids;
  for (const p of w.people) if (p.act?.k === "gamble") p.act = null;
  const king = findById(w.people, nation(w)?.leader);
  chron(w, "casino", `섬 사람 ${all.length}명 가운데 ${ids.length}명이 게임중독에 빠지자 ${king ? `왕 ${josa(king.name, "이/가")}` : "왕실이"} 곧바로 도박장 문을 닫았다. 중독된 이들이 대부분 나을 때까지 열지 않기로 했다.`);
  shiftMorale(w, -4);
  bump(w);
}

/** 매시간: 닫힌 도박장은 중독됐던 사람의 아홉 할이 나으면 다시 연다 */
export function hourlyCasino(w: WorldState) {
  const C = w.casino;
  if (!C || C.open) return;
  const gone = C.ids.filter((id) => {
    const p = findById(w.people, id);
    return !p || !p.alive || !addicted(w, p);
  }).length;
  if (gone < C.ids.length * 0.9) return;
  C.open = true;
  C.ids = [];
  C.cap = Math.min(C.cap, 10);
  chron(w, "casino", "게임중독에 빠졌던 사람들이 거의 다 기운을 되찾았다. 도박장이 다시 문을 열었다. 이번에는 한 번에 거는 돈을 낮게 묶었다.");
  bump(w);
}

/** 매일: 쌓인 돈을 나라 살림으로 옮기고, 놀이를 권할지 · 거는 돈을 묶을지 정한다 */
export function dailyCasino(w: WorldState) {
  const C = w.casino;
  if (!C && casinoHouse(w)) {
    stateOf(w);
    const king = findById(w.people, nation(w)?.leader);
    chron(w, "casino", `${king ? `왕 ${josa(king.name, "이/가")}` : "나라에서"} 도박장 문을 열었다. 백성은 ${money(w, 1)}부터 ${money(w, 100)}까지 걸 수 있고, 이기면 세 배를 받는다. 모인 돈은 나라 살림에 쓴다.`);
    return;
  }
  if (!C) return;
  for (const p of w.people) {
    const g = p.gamble;
    if (!g) continue;
    // 요즘 일은 날이 갈수록 잊는다
    g.plays *= 0.6;
    g.wins *= 0.6;
  }
  // 도박장의 돈은 나라 살림으로 (모자라면 나라 살림에서 채운다)
  if (w.civic) {
    w.civic.fund += C.bank;
    C.bank = 0;
  }
  const all = living(w);
  const share = addictShare(w);
  const risk = all.length ? all.filter((p) => atRisk(w, p)).length / all.length : 0;
  // 중독된 사람이 많으면 사기가 떨어진다
  if (share > 0) shiftMorale(w, -Math.min(6, share * 25));
  // 살림이 넉넉하지 않으면 적당한 놀이를 권하고, 중독이 늘면 자제시킨다
  const before = C.push;
  C.push = clamp(0.55 - share * 4 - risk * 1.5 - (w.civic && w.civic.fund > all.length * 40 ? 0.2 : 0), 0, 0.6);
  if (C.open && before < 0.3 && C.push >= 0.3 && w.time - (w.timers.casinoLog ?? -1e12) > 4 * DAY) {
    w.timers.casinoLog = w.time;
    chron(w, "casino", "왕과 대신들이 '적당한 놀이는 살림에 활력이 된다'며 도박장을 권했다. 다만 지나치지 않도록 지켜보기로 했다.");
  }
  // 거는 돈: 중독이 늘면 곧바로 묶고, 조용한 날이 며칠 이어져야 한 단계씩 푼다
  const need = share >= 0.15 ? 1 : share >= 0.06 || risk >= 0.3 ? 10 : share > 0 || risk >= 0.15 ? 50 : 100;
  C.calm = need >= C.cap ? (C.calm ?? 0) + 1 : 0;
  let cap = C.cap;
  if (need < C.cap) cap = need;
  else if (need > C.cap && (C.calm ?? 0) >= 4) cap = BETS[BETS.indexOf(C.cap as (typeof BETS)[number]) + 1] ?? 100;
  if (cap !== C.cap && C.open) {
    const tighter = cap < C.cap;
    C.cap = cap;
    C.calm = 0;
    const g = nation(w);
    const who = findById(w.people, g?.gov?.treasurer) ?? findById(w.people, g?.leader);
    // 크게 묶을 때는 꼭, 나머지는 가끔만 기록한다
    if ((cap <= 10 && tighter) || w.time - (C.capLog ?? -1e12) > 12 * DAY) {
      C.capLog = w.time;
      chron(w, "casino", tighter
        ? `${who ? `${josa(who.name, "이/가")} ` : ""}중독되는 사람이 늘지 않도록 도박장에서 한 번에 걸 수 있는 돈을 ${money(w, cap)}까지로 묶었다.`
        : `도박장의 분위기가 차분해지자 한 번에 걸 수 있는 돈을 ${money(w, cap)}까지로 풀었다.`);
    }
  }
}

/** 도박장 안내 (사람들 패널) */
export function casinoInfo(w: WorldState) {
  const C = w.casino;
  if (!C) return null;
  return {
    open: C.open,
    cap: money(w, C.cap),
    addicts: addicts(w).length,
    plays: C.plays,
    net: money(w, C.took - C.paid),
    push: C.push >= 0.3,
  };
}

/** 사람 카드 */
export function gambleLabel(w: WorldState, p: Person) {
  const g = p.gamble;
  if (!g || (!g.won && !g.lost)) return "";
  const state = addicted(w, p) ? ` · 🎰 게임중독 (${Math.ceil((g.addict! - w.time) / DAY)}일 남음)` : (g.rest ?? 0) > w.time ? " · 쉬는 중" : "";
  return `🎲 딴 돈 ${money(w, g.won)} · 잃은 돈 ${money(w, g.lost)}${state}`;
}
