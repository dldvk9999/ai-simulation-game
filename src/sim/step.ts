import { runPerson } from "./ai";
import { DAY, HOUR, MAX_CATCHUP, TIME_SCALE } from "./constants";
import { dayOf, seasonOf, SEASONS } from "./clock";
import { dailyAnimals, updateAnimals, updateFish, updateItems, updatePlants, updateStructures } from "./ecology";
import { dailyDisaster, updateDisaster } from "./disaster";
import { spreadIllness, updateIllness } from "./disease";
import { checkDeath, dailyPeople, hourlyPeople, makeCtx, perceive, updateEmotions, updateNeeds } from "./people";
import { chooseFocus, planFarms, planProject } from "./settlement";
import { dailySociety } from "./society";
import { getTerrain } from "./terrain";
import { josa } from "./text";
import type { WorldState } from "./types";
import { chron } from "./world";
import { dailyVoyage, updateVoyages } from "./voyage";
import { updateWeather } from "./weather";

/** 월드를 dt(게임 초)만큼 진행한다. 어떤 dt에도 동작하도록 작성되어 있다. */
export function step(w: WorldState, dt: number) {
  const T = getTerrain(w.seed);
  const prevHour = Math.floor(w.time / HOUR);
  w.time += dt;
  updateWeather(w, T, dt);
  updateDisaster(w, T);
  updatePlants(w, T, dt);
  updateAnimals(w, T, dt);
  updateFish(w, T, dt);
  updateStructures(w, dt);
  updateItems(w, T, dt);

  const ctx = makeCtx(w, T);
  for (const p of w.people) {
    if (!p.alive || p.away) continue;
    updateNeeds(w, ctx, p, dt);
    updateIllness(w, ctx, p, dt);
    updateEmotions(w, ctx, p, dt);
    perceive(w, ctx, p, dt);
    runPerson(w, ctx, p, dt);
    checkDeath(w, T, p);
  }
  if (w.voyages.length) updateVoyages(w);

  if (Math.floor(w.time / HOUR) !== prevHour) {
    hourlyPeople(w);
    spreadIllness(w);
    planProject(w, T);
    planFarms(w, T);
    if (!w.tech.focus) chooseFocus(w);
  }
  const d = dayOf(w.time);
  if (d !== w.timers.day) {
    const prevSeason = seasonOf(w.time - DAY);
    w.timers.day = d;
    daily(w);
    if (seasonOf(w.time) !== prevSeason) chron(w, "season", `${josa(SEASONS[seasonOf(w.time)], "이/가")} 찾아왔다.`);
  }
  const cutoff = w.time - 6 * TIME_SCALE;
  if (w.fx.length && w.fx[0].t < cutoff) w.fx = w.fx.filter((f) => f.t >= cutoff);
}

function daily(w: WorldState) {
  const T = getTerrain(w.seed);
  dailyAnimals(w, T);
  dailyPeople(w, T);
  dailySociety(w, T);
  dailyDisaster(w);
  dailyVoyage(w);
  // 바위는 천천히 다시 드러난다
  for (const r of w.rocks) r.amt = Math.min(r.max, r.amt + (r.kind === "clay" ? 3 : 1));
  // 쓰지 못하고 쌓이는 가죽은 버린다
  if ((w.stock.hide ?? 0) > 40) w.stock.hide = 40;
  // 음식이 상한다
  const rack = w.structures.some((s) => s.type === "rack" && s.prog >= 1);
  const pot = (w.stock.pot ?? 0) >= 1;
  const spoil: Record<string, number> = {
    berry: 0.18, fruit: 0.1, meat: 0.35, fish: 0.4, cookedMeat: 0.15, cookedFish: 0.15, crop: 0.02, meal: 0.1,
  };
  for (const [r, rate] of Object.entries(spoil)) {
    const v = w.stock[r as keyof typeof w.stock];
    if (!v) continue;
    const m = rate * (rack ? 0.5 : 1) * (pot ? 0.7 : 1);
    const nv = v * (1 - m);
    w.stock[r as keyof typeof w.stock] = nv < 0.5 ? 0 : nv;
  }
}

/** 오프라인 동안의 시간을 빠르게 따라잡는다. 진행 콜백과 함께 조금씩 나눠 실행한다. */
export async function advance(
  w: WorldState,
  gameSeconds: number,
  onProgress?: (done: number, total: number) => void,
  sliceMs = 24,
) {
  const total = Math.min(gameSeconds, MAX_CATCHUP);
  let done = 0;
  while (done < total) {
    const t0 = performance.now();
    while (done < total && performance.now() - t0 < sliceMs) {
      const left = total - done;
      const dt = left > 10 * DAY ? 2400 : left > DAY ? 900 : left > HOUR ? 120 : Math.min(left, 7.2);
      step(w, Math.min(dt, left));
      done += Math.min(dt, left);
    }
    onProgress?.(done, total);
    if (done < total) await new Promise((r) => setTimeout(r, 0));
  }
  w.fx = [];
  return total;
}

/** 동기 버전 (테스트/서버용) */
export function advanceSync(w: WorldState, gameSeconds: number, dt = 600) {
  let done = 0;
  while (done < gameSeconds) {
    const d = Math.min(dt, gameSeconds - done);
    step(w, d);
    done += d;
  }
}
