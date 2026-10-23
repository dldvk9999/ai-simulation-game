// 바깥에서 오는 사람들: 표류만이 아니라 가족 단위의 이주, 피난, 탐험대, 상인, 순례, 차원문으로도 온다.
// 한 번에 여러 명(최대 10명)이 함께 오기도 한다.
import { DAY, HOUR, MAX_POP } from "./constants";
import { TECH_BY_ID } from "./data";
import { clamp } from "./noise";
import { feel } from "./people";
import { chance, int, pick, range, weighted } from "./rng";
import { available, discover, houseCapacity } from "./settlement";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Person, Res, WorldState } from "./types";
import { addFx, bump, chron, createPerson, knows, living, makeStructure } from "./world";

export type Route = "drift" | "family" | "refugee" | "explorer" | "trader" | "pilgrim" | "portal";

/** 사람이 들어오는 사이: 처음보다 1.5배 짧다 */
export const nextArrival = (w: WorldState) => w.time + range(w, 5 / 1.5, 12 / 1.5) * DAY;

const SIZE: Record<Route, [number, number]> = {
  drift: [1, 2], family: [2, 6], refugee: [4, 10], explorer: [2, 5], trader: [1, 3], pilgrim: [2, 4], portal: [1, 3],
};

function routeWeights(w: WorldState): Partial<Record<Route, number>> {
  const recentStorm = w.time - (w.history.lastRain ?? -1e12) < 3 * DAY && w.weather.prev === "storm";
  const recentTrouble = !!w.history.lastDisaster && w.time - w.history.lastDisaster < 6 * DAY;
  const era = w.tech.known.reduce((e, id) => Math.max(e, TECH_BY_ID[id]?.era ?? 0), 0);
  const weights: Partial<Record<Route, number>> = { drift: 3 };
  if (knows(w, "fire")) weights.family = 2;
  // 큰 무리는 마을이 자리를 잡은 뒤에야 받아들일 수 있다
  if (era >= 1) weights.refugee = recentStorm || recentTrouble ? 2.2 : 0.7;
  if (era >= 2) weights.explorer = 1.1;
  if (w.economy) weights.trader = 1.3;
  if (w.religions.length) weights.pilgrim = 1;
  if (w.structures.some((s) => s.type === "portal" && s.prog >= 1)) weights.portal = 1.5;
  return weights;
}

/** 매일: 사람이 들어올 때가 되었는지 */
export function dailyArrivals(w: WorldState, T: Terrain, settled: boolean) {
  const now = living(w).length;
  const room = MAX_POP - now;
  if (room <= 0 || w.time < w.timers.castaway) return;
  // 사람이 많아질수록 섬을 찾는 이가 조금씩 줄어든다
  if (!chance(w, (settled ? 0.35 : 0.12) * clamp(1.1 - (now / MAX_POP) * 1.3, 0.12, 1))) return;
  const route = weighted(w, routeWeights(w) as Record<Route, number>);
  const [lo, hi] = SIZE[route];
  // 묵을 곳이 모자라면 적게 (처음엔 둘, 집이 넉넉해지면 최대 10명)
  const beds = houseCapacity(w) - now + 4;
  const n = Math.max(1, Math.min(room, beds, int(w, lo, hi)));
  arriveGroup(w, T, route, n);
  w.timers.castaway = nextArrival(w);
}

function landing(w: WorldState, T: Terrain, route: Route) {
  if (route === "portal") {
    const pt = w.structures.find((s) => s.type === "portal" && s.prog >= 1)!;
    return { x: pt.x + 2, z: pt.z + 1, wx: pt.x, wz: pt.z, a: 0, boat: false };
  }
  for (let k = 0; k < 40; k++) {
    const a = range(w, 0, Math.PI * 2);
    const sp = T.shorePoint(a, 1.4);
    const b = T.biome(sp.x, sp.z);
    if (b === "beach" || b === "grass") return { ...sp, a, boat: true };
  }
  const a = range(w, 0, Math.PI * 2);
  return { ...T.shorePoint(a, 1.4), a, boat: true };
}

/** 한 무리를 섬에 들인다 */
export function arriveGroup(w: WorldState, T: Terrain, route: Route, n: number) {
  const L = landing(w, T, route);
  if (L.boat) w.structures.push(makeStructure(w, "raft", L.wx * 0.15 + L.x * 0.85, L.wz * 0.15 + L.z * 0.85, L.a, true));
  const made: Person[] = [];
  const spot = (i: number) => {
    const a = L.a + Math.PI + (i - n / 2) * 0.35;
    return { x: L.x + Math.cos(a) * (0.8 + (i % 3) * 0.6), z: L.z + Math.sin(a) * (0.8 + (i % 3) * 0.6) };
  };
  const add = (age: number, sex?: "M" | "F", parents?: Person[]) => {
    const s = spot(made.length);
    const p = createPerson(w, { x: s.x, z: s.z, age, sex, parents });
    if (parents) p.parents = parents.map((q) => q.id);
    made.push(p);
    w.people.push(p);
    return p;
  };
  const family = (left: number) => {
    const dad = add(range(w, 24, 42), "M");
    const mom = add(range(w, 22, 40), "F");
    dad.partner = mom.id;
    mom.partner = dad.id;
    dad.rel[mom.id] = mom.rel[dad.id] = 0.75;
    const kids = Math.min(left - 2, int(w, 0, 3));
    for (let i = 0; i < kids; i++) {
      const k = add(range(w, 0.5, 13), undefined, [mom, dad]);
      for (const q of [mom, dad]) {
        k.rel[q.id] = 0.8;
        q.rel[k.id] = 0.85;
      }
    }
    return 2 + kids;
  };

  if (route === "family" || route === "refugee") {
    let left = n;
    while (left >= 2 && (made.length === 0 || (route === "refugee" && chance(w, 0.6)))) left -= family(left);
    while (left-- > 0) add(range(w, 16, 60));
  } else {
    for (let i = 0; i < n; i++) add(route === "explorer" ? range(w, 20, 34) : range(w, 18, 45));
  }
  // 함께 온 사람들끼리는 처음부터 가깝다
  for (const a of made) for (const b of made) if (a !== b) a.rel[b.id] = Math.max(a.rel[b.id] ?? 0, 0.35);

  for (const p of made) {
    if (route === "drift") {
      p.act = { k: "unconscious", ph: 1, tx: p.x, tz: p.z, t: range(w, 0.6, 1.4) * HOUR, started: w.time };
      p.anim = "lie";
    }
    if (route === "refugee") {
      p.needs.hunger = range(w, 25, 45);
      p.needs.energy = range(w, 25, 45);
      p.emo.sadness = 0.5;
    }
    if (route === "explorer") p.traits.openness = Math.max(p.traits.openness, 0.7);
    if (route === "trader") {
      p.purse = int(w, 30, 60);
      const goods: Res[] = ["metal", "jewelry", "fruit", "rope", "pot"];
      p.pack = {};
      for (let i = 0; i < 3; i++) {
        const r = pick(w, goods);
        p.pack[r] = (p.pack[r] ?? 0) + 1;
      }
    }
    if (route === "pilgrim" && w.religions.length) {
      const r = pick(w, w.religions);
      p.faith = r.id;
    }
    addFx(w, "arrive", p.x, p.z, p.id);
  }
  w.stats.arrivals += made.length;

  // 섬 사람들이 놀라고 반긴다
  for (const q of living(w)) {
    if (made.includes(q)) continue;
    feel(w, q, "surprise", 0.4);
    if (q.traits.extraversion > 0.4) feel(w, q, "joy", 0.3);
    else feel(w, q, "fear", 0.12, false);
    for (const p of made) {
      q.rel[p.id] = 0.1;
      p.rel[q.id] = 0.15;
    }
  }
  chron(w, "arrive", arrivalText(w, route, made));

  // 새로운 지식을 가져오기도 한다 (탐험대는 거의 늘)
  if (chance(w, route === "explorer" ? 0.5 : route === "trader" ? 0.3 : 0.18)) {
    const era = w.tech.known.reduce((e, id) => Math.max(e, TECH_BY_ID[id]?.era ?? 0), 0);
    const av = available(w).filter((t) => t.era <= Math.min(route === "explorer" ? 3 : 2, era));
    const who = made.find((p) => (w.time - p.birth) / (DAY * 28) >= 16) ?? made[0];
    if (av.length && who) {
      // 약초를 아는 사람이 먼저 반가운 법이다 (아직 모를 때)
      const herb = av.find((t) => t.id === "herbs" || t.id === "remedy");
      const t = herb && chance(w, 0.6) ? herb : pick(w, av);
      discover(w, who, t.id, `${josa(who.name, "은/는")} 고향에서 '${t.name}'에 대해 알고 있었다.`);
    }
  }
  bump(w);
  return made;
}

function arrivalText(w: WorldState, route: Route, made: Person[]) {
  const n = made.length;
  const lead = made[0];
  const kids = made.filter((p) => (w.time - p.birth) / (DAY * 28) < 13).length;
  switch (route) {
    case "drift":
      return n === 1 ? `새로운 표류자 ${josa(lead.name, "이/가")} 해변으로 떠밀려 왔다.` : `난파한 배의 표류자 ${n}명이 해변으로 떠밀려 왔다.`;
    case "family":
      return `${lead.name}네 가족 ${n}명${kids ? `(아이 ${kids}명)` : ""}이 작은 배를 타고 새 터전을 찾아 섬에 닿았다.`;
    case "refugee":
      return `폭풍과 다툼으로 집을 잃은 이웃 섬 사람들 ${n}명이 배를 타고 피난을 왔다.`;
    case "explorer":
      return `먼 바다를 건너온 탐험대 ${n}명이 섬을 둘러보다 머물기로 했다.`;
    case "trader":
      return `물건을 가득 실은 떠돌이 상인 ${n === 1 ? lead.name : `${n}명`}${n === 1 ? josa(lead.name, "이/가").slice(lead.name.length) : "이"} 들렀다가 그대로 눌러앉았다.`;
    case "pilgrim": {
      const r = w.religions.find((x) => x.id === lead.faith);
      return `${r ? `'${r.name}'의 ` : ""}소문을 듣고 순례자 ${n}명이 섬을 찾아왔다.`;
    }
    case "portal":
      return `차원문 너머에서 낯선 여행자 ${n}명이 걸어 나왔다.`;
  }
}
