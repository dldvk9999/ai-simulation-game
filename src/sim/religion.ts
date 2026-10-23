// 종교: 농경 사회가 되면 뜻(바람)이 같은 사람이 셋 이상 모여 종교를 세운다.
// 무엇을 비느냐에 따라 의식이 다르고, 때맞춰 올린 의식은 조금씩 효험이 있다 — 저주도 마찬가지다.
import { act, spot } from "./acts";
import { DAY, HOUR, MIN } from "./constants";
import { seasonOf } from "./clock";
import { illOf } from "./disease";
import { shiftMorale } from "./morale";
import { clamp } from "./noise";
import { age, feel, say } from "./people";
import { chance, pick, range } from "./rng";
import { foodTotal } from "./settlement";
import { josa } from "./text";
import type { Act, Faith, Person, Religion, WorldState } from "./types";
import { addFx, bump, chron, knows, living, newId } from "./world";

export const FAITH: Record<Faith, { icon: string; wish: string; rite: string; names: string[]; days: number }> = {
  rain: { icon: "🌧️", wish: "단비와 풍년", rite: "기우제", names: ["단비교", "비구름회", "농신교", "물방울회"], days: 2 },
  bounty: { icon: "🍖", wish: "넉넉한 먹을거리", rite: "풍요제", names: ["풍요교", "산신교", "사냥신회", "곳간회"], days: 3 },
  health: { icon: "🌿", wish: "아픈 이 없는 마을", rite: "치유 기도", names: ["무병교", "약수회", "푸른손회"], days: 3 },
  peace: { icon: "🛡️", wish: "맹수와 재해로부터의 보호", rite: "수호제", names: ["수호교", "천신교", "등불회"], days: 4 },
  curse: { icon: "☠️", wish: "미운 이들에게 내릴 재앙", rite: "저주 의식", names: ["검은달회", "재앙교", "그림자회"], days: 5 },
};

const adult = (w: WorldState, p: Person) => age(w, p) >= 16;
export const religionOf = (w: WorldState, p: Person) => (p.faith != null ? w.religions.find((r) => r.id === p.faith) : undefined);
export const believers = (w: WorldState, r: Religion) => w.people.filter((p) => p.alive && p.faith === r.id);

/** 지금 받고 있는 효험의 세기 (0이면 없음) */
export function blessed(w: WorldState, aim: Faith) {
  let k = 0;
  for (const b of w.blessings ?? []) if (b.aim === aim && w.time < b.until) k = Math.max(k, b.power);
  return k;
}

/** 이 사람이 가장 바라는 것 (믿음이 깊지 않으면 없음) */
function wishOf(w: WorldState, p: Person): Faith | null {
  const t = p.traits;
  const devout = 0.25 + t.openness * 0.35 + t.neuroticism * 0.3 + (p.grief ? 0.2 : 0);
  if (devout < 0.45) return null;
  // 원한이 깊은 사람은 저주를 빈다
  if (p.emo.anger > 0.45 && t.agreeableness < 0.4) return "curse";
  if ((p.ill ?? 0) >= 2 || p.grief || w.people.some((q) => q.alive && (q.ill ?? 0) >= 3 && (q.partner === p.id || q.parents.includes(p.id)))) return "health";
  if (p.role === "farmer" || (p.skills.farm ?? 0) > 0.25) return "rain";
  if (p.role === "hunter" || p.role === "fisher" || p.needs.hunger < 45) return "bounty";
  if ((w.history.beast ?? 0) > 0 || w.history.lastDisaster) return t.neuroticism > 0.5 ? "peace" : "rain";
  return t.conscientiousness > 0.5 ? "rain" : "bounty";
}

const close = (a: Person, b: Person) => {
  const va = a.vals ?? [0.5, 0.5], vb = b.vals ?? [0.5, 0.5];
  const like = Math.min(a.rel[b.id] ?? 0, b.rel[a.id] ?? 0);
  return like > 0.25 || (like > 0.05 && Math.hypot(va[0] - vb[0], va[1] - vb[1]) < 0.25);
};

/** 매일: 종교가 생기고, 사람이 들고 나고, 의식을 올릴 때를 정한다 */
export function dailyReligion(w: WorldState) {
  w.blessings = (w.blessings ?? []).filter((b) => w.time < b.until);
  if (!knows(w, "agriculture")) return;
  const alive = living(w);
  // 믿는 사람이 둘도 안 남으면 사라진다
  for (const r of [...w.religions]) {
    const ms = believers(w, r);
    if (ms.length < 2) {
      for (const p of ms) p.faith = null;
      w.religions = w.religions.filter((x) => x !== r);
      chron(w, "faith", `믿는 사람이 떠나고 '${r.name}'의 제단도 쓸쓸해졌다.`);
    }
  }
  const free = alive.filter((p) => adult(w, p) && !religionOf(w, p) && !p.away);
  const wishes = new Map<Faith, Person[]>();
  for (const p of free) {
    const k = wishOf(w, p);
    if (k) wishes.set(k, [...(wishes.get(k) ?? []), p]);
  }
  // 이미 있는 종교에 들어간다
  for (const [k, list] of wishes) {
    const r = w.religions.find((x) => x.aim === k);
    if (!r) continue;
    const ms = believers(w, r);
    for (const p of list) {
      if (ms.some((m) => close(p, m)) && chance(w, 0.2)) {
        p.faith = r.id;
        say(w, p, "faithJoin", { name: r.name }, "🙏");
      }
    }
  }
  // 마음이 맞는 사람이 셋 이상 모이면 새 종교를 세운다
  for (const [k, list] of wishes) {
    if (w.religions.some((x) => x.aim === k)) continue;
    const pool = list.filter((p) => !religionOf(w, p));
    for (const core of pool) {
      const circle = [core, ...pool.filter((q) => q !== core && close(core, q))];
      // 서로서로 마음이 맞아야 한다
      const tight = circle.filter((q) => circle.filter((o) => o !== q && close(q, o)).length >= 2);
      if (tight.length >= 3 && chance(w, 0.4)) {
        found(w, k, tight);
        break;
      }
    }
  }
  // 의식을 올릴 때
  for (const r of w.religions) {
    if (r.call && w.time - r.call > 8 * HOUR) {
      r.call = 0;
      r.gathered = [];
    }
    if (r.call || w.time - r.lastRite < 2.5 * DAY) continue;
    if (timely(w, r)) {
      r.call = w.time;
      r.gathered = [];
      for (const p of believers(w, r)) p.seen.reeval = 0;
    }
  }
}

function found(w: WorldState, aim: Faith, ms: Person[]) {
  const used = new Set(w.religions.map((r) => r.name));
  const name = FAITH[aim].names.find((n) => !used.has(n)) ?? `${pick(w, FAITH[aim].names)}${w.religions.length + 1}`;
  const r: Religion = { id: newId(w), name, aim, founded: w.time, hue: range(w, 0, 1), call: 0, gathered: [], lastRite: w.time - 2 * DAY, rites: 0 };
  // 저주는 가장 사이가 나쁜 무리를 향한다
  if (aim === "curse") {
    const mine = new Set(ms.map((p) => p.group));
    const foe = w.groups.filter((g) => !mine.has(g.id)).sort((a, b) => Math.max(...Object.values(b.tension), 0) - Math.max(...Object.values(a.tension), 0))[0];
    r.target = foe?.id ?? null;
  }
  w.religions.push(r);
  for (const p of ms) {
    p.faith = r.id;
    feel(w, p, "joy", 0.3, false);
    say(w, p, "faithFound", { name }, "🙏", true);
  }
  const lead = ms[0];
  const what = aim === "curse" ? "남몰래 모여 재앙을 비는" : `${josa(FAITH[aim].wish, "을/를")} 비는`;
  chron(w, "faith", `${josa(lead.name, "을/를")} 비롯해 마음이 맞는 ${ms.length}명이 ${what} '${name}'${josa(name, "을/를").slice(name.length)} 세웠다.`);
  bump(w);
}

/** 의식을 올리기에 알맞은 때인지 (때를 놓친 의식은 효험이 없다) */
function timely(w: WorldState, r: Religion) {
  const season = seasonOf(w.time);
  const dry = w.time - (w.history.lastRain ?? 0) > 1.5 * DAY && w.weather.type !== "rain" && w.weather.type !== "storm";
  switch (r.aim) {
    // 기우제: 씨 뿌리고 자라는 봄·여름에 가물 때
    case "rain": return (season === 0 || season === 1) && dry && w.structures.some((s) => s.type === "farm");
    case "bounty": return foodTotal(w) < living(w).length * 8 || w.time - r.lastRite > 6 * DAY;
    case "health": return w.people.some((p) => p.alive && illOf(p) >= 2) || w.time - r.lastRite > 8 * DAY;
    case "peace": return (!!w.history.lastBeast && w.time - w.history.lastBeast < 10 * DAY) || w.time - r.lastRite > 7 * DAY;
    case "curse": return w.time - r.lastRite > 4 * DAY;
  }
}

/** 의식을 올리는 자리: 제단, 없으면 마을 불가 */
export function riteSpot(w: WorldState, r: Religion) {
  const s = w.structures.find((x) => x.type === "shrine" && x.faith === r.id && x.prog >= 1);
  return s ?? w.camp;
}

/** 부름을 받은 믿는 사람이 할 일 */
export function riteCand(w: WorldState, p: Person): { s: number; mk: () => Act } | null {
  const r = religionOf(w, p);
  if (!r || !r.call || r.gathered.includes(p.id)) return null;
  const at = riteSpot(w, r);
  const devout = 0.6 + p.traits.openness * 0.2 + p.traits.neuroticism * 0.15;
  return {
    s: devout,
    mk: () => {
      const s = spot(p, at.x, at.z, 2 + (p.id % 3) * 0.5);
      return act(w, "rite", s.x, s.z, range(w, 30, 45) * MIN, { tid: r.id });
    },
  };
}

export function riteStart(w: WorldState, p: Person, a: Act) {
  const r = w.religions.find((x) => x.id === a.tid);
  if (!r) return;
  const at = riteSpot(w, r);
  p.rot = Math.atan2(at.z - p.z, at.x - p.x);
  say(w, p, `pray_${r.aim}`, { name: r.name }, FAITH[r.aim].icon, true);
  addFx(w, "pray", p.x, p.z, p.id);
}

/** 기도를 마쳤다: 셋 이상이 함께 올리면 의식이 이루어진다 */
export function riteFinish(w: WorldState, p: Person, a: Act) {
  const r = w.religions.find((x) => x.id === a.tid);
  if (!r || !r.call || r.gathered.includes(p.id)) return;
  r.gathered.push(p.id);
  feel(w, p, "joy", 0.12, false);
  p.emo.fear = Math.max(0, p.emo.fear - 0.15);
  if (r.gathered.length < 3) return;
  // 의식이 이루어졌다
  const power = clamp(0.4 + 0.1 * believers(w, r).length, 0.4, 1);
  w.blessings.push({ aim: r.aim, until: w.time + FAITH[r.aim].days * DAY, power, by: r.id });
  r.lastRite = w.time;
  r.rites++;
  r.call = 0;
  const at = riteSpot(w, r);
  addFx(w, "pray", at.x, at.z);
  if (r.aim !== "curse") shiftMorale(w, 1);
  const where = at === w.camp ? "마을 불가에" : "제단에";
  const msg: Record<Faith, string> = {
    rain: `'${r.name}' 사람들이 ${where} 모여 비를 내려 달라는 기우제를 지냈다.`,
    bounty: `'${r.name}' 사람들이 ${where} 모여 먹을 것이 넘치게 해 달라고 풍요제를 올렸다.`,
    health: `'${r.name}' 사람들이 ${where} 모여 아픈 이가 낫기를 빌었다.`,
    peace: `'${r.name}' 사람들이 ${where} 모여 맹수와 재해를 막아 달라고 수호제를 올렸다.`,
    curse: `'${r.name}' 사람들이 밤중에 ${where} 모여 재앙을 부르는 저주 의식을 올렸다…`,
  };
  // 의식 이야기는 너무 잦지 않게 (같은 종교는 여섯 번에 한 번, 저주는 늘)
  if (r.rites === 1 || r.rites % 6 === 0 || r.aim === "curse") chron(w, "faith", msg[r.aim]);
  bump(w);
}

/** 기우제를 올린 뒤 비가 오면 사람들이 효험을 믿는다 */
export function rainAnswered(w: WorldState) {
  const b = (w.blessings ?? []).find((x) => x.aim === "rain" && w.time < x.until);
  if (!b) return;
  const r = w.religions.find((x) => x.id === b.by);
  b.until = w.time;
  if (!r) return;
  for (const p of believers(w, r)) {
    feel(w, p, "joy", 0.35);
    say(w, p, "rainAnswered", {}, "🌧️");
  }
  if (r.rites <= 2 || chance(w, 0.25)) chron(w, "faith", `기우제를 지낸 덕분인지, 메마른 밭에 단비가 내렸다. '${r.name}'의 믿음이 깊어졌다.`);
}

/** 제단이 필요한 종교 (건설 계획) */
export function needShrine(w: WorldState) {
  return w.religions.find((r) => believers(w, r).length >= 3 && !w.structures.some((s) => s.type === "shrine" && s.faith === r.id));
}

/** 사람 카드: 믿는 종교 */
export function faithLabel(w: WorldState, p: Person) {
  const r = religionOf(w, p);
  if (!r) return "";
  return `${FAITH[r.aim].icon} ${r.name} · ${josa(FAITH[r.aim].wish, "을/를")} 빔`;
}
