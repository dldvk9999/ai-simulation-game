import { DAY, DAYS_PER_SEASON, HOUR, TIME_SCALE } from "./constants";
import { baseTemp, seasonOf } from "./clock";
import { chance, range, rand, weighted } from "./rng";
import type { Terrain } from "./terrain";
import type { WeatherType, WorldState } from "./types";
import { addFx, bump, chron, knows, nearest } from "./world";

// 계절별 날씨 가중치. 어느 계절이든 맑음이 가장 자주 나온다.
const WEIGHTS: Record<number, Record<WeatherType, number>> = {
  0: { clear: 42, cloudy: 22, rain: 25, storm: 9, snow: 2 },
  1: { clear: 46, cloudy: 18, rain: 20, storm: 16, snow: 0 },
  2: { clear: 40, cloudy: 27, rain: 23, storm: 8, snow: 3 },
  3: { clear: 36, cloudy: 24, rain: 8, storm: 4, snow: 28 },
};

const DURATION: Record<WeatherType, [number, number]> = {
  clear: [5, 12],
  cloudy: [3, 8],
  rain: [2, 6],
  storm: [1.5, 4],
  snow: [3, 9],
};

const TEMP_MOD: Record<WeatherType, number> = { clear: 1, cloudy: -2, rain: -3, storm: -5, snow: -6 };

export const WEATHER_NAME: Record<WeatherType, string> = {
  clear: "맑음",
  cloudy: "흐림",
  rain: "비",
  storm: "폭풍우",
  snow: "눈",
};

export const WEATHER_ICON: Record<WeatherType, string> = {
  clear: "☀️",
  cloudy: "☁️",
  rain: "🌧️",
  storm: "⛈️",
  snow: "❄️",
};

export function updateWeather(w: WorldState, T: Terrain, dt: number) {
  const W = w.weather;
  if (w.time >= W.until) {
    let next = weighted(w, WEIGHTS[seasonOf(w.time)]);
    // 같은 궂은 날씨가 연달아 길게 이어지지 않게 한 번 더 굴린다
    if (next === W.type && next !== "clear") next = weighted(w, WEIGHTS[seasonOf(w.time)]);
    // 포근한 날에는 눈 대신 구름
    if (next === "snow" && baseTemp(w.time) > 9) next = "cloudy";
    W.prev = W.type;
    W.type = next;
    W.changedAt = w.time;
    const [a, b] = DURATION[next];
    W.until = w.time + range(w, a, b) * HOUR;
    W.wind = next === "storm" ? range(w, 0.85, 1) : next === "rain" ? range(w, 0.4, 0.7) : range(w, 0.15, 0.55);
    // 연대기에는 계절마다 처음 맞는 폭풍과 눈만 남긴다
    const season = Math.floor(w.time / (DAY * DAYS_PER_SEASON));
    if (next === "storm") {
      if (w.timers.stormLog !== season) chron(w, "weather", "천둥 번개를 동반한 폭풍우가 몰아쳤다.");
      w.timers.stormLog = season;
      W.nextStrike = w.time + range(w, 5, 20) * TIME_SCALE;
    } else if (next === "snow" && w.timers.snowLog !== season) {
      w.timers.snowLog = season;
      chron(w, "weather", "섬에 하얀 눈이 내리기 시작했다.");
    }
  }

  let target = baseTemp(w.time) + TEMP_MOD[W.type];
  if (W.type === "snow") target = Math.min(target, 0.5);
  W.temp += (target - W.temp) * (1 - Math.exp(-dt / (2 * HOUR)));

  if (W.type === "snow") W.snow = Math.min(1, W.snow + dt / (5 * HOUR));
  else W.snow = Math.max(0, W.snow - (dt / HOUR) * (W.temp > 3 ? 0.2 + (W.temp - 3) * 0.04 : 0.02));

  if (W.type === "rain" || W.type === "storm") W.wet = Math.min(1, W.wet + dt / (0.8 * HOUR));
  else W.wet = Math.max(0, W.wet - (dt / (3 * HOUR)) * (W.type === "clear" ? 1.5 : 1));

  if (W.type === "storm" && w.time >= W.nextStrike) {
    W.nextStrike = w.time + range(w, 7, 28) * TIME_SCALE;
    strike(w, T);
  }
}

function strike(w: WorldState, T: Terrain) {
  // 높은 나무에 떨어지면 불이 붙는다
  let x = 0, z = 0;
  let ref: number | undefined;
  if (chance(w, 0.22)) {
    const cx = range(w, -50, 50), cz = range(w, -50, 50);
    const tree = nearest(w.plants, cx, cz, (p) => (p.kind === "tree" || p.kind === "pine" || p.kind === "palm") && p.g >= 1 && !p.stump && !p.burn, 30);
    if (tree) {
      x = tree.x;
      z = tree.z;
      ref = tree.id;
      tree.burn = w.time + range(w, 0.8, 1.6) * HOUR;
      bump(w);
      if (!knows(w, "fire") && w.timers.strike !== w.weather.changedAt) {
        w.timers.strike = w.weather.changedAt;
        chron(w, "misc", "번개가 나무에 내리꽂혀 불길이 솟았다.");
      }
    }
  }
  if (ref == null) {
    const p = T.randomPoint(w, () => true, 5) ?? { x: range(w, -60, 60), z: range(w, -60, 60) };
    x = p.x;
    z = p.z;
  }
  addFx(w, "lightning", x, z, ref, rand(w));
  for (const p of w.people) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < 30) {
      p.emo.surprise = Math.min(1, p.emo.surprise + 0.3 * p.sens.surprise);
      p.emo.fear = Math.min(1, p.emo.fear + (d < 12 ? 0.35 : 0.15) * p.sens.fear * (p.fears === "storm" ? 1.5 : 1));
    }
  }
}
