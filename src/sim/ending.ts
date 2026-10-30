// 엔딩: 과학 시대에 사람이 100명 모이면 날마다 아침 9시에 30% 확률로 다섯 결말 가운데 하나가 시작된다.
// 핵전쟁 · 우주로 떠남 · 차원문 침공(이기면 평화, 지면 항복) · 영생 · 로봇화.
// 단계마다 걸리는 시간이 게임 시간으로 정해져 있어 오래 비운 섬을 따라잡는 중에도 똑같이 흘러가고,
// 끝나면 크레딧을 띄운다. 외계 생명체 · 우주선 · 버섯구름은 화면에서만 그린다 (alienViews).
import { dayOf, hourOf, yearOf } from "./clock";
import { solidAt, walk } from "./collide";
import { DAY, ENDING_POP, HOUR, WALK_SPEED } from "./constants";
import { STRUCTS } from "./data";
import { clamp } from "./noise";
import { age, feel, injure, type Ctx } from "./people";
import { chance, pick, range } from "./rng";
import { currentEra } from "./settlement";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import { townReach } from "./town";
import type { Anim, Ending, EndingKind, Person, Res, WorldState } from "./types";
import { addFx, bump, chron, dist, findById, humans, knows } from "./world";

export const ENDING_KINDS: EndingKind[] = ["nuke", "space", "alien", "eternal", "robot"];
/** 조건이 갖춰진 동안 이 시각에 하루 한 번 점친다 */
const ROLL_HOUR = 9;
export const ENDING_CHANCE = 0.3;

/** 단계마다 걸리는 시간 (게임 시간). 로봇화의 둘째 단계는 사람이 다 바뀔 때까지 */
const PH: Record<EndingKind, number[]> = {
  nuke: [0.9, 0.6, 0.12, 1.6],
  space: [1.0, 1.6, 0.3, 0.7],
  alien: [0.6, 2.0, 1.0],
  eternal: [0.9, 1.1, 0.7],
  robot: [0.6, 6, 0.5],
};
export const phaseLen = (e: Ending, ph = e.ph) => (PH[e.kind][ph] ?? 0) * HOUR;
/** 그 단계가 시작된 (아직이면 시작될) 시각 */
export function startOf(e: Ending, ph: number) {
  if (e.ts[ph] != null) return e.ts[ph];
  let t = e.ts[e.ts.length - 1];
  for (let i = e.ts.length - 1; i < ph; i++) t += phaseLen(e, i);
  return t;
}

const SHIPS = ["희망", "새벽별", "누리", "한빛", "온새미", "미리내", "아라온"];

export function endingTitle(e: Ending) {
  if (e.kind === "alien") return e.win ? "차원문 전쟁의 승리" : "외계 생명체에게 항복";
  return { nuke: "핵전쟁", space: "별을 향해", eternal: "영원한 삶", robot: "기계의 섬" }[e.kind];
}
export function endingIcon(e: Ending) {
  if (e.kind === "alien") return e.win ? "🛡️" : "🏳️";
  return { nuke: "☢️", space: "🚀", eternal: "✨", robot: "🤖" }[e.kind];
}

/** 크레딧 첫머리의 짧은 이야기 */
export function endingStory(e: Ending): string[] {
  const ship = e.foe ?? "희망";
  switch (e.kind) {
    case "nuke": return [`'${e.foe}'${josa(e.foe ?? "", "과/와").slice((e.foe ?? "").length)}의 전쟁은 끝내 핵무기로 번졌다.`, "한순간의 빛이 섬의 모든 것을 삼켰다.", "잿더미 위로 언젠가 다시 풀이 돋아날까."];
    case "space": return [`섬 사람 ${e.n}명이 우주선 '${ship}'호에 올라 새 별을 찾아 떠났다.`, "텅 빈 마을에는 그들이 남긴 불빛만 깜박인다."];
    case "alien": return e.win
      ? ["차원문 너머에서 쏟아져 나온 외계 생명체를 끝내 물리쳤다.", "차원문은 닫혔고, 섬 사람들은 다시 평화로운 날들을 이어 간다."]
      : ["차원문 너머의 외계 생명체를 막아 내지 못했다.", "섬 사람들은 무기를 내려놓고 낯선 지배자를 맞이했다."];
    case "eternal": return ["과학은 마침내 늙음과 죽음의 비밀을 풀었다.", "섬 사람들은 이제 영원히 함께 살아간다."];
    case "robot": return ["사람들은 하나둘 몸을 기계로 바꾸었다.", "마지막 사람이 사라진 뒤에도 로봇들은 쉬지 않고 섬을 가꾼다."];
  }
}

/** 연출 중에 화면 위에 띄우는 한 줄 */
export function endingCaption(e: Ending) {
  if (e.done != null) return "";
  const C: Record<EndingKind, string[]> = {
    nuke: ["⚠️ 전쟁이 걷잡을 수 없이 번지고 있어요", "🚀 하늘을 가르며 미사일이 날아와요", "☢️ 핵폭발", "🌫️ 잿빛 낙진이 섬을 덮었어요"],
    space: [`🚀 우주선 '${e.foe}'호를 완성해 발사대에 세웠어요`, "🧑‍🚀 모두가 차례로 우주선에 올라요", "⏱️ 발사 준비", "🚀 새 별을 찾아 날아올라요"],
    alien: ["🌀 차원문이 열리고 낯선 것들이 쏟아져 나와요", "👽 외계 생명체와 싸우고 있어요", e.win ? "🎉 외계 생명체를 물리쳤어요" : "🏳️ 외계 생명체에게 항복했어요"],
    eternal: ["✨ 늙음과 죽음의 비밀이 풀렸어요. 모두 광장에 모여요", "✨ 영원한 삶의 빛이 내려요", "🌟 이제 아무도 늙어 죽지 않아요"],
    robot: ["🤖 스스로 생각하는 기계가 태어났어요", "🤖 사람들이 하나둘 기계의 몸을 얻고 있어요", "🤖 섬에 사람은 남지 않았어요"],
  };
  return C[e.kind][e.ph] ?? "";
}

// ─── 시작 ──────────────────────────────────────────────────────────────

export const endingReady = (w: WorldState) => currentEra(w) >= 4 && humans(w).length >= ENDING_POP;

/** 매시간: 엔딩을 맞을 때인지 하루 한 번 점친다 */
export function hourlyEnding(w: WorldState, T: Terrain) {
  if (w.ending || Math.floor(hourOf(w.time)) !== ROLL_HOUR) return;
  const d = dayOf(w.time);
  if (w.timers.endRoll === d || !endingReady(w)) return;
  w.timers.endRoll = d;
  if (chance(w, ENDING_CHANCE)) beginEnding(w, T, pick(w, ENDING_KINDS));
}

export function beginEnding(w: WorldState, T: Terrain, kind: EndingKind, win?: boolean) {
  // 섬 밖에 나가 있던 사람들도 이 날만큼은 돌아와 있다
  for (const p of w.people) if (p.alive && p.away) p.away = null;
  w.voyages = [];
  // 맹수와 재해, 바다 건너 배는 물러간다
  w.beasts = [];
  w.disaster = null;
  w.visit = null;
  const at = siteFor(w, T, kind);
  const e: Ending = { kind, t0: w.time, ph: 0, ts: [w.time], x: at.x, z: at.z, cast: humans(w).map((p) => p.name), n: 0 };
  if (kind === "alien") e.win = (win ?? chance(w, winChance(w))) ? 1 : 0;
  if (kind === "nuke") e.foe = foeOf(w);
  if (kind === "space") e.foe = pick(w, SHIPS);
  w.ending = e;
  for (const p of w.people) if (p.alive && p.act?.k !== "carried") p.act = null;
  enter(w, e);
  bump(w);
}

function siteFor(w: WorldState, T: Terrain, kind: EndingKind) {
  if (kind === "nuke" || kind === "eternal") return { x: w.camp.x, z: w.camp.z };
  if (kind === "alien") {
    const pt = w.structures.find((s) => s.type === "portal" && s.prog >= 1);
    if (pt) return { x: pt.x, z: pt.z };
  }
  return openSpot(w, T, kind === "space" ? 6 : 5);
}

/** 마을 가장자리 안쪽에서 건물도 바위도 없는 평평한 빈터를 찾아 나무를 걷어 낸다 */
function openSpot(w: WorldState, T: Terrain, r: number) {
  const { x: cx, z: cz } = w.camp;
  const inland = Math.atan2(-cz, -cx);
  const reach = townReach(w);
  for (let d = reach * 0.8 + r; d < reach + 60; d += 3) {
    for (let k = 0; k < 24; k++) {
      const a = inland + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (T.height(x, z) < 0.8 || T.slopeAt(x, z) > 0.4 || T.inPond(x, z, r) || T.inMine(x, z, r) || T.biome(x, z) === "rock") continue;
      if (w.structures.some((s) => dist(s.x, s.z, x, z) < r + STRUCTS[s.type].radius + 1)) continue;
      if (w.rocks.some((q) => dist(q.x, q.z, x, z) < r)) continue;
      w.plants = w.plants.filter((p) => dist(p.x, p.z, x, z) > r + 1);
      return { x, z };
    }
  }
  return { x: cx + 8, z: cz + 8 };
}

/** 총과 포대가 많고 사기가 높을수록 이길 수 있다 */
function winChance(w: WorldState) {
  const guns = (w.stock.rifle ?? 0) + (w.stock.musket ?? 0) * 0.6;
  const forts = w.structures.filter((s) => s.prog >= 1 && (s.type === "battery" || s.type === "fort" || s.type === "watchtower")).length;
  return clamp(0.35 + Math.min(0.2, guns / 80) + Math.min(0.15, forts * 0.025) + (knows(w, "rifle") ? 0.08 : 0) + (w.morale - 60) / 300, 0.2, 0.8);
}

/** 사이가 가장 나쁜 바다 건너 나라, 없으면 섬 안의 갈라진 무리 */
function foeOf(w: WorldState) {
  const met = w.nations.filter((n) => n.met);
  if (met.length) return met.reduce((a, b) => (b.mood < a.mood ? b : a)).name;
  return w.groups.find((g) => g.kind !== "nation" && g.camp)?.name ?? "섬 안의 반란군";
}

// ─── 진행 ──────────────────────────────────────────────────────────────

/** 매 스텝: 단계를 넘기고 단계마다 할 일을 한다 */
export function updateEnding(w: WorldState, T: Terrain, dt: number) {
  const e = w.ending;
  if (!e || e.done != null) return;
  // 우주선에 오른 사람은 섬에서 사라진다
  if (w.people.some((p) => p.away?.trip === -1)) w.people = w.people.filter((p) => p.away?.trip !== -1);
  during(w, e, dt);
  if (w.time - e.ts[e.ph] < phaseLen(e) || !phaseOver(w, e)) return;
  e.ph++;
  e.ts.push(w.time);
  if (e.ph >= PH[e.kind].length) finishEnding(w, e);
  else enter(w, e);
  bump(w);
}

function phaseOver(w: WorldState, e: Ending) {
  if (e.kind === "space" && e.ph === 1) {
    const left = w.people.filter((p) => p.alive && !p.away);
    // 너무 오래 걸리면 남은 사람도 서둘러 오른다
    if (left.length && w.time - e.ts[1] > phaseLen(e) * 1.6) for (const p of left) board(w, e, p);
    return !w.people.some((p) => p.alive && !p.away);
  }
  if (e.kind === "robot" && e.ph === 1) return humans(w).length === 0;
  return true;
}

/** 단계에 들어설 때 */
function enter(w: WorldState, e: Ending) {
  const n = humans(w).length;
  const foe = e.foe ?? "";
  if (e.kind === "nuke") {
    if (e.ph === 0) chron(w, "ending", `'${foe}'${josa(foe, "과/와").slice(foe.length)}의 전쟁이 걷잡을 수 없이 번졌다. 끝내 누군가 핵무기의 단추를 눌렀다.`);
    if (e.ph === 2) detonate(w, e);
  } else if (e.kind === "space") {
    if (e.ph === 0) {
      chron(w, "ending", `과학자들이 우주선 '${foe}'호를 완성했다. 섬 사람 모두가 새 별을 찾아 떠나기로 했다.`);
      w.timers.castaway = Math.max(w.timers.castaway, w.time + 8 * DAY);
    }
    if (e.ph === 3) chron(w, "ending", `우주선 '${foe}'호가 불기둥을 뿜으며 하늘 저편으로 날아올랐다. ${e.n}명이 새 별을 찾아 섬을 떠났다.`);
  } else if (e.kind === "alien") {
    if (e.ph === 0) {
      chron(w, "ending", "차원문 너머에서 외계 생명체가 쏟아져 나왔다! 섬 사람들이 무기를 들고 맞섰다.");
      addFx(w, "portal", e.x, e.z);
    }
    if (e.ph === 2) chron(w, "ending", e.win ? "치열한 전쟁 끝에 외계 생명체를 물리쳤다. 차원문이 닫히고 섬에 평화가 찾아왔다." : "외계 생명체를 끝내 막지 못했다. 섬 사람들은 무기를 내려놓고 항복했다.");
  } else if (e.kind === "eternal") {
    if (e.ph === 0) chron(w, "ending", "과학이 마침내 늙음과 죽음의 비밀을 풀었다. 섬 사람 모두가 광장에 모였다.");
    if (e.ph === 2) chron(w, "ending", `섬 사람 ${n}명이 모두 영원한 삶을 얻었다. 이제 아무도 늙거나 죽지 않는다.`);
  } else if (e.kind === "robot") {
    if (e.ph === 0) chron(w, "ending", "과학자들이 스스로 생각하는 기계를 만들었다. 사람들이 하나둘 몸을 기계로 바꾸기 시작했다.");
    if (e.ph === 2) chron(w, "ending", "마지막 사람마저 기계의 몸을 얻었다. 섬에는 이제 로봇만이 남았다.");
  }
  // 놀라고 두렵다
  for (const p of humans(w)) {
    if (e.ph !== 0) break;
    if (e.kind === "nuke" || e.kind === "alien") feel(w, p, "fear", 0.6, false);
    else feel(w, p, "surprise", 0.5, false);
  }
}

/** 단계를 밟는 동안 */
function during(w: WorldState, e: Ending, dt: number) {
  const t = w.time - e.ts[e.ph];
  const len = phaseLen(e);
  if (e.kind === "alien" && e.ph === 1) {
    // 총소리
    if (chance(w, Math.min(1, dt / 40))) {
      const line = w.people.filter((q) => q.alive && q.act?.k === "scene" && q.act.sub === "front" && q.act.ph === 1);
      if (line.length) {
        const p = pick(w, line);
        addFx(w, "shot", p.x, p.z, p.id);
      }
    }
    // 싸움이 길어지면 다치는 사람이 나온다 (지는 쪽이 더 많이)
    if (e.n === 0 && t > len * 0.55) {
      e.n = 1;
      for (const p of w.people) {
        if (!p.alive || p.act?.sub !== "front" || !chance(w, e.win ? 0.08 : 0.25)) continue;
        const dmg = range(w, 10, 24);
        p.health = Math.max(25, p.health - dmg);
        injure(w, p, dmg, "외계 생명체의 광선에 맞음");
        addFx(w, "hit", p.x, p.z, p.id);
      }
    }
  }
  if (e.ph === 2 && ((e.kind === "alien" && e.win) || e.kind === "eternal") && chance(w, Math.min(1, dt / 50))) {
    addFx(w, "firework", w.camp.x + range(w, -14, 14), w.camp.z + range(w, -14, 14));
  }
  if (e.kind === "eternal" && e.ph === 1) {
    const f = form(w, e);
    const due = Math.min(f.order.length, Math.floor(t / ((len * 0.85) / Math.max(1, f.order.length))) + 1);
    while (e.n < due) {
      const p = findById(w.people, f.order[e.n++]);
      if (p?.alive && !p.away) {
        addFx(w, "bless", p.x, p.z, p.id);
        feel(w, p, "joy", 0.5, false);
      }
    }
  }
  if (e.kind === "robot" && e.ph === 1) {
    // 사람이 다 바뀔 때까지 고르게 (중간에 태어나거나 들어온 사람도)
    const gap = len / Math.max(1, e.cast.length);
    const due = Math.floor(t / gap) + 1;
    while (e.n < due) {
      const left = humans(w).filter((p) => !p.away);
      if (!left.length) break;
      robotize(w, pick(w, left));
      e.n++;
      if (e.n === Math.ceil(e.cast.length / 2)) chron(w, "ending", "섬 사람 절반이 기계의 몸을 얻었다. 공장은 밤낮없이 새 몸을 찍어 낸다.");
    }
  }
}

function finishEnding(w: WorldState, e: Ending) {
  e.done = w.time;
  e.ph = PH[e.kind].length - 1;
  e.ts.pop();
  for (const p of w.people) if (p.act?.k === "scene") p.act = null;
  if (e.kind === "space") {
    w.people = w.people.filter((p) => p.away?.trip !== -1);
    w.groups = [];
  }
  if (e.kind === "nuke") w.timers.castaway = Math.max(w.timers.castaway, w.time + 20 * DAY);
  chron(w, "ending", `섬의 이야기가 막을 내렸다. (엔딩 · ${endingTitle(e)})`);
}

/** 섬 한가운데에 핵폭발: 모두가 목숨을 잃고, 마을은 무너지고, 숲은 그루터기만 남는다 */
function detonate(w: WorldState, e: Ending) {
  const n = w.people.filter((p) => p.alive).length;
  w.stats.deaths += n;
  w.people = [];
  w.structures = w.structures.filter((s) => s.prog >= 1 || s.type === "grave");
  for (const s of w.structures) {
    if (s.type === "grave" || s.type === "raft") continue;
    s.dmg = Math.max(s.dmg ?? 0, s.type === "farm" || s.type === "pen" ? 1 : range(w, 0.75, 0.95));
    s.lit = 0;
    s.fuel = 0;
    s.raze = undefined;
  }
  const big = new Set(["palm", "tree", "pine", "fruit"]);
  w.plants = w.plants.filter((p) => big.has(p.kind) && !p.farm);
  for (const p of w.plants) {
    p.stump = 1;
    p.fruit = 0;
    p.burn = 0;
    p.regrow = w.time + range(w, 40, 90) * DAY;
  }
  w.animals = [];
  w.items = [];
  w.stock = {};
  w.blazes = [];
  w.groups = [];
  w.scar = 1;
  addFx(w, "blast", e.x, e.z);
  chron(w, "ending", `섬 한가운데에서 핵폭발이 일어났다. 섬 사람 ${n}명이 모두 목숨을 잃고 마을과 숲은 잿더미가 되었다.`);
}

/** 매일: 그을린 땅이 두 달에 걸쳐 아문다 */
export function dailyEnding(w: WorldState) {
  if (w.scar) w.scar = w.scar > 1 / 60 ? w.scar - 1 / 60 : 0;
}

function board(w: WorldState, e: Ending, p: Person) {
  const gone = { until: w.time + 365 * DAY, via: "ship" as const, trip: -1 };
  p.away = gone;
  e.n++;
  addFx(w, "board", p.x, p.z, p.id);
  // 품에 안긴 아기도 함께
  for (const q of w.people) {
    if (q.alive && !q.away && q.act?.k === "carried" && q.act.tid === p.id) {
      q.away = { ...gone };
      e.n++;
    }
  }
  bump(w);
}

function robotize(w: WorldState, p: Person) {
  p.robot = 1;
  p.ill = 0;
  p.preg = 0;
  p.wound = null;
  p.health = 100;
  for (const k of Object.keys(p.needs) as (keyof Person["needs"])[]) p.needs[k] = 100;
  addFx(w, "robot", p.x, p.z, p.id);
  bump(w);
}

// ─── 함께 움직이기 ─────────────────────────────────────────────────────

/** 단계마다 사람들의 자리 순서 (번호 순, 단계가 바뀔 때 한 번 정한다) */
const FORM = { key: "", w: null as WorldState | null, rank: new Map<number, number>(), def: new Map<number, number>(), order: [] as number[], nd: 0 };
const fighter = (w: WorldState, p: Person) => {
  const y = age(w, p);
  return y >= 16 && y <= 62 && !p.preg;
};

function form(w: WorldState, e: Ending) {
  const key = `${e.t0}:${e.ph}`;
  if (FORM.key !== key || FORM.w !== w) {
    const list = w.people.filter((p) => p.alive && !p.away).sort((a, b) => a.id - b.id);
    FORM.key = key;
    FORM.w = w;
    FORM.rank = new Map(list.map((p, i) => [p.id, i]));
    const def = list.filter((p) => fighter(w, p));
    FORM.def = new Map(def.map((p, i) => [p.id, i]));
    FORM.nd = def.length;
    FORM.order = list.map((p) => p.id);
    SPOT.clear();
  }
  return FORM;
}

const rankOf = (f: typeof FORM, p: Person) => {
  let k = f.rank.get(p.id);
  if (k == null) f.rank.set(p.id, (k = f.rank.size));
  return k;
};

const SPOT = new Map<string, { x: number; z: number }>();
function cached(p: Person, sub: string, make: () => { x: number; z: number }) {
  const key = `${p.id}:${sub}`;
  let s = SPOT.get(key);
  if (!s) SPOT.set(key, (s = make()));
  return s;
}

/** 해바라기 씨처럼 가운데에서 바깥으로 둥글게 모인다. 건물 안이면 바깥 자리로 */
function crowdSpot(w: WorldState, T: Terrain, cx: number, cz: number, k: number, r0: number) {
  for (let i = 0; i < 10; i++) {
    const kk = k + i * 9;
    const a = kk * 2.39996, r = r0 + 1.05 * Math.sqrt(kk + 1);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!solidAt(w, x, z) && T.height(x, z) > 0.25 && !T.inPond(x, z)) return { x, z };
  }
  return { x: cx + r0, z: cz };
}

function homeSpot(w: WorldState, p: Person) {
  const h = findById(w.structures, p.home);
  if (!h || (h.dmg ?? 0) >= 0.6 || h.prog < 1) return null;
  const a = h.rot + Math.PI / 2 + (p.id % 5) * 1.3;
  const r = STRUCTS[h.type].radius * 0.4;
  return { x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r };
}

/** 마을에서 차원문 쪽으로 이만큼 나가 맞선다 */
export const frontDist = (L: number) => clamp(L * 0.45, 7, 26);

/** 마을과 차원문 사이의 축 */
function axis(w: WorldState, e: Ending) {
  const ux = e.x - w.camp.x, uz = e.z - w.camp.z;
  const L = Math.hypot(ux, uz) || 1;
  return { dx: ux / L, dz: uz / L, L };
}

const gunOf = (w: WorldState): Res | undefined => ((w.stock.rifle ?? 0) >= 1 ? "rifle" : (w.stock.musket ?? 0) >= 1 ? "musket" : undefined);
/** 사람마다 조금씩 다른 박자로 바뀌는 몸짓 */
const beat = (w: WorldState, p: Person, n: number) => Math.floor((w.time + p.id * 97) / 300) % n;

interface Goal { x: number; z: number; sub: string; anim: Anim; run?: boolean; res?: Res; face?: { x: number; z: number }; near?: number }

function goalOf(w: WorldState, T: Terrain, e: Ending, p: Person): Goal | null {
  const f = form(w, e);
  const k = rankOf(f, p);
  const camp = w.camp;
  const center = { x: e.x, z: e.z };
  switch (e.kind) {
    case "nuke": {
      if (e.ph >= 2) return null;
      const d = f.def.get(p.id);
      if (d != null && (p.role === "guard" || p.id % 3 === 0)) {
        // 바닷가로 나가 하늘을 겨눈다
        const a = Math.atan2(camp.z, camp.x) + (d - f.nd / 2) * 0.03;
        const s = cached(p, "muster", () => T.shorePoint(a, 5));
        return { ...s, sub: "muster", anim: e.ph === 0 ? "aim" : "startle", run: true, res: gunOf(w), face: { x: s.x * 1.3, z: s.z * 1.3 } };
      }
      const s = cached(p, "panic", () => homeSpot(w, p) ?? crowdSpot(w, T, camp.x, camp.z, k, 3));
      return { ...s, sub: "panic", anim: "cower", run: true, near: 1 };
    }
    case "space": {
      const watch = () => {
        const s = cached(p, "watch", () => crowdSpot(w, T, center.x, center.z, k, 7));
        const anim: Anim = e.ph === 0 && w.time - e.ts[0] < phaseLen(e) * 0.5 ? (beat(w, p, 3) ? "idle" : "talk") : (["wave", "cheer", "idle"] as Anim[])[beat(w, p, 3)];
        return { ...s, sub: "watch", anim, face: center };
      };
      if (e.ph === 0) return watch();
      if (e.ph !== 1) return null;
      const gap = (phaseLen(e) * 0.7) / Math.max(1, f.order.length);
      if (w.time < e.ts[1] + k * gap) return watch();
      // 발사대 아래 계단으로
      const a = Math.atan2(camp.z - e.z, camp.x - e.x) + ((p.id % 5) - 2) * 0.12;
      return { x: e.x + Math.cos(a) * 2.2, z: e.z + Math.sin(a) * 2.2, sub: "board", anim: "idle", near: 0.9, face: center };
    }
    case "alien": {
      const { dx, dz, L } = axis(w, e);
      if (e.ph >= 2) {
        const s = cached(p, "plaza", () => crowdSpot(w, T, camp.x, camp.z, k, 3.5));
        if (e.win) return { ...s, sub: "cheer", anim: beat(w, p, 2) ? "cheer" : "dance" };
        return { ...s, sub: "kneel", anim: "pray", face: center };
      }
      const d = f.def.get(p.id);
      if (d == null) {
        const s = cached(p, "hide", () => homeSpot(w, p) ?? crowdSpot(w, T, camp.x - dx * 8, camp.z - dz * 8, k, 2));
        return { ...s, sub: "hide", anim: "cower", run: true, near: 1 };
      }
      // 여러 줄로 늘어서 차원문을 겨눈다 (물가로 밀리면 뭍으로). 지는 싸움이면 뒤로 물러난다
      const back = !e.win && e.ph === 1 && w.time - e.ts[1] > phaseLen(e) * 0.6;
      const rows = f.nd > 40 ? 4 : 2;
      const D = frontDist(L) * (back ? 0.35 : 1) + (d % rows) * 1.3;
      const lat = (Math.floor(d / rows) - f.nd / rows / 2) * 1.3;
      const s = cached(p, back ? "back" : "front", () => {
        let { x, z } = ashore(camp.x + dx * D - dz * lat, camp.z + dz * D + dx * lat, camp, (a, b) => T.height(a, b) > 0.4);
        if (solidAt(w, x, z)) ({ x, z } = { x: x + dx * 1.5, z: z + dz * 1.5 });
        return { x, z };
      });
      return { ...s, sub: "front", anim: e.ph === 0 && w.time - e.ts[0] < phaseLen(e) * 0.3 ? "startle" : "aim", run: true, res: gunOf(w), face: center };
    }
    case "eternal": {
      const s = cached(p, "plaza", () => crowdSpot(w, T, camp.x, camp.z, k, 3.5));
      const lit = e.ph >= 1 && (f.order.indexOf(p.id) < e.n || e.ph >= 2);
      const anim: Anim = e.ph === 0 ? (beat(w, p, 3) ? "idle" : "talk") : e.ph === 1 ? (lit ? "stretch" : "pray") : beat(w, p, 2) ? "cheer" : "dance";
      return { ...s, sub: e.ph === 0 ? "gather" : e.ph === 1 ? "light" : "rejoice", anim, face: center };
    }
    case "robot":
      return null;
  }
}

/** 엔딩 연출 중이면 이 사람을 대신 움직인다 (false면 평소대로) */
export function scenePerson(w: WorldState, ctx: Ctx, p: Person, dt: number) {
  const e = w.ending;
  if (!e || e.done != null || e.kind === "robot" || p.act?.k === "carried") return false;
  const g = goalOf(w, ctx.T, e, p);
  if (!g) return false;
  let a = p.act;
  if (!a || a.k !== "scene" || a.sub !== g.sub || Math.hypot(a.tx - g.x, a.tz - g.z) > 0.6) {
    a = p.act = { k: "scene", ph: 0, tx: g.x, tz: g.z, t: 0, sub: g.sub, res: g.res, run: g.run ? 1 : 0, started: w.time };
  }
  a.res = g.res;
  p.gesture = null;
  const near = g.near ?? 0.7;
  if (a.ph === 0) {
    const d = dist(p.x, p.z, a.tx, a.tz);
    if (d < near) a.ph = 1;
    else {
      const yrs = age(w, p);
      const sp = WALK_SPEED * (a.run ? 1.7 : 1) * (yrs < 3 ? 0.4 : yrs < 8 ? 0.75 : yrs > 65 ? 0.75 : 1);
      if (dt <= 40) {
        const r = walk(w, p, a, sp, dt);
        if (r.arrived || dist(p.x, p.z, a.tx, a.tz) < near) a.ph = 1;
        p.anim = r.moved ? (a.run ? "run" : "walk") : "idle";
      } else {
        const k = Math.min(1, (sp * dt) / d);
        p.rot = Math.atan2(a.tz - p.z, a.tx - p.x);
        p.x += (a.tx - p.x) * k;
        p.z += (a.tz - p.z) * k;
        if (k >= 1) a.ph = 1;
        p.anim = a.run ? "run" : "walk";
      }
    }
  }
  if (a.ph === 1) {
    p.anim = g.anim;
    if (g.face) p.rot = Math.atan2(g.face.z - p.z, g.face.x - p.x);
    if (a.sub === "board") board(w, e, p);
  }
  return true;
}

export const SCENE_LABEL: Record<string, string> = {
  muster: "바닷가에서 하늘을 겨누는 중", panic: "몸을 웅크리고 숨은 중", watch: "우주선을 지켜보는 중", board: "우주선에 오르는 중",
  front: "외계 생명체와 맞서 싸우는 중", hide: "외계 생명체를 피해 숨은 중", kneel: "외계 생명체에게 항복하는 중", cheer: "승리를 기뻐하는 중",
  gather: "광장에 모이는 중", light: "영원한 삶의 빛을 받는 중", rejoice: "영원한 삶을 기뻐하는 중",
};

// ─── 화면에서만 그리는 것 ─────────────────────────────────────────────

export const ALIENS = 28;
/** st: 0 걸어 나옴 · 1 싸움 · 2 쓰러짐 · 3 광장을 에워쌈 */
export interface AlienView { i: number; x: number; z: number; rot: number; st: 0 | 1 | 2 | 3; fade: number }

const hash = (i: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** 물이면 마을 쪽으로 끌어당겨 뭍에 세운다 */
function ashore(x: number, z: number, to: { x: number; z: number }, land?: (x: number, z: number) => boolean) {
  if (!land || land(x, z)) return { x, z };
  for (let k = 1; k <= 12; k++) {
    const f = k / 12;
    const nx = x + (to.x - x) * f, nz = z + (to.z - z) * f;
    if (land(nx, nz)) return { x: nx, z: nz };
  }
  return { x: to.x, z: to.z };
}

/** 외계 생명체들이 지금 어디에 있는지: 엔딩과 시각만으로 정해진다 (관찰자마다 같게) */
export function alienViews(e: Ending, camp: { x: number; z: number }, t: number, land?: (x: number, z: number) => boolean): AlienView[] {
  if (e.kind !== "alien") return [];
  const B = startOf(e, 1), E = startOf(e, 2);
  const ux = camp.x - e.x, uz = camp.z - e.z;
  const L = Math.hypot(ux, uz) || 1;
  const dx = ux / L, dz = uz / L;
  const stopAt = Math.max(3, L - frontDist(L) - 5);
  const out: AlienView[] = [];
  for (let i = 0; i < ALIENS; i++) {
    const h1 = hash(i * 7 + 1), h2 = hash(i * 13 + 5), h3 = hash(i * 31 + 9);
    const spawn = B - 0.35 * HOUR + (i * 1.1 * HOUR) / ALIENS;
    if (t < spawn) continue;
    const speed = WALK_SPEED * (1.2 + h2 * 0.5);
    const lat = (h1 - 0.5) * 18;
    const stop = stopAt + (h3 - 0.5) * 4;
    const at = (tt: number) => {
      const along = Math.min(stop, Math.max(0, (tt - spawn) * speed));
      const side = lat * Math.min(1, along / 8);
      return { ...ashore(e.x + dx * along - dz * side, e.z + dz * along + dx * side, camp, land), along };
    };
    const face = Math.atan2(dz, dx);
    if (e.win) {
      const die = spawn + 0.3 * HOUR + h3 * Math.max(0.1 * HOUR, E - spawn - 0.4 * HOUR);
      if (t >= die) {
        const p = at(die);
        const fade = clamp((t - die) / (0.5 * HOUR), 0, 1);
        if (fade < 1) out.push({ i, x: p.x, z: p.z, rot: face, st: 2, fade });
        continue;
      }
      const p = at(t);
      out.push({ i, x: p.x, z: p.z, rot: face, st: p.along >= stop - 0.5 ? 1 : 0, fade: 0 });
      continue;
    }
    // 지는 싸움: 뒤쪽 40%부터 마을로 밀고 들어와 광장을 에워싼다
    const push = B + (E - B) * 0.6;
    const p = at(Math.min(t, push));
    if (t <= push) {
      out.push({ i, x: p.x, z: p.z, rot: face, st: p.along >= stop - 0.5 ? 1 : 0, fade: 0 });
      continue;
    }
    const ga = (i / ALIENS) * Math.PI * 2, gr = 15 + h1 * 4;
    const { x: gx, z: gz } = ashore(camp.x + Math.cos(ga) * gr, camp.z + Math.sin(ga) * gr, camp, land);
    const k = clamp((t - push) / (0.6 * HOUR), 0, 1);
    const x = p.x + (gx - p.x) * k, z = p.z + (gz - p.z) * k;
    out.push({ i, x, z, rot: k < 1 ? Math.atan2(gz - p.z, gx - p.x) : Math.atan2(camp.z - gz, camp.x - gx), st: k < 1 ? 0 : 3, fade: 0 });
  }
  return out;
}

/** 핵전쟁의 잿빛 하늘 0..1 */
export function ashOf(w: WorldState, t: number) {
  const e = w.ending;
  if (e?.kind === "nuke" && e.done == null) return e.ph >= 2 ? clamp((t - startOf(e, 2)) / (0.25 * HOUR), 0, 1) : 0;
  return (w.scar ?? 0) * 0.35;
}

// ─── 크레딧 ────────────────────────────────────────────────────────────

export interface Credits {
  icon: string;
  title: string;
  story: string[];
  annals: string[];
  stats: [string, string][];
  cast: string[];
}

export function creditsOf(w: WorldState): Credits | null {
  const e = w.ending;
  if (!e || e.done == null) return null;
  const built = w.structures.filter((s) => s.prog >= 1 && s.type !== "grave" && s.type !== "raft").length;
  const cycle = w.stats.cycle ?? 1;
  const stats: [string, string][] = [
    ["섬에서 보낸 날", `${dayOf(e.done)}일 (${yearOf(e.done)}년)`],
    ["가장 많았던 사람", `${w.stats.maxPop}명`],
    ["태어난 아이", `${w.stats.births}명`],
    ["떠나보낸 사람", `${w.stats.deaths}명`],
    ["섬을 찾아온 사람", `${w.stats.arrivals}명`],
    ["깨친 지식", `${w.tech.known.length}가지`],
    ["남은 건물", `${built}채`],
    ["세대", `${w.stats.generation}세대`],
  ];
  if (cycle > 1) stats.unshift(["문명", `${cycle}번째 문명`]);
  return {
    icon: endingIcon(e),
    title: endingTitle(e),
    story: endingStory(e),
    annals: (w.annals ?? []).map((c) => c.text),
    stats,
    cast: e.cast,
  };
}
