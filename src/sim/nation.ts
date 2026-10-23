// 나라: 철기 시대에 문명을 이룬 사람들이 서른 명을 넘으면 왕을 세워 나라를 연다.
// 나라가 커지면 대신을 두고, 과학 시대에는 의회를 연다. 바다 건너 다른 나라와 무역도 하고 전쟁도 한다.
import { act, spot } from "./acts";
import { harm } from "./building";
import { DAY, HOUR, ISLAND_RADIUS, NATION_POP } from "./constants";
import { shiftMorale } from "./morale";
import { clamp } from "./noise";
import { age, feel, lying, say } from "./people";
import { chance, int, pick, range } from "./rng";
import { currentEra, foodTotal } from "./settlement";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Act, Group, Nation, Person, Res, WorldState } from "./types";
import { addFx, addStock, bump, chron, dist, findById, knows, living, newId, stockOf } from "./world";
import { pickWeapon, weaponOf } from "./beasts";

const NATION_NAMES = ["가람국", "해솔국", "온누리국", "새벽국", "윤슬국", "한울국", "푸른섬국", "바람결국"];
const FOREIGN_NAMES = ["해랑국", "별무리국", "청솔국", "마루국", "아라국", "다래국", "구름섬국", "노을국"];
export const GOV_NAME: Record<NonNullable<Group["gov"]>["kind"], string> = {
  monarchy: "왕정", cabinet: "왕과 대신들", parliament: "의회를 둔 왕정",
};

const adult = (w: WorldState, p: Person) => age(w, p) >= 16;
export const nationOf = (w: WorldState) => w.groups.find((g) => g.kind === "nation");
const members = (w: WorldState, g: Group) => w.people.filter((p) => p.alive && p.group === g.id);
const vd = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 우리 나라를 대하는 마음 */
export const moodName = (m: number) => (m > 0.4 ? "우호" : m > -0.2 ? "보통" : m > -0.6 ? "냉랭" : "적대");

/** 매일: 나라가 서고, 왕위가 이어지고, 정부가 생기고, 바다 건너 나라와 오간다 */
export function dailyNation(w: WorldState, T: Terrain) {
  let g = nationOf(w);
  if (!g) {
    g = tryFound(w);
    if (!g) return;
  }
  const ms = members(w, g);
  if (ms.filter((p) => adult(w, p)).length < 6) {
    g.kind = "civ";
    g.gov = undefined;
    for (const p of ms) if (p.role === "king" || p.role === "minister") p.role = null;
    chron(w, "nation", `백성이 줄어들어 '${g.name}'의 왕실도 흩어졌다. 다시 작은 문명으로 돌아갔다.`);
    bump(w);
    return;
  }
  succession(w, g);
  government(w, g);
  foreign(w, T, g);
}

/** 철기 시대 · 문명 · 서른 명 이상 → 나라 */
function tryFound(w: WorldState): Group | undefined {
  if (currentEra(w) < 3 || !knows(w, "writing")) return;
  const alive = living(w);
  if (alive.length < NATION_POP) return;
  // 가장 큰 무리(문명이면 더 좋다)가 뜻이 맞는 사람들을 받아들여 나라를 연다
  const groups = w.groups.filter((x) => x.kind === "civ" || x.kind === "org").sort((a, b) => (b.kind === "civ" ? 1 : 0) - (a.kind === "civ" ? 1 : 0) || members(w, b).length - members(w, a).length);
  const g = groups[0];
  if (!g || (g.kind !== "civ" && w.time - g.founded < 20 * DAY)) return;
  const join = alive.filter((p) => p.group !== g.id && (p.group == null || !w.groups.some((x) => x.id === p.group && x.war)) && vd(p.vals ?? [0.5, 0.5], g.vals) < 0.35);
  const total = members(w, g).length + join.length;
  if (total < NATION_POP || !chance(w, 0.5)) return;
  for (const p of join) {
    // 떠난 무리에 아무도 안 남으면 그 무리는 사라진다
    p.group = g.id;
  }
  w.groups = w.groups.filter((x) => x === g || members(w, x).length >= 2);
  const used = new Set(w.groups.map((x) => x.name));
  const base = g.kind === "civ" ? `${g.name}국` : pick(w, NATION_NAMES);
  g.name = used.has(base) ? pick(w, NATION_NAMES.filter((n) => !used.has(n))) ?? base : base;
  g.kind = "nation";
  g.crowned = w.time;
  g.gov = { kind: "monarchy", since: w.time };
  g.war = null;
  const king = crown(w, g);
  chron(w, "nation", `${king ? `${josa(king.name, "이/가")} 왕위에 올라 ` : ""}'${g.name}'${josa(g.name, "을/를").slice(g.name.length)} 세웠다! 섬 사람 ${members(w, g).length}명이 한 나라의 백성이 되었다.`);
  shiftMorale(w, 8);
  for (const p of members(w, g)) {
    feel(w, p, "joy", 0.4);
    if (!p.away && chance(w, 0.5)) say(w, p, "nationFound", { name: g.name }, "👑", true);
  }
  // 바다 건너에도 나라들이 있다
  if (!w.nations.length) {
    const n = int(w, 2, 3);
    const names = [...FOREIGN_NAMES];
    for (let i = 0; i < n; i++) {
      const name = names.splice(int(w, 0, names.length - 1), 1)[0];
      // 한 나라쯤은 호전적이다
      const temper = i === 0 ? range(w, -0.6, -0.35) : range(w, -0.2, 0.5);
      w.nations.push({
        id: newId(w), name, hue: range(w, 0, 1), power: range(w, 0.6, 1.5), mood: temper + range(w, -0.1, 0.2), temper,
        dir: range(w, 0, Math.PI * 2), met: 0, lastTrade: w.time, war: null, trades: 0,
      });
    }
  }
  bump(w);
  return g;
}

function crown(w: WorldState, g: Group) {
  const ms = members(w, g).filter((p) => adult(w, p) && !p.away);
  const king = findById(w.people, g.leader) ?? ms.sort((a, b) => b.traits.extraversion + b.traits.conscientiousness - a.traits.extraversion - a.traits.conscientiousness)[0];
  if (!king) return null;
  for (const p of members(w, g)) if (p.role === "king") p.role = null;
  g.leader = king.id;
  king.role = "king";
  return king;
}

/** 왕이 세상을 떠나면 맏이가, 없으면 따르는 이가 많은 사람이 왕위를 잇는다 */
function succession(w: WorldState, g: Group) {
  const king = findById(w.people, g.leader);
  if (king?.alive && king.group === g.id) {
    king.role = "king";
    return;
  }
  const heir = w.people
    .filter((p) => p.alive && p.group === g.id && adult(w, p) && king && p.parents.includes(king.id))
    .sort((a, b) => a.birth - b.birth)[0];
  g.leader = heir?.id ?? null;
  const next = crown(w, g);
  if (next) chron(w, "nation", heir ? `${king?.name ?? "왕"}의 맏이 ${josa(next.name, "이/가")} 왕위를 이었다.` : `${josa(next.name, "이/가")} 백성들의 뜻을 모아 새 왕이 되었다.`);
}

/** 나라가 커지면 대신을 두고, 과학 시대에는 의회를 연다 */
function government(w: WorldState, g: Group) {
  const gov = (g.gov ??= { kind: "monarchy", since: w.time });
  const ms = members(w, g).filter((p) => adult(w, p) && p.role !== "king");
  if (gov.kind === "monarchy" && (ms.length >= 30 || w.time - gov.since > 20 * DAY)) {
    gov.kind = "cabinet";
    gov.since = w.time;
    appoint(w, g, true);
  } else if (gov.kind === "cabinet" && currentEra(w) >= 4 && w.time - gov.since > 15 * DAY) {
    gov.kind = "parliament";
    gov.since = w.time;
    shiftMorale(w, 4);
    chron(w, "nation", `'${g.name}'에 백성의 뜻을 모으는 의회가 열렸다. 왕은 그대로 나라를 대표한다.`);
  } else if (gov.kind !== "monarchy") appoint(w, g, false);
}

const fitness = {
  chancellor: (p: Person) => (p.skills.think ?? 0) * 2 + p.traits.openness + p.traits.conscientiousness * 0.5,
  general: (p: Person) => (1 - p.traits.agreeableness) * 0.6 + (1 - p.traits.neuroticism) * 0.4 + (p.role === "guard" ? 0.5 : 0),
  treasurer: (p: Person) => p.traits.conscientiousness + (p.purse ?? 0) / 200,
};
const TITLE = { chancellor: "재상", general: "장군", treasurer: "재무관" } as const;

function appoint(w: WorldState, g: Group, first: boolean) {
  const gov = g.gov!;
  const named: string[] = [];
  for (const k of ["chancellor", "general", "treasurer"] as const) {
    if (k === "treasurer" && !w.economy) continue;
    const cur = findById(w.people, gov[k]);
    if (cur?.alive && cur.group === g.id) continue;
    const taken = new Set([gov.chancellor, gov.general, gov.treasurer, g.leader]);
    const pickOne = members(w, g).filter((p) => adult(w, p) && !p.away && !taken.has(p.id) && age(w, p) < 66).sort((a, b) => fitness[k](b) - fitness[k](a))[0];
    if (!pickOne) continue;
    gov[k] = pickOne.id;
    pickOne.role = "minister";
    named.push(`${TITLE[k]} ${pickOne.name}`);
  }
  if (named.length && first) chron(w, "nation", `나라가 커지자 왕이 ${josa(named.join(", "), "을/를")} 두어 나랏일을 나누어 맡겼다.`);
}

/** 대신의 직함 (사람 카드) */
export function ministerTitle(w: WorldState, p: Person) {
  const g = nationOf(w);
  if (!g?.gov) return "";
  if (g.gov.chancellor === p.id) return "재상";
  if (g.gov.general === p.id) return "장군";
  if (g.gov.treasurer === p.id) return "재무관";
  return "";
}

/** 연구·건설이 조금 빨라진다 (대신들이 나랏일을 나눈다) */
export function govMul(w: WorldState) {
  const g = nationOf(w);
  if (!g?.gov) return 1;
  return g.gov.kind === "monarchy" ? 1.04 : g.gov.kind === "cabinet" ? 1.08 : 1.12;
}

// ─── 바다 건너의 나라들 ────────────────────────────────────────────────

function foreign(w: WorldState, T: Terrain, g: Group) {
  const ships = knows(w, "boat");
  const dock = w.structures.find((s) => s.type === "dock" && s.prog >= 1);
  const curse = w.religions.some((r) => r.aim === "curse");
  for (const n of w.nations) {
    // 마음은 조금씩 오르내리고, 저주를 빈다는 소문이 돌면 나빠진다
    // 마음은 날마다 조금씩 오르내리며 타고난 기질로 돌아온다. 저주를 빈다는 소문이 돌면 나빠진다
    n.temper ??= range(w, -0.3, 0.4);
    n.mood = clamp(n.mood + range(w, -0.08, 0.08) + (n.temper - n.mood) * 0.05 - (curse ? 0.02 : 0), -1, 1);
    if (!ships) continue;
    if (!n.met) {
      n.met = w.time;
      chron(w, "nation", `바다 건너에 '${n.name}'${josa(n.name, "이/가").slice(n.name.length)} 있다는 것을 알게 되었다.`);
    }
    if (w.visit) continue;
    // 전쟁: 사이가 아주 나쁘면
    if (!n.war && n.mood < -0.55 && w.time - (n.lastWar ?? -1e12) > 40 * DAY && chance(w, 0.3)) {
      n.war = { since: w.time, until: w.time + 2 * DAY };
      const arrive = w.time + range(w, 4, 8) * HOUR;
      w.visit = { nation: n.id, kind: "war", arrive, until: arrive + range(w, 8, 12) * HOUR, score: 0 };
      chron(w, "nation", `'${n.name}'${josa(n.name, "이/가").slice(n.name.length)} '${g.name}'에 전쟁을 선포했다! 바다 너머에서 전함이 몰려온다.`);
      for (const p of members(w, g)) {
        feel(w, p, "fear", 0.3, false);
        feel(w, p, "anger", 0.2, false);
        p.seen.reeval = 0;
      }
      continue;
    }
    // 무역: 사이가 나쁘지 않으면 상선이 드나든다
    if (!n.war && dock && n.mood > -0.2 && w.time - n.lastTrade > range(w, 12, 24) * DAY) {
      n.lastTrade = w.time;
      w.visit = { nation: n.id, kind: "trade", arrive: w.time, until: w.time + range(w, 8, 14) * HOUR };
      tradeWith(w, g, n);
    }
  }
}

const TRADE_GOODS: Res[] = ["iron", "copper", "tin", "metal", "jewelry", "fruit", "rope", "pot", "herbal", "silver"];

/** 넘치는 것을 내주고 모자란 것을 받는다 */
function tradeWith(w: WorldState, g: Group, n: Nation) {
  const pop = living(w).length;
  const keep: Partial<Record<Res, number>> = { crop: pop * 6, wood: 20, stone: 20, stick: 20, fiber: 12, hide: 10, clay: 10 };
  let gave: [Res, number] | null = null;
  for (const [r, need] of Object.entries(keep) as [Res, number][]) {
    const extra = Math.floor(stockOf(w, r) - need);
    if (extra >= 6 && (!gave || extra > gave[1])) gave = [r, Math.min(20, extra)];
  }
  const want: Res = foodTotal(w) < pop * 6 ? "meal" : pick(w, TRADE_GOODS);
  const got = gave ? Math.max(2, Math.round(gave[1] / 2.5)) : int(w, 1, 3);
  if (gave) addStock(w, gave[0], -gave[1]);
  addStock(w, want, got);
  if (w.economy) w.economy.treasury += got * 3;
  n.trades = (n.trades ?? 0) + 1;
  // 흥정이 틀어지면 사이가 나빠지기도 한다
  const dispute = chance(w, 0.15);
  n.mood = clamp(n.mood + (dispute ? -0.35 : 0.06), -1, 1);
  shiftMorale(w, 2);
  if (dispute) {
    chron(w, "nation", `'${n.name}'의 상인들과 값을 두고 다툼이 벌어졌다. 두 나라 사이가 싸늘해졌다.`);
    return;
  }
  // 무역 이야기는 처음과 가끔만
  if (n.trades !== 1 && n.trades % 4 !== 0) return;
  const RES: Partial<Record<Res, string>> = { crop: "곡식", wood: "목재", stone: "돌", stick: "나뭇가지", fiber: "섬유", hide: "가죽", clay: "점토", iron: "철", copper: "구리", tin: "주석", metal: "금속", jewelry: "장신구", fruit: "열매", rope: "밧줄", pot: "항아리", herbal: "약초즙", silver: "은", meal: "음식" };
  chron(w, "trade", `'${n.name}'의 상선이 들어와 ${gave ? `${RES[gave[0]]} ${gave[1]}개를 주고 ` : ""}${RES[want] ?? want} ${got}개를 받았다.`);
  for (const p of members(w, g)) if (!p.away && chance(w, 0.2)) say(w, p, "foreignShip", { name: n.name }, "⛵");
}

/** 싸움터: 그 나라가 있는 쪽 바닷가 */
export function frontOf(w: WorldState, T: Terrain) {
  const n = w.visit ? w.nations.find((x) => x.id === w.visit!.nation) : undefined;
  const a = n?.dir ?? 0;
  return T.shorePoint(a, 3);
}

/** 매 스텝: 전함이 오면 싸우고, 배가 떠나면 결판이 난다 */
export function updateNation(w: WorldState, T: Terrain, dt: number) {
  const v = w.visit;
  if (!v) return;
  const n = w.nations.find((x) => x.id === v.nation);
  const g = nationOf(w);
  if (!n || !g) {
    w.visit = null;
    return;
  }
  if (v.kind === "trade") {
    if (w.time >= v.until) w.visit = null;
    return;
  }
  if (w.time < v.arrive) return;
  const h = dt / HOUR;
  const front = frontOf(w, T);
  // 우리 힘: 바닷가에 모인 사람들의 무기 + 장군 + 포대 · 성루
  const fighters = w.people.filter((p) => p.alive && p.act?.k === "muster" && p.act.ph === 1);
  let ours = fighters.reduce((s, p) => s + weaponOf(p.act?.sub).dmg / 10 + p.health / 200, 0);
  if (g.gov?.general && findById(w.people, g.gov.general)?.alive) ours *= 1.3;
  ours += w.structures.filter((s) => (s.type === "battery" || s.type === "fort") && s.prog >= 1 && dist(s.x, s.z, front.x, front.z) < 60).length * 3;
  // 저쪽도 그 시대의 무기를 들고 우리만큼 사람을 모아 온다 (국력에 따라 많거나 적게)
  const arms = [0.6, 0.9, 2.2, 3.4, 7][currentEra(w)] + 0.5;
  const theirs = n.power * members(w, g).length * 0.6 * arms * range(w, 0.75, 1.25);
  v.score = clamp((v.score ?? 0) + ((ours - theirs) / Math.max(ours, theirs, 1)) * h * 0.6, -1, 1);
  // 포탄과 화살이 오간다: 다치고, 바닷가 건물이 부서진다
  if (chance(w, Math.min(1, h * 2))) {
    addFx(w, "shot", front.x + range(w, -6, 6), front.z + range(w, -6, 6));
    const p = fighters.length ? pick(w, fighters) : null;
    if (p && chance(w, theirs / (ours + theirs))) {
      p.health = Math.max(5, p.health - range(w, 6, 18));
      say(w, p, "hurt", {}, "🤕", true);
      if (p.health < 30 && !lying(p)) p.act = null;
    }
    const near = w.structures.filter((s) => s.prog >= 1 && dist(s.x, s.z, front.x, front.z) < 18 && s.type !== "raft");
    if (near.length && chance(w, 0.25)) {
      const s = pick(w, near);
      harm(w, T, s, range(w, 0.05, 0.15), "hand");
    }
  }
  if (w.time < v.until) return;
  // 결판
  const won = (v.score ?? 0) > 0;
  w.visit = null;
  n.war = null;
  n.lastWar = w.time;
  n.mood = won ? -0.2 : -0.1;
  if (won) {
    addStock(w, "metal", int(w, 4, 10));
    addStock(w, "gold", int(w, 1, 3));
    addStock(w, "meal", int(w, 8, 16));
    shiftMorale(w, 6);
    chron(w, "nation", `'${g.name}'${josa(g.name, "이/가").slice(g.name.length)} '${n.name}'의 함대를 물리쳤다! 물러간 그들이 공물을 보내 화친을 청했다.`);
    for (const p of fighters) {
      feel(w, p, "joy", 0.5);
      say(w, p, "warWon", {}, "🎉", true);
    }
  } else {
    for (const r of ["meal", "crop", "metal", "iron", "gold"] as Res[]) addStock(w, r, -Math.floor(stockOf(w, r) * 0.25));
    shiftMorale(w, -6);
    chron(w, "nation", `'${g.name}'${josa(g.name, "이/가").slice(g.name.length)} '${n.name}'에 지고 말았다. 곳간의 물자를 공물로 내주고 화친을 맺었다.`);
    for (const p of fighters) feel(w, p, "sadness", 0.4);
  }
  for (const p of w.people) if (p.act?.k === "muster") p.act = null;
  bump(w);
}

/** 전함이 오면 싸울 수 있는 백성은 바닷가로 모인다 */
export function musterCand(w: WorldState, T: Terrain, p: Person): { s: number; mk: () => Act } | null {
  const v = w.visit;
  const g = nationOf(w);
  if (!v || v.kind !== "war" || !g || p.group !== g.id || w.time < v.arrive - 2 * HOUR) return null;
  const yrs = age(w, p);
  if (yrs < 16 || yrs > 60 || p.health < 40 || p.preg) return null;
  return {
    s: 1.25 + (p.role === "guard" || p.role === "minister" ? 0.2 : 0),
    mk: () => {
      const f = frontOf(w, T);
      const s = spot(p, f.x, f.z, 2 + (p.id % 5) * 0.7);
      const wp = pickWeapon(w);
      return act(w, "muster", s.x, s.z, Math.max(HOUR, v.until - w.time), { run: 1, sub: wp.res });
    },
  };
}

/** 싸울 수 없는 사람은 집 안에 숨는다 */
export const atWar = (w: WorldState) => !!w.visit && w.visit.kind === "war" && w.time >= w.visit.arrive - 2 * HOUR;

/** 바다 위 배가 떠 있는 자리 (화면) */
export function shipSpots(w: WorldState, T: Terrain) {
  const v = w.visit;
  if (!v) return [];
  const n = w.nations.find((x) => x.id === v.nation);
  if (!n) return [];
  if (v.kind === "trade") {
    const dock = w.structures.find((s) => s.type === "dock");
    const a = dock ? Math.atan2(dock.z, dock.x) : n.dir;
    const r = (dock ? Math.hypot(dock.x, dock.z) : ISLAND_RADIUS) + 7;
    return [{ x: Math.cos(a) * r, z: Math.sin(a) * r, rot: a + Math.PI / 2, hue: n.hue, war: false }];
  }
  if (w.time < v.arrive - 3 * HOUR) return [];
  const f = T.shorePoint(n.dir, 3);
  const base = Math.hypot(f.x, f.z) + 18;
  return [-0.12, 0, 0.12].map((da) => ({ x: Math.cos(n.dir + da) * base, z: Math.sin(n.dir + da) * base, rot: n.dir + da + Math.PI / 2, hue: n.hue, war: true }));
}

/** 왕궁을 세울 때 */
export const wantPalace = (w: WorldState) => !!nationOf(w) && knows(w, "masonry") && !w.structures.some((s) => s.type === "palace");
