// 맹수: 아주 가끔 숲 깊은 곳에서 나타나 사람을 노린다. 섬에서 보낸 날이 길수록, 섬 사람이 많을수록 강한 놈이 여럿 온다.
// 마지막에는 하늘을 나는 용이 불을 뿜는다. 맹수는 사람을 다치게 하고 목숨도 앗지만, 한 번의 습격에서
// 해칠 수 있는 사람 수는 섬 사람 수에 맞춰 정해져 있어 마을을 몰살하지는 않는다.
// 사람들은 그 시대의 무기를 들고 맞서거나 집으로 숨는다. 망루·성루·포대에 오르면 위에서 쏘아 마을을 지킨다.
import { DAY, ERA_STRETCH, HOUR, MIN, WALK_SPEED } from "./constants";
import { hourOf } from "./clock";
import { BARE_HANDS, HOUSE_TYPES, STRUCTS, TECH_BY_ID, WEAPONS } from "./data";
import { harm, maxHp } from "./building";
import { shiftMorale } from "./morale";
import { blessed } from "./religion";
import { igniteStructure, startWildfire } from "./fire";
import { age, die, feel, injure, lying, say } from "./people";
import { chance, int, range } from "./rng";
import { addResearch, available } from "./settlement";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Act, Beast, BeastKind, Person, Structure, StructureType, WorldState } from "./types";
import { addFx, addStock, bump, chron, dist, findById, living, makeItem, newId, onIsland, stockOf } from "./world";

export const BEAST_INFO: Record<BeastKind, { name: string; from: number; to: number; speed: number }> = {
  wolf: { name: "늑대", from: 0, to: 2.8, speed: 1.05 },
  bear: { name: "곰", from: 2.8, to: 6, speed: 0.9 },
  tiger: { name: "호랑이", from: 6, to: 12, speed: 1.1 },
  sabertooth: { name: "검치호", from: 12, to: 20, speed: 1.15 },
  dragon: { name: "용", from: 20, to: 40, speed: 1.35 },
};

/** 섬에서 보낸 날에 따라 강해진다: 처음엔 늑대, 몇 달 뒤엔 곰, 해가 바뀌면 호랑이… */
/** 시대가 느리게 넘어가는 만큼 맹수도 천천히 세진다 (그 시대의 무기로 맞설 수 있게) */
export const beastPower = (w: WorldState) => 1 + w.time / DAY / (40 * ERA_STRETCH);
export const kindFor = (pow: number): BeastKind => (pow >= 20 ? "dragon" : pow >= 12 ? "sabertooth" : pow >= 6 ? "tiger" : pow >= 2.8 ? "bear" : "wolf");
/** 섬 사람이 많을수록 맹수도 세진다 (사람이 적은 섬에는 약한 놈이 온다) */
export const popMul = (pop: number) => Math.max(0.6, Math.min(1.9, 0.55 + pop / 45));
/** 이번에 올 맹수의 힘: 섬에서 보낸 날 × 섬 사람 수 */
export const threatOf = (w: WorldState) => beastPower(w) * popMul(living(w).length);
/** 하늘에 떠 있는 용 (칼과 창이 닿지 않는다) */
export const aloft = (b: Beast) => b.kind === "dragon" && (b.fly ?? 0) > 0.45;
export const biteOf = (b: Beast) => 6 + 3 * Math.pow(b.pow, 0.8);
/** 같은 종류 안에서 얼마나 큰 놈인지 0..1 (화면 크기) */
export function growthOf(b: Beast) {
  const k = BEAST_INFO[b.kind];
  return Math.max(0, Math.min(1, (b.pow - k.from) / (k.to - k.from)));
}
export const beastName = (b: Beast) => (growthOf(b) > 0.75 ? "거대한 " : "") + BEAST_INFO[b.kind].name;
export const active = (b: Beast) => b.st !== "dead" && b.st !== "leave";

/** 망루·성루·포대: 위에 오른 사람이 멀리서 쏜다 */
export const TOWER: Partial<Record<StructureType, { dmg: number; range: number }>> = {
  watchtower: { dmg: 12, range: 16 },
  fort: { dmg: 30, range: 20 },
  battery: { dmg: 70, range: 26 },
};
export const towerRange = (s: Structure) => (TOWER[s.type]?.range ?? 0) + ((s.lv ?? 1) - 1) * 2;

const DAILY_CHANCE = 1 / 8;
/** 몇 게임 초마다 한 번 물거나 치는지 */
const BITE_EVERY = 75;
export const STRIKE_EVERY = 50;

// ─── 나타남 ────────────────────────────────────────────────────────────

/** 하루에 한 번: 오늘 맹수가 올지 정한다 (저녁과 밤에 더 자주) */
export function dailyBeasts(w: WorldState) {
  if (w.time < (w.timers.beast ?? 0) || w.timers.beastAt || w.time < 18 * DAY) return;
  // 사람이 몇 모여 살기 시작해야 맹수의 눈에 띈다
  if (w.beasts.some((b) => b.st !== "dead") || living(w).length < 4) return;
  // 수호제는 맹수를 덜 부르고, 저주는 더 부른다
  if (!chance(w, DAILY_CHANCE * (1 - 0.35 * blessed(w, "peace") + 0.3 * blessed(w, "curse")))) return;
  const h = chance(w, 0.6) ? range(w, 18, 23.5) : range(w, 6, 18);
  w.timers.beastAt = w.time + h * HOUR;
}

/** 사람 눈이 닿지 않는 먼 숲이나 바위 지대에서 나타난다 */
export function spawnBeasts(w: WorldState, T: Terrain, pow = threatOf(w) * range(w, 0.85, 1.15)) {
  const people = living(w);
  const far = (x: number, z: number) => dist(x, z, w.camp.x, w.camp.z) > 50 && people.every((p) => dist(x, z, p.x, p.z) > 35);
  const pt = T.randomPoint(w, (x, z, b) => (b === "forest" || b === "rock" || b === "grass") && far(x, z), 400)
    ?? T.randomPoint(w, (x, z, b) => b === "forest" || b === "grass", 200);
  if (!pt) return [];
  // 용이 올 만큼 강해져도 때로는 검치호 무리가 몰려온다
  let kind = kindFor(pow);
  if (kind === "dragon" && chance(w, 0.45)) kind = "sabertooth";
  // 섬 사람이 많으면 여럿이 몰려온다
  const pop = people.length;
  const pack = kind === "wolf" ? Math.min(5, (pow < 1.4 ? int(w, 1, 2) : int(w, 2, 3)) + Math.floor(pop / 20))
    : kind === "dragon" ? (pop >= 45 && chance(w, 0.4) ? 2 : 1)
    : Math.max(1, Math.min(3, 1 + Math.floor(pop / 22) - (chance(w, 0.35) ? 1 : 0)));
  const out: Beast[] = [];
  for (let i = 0; i < pack; i++) {
    const p = pack > 1 ? pow * range(w, 0.65, 0.8) : pow;
    const max = Math.round(30 * p);
    const b: Beast = {
      id: newId(w), kind, x: pt.x + range(w, -2, 2), z: pt.z + range(w, -2, 2), rot: range(w, 0, Math.PI * 2),
      st: "prowl", hp: max, max, pow: p, tx: w.camp.x, tz: w.camp.z, target: null, siege: null,
      until: w.time + range(w, 6, 9) * HOUR, stun: 0, atk: 0, home: { x: pt.x, z: pt.z }, born: w.time, foes: [],
    };
    if (kind === "dragon") {
      b.fly = 1;
      b.breath = w.time + range(w, 10, 20) * MIN;
    }
    w.beasts.push(b);
    out.push(b);
  }
  // 이번 습격에서 해칠 수 있는 사람 수 (섬 사람이 적을수록 적게, 네 명 이하면 아무도)
  w.timers.beastKills = 0;
  w.timers.beastCap = pop <= 6 ? 0 : Math.max(1, Math.floor(pop / 18));
  w.history.beast = (w.history.beast ?? 0) + 1;
  w.history.lastBeast = w.time;
  w.timers.beast = w.time + range(w, 6, 12) * DAY;
  const name = beastName(out[0]);
  const many = pack > 1 ? ` ${pack}마리` : "";
  if (kind === "dragon") chron(w, "beast", `하늘이 갑자기 어두워지더니 거대한 날갯짓 소리가 섬을 덮었다. ${name}${many}${josa(many || name, "이/가").slice((many || name).length)} 나타났다! 불을 뿜는 그림자가 마을로 향한다!`);
  else chron(w, "beast", hourOf(w.time) >= 19 || hourOf(w.time) < 5
    ? `어둠 속 숲에서 낮게 으르렁거리는 소리가 들렸다. ${name}${many}${josa(many || name, "이/가").slice((many || name).length)} 나타났다!`
    : `숲 깊은 곳에서 ${name}${many}${josa(many || name, "이/가").slice((many || name).length)} 모습을 드러냈다. 사람을 노리는 눈빛이다!`);
  addFx(w, "roar", pt.x, pt.z, out[0].id, pow);
  bump(w);
  return out;
}

// ─── 안전한 곳 ─────────────────────────────────────────────────────────

const SAFE = new Set<StructureType>([...HOUSE_TYPES, "hall", "infirmary", "library", "fort", "battery", "factory", "observatory"]);
const HIDE_ACTS = new Set(["hide", "sleep", "shelter", "rest", "isolate", "addict"]);
const usable = (s: Structure) => s.prog >= 1 && (s.dmg ?? 0) < 0.6;

/** 숨을 수 있는 튼튼한 건물 */
export const shelterOk = (s: Structure) => SAFE.has(s.type) && usable(s);

/** 지금 맹수 이빨이 닿지 않는 곳에 있는지 (집 안, 망루 위) */
export function safeFromBeast(w: WorldState, p: Person): boolean {
  // 젖먹이는 안아 주는 어른이 안전하면 함께 안전하다
  if (age(w, p) < 3) return w.people.some((q) => q !== p && onIsland(q) && age(w, q) >= 12 && dist(p.x, p.z, q.x, q.z) < 2.5 && safeFromBeast(w, q));
  const a = p.act;
  if (!a || a.ph !== 1) return false;
  if (a.k === "defend" && a.sub === "tower") {
    const t = findById(w.structures, a.n);
    return !!t && usable(t);
  }
  if (!HIDE_ACTS.has(a.k)) return false;
  return w.structures.some((s) => shelterOk(s) && dist(p.x, p.z, s.x, s.z) < STRUCTS[s.type].radius + 1.2);
}

/** 이 사람이 마주한 맹수 (가까이 있거나, 망루가 마을에 알렸을 때) */
export function threatFor(w: WorldState, p: Person): Beast | null {
  let best: Beast | null = null;
  let bd = Infinity;
  for (const b of w.beasts) {
    if (!active(b)) continue;
    const d = dist(p.x, p.z, b.x, b.z);
    const alarmed = p.seen.bst === b.born;
    if (d < (alarmed ? 60 : 36) && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

// ─── 싸움 ──────────────────────────────────────────────────────────────

export const weaponOf = (res: string | undefined) => WEAPONS.find((x) => x.res === res) ?? BARE_HANDS;

/** 창고의 무기 가운데 아직 아무도 들지 않은 가장 좋은 것 */
export function pickWeapon(w: WorldState) {
  for (const wp of WEAPONS) {
    const have = stockOf(w, wp.res);
    if (have < 1) continue;
    const used = w.people.reduce((n, q) => n + (q.act?.k === "defend" && q.act.sub === wp.res ? 1 : 0), 0);
    if (used < Math.floor(have)) return wp;
  }
  return BARE_HANDS;
}

/** 지금 싸우러 나설 수 있는 사람 모두가 들 수 있는 무기로 1분에 줄 수 있는 피해 (어림) */
export function teamPower(w: WorldState, fighters: number) {
  let left = fighters;
  let sum = 0;
  for (const wp of WEAPONS) {
    const n = Math.min(left, Math.floor(stockOf(w, wp.res)));
    sum += n * wp.dmg;
    left -= n;
  }
  sum += left * BARE_HANDS.dmg;
  for (const s of w.structures) if (TOWER[s.type] && usable(s)) sum += TOWER[s.type]!.dmg;
  return sum * 0.6 * (60 / STRIKE_EVERY);
}

/** 한 번 친다 (싸우는 사람의 작업 중에 불린다) */
export function strike(w: WorldState, T: Terrain, p: Person, b: Beast, a: Act) {
  if (!active(b) && b.st !== "stun") return;
  const tower = a.sub === "tower" ? findById(w.structures, a.n) : undefined;
  const wp = weaponOf(tower ? bestRanged(w, p) : a.sub);
  // 하늘에 뜬 용에게는 활과 총, 망루 위에서 쏘는 것만 닿는다
  if (aloft(b) && !tower && wp.range <= 3) {
    if (chance(w, 0.15)) say(w, p, "outOfReach", {}, "😤");
    return;
  }
  const base = tower ? Math.max(wp.dmg, TOWER[tower.type]?.dmg ?? 0) * 1.15 : wp.dmg;
  const skill = p.skills.hunt ?? 0;
  const role = p.role === "guard" || p.role === "hunter" ? 1.2 : 1;
  const hit = 0.55 + skill * 0.15 + ("gun" in wp && wp.gun ? 0.1 : 0) + (tower ? 0.1 : 0) + (b.st === "stun" ? 0.25 : 0);
  const fx = "gun" in wp && wp.gun ? "shot" : wp.range > 3 || tower ? "hit" : "clash";
  addFx(w, fx, (b.x + p.x) / 2, (b.z + p.z) / 2, b.id);
  if (!b.foes.includes(p.id)) b.foes.push(p.id);
  p.skills.hunt = Math.min(1, skill + 0.01);
  if (!chance(w, Math.min(0.95, hit))) return;
  const dmg = base * range(w, 0.8, 1.2) * role * (1 + skill * 0.3);
  b.hp -= dmg;
  addFx(w, "hit", b.x, b.z, b.id, dmg);
  // 무기도 닳는다
  if (wp.res && !tower && chance(w, 0.008) && stockOf(w, wp.res) >= 1) {
    addStock(w, wp.res, -1);
    say(w, p, "toolBreak", {}, "💢", true);
  }
  // 덤벼든 사람에게 고개를 돌린다
  if (!tower && dist(p.x, p.z, b.x, b.z) < 3.5 && chance(w, 0.4)) b.target = p.id;
  if (b.hp <= 0) slay(w, T, b);
}

function bestRanged(w: WorldState, p: Person) {
  void p;
  return WEAPONS.find((x) => x.range > 3 && stockOf(w, x.res) >= 1)?.res;
}

function slay(w: WorldState, T: Terrain, b: Beast) {
  void T;
  b.st = "dead";
  b.hp = 0;
  b.gone = w.time + 1.5 * HOUR;
  b.target = null;
  b.siege = null;
  w.items.push(makeItem(w, "meat", Math.min(14, 3 + Math.round(b.pow)), b.x + 0.6, b.z));
  w.items.push(makeItem(w, "hide", b.kind === "wolf" ? 1 : b.kind === "dragon" ? 4 : 2, b.x - 0.6, b.z + 0.3));
  // 용의 둥지에서 모은 보물
  if (b.kind === "dragon") {
    w.items.push(makeItem(w, "gold", int(w, 2, 4), b.x, b.z - 0.7));
    if (chance(w, 0.35)) w.items.push(makeItem(w, "diamond", 1, b.x + 0.4, b.z + 0.7));
  }
  addFx(w, "catch", b.x, b.z, b.id);
  const foes = b.foes.map((id) => findById(w.people, id)).filter((q): q is Person => !!q && !!q.alive);
  const arms = [...new Set(foes.filter((q) => q.act?.sub !== "tower").map((q) => weaponOf(q.act?.sub).name))].filter((x) => x !== BARE_HANDS.name).slice(0, 2);
  const tower = foes.map((q) => (q.act?.sub === "tower" ? findById(w.structures, q.act.n) : undefined)).find(Boolean);
  const names = foes.slice(0, 2).map((q) => q.name).join(", ");
  const who = foes.length > 2 ? `${names} 등 ${foes.length}명이` : foes.length ? josa(names, "이/가") : "사람들이";
  const held = (tower ? `${STRUCTS[tower.type].name} 위에서 쏘고 ` : "") +
    (arms.length === 2 ? `${josa(arms[0], "과/와")} ${josa(arms[1], "을/를")} 들고 ` : arms.length ? `${josa(arms[0], "을/를")} 들고 ` : foes.length && !tower ? "맨손으로 " : "");
  const name = beastName(b);
  const more = w.beasts.some((x) => x !== b && x.born === b.born && active(x));
  if (b.kind === "dragon") chron(w, "beast", `${who} ${held}마침내 ${josa(name, "을/를")} 쓰러뜨렸다! 섬을 뒤덮던 불길의 그림자가 걷히고, 용이 지키던 금붙이가 땅에 흩어졌다.`);
  else chron(w, "beast", more ? `${who} ${held}${name} 한 마리를 쓰러뜨렸다!` : `${who} ${held}힘을 모아 ${josa(name, "을/를")} 물리쳤다!`);
  shiftMorale(w, 6 + Math.min(b.kind === "dragon" ? 14 : 8, b.pow * 0.5));
  for (const q of living(w)) {
    const near = foes.includes(q);
    feel(w, q, "joy", near ? 0.5 : 0.2, near);
    q.emo.fear *= 0.4;
    if (near) {
      say(w, q, "beastWin", { beast: BEAST_INFO[b.kind].name }, "💪", true);
      addResearch(w, q, 6, nextWeaponTech(w) ?? undefined);
    }
    q.seen.reeval = 0;
  }
  bump(w);
}

/** 더 강한 맹수를 막으려면 다음에 궁리해야 할 것 */
export function nextWeaponTech(w: WorldState) {
  const av = new Set(available(w).map((t) => t.id));
  return ["bronzeweapon", "watchtower", "ironweapon", "fortress", "firearm", "rifle"].find((id) => av.has(id)) ?? null;
}

// ─── 매 순간 ───────────────────────────────────────────────────────────

/** 따라잡기처럼 큰 걸음으로 시간이 흐르는 중인지: 사람이 제대로 피하거나 맞설 틈이 없으니 덜 치명적으로 */
let coarse = false;

export function updateBeasts(w: WorldState, T: Terrain, dt: number) {
  if (w.timers.beastAt && w.time >= w.timers.beastAt) {
    w.timers.beastAt = 0;
    spawnBeasts(w, T);
  }
  if (!w.beasts.length) return;
  // 큰 dt(따라잡기)에서도 움직임은 잘게 나누되, 사람이 피할 틈도 없이 여러 번 물지는 않게 한다
  const bites = new Map<number, number>();
  for (const b of w.beasts) bites.set(b.id, dt > 60 ? 1 : 9);
  coarse = dt > 60;
  for (let left = dt; left > 1e-6; ) {
    const d = Math.min(left, 30);
    for (const b of [...w.beasts]) beastStep(w, T, b, d, bites);
    left -= d;
  }
}

function moveToward(T: Terrain, b: Beast, x: number, z: number, step: number) {
  const d = dist(b.x, b.z, x, z);
  if (d < 1e-3) return true;
  const k = Math.min(1, step / d);
  const nx = b.x + (x - b.x) * k, nz = b.z + (z - b.z) * k;
  // 물에는 들어가지 않는다 (하늘을 나는 용은 바다 위로도 날아간다)
  if (b.kind !== "dragon" && (T.height(nx, nz) < 0.2 || T.inPond(nx, nz, 0.4))) return true;
  b.x = nx;
  b.z = nz;
  b.rot = Math.atan2(z - b.z, x - b.x);
  return k >= 1;
}

function beastStep(w: WorldState, T: Terrain, b: Beast, dt: number, bites: Map<number, number>) {
  const canBite = () => {
    const n = bites.get(b.id) ?? 0;
    if (n <= 0) return false;
    bites.set(b.id, n - 1);
    return true;
  };
  if (b.st === "dead") {
    if (w.time >= (b.gone ?? 0)) {
      w.beasts = w.beasts.filter((x) => x !== b);
      bump(w);
    }
    return;
  }
  if (b.st === "stun") {
    if (w.time < b.stun) return;
    b.st = "prowl";
  }
  const speed = WALK_SPEED * BEAST_INFO[b.kind].speed;
  // 다쳤거나 오래 헤매면 숲으로 돌아간다
  const crowd = b.hp < b.max * 0.45 && w.people.filter((q) => onIsland(q) && !lying(q) && age(w, q) >= 16 && q.health > 30 && dist(q.x, q.z, b.x, b.z) < 7).length >= 3;
  if (b.st !== "leave" && (w.time >= b.until || b.hp < b.max * 0.3 || crowd || (b.bored ?? 0) > 2 * HOUR)) {
    const hurt = b.hp < b.max * 0.45;
    b.st = "leave";
    b.target = null;
    b.siege = null;
    const pack = w.beasts.filter((x) => x.born === b.born && x !== b);
    if (!pack.some((x) => x.st === "leave")) {
      const name = beastName(b);
      const away = b.kind === "dragon" ? "하늘 저편으로" : "숲 속으로";
      chron(w, "beast", hurt ? `상처 입은 ${josa(name, "이/가")} ${away} 달아났다.` : b.ate ? `사람을 해친 ${josa(name, "은/는")} ${away} 사라졌다.` : `${josa(name, "은/는")} 먹잇감을 찾지 못하고 ${away} 돌아갔다.`);
      if (hurt) shiftMorale(w, 3);
    }
    bump(w);
  }
  if (b.st === "leave") {
    const done = moveToward(T, b, b.home.x, b.home.z, speed * 1.4 * dt);
    if (done || dist(b.x, b.z, b.home.x, b.home.z) < 2 || w.time > b.until + 3 * HOUR) {
      w.beasts = w.beasts.filter((x) => x !== b);
      bump(w);
    }
    return;
  }
  alarm(w, b);
  if (b.kind === "dragon") dragonSky(w, T, b, dt);

  let tgt: Person | null | undefined = findById(w.people, b.target);
  if (!tgt || !onIsland(tgt) || downed(tgt) || safeFromBeast(w, tgt) || dist(b.x, b.z, tgt.x, tgt.z) > 40 || T.height(tgt.x, tgt.z) < 0.1) tgt = pickTarget(w, T, b);
  b.target = tgt?.id ?? null;
  if (tgt) {
    b.siege = null;
    const d = dist(b.x, b.z, tgt.x, tgt.z);
    if (d > 1.3) {
      b.st = d < 26 ? "chase" : "prowl";
      moveToward(T, b, tgt.x, tgt.z, speed * (b.st === "chase" ? 1.55 : 0.85) * dt);
      b.atk = Math.max(0, b.atk - dt);
    } else {
      b.st = "maul";
      b.rot = Math.atan2(tgt.z - b.z, tgt.x - b.x);
      b.atk -= dt;
      // 용은 땅에 내려앉아야 문다
      if (b.atk <= 0 && !aloft(b) && canBite()) {
        b.atk = BITE_EVERY;
        bite(w, T, b, tgt);
        b.bored = Math.max(0, (b.bored ?? 0) - 20 * MIN);
      }
    }
    return;
  }
  b.bored = (b.bored ?? 0) + dt;
  // 숨은 사람이 있는 집을 부수려 든다 (곰부터는 힘이 세다. 용은 위에서 불을 뿜는다)
  const house = b.pow >= 2.8 ? siegeTarget(w, b) : null;
  if (house && b.kind === "dragon") {
    b.siege = house.id;
    b.st = "chase";
    if (dist(b.x, b.z, house.x, house.z) > 9) moveToward(T, b, house.x, house.z, speed * 1.2 * dt);
    return;
  }
  if (house) {
    b.siege = house.id;
    const r = STRUCTS[house.type].radius + 0.7;
    const d = dist(b.x, b.z, house.x, house.z);
    if (d > r) {
      b.st = "chase";
      const a = Math.atan2(b.z - house.z, b.x - house.x);
      moveToward(T, b, house.x + Math.cos(a) * r * 0.9, house.z + Math.sin(a) * r * 0.9, speed * 1.2 * dt);
    } else {
      b.st = "maul";
      b.rot = Math.atan2(house.z - b.z, house.x - b.x);
      b.atk -= dt;
      if (b.atk <= 0 && canBite()) {
        b.atk = BITE_EVERY;
        harm(w, T, house, (biteOf(b) * 0.3) / maxHp(house), "beast");
        addFx(w, "bite", house.x, house.z, house.id);
        const broken = !usable(house);
        for (const q of living(w)) if (dist(q.x, q.z, house.x, house.z) < STRUCTS[house.type].radius + 3) {
          wake(w, q);
          feel(w, q, "fear", 0.15, false);
          // 벽이 뚫리면 다른 곳으로 피한다
          if (broken && (q.act?.k === "hide" || q.act?.k === "sleep" || q.act?.k === "rest")) q.act = null;
        }
      }
    }
    return;
  }
  b.siege = null;
  // 마을 쪽으로 어슬렁거린다
  b.st = "prowl";
  if (dist(b.x, b.z, b.tx, b.tz) < 1.5) {
    const a = range(w, 0, Math.PI * 2);
    b.tx = w.camp.x + Math.cos(a) * range(w, 6, 16);
    b.tz = w.camp.z + Math.sin(a) * range(w, 6, 16);
  }
  if (moveToward(T, b, b.tx, b.tz, speed * 0.8 * dt)) {
    b.tx = b.x;
    b.tz = b.z;
  }
}

/** 가장 노리기 좋은 사람: 가깝고, 약하고, 홀로 있는 사람. 덤벼든 사람에게도 이를 드러낸다 */
/** 정신을 잃고 쓰러진 사람은 더 건드리지 않는다 */
const downed = (p: Person) => p.act?.k === "unconscious";

function pickTarget(w: WorldState, T: Terrain, b: Beast) {
  let best: Person | null = null;
  let bs = Infinity;
  for (const p of w.people) {
    if (!onIsland(p)) continue;
    const d = dist(b.x, b.z, p.x, p.z);
    if (d > (p.id === b.target ? 34 : 26) || T.height(p.x, p.z) < 0.1 || downed(p) || safeFromBeast(w, p)) continue;
    const yrs = age(w, p);
    if (yrs < 3) continue;
    const s = d - (yrs > 64 ? 2 : 0) - ((p.ill ?? 0) >= 2 ? 2 : 0) - (b.foes.includes(p.id) ? 6 : 0) - (p.act?.k === "defend" && p.act.tid === b.id ? 4 : 0);
    if (s < bs) {
      bs = s;
      best = p;
    }
  }
  return best;
}

function siegeTarget(w: WorldState, b: Beast) {
  const cur = findById(w.structures, b.siege);
  if (cur && usable(cur) && dist(b.x, b.z, cur.x, cur.z) < 40) return cur;
  let best: Structure | null = null;
  let bd = 30;
  for (const s of w.structures) {
    if (!usable(s) || !(SAFE.has(s.type) || TOWER[s.type])) continue;
    const d = dist(b.x, b.z, s.x, s.z);
    if (d >= bd) continue;
    const r = STRUCTS[s.type].radius + 1.2;
    if (!w.people.some((p) => onIsland(p) && dist(p.x, p.z, s.x, s.z) < r && safeFromBeast(w, p))) continue;
    bd = d;
    best = s;
  }
  return best;
}

/** 이번 습격에서 사람을 더 해칠 수 있는지 (섬 사람을 몰살하지 않도록) */
function mayKill(w: WorldState) {
  return living(w).length > 6 && (w.timers.beastKills ?? 0) < (w.timers.beastCap ?? 1);
}

function bite(w: WorldState, T: Terrain, b: Beast, p: Person) {
  const dmg = biteOf(b) * range(w, 0.8, 1.2);
  const before = p.health;
  p.health = Math.max(0, p.health - dmg);
  // 쓰러질 만큼 깊이 물리면 그대로 목숨을 잃기도 한다 (힘센 맹수일수록)
  if (p.health > 0 && p.health < 35 && before >= 35 && !coarse && chance(w, Math.min(0.3, 0.06 + dmg / 200))) p.health = 0;
  if (p.health <= 0 && coarse && chance(w, 0.75)) p.health = range(w, 4, 10);
  // 해칠 수 있는 만큼 해쳤으면 크게 다치는 데 그친다
  if (p.health <= 0 && !mayKill(w)) p.health = range(w, 3, 8);
  injure(w, p, dmg, `${BEAST_INFO[b.kind].name}에게 물림`);
  addFx(w, "bite", p.x, p.z, p.id);
  feel(w, p, "fear", 0.5);
  p.seen.reeval = 0;
  if (p.act && p.act.k !== "defend" && p.act.k !== "unconscious") p.act = null;
  // 비명에 곁에서 자던 사람도 깬다
  for (const q of living(w)) if (dist(q.x, q.z, p.x, p.z) < 10) wake(w, q);
  const name = BEAST_INFO[b.kind].name;
  if (p.health <= 0) {
    die(w, T, p, "beast");
    w.timers.beastKills = (w.timers.beastKills ?? 0) + 1;
    shiftMorale(w, -8);
    b.target = null;
    // 사람을 해친 맹수는 배를 채우고 돌아간다
    b.ate = 1;
    b.until = Math.min(b.until, w.time);
    return;
  }
  say(w, p, "bitten", { beast: name }, "🩸", true);
  shiftMorale(w, -1.5);
  if (p.health < 35 && !lying(p)) {
    p.act = { k: "unconscious", ph: 1, tx: p.x, tz: p.z, t: range(w, 20, 40) * MIN, started: w.time };
    p.anim = "lie";
    b.target = null;
    chron(w, "beast", `${josa(p.name, "이/가")} ${name}에게 물려 크게 다치고 쓰러졌다.`);
    shiftMorale(w, -2);
  }
  // 지금 무기로는 버겁다는 것을 깨닫는다
  if (p.act?.k === "defend" && p.health < 40 && w.time - (w.timers.weaponGap ?? -1e9) > 10 * DAY) {
    const next = nextWeaponTech(w);
    if (next) {
      w.timers.weaponGap = w.time;
      const t = TECH_BY_ID[next].name;
      chron(w, "beast", `지금의 무기로는 ${josa(name, "을/를")} 당해 내기 버거웠다. 사람들은 '${t}'${josa(t, "을/를").slice(t.length)} 궁리하기 시작했다.`);
      addResearch(w, p, TECH_BY_ID[next].cost * 0.05, next);
    }
  }
}

// ─── 용 ────────────────────────────────────────────────────────────────

/** 용은 하늘에서 맴돌다 사람을 덮칠 때만 내려앉고, 틈틈이 불을 뿜는다 */
function dragonSky(w: WorldState, T: Terrain, b: Beast, dt: number) {
  const tgt = findById(w.people, b.target);
  const low = b.st === "maul" || (!!tgt && dist(b.x, b.z, tgt.x, tgt.z) < 4);
  const want = low ? 0 : 1;
  const f = b.fly ?? 1;
  b.fly = want > f ? Math.min(1, f + dt / 50) : Math.max(0, f - dt / 35);
  if (w.time < (b.breath ?? 0)) return;
  // 불을 뿜을 곳: 노리는 사람, 숨은 사람이 있는 집, 아니면 가까운 나무집
  let spot: { x: number; z: number } | null = null;
  if (tgt && dist(b.x, b.z, tgt.x, tgt.z) < 13 && !safeFromBeast(w, tgt)) spot = { x: tgt.x, z: tgt.z };
  const house = findById(w.structures, b.siege);
  if (!spot && house && dist(b.x, b.z, house.x, house.z) < 14) spot = house;
  if (!spot) {
    const s = w.structures.find((x) => x.prog >= 1 && !x.fp && dist(b.x, b.z, x.x, x.z) < 12 && x.type !== "raft" && x.type !== "farm");
    if (s) spot = s;
  }
  if (!spot) return;
  b.breath = w.time + range(w, 5, 9) * MIN;
  b.rot = Math.atan2(spot.z - b.z, spot.x - b.x);
  breathFire(w, T, b, spot.x, spot.z);
}

/** 불길을 뿜는다: 건물에 불이 붙고, 풀숲이 타고, 곁에 있던 사람은 덴다 */
function breathFire(w: WorldState, T: Terrain, b: Beast, x: number, z: number) {
  addFx(w, "breath", x, z, b.id);
  let lit = 0;
  for (const s of w.structures) {
    if (s.prog < 1 || dist(s.x, s.z, x, z) > STRUCTS[s.type].radius + 2.5) continue;
    if (chance(w, s.fp ? 0.12 : 0.7) && igniteStructure(w, s, "spread")) lit++;
    else harm(w, T, s, 0.04, "beast");
  }
  if (!lit && chance(w, 0.3)) {
    const bi = T.biome(x, z);
    if (bi === "grass" || bi === "forest") startWildfire(w, T, x, z);
  }
  for (const q of living(w)) {
    if (dist(q.x, q.z, x, z) > 2.8 || safeFromBeast(w, q)) continue;
    const dmg = range(w, 6, 12);
    q.health = Math.max(mayKill(w) ? 0 : 5, q.health - dmg);
    injure(w, q, dmg, "용의 불길에 뎀");
    feel(w, q, "fear", 0.5);
    say(w, q, "burned", {}, "🔥", true);
    if (q.act && q.act.k !== "unconscious") q.act = null;
    if (q.health <= 0) {
      die(w, T, q, "beast");
      w.timers.beastKills = (w.timers.beastKills ?? 0) + 1;
      shiftMorale(w, -8);
    }
  }
  if (w.time - (w.timers.fireLog ?? -1e12) > 6 * HOUR) {
    w.timers.fireLog = w.time;
    chron(w, "beast", `${josa(beastName(b), "이/가")} 하늘에서 불길을 내뿜었다! ${lit ? "집에 불이 옮겨붙었다." : "땅이 시뻘겋게 그을렸다."}`);
  }
  bump(w);
}

/** 자다가도 벌떡 일어난다 (정신을 잃은 사람은 그대로) */
function wake(w: WorldState, p: Person) {
  if (p.act?.k !== "sleep" || safeFromBeast(w, p)) return;
  p.act = null;
  p.gesture = "startle";
  p.gestureUntil = w.time + 3 * 72;
}

/** 맹수를 본 사람은 하던 일을 멈춘다. 망루가 있으면 마을 전체에 알린다 */
function alarm(w: WorldState, b: Beast) {
  const towers = w.structures.filter((s) => TOWER[s.type] && usable(s) && dist(s.x, s.z, b.x, b.z) < 50);
  const watched = towers.length > 0;
  let told = 0;
  for (const p of living(w)) {
    if (p.seen.bst === b.born) {
      if (p.act?.k === "sleep" && dist(p.x, p.z, b.x, b.z) < 9) wake(w, p);
      continue;
    }
    const d = dist(p.x, p.z, b.x, b.z);
    if (d > 30 && !(watched && dist(p.x, p.z, w.camp.x, w.camp.z) < 70)) continue;
    p.seen.bst = b.born;
    told++;
    feel(w, p, "fear", d < 15 ? 0.55 : 0.35, d < 20);
    // 망루의 외침이나 가까운 기척에 잠에서 깬다
    if (d < 22 || watched) wake(w, p);
    if (!lying(p)) {
      say(w, p, "beast", { beast: BEAST_INFO[b.kind].name }, "😱", true);
      if (!safeFromBeast(w, p) && p.act?.k !== "defend" && p.act?.k !== "hide" && p.act?.k !== "unconscious") p.act = null;
    }
  }
  if (told && watched && !w.beasts.some((x) => x.born === b.born && x.foes.includes(-1))) {
    b.foes.push(-1);
    for (const p of living(w)) if (dist(p.x, p.z, towers[0].x, towers[0].z) < 40 && !lying(p)) say(w, p, "alarm", { place: STRUCTS[towers[0].type].name }, "📯", true);
  }
}
