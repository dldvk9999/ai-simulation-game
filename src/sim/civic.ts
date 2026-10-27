// 세금: 나라를 세우면 품삯의 한 할을 세금으로 거두고, 도박장에 쌓인 돈과 무역에서 남긴 돈도 나라 살림에 보탠다.
// 왕과 대신들은 며칠마다 백성들이 불편하다고 하는 소리를 듣고, 그 돈으로 길을 닦고, 탈것을 들이고,
// 의료를 넓히고, 어려운 이를 돕고, 무역을 늘린다.
import { DAY } from "./constants";
import { money } from "./economy";
import { shiftMorale } from "./morale";
import { clamp } from "./noise";
import { age, feel, say } from "./people";
import { pick, range } from "./rng";
import { currentEra } from "./settlement";
import { josa } from "./text";
import type { Civic, CivicKind, WorldState } from "./types";
import { addStock, bump, chron, dist, findById, living } from "./world";
import { HOUSE_TYPES } from "./data";
import { onRoad } from "./town";

export const TAX_RATE = 0.1;
export const CIVIC_NAME: Record<CivicKind, string> = { road: "길", transport: "탈것", medical: "의료", welfare: "복지", trade: "무역" };
const KINDS = Object.keys(CIVIC_NAME) as CivicKind[];
const MAX_LV: Record<CivicKind, number> = { road: 4, transport: 4, medical: 4, welfare: 99, trade: 4 };
/** 한 단계 고치는 데 드는 돈 (단계가 오를수록 비싸다) */
const COST: Record<CivicKind, number> = { road: 110, transport: 150, medical: 130, welfare: 30, trade: 170 };
/** 단계마다 생기는 것 */
export const ROAD_NAME = ["", "흙길", "자갈길", "돌길", "포장도로"];
export const RIDE_NAME = ["", "손수레", "소달구지", "마차", "자동차"];
const CLINIC_NAME = ["", "약방", "의원", "병원", "종합병원"];
/** 백성이 하는 말 */
const VOICE: Record<CivicKind, string> = {
  road: "길이 험해서 오가기 힘들다", transport: "짐을 지고 먼 길을 오가기 버겁다", medical: "아프고 다친 사람을 돌볼 곳이 모자라다",
  welfare: "끼니를 잇기 어려운 이웃이 많다", trade: "쓸 만한 물건이 모자라다",
};

const nation = (w: WorldState) => w.groups.find((g) => g.kind === "nation");
const lvOf = (w: WorldState, k: CivicKind) => w.civic?.lv[k] ?? 0;

function civicOf(w: WorldState): Civic {
  return (w.civic ??= {
    fund: 0, lv: { road: 0, transport: 0, medical: 0, welfare: 0, trade: 0 }, voice: { road: 0, transport: 0, medical: 0, welfare: 0, trade: 0 },
    last: w.time, taxed: 0, spent: 0,
  });
}

/** 품삯에서 세금을 뗀다: 백성에게 줄 몫을 돌려준다 */
export function levy(w: WorldState, pay: number) {
  if (!nation(w)) return pay;
  const C = civicOf(w);
  const tax = pay * TAX_RATE;
  C.fund += tax;
  C.taxed += tax;
  return pay - tax;
}

/** 나라 살림에 보탠다 (무역에서 남긴 돈 등) */
export function addFund(w: WorldState, n: number) {
  if (nation(w)) civicOf(w).fund += n;
}

/** 길 위에서는 빨리 다닌다: 밟아 다진 오솔길도 조금, 나라가 닦은 길일수록 더. 탈것이 생기면 어디서든 조금 더 */
export const roadMul = (w: WorldState, x: number, z: number) =>
  (onRoad(w, x, z) ? 1.05 + 0.07 * lvOf(w, "road") : 1) + 0.03 * lvOf(w, "transport");
/** 탈것이 있으면 한 번에 더 많이 나른다 */
export const rideMul = (w: WorldState) => 1 + 0.2 * lvOf(w, "transport");
/** 의료가 넓어지면 병과 상처가 빨리 낫는다 */
export const clinicMul = (w: WorldState) => 1 + 0.15 * lvOf(w, "medical");
/** 무역을 늘리면 배가 자주 오고 더 많이 실어 온다 */
export const tradeMul = (w: WorldState) => 1 + 0.2 * lvOf(w, "trade");

/** 매일: 백성들의 불편이 쌓이고, 며칠마다 왕과 대신이 들어 고친다 */
export function dailyCivic(w: WorldState) {
  const g = nation(w);
  if (!g) return;
  const C = civicOf(w);
  const all = living(w);
  const pop = all.length;
  if (!pop) return;
  const era = currentEra(w);
  const v = C.voice;
  // 집이 마을에서 멀리 흩어질수록 길이 아쉽다
  const homes = w.structures.filter((s) => HOUSE_TYPES.includes(s.type) && s.prog >= 1);
  const far = homes.length ? homes.reduce((n, s) => n + dist(s.x, s.z, w.camp.x, w.camp.z), 0) / homes.length : 0;
  v.road += clamp((far - 8) / 20, 0, 1) * 0.25 + pop / 300;
  // 사람이 많고 길이 좋은데 탈것이 없으면 아쉽다
  v.transport += pop / 400 + (lvOf(w, "road") > lvOf(w, "transport") ? 0.12 : 0.03);
  // 아프거나 크게 다친 사람
  const sick = all.filter((p) => (p.ill ?? 0) >= 2 || p.wound?.sev === 2).length;
  v.medical += (sick / pop) * 1.4 + 0.02;
  // 가난하거나 배고픈 사람
  const poor = all.filter((p) => age(w, p) >= 16 && (p.purse ?? 0) < 4).length;
  const hungry = all.filter((p) => p.needs.hunger < 30).length;
  v.welfare += poor + hungry >= 3 ? (poor / pop) * 0.5 + (hungry / pop) * 0.8 + ((w.morale ?? 70) < 50 ? 0.12 : 0) : 0;
  // 배가 드나들 수 있는데 쇠붙이가 모자라면
  const dock = w.structures.some((s) => s.type === "dock" && s.prog >= 1);
  v.trade += dock && w.nations.some((n) => n.met) ? 0.05 + ((w.stock.metal ?? 0) < 6 ? 0.1 : 0) : 0;
  for (const k of KINDS) if (C.lv[k] >= MAX_LV[k] || (k === "transport" && C.lv.transport >= era)) v[k] = 0;
  // 백성 몇이 불편을 입 밖에 낸다
  const top = KINDS.reduce((a, b) => (v[b] > v[a] ? b : a));
  if (v[top] > 0.3) {
    const speak = all.filter((p) => p.group === g.id && age(w, p) >= 16 && p.role !== "king" && p.role !== "minister");
    for (let i = 0; i < 2 && speak.length; i++) say(w, pick(w, speak)!, `voice_${top}`, {}, "🗣️", true);
  }
  // 닦은 길과 들인 탈것을 돌보는 데도 돈이 든다
  const upkeep = (C.lv.road + C.lv.transport + C.lv.medical + C.lv.trade) * 1.5 * (pop / 30);
  C.fund = Math.max(0, C.fund - upkeep);
  C.spent += upkeep;
  // 쓰고도 남는 살림은 나라 곳간으로 돌려 품삯을 넉넉히 준다
  if (w.economy && C.fund > pop * 60) {
    const back = C.fund - pop * 40;
    C.fund -= back;
    w.economy.treasury += back;
    if (w.time - (w.timers.casinoLog ?? -1e12) > 20 * DAY && w.time - C.last > DAY) {
      chron(w, "civic", `나라 살림이 넉넉해 쓰고 남은 ${money(w, back)}을 나라 곳간으로 돌렸다. 일하는 백성들의 품삯이 넉넉해졌다.`);
      w.timers.casinoLog = w.time;
    }
  }
  // 재무관이 있으면 더 자주 살림을 돌본다
  const every = (g.gov?.treasurer ? 5 : 7) * DAY;
  if (w.time - C.last < every) return;
  const order = [...KINDS].sort((a, b) => v[b] - v[a]);
  for (const k of order) {
    if (v[k] < 0.5) break;
    const cost = costOf(w, k, poor);
    if (C.fund < cost) continue;
    improve(w, k, cost, poor);
    C.last = w.time;
    return;
  }
  C.last = w.time - every * 0.5;
}

function costOf(w: WorldState, k: CivicKind, poor: number) {
  const scale = Math.max(1, living(w).length / 20);
  return Math.round((k === "welfare" ? COST.welfare + poor * 6 : COST[k] * (lvOf(w, k) + 1)) * scale);
}

/** 세금을 들여 고친다 */
function improve(w: WorldState, k: CivicKind, cost: number, poor: number) {
  const C = civicOf(w);
  const g = nation(w)!;
  C.fund -= cost;
  C.spent += cost;
  C.lv[k] = Math.min(MAX_LV[k], C.lv[k] + 1);
  const said = C.voice[k];
  for (const x of KINDS) C.voice[x] *= x === k ? 0 : 0.7;
  const lv = C.lv[k];
  const king = findById(w.people, g.leader);
  const minister = k === "welfare" || k === "trade" ? findById(w.people, g.gov?.treasurer) : findById(w.people, g.gov?.chancellor);
  const who = minister?.alive ? `${minister.name}의 건의로 왕 ${king?.name ?? ""}` : `왕 ${king?.name ?? ""}`;
  let done = "";
  switch (k) {
    case "road":
      done = lv === 1 ? "마을의 길을 흙길로 다지고, 큰길을 섬을 한 바퀴 두르는 둘레길까지 이었다" : `길을 넓혀 ${ROAD_NAME[lv]}로 고쳤다`;
      break;
    case "transport":
      done = `${RIDE_NAME[lv]}${josa(RIDE_NAME[lv], "을/를").slice(RIDE_NAME[lv].length)} 들여 짐을 실어 나르게 했다`;
      break;
    case "medical":
      done = `${CLINIC_NAME[lv]}${josa(CLINIC_NAME[lv], "을/를").slice(CLINIC_NAME[lv].length)} 열고 약재를 사들였다`;
      addStock(w, "herbal", 3 + lv * 2);
      if (lv >= 2) addStock(w, "remedy", lv);
      break;
    case "welfare": {
      const each = Math.max(5, Math.round((cost * 0.6) / Math.max(1, poor)));
      let n = 0;
      for (const p of living(w)) if (age(w, p) >= 16 && (p.purse ?? 0) < 4) {
        p.purse = (p.purse ?? 0) + each;
        feel(w, p, "joy", 0.25);
        feel(w, p, "love", 0.1, false);
        n++;
      }
      addStock(w, "meal", Math.round(cost * 0.15));
      done = n ? `어려운 이웃 ${n}명에게 ${money(w, each)}씩과 먹을 것을 나누어 주었다` : "곳간에 먹을 것을 채워 어려운 이웃에게 나누었다";
      break;
    }
    case "trade":
      done = "무역선을 더 자주 부르고 실어 오는 물건을 늘렸다";
      break;
  }
  chron(w, "civic", `백성들 사이에서 '${VOICE[k]}'는 말이 많았다. ${josa(who, "이/가")} 세금 ${money(w, cost)}을 들여 ${done}.`);
  shiftMorale(w, 3 + Math.min(3, said));
  for (const p of living(w)) {
    if (p.group !== g.id) continue;
    feel(w, p, "joy", 0.08, false);
    if (range(w, 0, 1) < 0.15) say(w, p, `voiceDone_${k}`, {}, "😊");
  }
  bump(w);
}

/** 사람들 패널 */
export function civicInfo(w: WorldState) {
  const C = w.civic;
  if (!C || !nation(w)) return null;
  const lv = KINDS.filter((k) => C.lv[k] > 0).map((k) => `${CIVIC_NAME[k]} ${k === "road" ? ROAD_NAME[C.lv[k]] : k === "transport" ? RIDE_NAME[C.lv[k]] : k === "medical" ? CLINIC_NAME[C.lv[k]] : k === "welfare" ? `${C.lv[k]}번` : `${C.lv[k]}단계`}`);
  const top = KINDS.reduce((a, b) => (C.voice[b] > C.voice[a] ? b : a));
  return {
    fund: money(w, C.fund),
    taxed: money(w, C.taxed),
    spent: money(w, C.spent),
    done: lv.join(" · "),
    voice: C.voice[top] > 0.3 ? `“${VOICE[top]}”` : "",
  };
}

