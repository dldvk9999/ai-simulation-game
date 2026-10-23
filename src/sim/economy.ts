// 경제: 신석기 시대부터 사람들은 일한 만큼 품삯을 받고, 제 몫으로 챙긴 물건을 서로 바꾸거나 사고판다.
// 돈은 시대에 맞게 조개 화폐 → 청동 화폐 → 철전 → 지폐로 바뀌고, 나라 곳간에서 찍어 낸다.
import { act, spot } from "./acts";
import { HOUR, MIN } from "./constants";
import { FOOD, RES_NAME } from "./data";
import { clamp } from "./noise";
import { age, feel, lying, say } from "./people";
import { chance, int } from "./rng";
import { currentEra } from "./settlement";
import { josa } from "./text";
import type { Act, Person, Res, Stock, WorldState } from "./types";
import { addFx, addStock, bump, chron, dist, findById, knows, living, onIsland, stockOf } from "./world";

export const CURRENCY = [
  null,
  { name: "조개 화폐", unit: "개", icon: "🐚", what: "조개껍데기" },
  { name: "청동 화폐", unit: "닢", icon: "🪙", what: "청동을 녹여 부은 동전" },
  { name: "철전", unit: "냥", icon: "🪙", what: "쇠로 만든 엽전" },
  { name: "지폐", unit: "원", icon: "💵", what: "종이돈" },
] as const;

/** 물건 값 (시대가 바뀌어 단위가 달라져도 셈은 그대로) */
export const PRICE: Partial<Record<Res, number>> = {
  berry: 1, fruit: 1, fish: 2, meat: 3, crop: 1, meal: 3, cookedFish: 3, cookedMeat: 4,
  stick: 1, wood: 1, stone: 1, fiber: 1, hide: 2, clay: 1, rope: 2, herb: 2, root: 2, herbal: 4, remedy: 6, medicine: 10,
  handaxe: 3, spear: 4, axe: 5, basket: 3, rod: 4, bow: 6, hoe: 5, pot: 4, net: 6, pickaxe: 7,
  ore: 2, metal: 4, copper: 3, tin: 3, iron: 4, silver: 8, gold: 14, diamond: 30,
  sword: 10, ironsword: 14, musket: 20, rifle: 28, jewelry: 16,
};
/** 돈을 찍는 데 드는 재료 (조개는 바닷가에 흔하다) */
const MINT_MATERIAL: (Res | null)[] = [null, null, "metal", "iron", "fiber"];
/** 제 몫으로 챙겨 둘 만한 것 */
const KEEP = new Set<Res>(["berry", "fruit", "fish", "meat", "crop", "herb", "fiber", "rope", "hide", "copper", "tin", "iron", "silver", "gold"]);
/** 역할마다 갖고 싶은 제 연장 */
const ROLE_TOOL: Partial<Record<string, Res[]>> = {
  hunter: ["bow", "spear"], fisher: ["net", "rod"], farmer: ["hoe"], builder: ["axe"], crafter: ["pickaxe"], guard: ["ironsword", "sword", "spear"],
};

export const priceOf = (r: Res) => PRICE[r] ?? 2;
export const currency = (w: WorldState) => (w.economy ? CURRENCY[w.economy.era] : null);
export function money(w: WorldState, n: number) {
  const c = currency(w);
  return c ? `${c.icon} ${Math.round(n)}${c.unit}` : "";
}
const packOf = (p: Person): Stock => (p.pack ??= {});
const packed = (p: Person, r: Res) => p.pack?.[r] ?? 0;
function give(p: Person, r: Res, n: number) {
  const k = packOf(p);
  k[r] = (k[r] ?? 0) + n;
  if ((k[r] ?? 0) <= 0) delete k[r];
}

/** 매일: 경제가 시작되고, 시대가 바뀌면 화폐도 바뀌고, 곳간에 돈을 찍는다 */
export function dailyEconomy(w: WorldState) {
  const era = currentEra(w);
  if (era < 1) return;
  const adults = living(w).filter((p) => age(w, p) >= 12);
  if (!w.economy) {
    w.economy = { era, treasury: adults.length * 20, trades: 0, started: w.time };
    for (const p of adults) p.purse = (p.purse ?? 0) + 5;
    const c = CURRENCY[era]!;
    chron(w, "trade", `서로 필요한 물건을 바꾸어 쓰던 사람들이 ${josa(c.what, "을/를")} 돈 삼아 주고받기 시작했다. 섬에 '${c.name}'${josa(c.name, "이/가").slice(c.name.length)} 생겼다.`);
  } else if (era > w.economy.era) {
    w.economy.era = era;
    const c = CURRENCY[era]!;
    chron(w, "trade", `이제 ${josa(c.what, "이/가")} 예전 돈을 대신한다. 섬의 화폐가 '${c.name}'(으)로 바뀌었다.`);
  }
  // 곳간에 돈을 찍는다 (화폐 재료가 넉넉하면 많이)
  const mat = MINT_MATERIAL[era];
  let mint = adults.length;
  if (!mat || stockOf(w, mat) >= 3) {
    mint = adults.length * 3;
    if (mat) addStock(w, mat, -1);
  }
  w.economy.treasury += mint;
  // 새로 온 사람에게도 조금씩
  for (const p of adults) if (p.purse == null) p.purse = int(w, 2, 8);
  // 장신구를 지닌 사람은 마음이 든든하다
  for (const p of adults) if (packed(p, "jewelry") > 0) feel(w, p, "joy", 0.05, false);
}

/** 창고에 내려놓을 때: 품삯을 받고, 가끔은 하나를 제 몫으로 챙긴다. 남은 수를 돌려준다 */
export function payWage(w: WorldState, p: Person, res: Res, qty: number) {
  const E = w.economy;
  if (!E || age(w, p) < 12) return qty;
  const pay = Math.min(E.treasury, Math.max(1, Math.round(priceOf(res) * qty * 0.5)));
  E.treasury -= pay;
  p.purse = (p.purse ?? 0) + pay;
  if (qty >= 2 && KEEP.has(res) && chance(w, 0.12) && packed(p, res) < 3) {
    give(p, res, 1);
    return qty - 1;
  }
  return qty;
}

/** 지금 가장 갖고 싶은 것 */
function wantOf(w: WorldState, p: Person): Res | null {
  const fav = p.likes.food;
  if (!packed(p, fav) && (p.needs.hunger < 70 || p.emo.sadness > 0.4) && chance(w, 0.6)) return fav;
  for (const t of ROLE_TOOL[p.role ?? ""] ?? []) {
    if (!packed(p, t) && (stockOf(w, t) >= 2 || w.people.some((q) => q !== p && packed(q, t) > 0))) return t;
  }
  if (knows(w, "goldsmith") && p.traits.extraversion > 0.55 && !packed(p, "jewelry")) return "jewelry";
  return null;
}

/** 거래할 상대: 그 물건을 가진 사람, 없으면 장터(곳간) */
export function tradeCand(w: WorldState, p: Person): { s: number; mk: () => Act | null } | null {
  const E = w.economy;
  if (!E || age(w, p) < 16 || w.time - (p.seen.trade ?? -1e12) < 12 * HOUR) return null;
  // 넘치게 챙긴 것은 장터에 판다
  const extra = Object.entries(p.pack ?? {}).find(([r, n]) => (n ?? 0) >= 3 && r !== "jewelry") as [Res, number] | undefined;
  const market = w.structures.find((s) => s.type === "market" && s.prog >= 1) ?? w.structures.find((s) => s.type === "storage" && s.prog >= 1);
  if (extra && market) {
    return { s: 0.3, mk: () => { p.seen.trade = w.time; const s = spot(p, market.x, market.z, 2); return act(w, "trade", s.x, s.z, 8 * MIN, { sub: "sell", res: extra[0] }); } };
  }
  const want = wantOf(w, p);
  if (!want) return null;
  const price = priceOf(want);
  const seller = w.people.find((q) => q !== p && q.alive && onIsland(q) && !lying(q) && packed(q, want) > 0 && dist(p.x, p.z, q.x, q.z) < 60 && q.act?.k !== "defend" && q.act?.k !== "douse");
  const s = 0.3 + (FOOD[want] ? 0.1 : 0.05) + p.traits.extraversion * 0.1;
  if (seller) {
    return { s, mk: () => { p.seen.trade = w.time; return act(w, "trade", seller.x, seller.z, 10 * MIN, { tid: seller.id, res: want, sub: "buy" }); } };
  }
  if (market && stockOf(w, want) >= 2 && (p.purse ?? 0) >= price) {
    return { s: s - 0.05, mk: () => { p.seen.trade = w.time; const st = spot(p, market.x, market.z, 2); return act(w, "trade", st.x, st.z, 8 * MIN, { res: want, sub: "market" }); } };
  }
  return null;
}

/** 거래 상대에게 다가가거나 장터에 도착했다 */
export function tradeArrive(w: WorldState, p: Person, a: Act) {
  if (a.sub !== "buy") return true;
  const q = findById(w.people, a.tid);
  if (!q || !q.alive || lying(q)) return false;
  p.rot = Math.atan2(q.z - p.z, q.x - p.x);
  // 상대도 잠깐 멈춰 흥정한다
  if (q.act?.k !== "trade" && q.act?.k !== "unconscious") {
    q.act = act(w, "trade", q.x, q.z, a.t, { ph: 1, tid: p.id, sub: "deal" });
    q.rot = Math.atan2(p.z - q.z, p.x - q.x);
    q.gesture = null;
  }
  say(w, p, "tradeOffer", { what: RES_NAME[a.res!] ?? "그것", price: money(w, priceOf(a.res!)) }, "💬", true);
  return true;
}

/** 흥정이 끝났다: 돈이나 물건이 오간다 */
export function tradeFinish(w: WorldState, p: Person, a: Act) {
  const E = w.economy;
  const r = a.res;
  if (!E || !r || a.sub === "deal") return;
  const price = priceOf(r);
  const got = (res: Res) => {
    // 먹을 것은 바로 맛있게 먹는다
    if (FOOD[res]) {
      p.needs.hunger = clamp(p.needs.hunger + (FOOD[res] ?? 10), 0, 100);
      feel(w, p, "joy", res === p.likes.food ? 0.3 : 0.12, false);
    } else give(p, res, 1);
  };
  if (a.sub === "sell") {
    const n = packed(p, r);
    if (n <= 0) return;
    const pay = Math.min(E.treasury, priceOf(r) * n);
    give(p, r, -n);
    addStock(w, r, n);
    E.treasury -= pay;
    p.purse = (p.purse ?? 0) + pay;
    E.trades++;
    addFx(w, "coin", p.x, p.z, p.id);
    say(w, p, "tradeSold", { what: RES_NAME[r] ?? "물건", price: money(w, pay) }, "💰");
    bump(w);
    return;
  }
  if (a.sub === "market") {
    if ((p.purse ?? 0) < price || stockOf(w, r) < 1) return say(w, p, "tradeFail", {}, "😕");
    p.purse = (p.purse ?? 0) - price;
    E.treasury += price;
    addStock(w, r, -1);
    got(r);
  } else {
    const q = findById(w.people, a.tid);
    if (!q || packed(q, r) <= 0) return say(w, p, "tradeFail", {}, "😕");
    if ((p.purse ?? 0) >= price) {
      p.purse = (p.purse ?? 0) - price;
      q.purse = (q.purse ?? 0) + price;
    } else {
      // 돈이 모자라면 제 물건으로 바꾼다
      const swap = Object.entries(p.pack ?? {}).find(([x, n]) => (n ?? 0) > 0 && priceOf(x as Res) >= price * 0.6)?.[0] as Res | undefined;
      if (!swap) return say(w, p, "tradeFail", {}, "😕");
      give(p, swap, -1);
      give(q, swap, 1);
    }
    give(q, r, -1);
    got(r);
    q.rel[p.id] = clamp((q.rel[p.id] ?? 0) + 0.03, -1, 1);
    p.rel[q.id] = clamp((p.rel[q.id] ?? 0) + 0.04, -1, 1);
    say(w, q, "tradeDeal", {}, "🤝");
  }
  E.trades++;
  addFx(w, "coin", p.x, p.z, p.id);
  say(w, p, "tradeGot", { what: RES_NAME[r] ?? "물건" }, "😊", true);
  if (E.trades === 1) chron(w, "trade", `${josa(p.name, "이/가")} ${CURRENCY[E.era]!.name}(으)로 ${josa(RES_NAME[r] ?? "물건", "을/를")} 사며 섬의 첫 거래가 이루어졌다.`);
  bump(w);
}

/** 사람 카드: 지갑과 꾸러미 */
export function walletLabel(w: WorldState, p: Person) {
  if (!w.economy || age(w, p) < 12) return "";
  const items = Object.entries(p.pack ?? {}).filter(([, n]) => (n ?? 0) > 0).map(([r, n]) => `${RES_NAME[r as Res] ?? r} ${n}`);
  return `${money(w, p.purse ?? 0)}${items.length ? ` · 🎒 ${items.join(", ")}` : ""}`;
}

/** 장터를 세울 때 */
export const wantMarket = (w: WorldState) => !!w.economy && living(w).length >= 8 && !w.structures.some((s) => s.type === "market");
