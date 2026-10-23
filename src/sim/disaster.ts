// 자연재해: 지진 · 태풍 · 쓰나미. 아주 드물게 찾아와 집과 밭, 창고를 부순다.
// 겪고 나면 사람들은 모여 대비책을 궁리하고(연구), 부서진 것을 함께 고친다.
import { DAY, HOUR, MIN } from "./constants";
import { seasonOf } from "./clock";
import { harm } from "./building";
import { STRUCTS, WOODEN } from "./data";
import { clamp } from "./noise";
import { isTree } from "./ecology";
import { feel, lying, say } from "./people";
import { chance, range, weighted } from "./rng";
import { shiftMorale } from "./morale";
import { blessed } from "./religion";
import { available } from "./settlement";
import type { Terrain } from "./terrain";
import { josa } from "./text";
import type { Disaster, DisasterType, Res, Structure, StructureType, WorldState } from "./types";
import { addFx, bump, chron, knows, living, makeItem } from "./world";

export const DISASTER_NAME: Record<DisasterType, string> = { quake: "지진", typhoon: "태풍", tsunami: "쓰나미" };
export const DISASTER_ICON: Record<DisasterType, string> = { quake: "🫨", typhoon: "🌀", tsunami: "🌊" };

/** 하루에 재해가 찾아올 확률 (최소 간격이 지난 뒤) */
const DAILY_CHANCE = 1 / 90;

const QUAKE: Partial<Record<StructureType, number>> = {
  leanto: 0.5, hut: 0.55, loghouse: 0.4, stonehouse: 0.6, storage: 0.5, rack: 0.5, kiln: 0.55, workshop: 0.45,
  smelter: 0.55, well: 0.35, library: 0.5, windmill: 0.6, observatory: 0.55, lighthouse: 0.5, dock: 0.3, bench: 0.2,
  pen: 0.35, infirmary: 0.45, hall: 0.5, shipyard: 0.35, seawall: 0.15, portal: 0.2,
  watchtower: 0.55, fort: 0.3, battery: 0.3, townhouse: 0.5, apartment: 0.45, forge: 0.45, factory: 0.4, mine: 0.5,
};
const WIND: Partial<Record<StructureType, number>> = {
  leanto: 0.45, hut: 0.3, loghouse: 0.12, stonehouse: 0.05, storage: 0.2, rack: 0.5, farm: 0.35, pen: 0.25,
  workshop: 0.3, windmill: 0.25, dock: 0.3, bench: 0.2, infirmary: 0.35, hall: 0.1, shipyard: 0.15, library: 0.06,
  lighthouse: 0.05, observatory: 0.08, kiln: 0.08, smelter: 0.05,
  watchtower: 0.35, fort: 0.04, battery: 0.04, townhouse: 0.05, apartment: 0.06, forge: 0.1, factory: 0.08, mine: 0.2,
};
const SPARED = new Set<StructureType>(["grave", "raft", "campfire", "banner"]);

/** 대비책을 알면 덜 부서진다 */
function sturdiness(w: WorldState, s: Structure, type: DisasterType) {
  let m = 1;
  if (knows(w, "bracing") && WOODEN.has(s.type) && type !== "tsunami") m *= 0.6;
  if (knows(w, "quakeproof") && type === "quake") m *= 0.25;
  if (knows(w, "masonry") && type === "typhoon" && (s.type === "stonehouse" || s.type === "townhouse")) m *= 0.5;
  return m;
}

export function schedule(w: WorldState, type: DisasterType, start: number, power: number, ang = range(w, 0, Math.PI * 2)) {
  const until = type === "quake" ? start + 40 * MIN : type === "typhoon" ? start + range(w, 8, 14) * HOUR : start + 90 * MIN;
  w.disaster = {
    type, start, until, power, ang, hit: 0, warned: 0,
    toll: { broken: 0, ruined: 0, crops: 0, trees: 0, hurt: 0, lost: 0 },
  };
}

/** 하루에 한 번: 아주 드물게 재해가 다가온다 */
export function dailyDisaster(w: WorldState) {
  if (w.disaster || w.time < (w.timers.disaster ?? 0)) return;
  // 저주 의식이 통하면 재해가 일어날 확률이 오르고, 수호제는 조금 낮춘다
  if (!chance(w, DAILY_CHANCE * (1 - 0.3 * blessed(w, "peace") + 0.8 * blessed(w, "curse")))) return;
  const season = seasonOf(w.time);
  const typhoon = season === 1 ? 1.6 : season === 2 ? 1.1 : season === 0 ? 0.3 : 0;
  const type = weighted(w, { quake: 0.45, typhoon: 0.4 * typhoon, tsunami: 0.12 } as Record<DisasterType, number>);
  schedule(w, type, w.time + range(w, 1, 20) * HOUR, range(w, 0.45, 1));
}

export function seawallUp(w: WorldState) {
  return w.structures.some((s) => s.type === "seawall" && s.prog >= 1 && (s.dmg ?? 0) < 0.6);
}

/** 쓰나미 때 바닷물이 차오른 높이 (렌더러와 시뮬레이션이 같이 쓴다) */
export function floodLevel(w: WorldState, t = w.time) {
  const d = w.disaster;
  if (!d || d.type !== "tsunami") return 0;
  const H = floodPeak(w);
  const s = d.start;
  if (t < s - 10 * MIN || t > d.until) return 0;
  if (t < s) return -0.9 * ((t - (s - 10 * MIN)) / (10 * MIN));
  if (t < s + 20 * MIN) {
    const k = (t - s) / (20 * MIN);
    return -0.9 + (H + 0.9) * k * k * (3 - 2 * k);
  }
  if (t < s + 35 * MIN) return H;
  const k = clamp((t - (s + 35 * MIN)) / (d.until - (s + 35 * MIN)), 0, 1);
  return H * (1 - k * k * (3 - 2 * k));
}

export function floodPeak(w: WorldState) {
  const d = w.disaster;
  return d && d.type === "tsunami" ? Math.max(0.5, 1.6 + 1.8 * d.power - (seawallUp(w) ? 2 : 0)) : 0;
}

/** 지진이 흔들리는 세기 0..1 */
export function quakeShake(w: WorldState, t = w.time) {
  const d = w.disaster;
  if (!d || d.type !== "quake" || t < d.start || t > d.until) return 0;
  const k = (t - d.start) / (d.until - d.start);
  return d.power * (k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 1.6)) * (0.75 + 0.25 * Math.sin(t * 0.9));
}

/** 사람들이 쓰나미를 피해 높은 곳으로 가야 하는지 */
export function tsunamiThreat(w: WorldState, open: number) {
  const d = w.disaster;
  if (!d || d.type !== "tsunami" || w.time > d.start + 30 * MIN) return false;
  const lead = d.warned ? 40 * MIN : (open > 0.5 || w.history.tsunami > 0 ? 7 * MIN : 3 * MIN);
  return w.time >= d.start - lead;
}

export function updateDisaster(w: WorldState, T: Terrain) {
  const d = w.disaster;
  if (!d) return;
  // 예보: 기상 관측을 알면 태풍과 쓰나미를 미리 알아챈다
  if (!d.warned && knows(w, "forecast")) {
    const lead = d.type === "typhoon" ? 6 * HOUR : d.type === "tsunami" ? 40 * MIN : 0;
    if (lead && w.time >= d.start - lead) {
      d.warned = 1;
      chron(w, "disaster", d.type === "typhoon"
        ? "구름과 바람을 살피던 사람들이 태풍이 다가오는 것을 알아챘다. 서둘러 곡식을 거둬들였다."
        : "바다가 심상치 않다. 사람들이 서둘러 높은 곳으로 피했다.");
      if (d.type === "typhoon") harvestEarly(w);
      bump(w);
    }
  }
  if (w.time < d.start) return;
  if (d.type === "quake") quake(w, T, d);
  else if (d.type === "typhoon") typhoon(w, T, d);
  else tsunami(w, T, d);
  if (w.time >= d.until) finish(w, d);
}

function startle(w: WorldState, key: string, fear: number) {
  for (const p of living(w)) {
    feel(w, p, "fear", fear * (p.fears === "storm" ? 1.3 : 1));
    feel(w, p, "surprise", 0.4, false);
    if (!lying(p)) {
      p.gesture = "cower";
      p.gestureUntil = w.time + range(w, 3, 5) * 72;
    }
    say(w, p, key, {}, DISASTER_ICON[w.disaster!.type], true);
    p.seen.reeval = 0;
  }
}

function quake(w: WorldState, T: Terrain, d: Disaster) {
  if (d.hit === 0) {
    d.hit = 1;
    chron(w, "disaster", d.power > 0.75 ? "땅이 크게 울리며 섬 전체가 흔들렸다!" : "땅이 우르릉 흔들렸다.");
    startle(w, "quake", 0.5 + d.power * 0.3);
    for (const s of w.structures) if (!SPARED.has(s.type)) addFx(w, "dust", s.x, s.z, s.id, d.power);
    bump(w);
  }
  if (d.hit === 1 && w.time >= d.start + 4 * MIN) {
    d.hit = 2;
    for (const s of [...w.structures]) {
      if (SPARED.has(s.type)) continue;
      const k = sturdiness(w, s, "quake");
      if (chance(w, (QUAKE[s.type] ?? 0.3) * d.power * k)) damage(w, T, s, range(w, 0.3, 1.0) * d.power * 1.3 * Math.sqrt(k), "quake");
    }
    // 바위에서 돌이 굴러떨어지고, 나무가 쓰러진다
    for (const r of w.rocks) {
      if (r.kind === "boulder" && chance(w, 0.3 * d.power)) w.items.push(makeItem(w, "stone", 1, r.x + range(w, -2, 2), r.z + range(w, -2, 2)));
    }
    fellTrees(w, 0.03 * d.power, d);
    bump(w);
  }
}

function typhoon(w: WorldState, T: Terrain, d: Disaster) {
  const W = w.weather;
  if (W.type !== "storm" || W.until < d.until) {
    W.prev = W.type;
    W.type = "storm";
    W.changedAt = w.time;
    W.until = d.until;
    W.nextStrike = w.time + 10 * 72;
  }
  W.wind = 1 + 0.4 * d.power;
  if (d.hit === 0) {
    d.hit = 1;
    chron(w, "disaster", "거센 태풍이 섬을 덮쳤다. 비바람이 모든 것을 할퀴었다.");
    startle(w, "typhoon", 0.45);
    for (const f of w.structures) if (f.type === "campfire" && f.lit) f.lit = 0;
    bump(w);
  }
  const ticks = Math.floor((w.time - d.start) / HOUR) + 1;
  while (d.hit < ticks + 1 && w.time < d.until) {
    d.hit++;
    const k = d.power * (d.warned ? 0.55 : 1);
    for (const s of [...w.structures]) {
      if (SPARED.has(s.type)) continue;
      const v = (WIND[s.type] ?? 0) * k * 0.15 * sturdiness(w, s, "typhoon");
      if (v > 0 && chance(w, v)) damage(w, T, s, range(w, 0.2, 0.6) * k, "typhoon");
    }
    const crops = w.plants.filter((p) => p.kind === "crop");
    for (const c of crops) {
      if (chance(w, 0.12 * k)) {
        w.plants = w.plants.filter((p) => p !== c);
        d.toll.crops++;
      }
    }
    fellTrees(w, 0.012 * d.power, d);
    // 젖어서 상하는 음식
    for (const r of ["berry", "fruit", "meat", "fish", "crop"] as Res[]) {
      const v = w.stock[r];
      if (v) {
        const lost = v * 0.04 * k;
        w.stock[r] = v - lost;
        d.toll.lost += lost;
      }
    }
    bump(w);
  }
}

function tsunami(w: WorldState, T: Terrain, d: Disaster) {
  if (d.hit === 0) {
    d.hit = 1;
    if (!d.warned) chron(w, "disaster", "바닷물이 멀리 빠져나가더니, 거대한 물결이 해안으로 밀려왔다!");
    startle(w, "tsunami", 0.6);
  }
  if (d.hit === 1 && w.time >= d.start + 18 * MIN) {
    d.hit = 2;
    const H = floodPeak(w);
    for (const s of [...w.structures]) {
      if (SPARED.has(s.type) && s.type !== "campfire") continue;
      const h = s.type === "dock" ? 0 : T.height(s.x, s.z);
      if (h > H + 0.3) continue;
      if (s.type === "campfire") {
        s.lit = 0;
        continue;
      }
      if (s.type === "seawall") {
        damage(w, T, s, range(w, 0.1, 0.4) * d.power, "tsunami");
        continue;
      }
      damage(w, T, s, clamp((H - h) / 2.5 + 0.2, 0.2, 1.0), "tsunami");
    }
    // 물에 잠긴 물건은 쓸려 가고, 낮은 곳의 풀과 나무가 뽑힌다
    const before = w.items.length;
    w.items = w.items.filter((it) => T.height(it.x, it.z) > H || !!it.held);
    d.toll.lost += before - w.items.length;
    w.plants = w.plants.filter((p) => {
      const h = T.height(p.x, p.z);
      if (h > H) return true;
      const deep = h < H - 1;
      const gone = p.kind === "crop" ? chance(w, 0.7) : chance(w, (p.kind === "palm" ? 0.1 : 0.3) * (deep ? 1 : 0.5));
      if (gone && p.kind === "crop") d.toll.crops++;
      if (gone && isTree(p.kind)) d.toll.trees++;
      return !gone;
    });
    for (const p of living(w)) {
      if (T.height(p.x, p.z) > H) continue;
      p.health = Math.max(1, p.health - range(w, 25, 40));
      const a = Math.atan2(p.z, p.x);
      const sp = T.shorePoint(a, 9);
      p.x = sp.x;
      p.z = sp.z;
      p.act = { k: "unconscious", ph: 1, tx: p.x, tz: p.z, t: range(w, 0.4, 1) * HOUR, started: w.time };
      p.anim = "lie";
      feel(w, p, "fear", 0.6);
      d.toll.hurt++;
    }
    for (const a of w.animals) {
      if (a.kind === "crab" || T.height(a.x, a.z) > H) continue;
      a.st = "flee";
      const sp = T.shorePoint(Math.atan2(a.z, a.x), 12);
      a.tx = sp.x;
      a.tz = sp.z;
    }
    bump(w);
  }
  // 물이 빠지면 바닷가에 물고기가 남는다
  if (d.hit === 2 && w.time >= d.start + 60 * MIN) {
    d.hit = 3;
    for (let i = 0; i < 6; i++) {
      const sp = T.shorePoint(range(w, 0, Math.PI * 2), 2.5);
      if (T.height(sp.x, sp.z) > 0.1) w.items.push(makeItem(w, "fish", 1, sp.x, sp.z));
    }
    bump(w);
  }
}

function fellTrees(w: WorldState, p: number, d: Disaster) {
  for (const t of w.plants) {
    if (t.stump || t.burn || t.g < 1 || !(t.kind === "tree" || t.kind === "pine" || t.kind === "palm")) continue;
    if (!chance(w, p)) continue;
    t.stump = 1;
    t.fruit = 0;
    t.regrow = w.time + range(w, 2, 4) * DAY;
    w.items.push(makeItem(w, "wood", 1, t.x + range(w, -1, 1), t.z + range(w, -1, 1)));
    addFx(w, "chop", t.x, t.z, t.id);
    d.toll.trees++;
  }
}

/** 구조물을 부순다. 1을 넘으면 무너진다 */
export function damage(w: WorldState, T: Terrain, s: Structure, amount: number, type: DisasterType) {
  harm(w, T, s, amount, type, w.disaster?.toll);
}

function harvestEarly(w: WorldState) {
  for (const c of w.plants.filter((p) => p.kind === "crop" && p.g >= 0.6)) {
    w.plants = w.plants.filter((p) => p !== c);
    w.stock.crop = (w.stock.crop ?? 0) + 2;
  }
}

function finish(w: WorldState, d: Disaster) {
  const t = d.toll;
  const parts: string[] = [];
  if (t.ruined) parts.push(`건물 ${t.ruined}채가 무너졌고`);
  if (t.broken) parts.push(`${t.broken}채가 부서졌다`);
  if (t.crops) parts.push(`곡식 ${t.crops}포기를 잃었다`);
  if (t.trees >= 3) parts.push(`나무 ${t.trees}그루가 쓰러졌다`);
  if (t.hurt) parts.push(`${t.hurt}명이 다쳤다`);
  const name = DISASTER_NAME[d.type];
  chron(w, "disaster", parts.length
    ? `${josa(name, "이/가")} 지나갔다. ${parts.join(", ")}.`
    : `${josa(name, "이/가")} 지나갔다. 다행히 큰 피해는 없었다.`);
  w.history[d.type]++;
  w.history.lastDisaster = w.time;
  shiftMorale(w, -(1 + t.broken * 0.8 + t.hurt * 1.5));
  w.history.lastType = d.type;
  w.disaster = null;
  w.timers.disaster = w.time + range(w, 30, 50) * DAY;
  // 큰 지진 뒤에는 쓰나미가 따라오기도 한다
  if (d.type === "quake" && d.power > 0.65 && chance(w, 0.35)) {
    schedule(w, "tsunami", w.time + range(w, 15, 45) * MIN, clamp(d.power * range(w, 0.8, 1.1), 0.4, 1));
    if (knows(w, "forecast") || w.history.tsunami > 0) {
      w.disaster!.warned = 1;
      chron(w, "disaster", "흔들림이 멎자 사람들은 바다를 살폈다. 큰 물결이 올지도 모른다!");
    }
  }
  for (const p of living(w)) {
    feel(w, p, "sadness", t.ruined + t.broken > 0 ? 0.25 : 0.05, false);
    p.seen.reeval = 0;
  }
  bump(w);
}

/** 겪은 재해에 맞는 대비책 (지금 궁리할 수 있는 것) */
export function countermeasure(w: WorldState, type: DisasterType | null) {
  if (!type) return null;
  const order: Record<DisasterType, string[]> = {
    quake: ["bracing", "quakeproof"],
    typhoon: ["bracing", "forecast"],
    tsunami: ["forecast", "seawall"],
  };
  const av = new Set(available(w).map((t) => t.id));
  return order[type].find((id) => av.has(id)) ?? null;
}

export const repairCost = (s: Structure) => {
  const out: Partial<Record<Res, number>> = {};
  for (const [r, n] of Object.entries(STRUCTS[s.type].cost) as [Res, number][]) out[r] = Math.max(1, Math.ceil(n * (s.dmg ?? 0) * 0.5));
  return out;
};

export const damaged = (w: WorldState) => w.structures.filter((s) => (s.dmg ?? 0) > 0 && s.prog >= 1);

