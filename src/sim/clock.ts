import { DAY, DAYS_PER_SEASON, HOUR, YEAR } from "./constants";
import { clamp, smoothstep } from "./noise";

export const SEASONS = ["봄", "여름", "가을", "겨울"] as const;

export const dayOf = (t: number) => Math.floor(t / DAY) + 1;
export const hourOf = (t: number) => (t % DAY) / HOUR;
export const seasonOf = (t: number) => Math.floor(((t / DAY) % (DAYS_PER_SEASON * 4)) / DAYS_PER_SEASON);
export const yearOf = (t: number) => Math.floor(t / YEAR) + 1;
export const ageYears = (birth: number, now: number) => (now - birth) / YEAR;

/** 태양 고도 -1..1 (6시 일출, 19시 반 일몰 무렵) */
export function sunElevation(t: number) {
  const h = hourOf(t);
  return Math.sin(((h - 6) / 13.5) * Math.PI);
}

export function daylight(t: number) {
  return smoothstep(-0.12, 0.28, sunElevation(t));
}

export const isNight = (t: number) => {
  const h = hourOf(t);
  return h < 5.5 || h >= 20.5;
};

export const isEvening = (t: number) => {
  const h = hourOf(t);
  return h >= 17.5 && h < 22;
};

export function clockLabel(t: number) {
  const h = hourOf(t);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function timeOfDayLabel(t: number) {
  const h = hourOf(t);
  if (h < 5) return "깊은 밤";
  if (h < 7) return "새벽";
  if (h < 11) return "아침";
  if (h < 14) return "한낮";
  if (h < 17.5) return "오후";
  if (h < 20) return "저녁";
  return "밤";
}

/** 계절 기본 기온 */
export function baseTemp(t: number) {
  const s = (t / DAY / DAYS_PER_SEASON) % 4; // 0..4 연속
  // 봄 15, 여름 27, 가을 14, 겨울 1
  const pts = [15, 27, 14, 1, 15];
  const i = Math.floor(s);
  const f = s - i;
  const seasonal = pts[i] + (pts[i + 1] - pts[i]) * smoothstep(0.55, 1, f);
  const diurnal = Math.sin(((hourOf(t) - 9) / 24) * Math.PI * 2) * 4.5;
  return seasonal + diurnal;
}

export const clamp01 = (v: number) => clamp(v, 0, 1);
