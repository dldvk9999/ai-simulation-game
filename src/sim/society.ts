// 조직과 문명: 열 명 넘게 모이면 뜻이 맞는 사람끼리 조직을 만들고, 모두의 뜻이 맞으면 문명을 세운다.
// 무리 안에서는 저마다 역할을 맡아 체계적으로 일하고, 뜻이 너무 다른 무리끼리는 다투다 갈라서기도 한다.
import { DAY, GROUP_POP } from "./constants";
import { ageYears } from "./clock";
import { clamp } from "./noise";
import { feel, say } from "./people";
import { chance, pick, range } from "./rng";
import { currentEra, findSite, foodTotal, projects } from "./settlement";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Group, GroupKind, Person, Role, WorldState } from "./types";
import { bump, chron, dist, findById, knows, living, makeStructure, newId } from "./world";

const ORG_A = ["물결", "솔숲", "해돋이", "돌망치", "별빛", "갈매기", "바위", "산마루", "모래톱", "들꽃", "너울", "이슬", "불씨", "흙손", "조개"];
const ORG_B = ["회", " 모임", " 두레", " 무리", " 패"];
const CIV = ["윤슬", "새벽", "한울", "해솔", "다솜", "푸른섬", "바람결", "온누리", "늘봄", "가람"];
export const CIV_STAGE = ["씨족 사회", "부족 연맹", "고대 왕국", "고전 문명", "과학 문명"];

const vd = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const valsOf = (p: Person): [number, number] => p.vals ?? [0.5, 0.5];
const adult = (w: WorldState, p: Person) => ageYears(p.birth, w.time) >= 16;

export const groupOf = (w: WorldState, p: Person) => (p.group != null ? findById(w.groups, p.group) : undefined);
/** 무리에 속한 산 사람 (섬 밖에 나간 사람 포함) */
export const membersOf = (w: WorldState, g: Group) => w.people.filter((p) => p.alive && p.group === g.id);

export function groupTitle(w: WorldState, g: Group) {
  return g.kind === "civ" ? `${g.name} 문명` : g.name;
}
export function groupStage(w: WorldState, g: Group) {
  if (g.kind === "org") return "조직";
  const era = currentEra(w);
  return `문명 ${era + 1}단계 · ${CIV_STAGE[era]}`;
}

/** 이 사람이 머무는 터 (갈라져 나간 무리는 따로 잡은 자리) */
export function campOf(w: WorldState, p: Person) {
  const g = groupOf(w, p);
  return g?.camp ?? w.camp;
}

export function enemies(w: WorldState, a: Person, b: Person) {
  const ga = groupOf(w, a), gb = groupOf(w, b);
  if (!ga || !gb || ga === gb) return false;
  return ga.war?.with === gb.id;
}

export const warOf = (w: WorldState, p: Person) => {
  const g = groupOf(w, p);
  return g?.war ? g : null;
};

function centroid(list: [number, number][]): [number, number] {
  let a = 0, b = 0;
  for (const v of list) {
    a += v[0];
    b += v[1];
  }
  return [a / Math.max(1, list.length), b / Math.max(1, list.length)];
}

function avgRel(ps: Person[], qs: Person[]) {
  let s = 0, n = 0;
  for (const p of ps) for (const q of qs) {
    if (p === q) continue;
    s += ((p.rel[q.id] ?? 0) + (q.rel[p.id] ?? 0)) / 2;
    n++;
  }
  return n ? s / n : 0;
}

function freshName(w: WorldState, kind: GroupKind) {
  const used = new Set(w.groups.map((g) => g.name));
  for (let k = 0; k < 20; k++) {
    const n = kind === "civ" ? pick(w, CIV) : pick(w, ORG_A) + pick(w, ORG_B);
    if (!used.has(n)) return n;
  }
  return (kind === "civ" ? pick(w, CIV) : pick(w, ORG_A)) + (w.groups.length + 1);
}

function freshHue(w: WorldState) {
  const used = w.groups.map((g) => g.hue);
  let best = range(w, 0, 1), bd = -1;
  for (let k = 0; k < 12; k++) {
    const h = range(w, 0, 1);
    const d = used.length ? Math.min(...used.map((u) => Math.min(Math.abs(u - h), 1 - Math.abs(u - h)))) : 1;
    if (d > bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

function pickLeader(w: WorldState, ms: Person[]) {
  let best: Person | null = null, bs = -Infinity;
  for (const p of ms) {
    if (!adult(w, p)) continue;
    const t = p.traits;
    const s = t.extraversion * 0.4 + t.conscientiousness * 0.3 + t.agreeableness * 0.2 + avgRel([p], ms) * 0.6
      + Math.min(ageYears(p.birth, w.time), 50) / 250;
    if (s > bs) {
      bs = s;
      best = p;
    }
  }
  return best;
}

function makeGroup(w: WorldState, kind: GroupKind, ms: Person[]): Group {
  const g: Group = {
    id: newId(w), kind, name: freshName(w, kind), hue: freshHue(w), founded: w.time, leader: null,
    vals: centroid(ms.map(valsOf)), camp: null, tension: {}, war: null,
  };
  w.groups.push(g);
  for (const p of ms) p.group = g.id;
  g.leader = pickLeader(w, ms)?.id ?? null;
  return g;
}

/** 깃발을 꽂는다: 갈라져 나간 무리는 자기 터에, 아니면 마을 둘레에 */
function plantBanner(w: WorldState, T: Terrain, g: Group) {
  w.structures = w.structures.filter((s) => !(s.type === "banner" && s.group === g.id));
  let x: number, z: number;
  if (g.camp) {
    x = g.camp.x + 1.6;
    z = g.camp.z;
  } else if (g.kind === "civ") {
    x = w.camp.x + 2.6;
    z = w.camp.z - 1.2;
  } else {
    const i = w.groups.filter((q) => q.kind === "org").indexOf(g);
    const a = (i / 3) * Math.PI * 2 + 0.4;
    x = w.camp.x + Math.cos(a) * 3.4;
    z = w.camp.z + Math.sin(a) * 3.4;
  }
  if (!T.isLand(x, z)) {
    x = (g.camp ?? w.camp).x;
    z = (g.camp ?? w.camp).z + 1.5;
  }
  const s = makeStructure(w, "banner", x, z, 0, true);
  s.group = g.id;
  w.structures.push(s);
}

function kmeans(ps: Person[], k: number): Person[][] {
  // 가장 먼 점부터 씨앗으로
  const seeds: [number, number][] = [valsOf(ps[0])];
  while (seeds.length < k) {
    let far = ps[0], fd = -1;
    for (const p of ps) {
      const d = Math.min(...seeds.map((s) => vd(s, valsOf(p))));
      if (d > fd) {
        fd = d;
        far = p;
      }
    }
    seeds.push(valsOf(far));
  }
  let groups: Person[][] = [];
  for (let it = 0; it < 8; it++) {
    groups = seeds.map(() => []);
    for (const p of ps) {
      let bi = 0, bd = Infinity;
      seeds.forEach((s, i) => {
        // 친한 사람이 많은 쪽으로 조금 끌린다
        const d = vd(s, valsOf(p));
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      groups[bi].push(p);
    }
    groups.forEach((g, i) => {
      if (g.length) seeds[i] = centroid(g.map(valsOf));
    });
  }
  return groups;
}

function kidsFollowParents(w: WorldState) {
  for (const p of w.people) {
    if (!p.alive || adult(w, p)) continue;
    const par = p.parents.map((id) => findById(w.people, id)).find((q) => q?.alive && q.group != null);
    p.group = par?.group ?? null;
    p.role = null;
  }
}

/** 조직이나 문명이 처음 생긴다 */
function formGroups(w: WorldState, T: Terrain, adults: Person[]) {
  const c = centroid(adults.map(valsOf));
  const maxDev = Math.max(...adults.map((p) => vd(valsOf(p), c)));
  const rel = avgRel(adults, adults);
  if (maxDev < 0.22 && rel > 0.35) {
    const g = makeGroup(w, "civ", adults);
    kidsFollowParents(w);
    plantBanner(w, T, g);
    const leader = findById(w.people, g.leader);
    chron(w, "society", `모두의 뜻이 하나로 모였다. ${leader ? josa(leader.name, "을/를") + " 중심으로 " : ""}섬 사람들이 '${g.name} 문명'을 세웠다!`);
    celebrate(w, membersOf(w, g));
    return;
  }
  const k = adults.length >= 15 ? 3 : 2;
  const clusters = kmeans(adults, k).filter((cl) => cl.length >= 3);
  if (!clusters.length) return;
  for (const cl of clusters) {
    const g = makeGroup(w, "org", cl);
    plantBanner(w, T, g);
    const leader = findById(w.people, g.leader);
    chron(w, "society", `${leader ? josa(leader.name, "을/를") + " 중심으로 " : ""}뜻이 맞는 ${cl.length}명이 '${g.name}'${josa(g.name, "을/를").slice(g.name.length)} 만들었다.`);
    celebrate(w, cl);
  }
  kidsFollowParents(w);
}

function celebrate(w: WorldState, ms: Person[]) {
  for (const p of ms) {
    if (p.away) continue;
    feel(w, p, "joy", 0.4);
    say(w, p, "together", {}, "🤝", true);
  }
}

function dissolve(w: WorldState, g: Group, why: string) {
  for (const p of w.people) if (p.group === g.id) {
    p.group = null;
    p.role = null;
  }
  w.groups = w.groups.filter((x) => x !== g);
  for (const o of w.groups) {
    delete o.tension[g.id];
    if (o.war?.with === g.id) o.war = null;
  }
  w.structures = w.structures.filter((s) => !(s.type === "banner" && s.group === g.id));
  for (const s of w.structures) if (s.group === g.id) s.group = undefined;
  if (why) chron(w, "society", why);
}

// ─── 역할 ──────────────────────────────────────────────────────────────

const ROLES: Role[] = ["farmer", "fisher", "hunter", "builder", "scholar", "crafter", "healer", "cook", "sailor", "guard"];

function fit(p: Person, r: Role) {
  const t = p.traits, s = p.skills;
  const k = (x: string) => (s[x] ?? 0) * 2;
  switch (r) {
    case "farmer": return k("farm") + t.conscientiousness * 0.5;
    case "fisher": return k("fish") + (1 - t.extraversion) * 0.3;
    case "hunter": return k("hunt") + (1 - t.agreeableness) * 0.4;
    case "builder": return k("build") + t.conscientiousness * 0.4;
    case "scholar": return k("think") + t.openness * 0.8;
    case "crafter": return k("craft") + t.conscientiousness * 0.3;
    case "healer": return k("heal") + t.agreeableness * 0.8 + (1 - t.neuroticism) * 0.2;
    case "cook": return k("cook") + t.agreeableness * 0.2;
    case "sailor": return (s.fish ?? 0) + t.openness * 0.6;
    case "guard": return (1 - t.agreeableness) * 0.6 + (1 - t.neuroticism) * 0.3;
    default: return 0;
  }
}

function demand(w: WorldState, g: Group): Record<Role, number> {
  const pop = living(w).length;
  const deficit = clamp((pop * 8 - foodTotal(w)) / Math.max(1, pop * 8), 0, 1);
  const sick = living(w).filter((p) => (p.ill ?? 0) >= 1).length;
  const broken = w.structures.filter((s) => (s.dmg ?? 0) > 0).length;
  return {
    leader: 0,
    farmer: knows(w, "agriculture") ? 1 + deficit * 2 : 0,
    fisher: 0.7 + (knows(w, "fishing") ? 0.4 : 0) + deficit,
    hunter: knows(w, "spear") ? 0.5 + deficit : 0.15,
    builder: 0.6 + projects(w).length * 0.4 + broken * 0.5,
    scholar: w.tech.focus ? 0.9 : 0,
    crafter: knows(w, "cordage") ? 0.5 : 0.2,
    healer: knows(w, "herbs") ? 0.3 + sick * 0.6 : sick * 0.3,
    cook: knows(w, "cooking") ? 0.4 : 0,
    sailor: knows(w, "boat") ? 0.5 + (knows(w, "navigation") ? 0.4 : 0) : 0,
    guard: g.war ? 1.4 : 0,
  };
}

function assignRoles(w: WorldState, g: Group) {
  const ms = membersOf(w, g).filter((p) => adult(w, p));
  for (const p of membersOf(w, g)) if (!adult(w, p)) p.role = null;
  const need = demand(w, g);
  const count: Partial<Record<Role, number>> = {};
  const leader = findById(w.people, g.leader);
  if (leader?.alive) leader.role = "leader";
  const rest = ms.filter((p) => p !== leader).sort((a, b) => Math.max(...ROLES.map((r) => fit(b, r))) - Math.max(...ROLES.map((r) => fit(a, r))));
  for (const p of rest) {
    let best: Role = "builder", bs = -Infinity;
    for (const r of ROLES) {
      const d = need[r];
      if (d <= 0) continue;
      const s = (d / (1 + (count[r] ?? 0))) * (0.5 + fit(p, r));
      if (s > bs) {
        bs = s;
        best = r;
      }
    }
    if (p.role !== best && p.role && !p.away) say(w, p, "newRole", {}, "🧭");
    p.role = best;
    count[best] = (count[best] ?? 0) + 1;
  }
}

// ─── 매일: 무리의 움직임 ───────────────────────────────────────────────

export function dailySociety(w: WorldState, T: Terrain) {
  const alive = living(w);
  const adults = alive.filter((p) => adult(w, p));
  // 함께 지내면 뜻이 조금씩 닮아 가지만, 저마다 타고난 뜻으로 돌아오려 한다
  for (const p of adults) {
    const g = groupOf(w, p);
    const partner = findById(w.people, p.partner);
    const v = valsOf(p);
    if (p.core) {
      v[0] += (p.core[0] - v[0]) * 0.05;
      v[1] += (p.core[1] - v[1]) * 0.05;
    }
    if (g) {
      v[0] += (g.vals[0] - v[0]) * 0.02;
      v[1] += (g.vals[1] - v[1]) * 0.02;
    }
    if (partner?.alive && partner.vals) {
      v[0] += (partner.vals[0] - v[0]) * 0.03;
      v[1] += (partner.vals[1] - v[1]) * 0.03;
    }
  }

  if (!w.groups.length) {
    if (alive.length >= GROUP_POP && adults.length >= 6) formGroups(w, T, adults);
    if (w.groups.length) bump(w);
    return;
  }
  if (alive.length < 6) {
    for (const g of [...w.groups]) dissolve(w, g, "");
    chron(w, "society", "사람이 줄어들자 무리는 자연스럽게 흩어졌다.");
    bump(w);
    return;
  }

  // 무소속인 어른은 뜻이 맞는 무리에 들어간다
  for (const p of adults) {
    if (p.group != null && findById(w.groups, p.group)) continue;
    p.group = null;
    let best: Group | null = null, bs = 0.6;
    for (const g of w.groups) {
      const s = 1 - vd(valsOf(p), g.vals) * 2 + avgRel([p], membersOf(w, g)) * 0.8;
      if (s > bs) {
        bs = s;
        best = g;
      }
    }
    if (best) {
      p.group = best.id;
      say(w, p, "together", {}, "🤝");
    }
  }
  // 어디에도 맞지 않는 사람들끼리 뜻이 통하면 새 조직을 만든다
  const loners = adults.filter((p) => p.group == null);
  if (loners.length >= 3 && !w.groups.some((g) => g.kind === "civ")) {
    const c = centroid(loners.map(valsOf));
    const close = loners.filter((p) => vd(valsOf(p), c) < 0.25);
    if (close.length >= 3 && avgRel(close, close) > 0.1) {
      const g = makeGroup(w, "org", close);
      plantBanner(w, T, g);
      const leader = findById(w.people, g.leader);
      chron(w, "society", `${leader ? josa(leader.name, "을/를") + " 중심으로 " : ""}어느 무리에도 속하지 않던 ${close.length}명이 '${g.name}'${josa(g.name, "을/를").slice(g.name.length)} 만들었다.`);
      celebrate(w, close);
    }
  }
  kidsFollowParents(w);

  for (const g of [...w.groups]) {
    const ms = membersOf(w, g).filter((p) => adult(w, p));
    if (ms.length < 2) {
      dissolve(w, g, `'${groupTitle(w, g)}'${josa(groupTitle(w, g), "은/는").slice(groupTitle(w, g).length)} 사람이 남지 않아 흩어졌다.`);
      continue;
    }
    g.vals = centroid(ms.map(valsOf));
    const leader = findById(w.people, g.leader);
    if (!leader?.alive || leader.group !== g.id || chance(w, 0.05)) {
      const next = pickLeader(w, ms);
      if (next && next.id !== g.leader && leader?.alive === 0) {
        chron(w, "society", `${josa(next.name, "이/가")} '${groupTitle(w, g)}'${josa(groupTitle(w, g), "을/를").slice(groupTitle(w, g).length)} 이끌게 되었다.`);
      }
      g.leader = next?.id ?? null;
    }
    assignRoles(w, g);
  }

  civilizationCheck(w, T, adults);
  rivalry(w, T);
  bump(w);
}

/** 뜻이 모두 맞으면 문명을, 너무 벌어지면 분열을 */
function civilizationCheck(w: WorldState, T: Terrain, adults: Person[]) {
  const civ = w.groups.find((g) => g.kind === "civ");
  if (civ) {
    const ms = membersOf(w, civ).filter((p) => adult(w, p));
    const c = centroid(ms.map(valsOf));
    const spread = Math.max(...ms.map((p) => vd(valsOf(p), c)));
    civ.strain = clamp((civ.strain ?? 0) + (spread > 0.42 ? 1 : -0.5), 0, 6);
    if (civ.strain >= 5 && ms.length >= 6) {
      const title = groupTitle(w, civ);
      dissolve(w, civ, "");
      const parts = kmeans(ms, 2).filter((cl) => cl.length >= 2);
      const made: Group[] = [];
      for (const cl of parts) {
        const g = makeGroup(w, "org", cl);
        plantBanner(w, T, g);
        made.push(g);
      }
      if (made.length === 2) {
        made[0].tension[made[1].id] = 0.6;
        made[1].tension[made[0].id] = 0.6;
      }
      kidsFollowParents(w);
      chron(w, "society", `뜻이 갈라진 사람들 사이에 금이 가더니, '${title}'${josa(title, "이/가").slice(title.length)} ${made.map((g) => `'${g.name}'`).join("와 ")}(으)로 갈라졌다.`);
    }
    return;
  }
  const orgs = w.groups.filter((g) => g.kind === "org");
  if (!orgs.length) return;
  const loners = adults.filter((p) => p.group == null).length;
  const c = centroid(adults.map(valsOf));
  const close = orgs.every((g) => vd(g.vals, c) < (orgs.length > 1 ? 0.1 : 0.2));
  const calm = orgs.every((a) => orgs.every((b) => a === b || (a.tension[b.id] ?? 0) < 0.12));
  const settled = orgs.every((g) => w.time - g.founded > 30 * DAY);
  const rel = avgRel(adults, adults);
  const spread = Math.max(...adults.map((p) => vd(valsOf(p), c)));
  if (close && calm && settled && loners <= 1 && rel > 0.38 && spread < 0.34 && !orgs.some((g) => g.war)) {
    for (const g of [...orgs]) dissolve(w, g, "");
    const g = makeGroup(w, "civ", adults);
    kidsFollowParents(w);
    plantBanner(w, T, g);
    chron(w, "society", `서로의 뜻이 마침내 하나로 모였다. 무리들이 손을 맞잡고 '${g.name} 문명'을 세웠다!`);
    celebrate(w, membersOf(w, g));
  }
}

/** 무리 사이의 긴장 → 다툼 → 화해나 분열 */
function rivalry(w: WorldState, T: Terrain) {
  const orgs = w.groups.filter((g) => g.kind === "org");
  const pop = living(w).length;
  const deficit = clamp((pop * 8 - foodTotal(w)) / Math.max(1, pop * 8), 0, 1);
  for (const a of orgs) {
    for (const b of orgs) {
      if (a.id >= b.id) continue;
      const ma = membersOf(w, a), mb = membersOf(w, b);
      const cross = avgRel(ma, mb);
      const lastWar = Math.max(a.lastWar ?? -1e9, b.lastWar ?? -1e9);
      let d = (vd(a.vals, b.vals) - 0.15) * 0.25 - cross * 0.05 + deficit * 0.08;
      // 따로 살면 덜 부딪히고, 화해한 뒤 한동안은 서로 조심한다
      if (a.camp || b.camp) d = d * 0.5 - 0.03;
      if (w.time - lastWar < 40 * DAY) d = Math.min(d * 0.3, d);
      const t = clamp((a.tension[b.id] ?? 0) + d, 0, 1.5);
      a.tension[b.id] = t;
      b.tension[a.id] = t;
      if (a.war || b.war) continue;
      if (t > 1 && w.time - lastWar > 30 * DAY && ma.length >= 2 && mb.length >= 2 && chance(w, 0.5)) {
        const until = w.time + range(w, 1, 2.5) * DAY;
        a.war = { with: b.id, since: w.time, until };
        b.war = { with: a.id, since: w.time, until };
        w.history.wars++;
        chron(w, "society", `'${a.name}'${josa(a.name, "과/와").slice(a.name.length)} '${b.name}' 사이의 다툼이 끝내 싸움으로 번졌다.`);
        for (const p of [...ma, ...mb]) {
          feel(w, p, "anger", 0.4);
          feel(w, p, "fear", 0.15, false);
          p.seen.reeval = 0;
        }
      }
    }
  }
  // 싸움이 끝나면 화해하거나 갈라선다
  for (const a of orgs) {
    if (!a.war || w.time < a.war.until) continue;
    const b = findById(w.groups, a.war.with);
    a.lastWar = w.time;
    a.war = null;
    if (!b) continue;
    b.war = null;
    b.lastWar = w.time;
    const t = a.tension[b.id] ?? 0;
    const power = (g: Group) => membersOf(w, g).filter((p) => adult(w, p)).reduce((s, p) => s + p.health / 100 + (p.role === "guard" ? 0.5 : 0), 0);
    const weak = power(a) < power(b) ? a : b;
    const strong = weak === a ? b : a;
    if ((t > 0.8 || chance(w, 0.4)) && !weak.camp) {
      const site = findSite(w, T, "leanto", undefined, { min: 22, max: 34 });
      if (site) {
        weak.camp = { x: site.x, z: site.z };
        w.structures.push(makeStructure(w, "campfire", site.x, site.z, 0, true));
        plantBanner(w, T, weak);
        for (const p of membersOf(w, weak)) if (p.home != null) {
          const h = findById(w.structures, p.home);
          if (h && h.group !== weak.id) p.home = null;
        }
        a.tension[b.id] = b.tension[a.id] = 0.45;
        chron(w, "society", `싸움 끝에 '${weak.name}'${josa(weak.name, "은/는").slice(weak.name.length)} 마을을 떠나 섬의 다른 곳에 새 터전을 잡았다. 섬이 둘로 나뉘었다.`);
        continue;
      }
    }
    a.tension[b.id] = b.tension[a.id] = 0.15;
    chron(w, "society", `'${strong.name}'${josa(strong.name, "과/와").slice(strong.name.length)} '${weak.name}'${josa(weak.name, "이/가").slice(weak.name.length)} 싸움을 멈추고 화해했다.`);
    for (const p of [...membersOf(w, a), ...membersOf(w, b)]) {
      p.emo.anger *= 0.4;
      feel(w, p, "joy", 0.2, false);
      say(w, p, "peace", {}, "🕊️");
    }
  }
}

/** 이야기를 나누면 뜻이 닮아 가고, 다른 무리 사이의 긴장이 풀린다 (다투면 반대) */
export function socialize(w: WorldState, p: Person, q: Person, friendly: boolean) {
  const a = valsOf(p), b = valsOf(q);
  const k = friendly ? 0.004 : -0.006;
  for (const i of [0, 1] as const) {
    const d = b[i] - a[i];
    a[i] = clamp(a[i] + d * k, 0, 1);
    b[i] = clamp(b[i] - d * k, 0, 1);
  }
  const ga = groupOf(w, p), gb = groupOf(w, q);
  if (ga && gb && ga !== gb) {
    const t = clamp((ga.tension[gb.id] ?? 0) + (friendly ? -0.003 : 0.025), 0, 1.5);
    ga.tension[gb.id] = t;
    gb.tension[ga.id] = t;
  }
}

export function easeWar(w: WorldState, p: Person, amt: number) {
  const g = groupOf(w, p);
  const o = g?.war ? findById(w.groups, g.war.with) : undefined;
  if (!g || !o) return;
  const t = clamp((g.tension[o.id] ?? 0) - amt, 0, 1.5);
  g.tension[o.id] = t;
  o.tension[g.id] = t;
}

