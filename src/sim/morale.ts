// 사기: 건물이 무너지고 사람이 다치면 꺾이고, 함께 이겨 내고 해내면 오른다.
// 사기가 높으면 일과 연구가 잘 되고, 낮으면 손이 무겁고 마음도 가라앉는다.
import { clamp } from "./noise";
import type { WorldState } from "./types";
import { chron, living } from "./world";

export const MORALE_START = 70;
const LOW = 35;
const RECOVERED = 55;

export const moraleOf = (w: WorldState) => w.morale ?? MORALE_START;

/** 일·연구 속도 배율 (사기 0 → 0.8, 50 → 1.0, 100 → 1.2) */
export const moraleMul = (w: WorldState) => 0.8 + 0.4 * (moraleOf(w) / 100);

export function shiftMorale(w: WorldState, amt: number) {
  const before = moraleOf(w);
  const after = clamp(before + amt, 0, 100);
  w.morale = after;
  if (before >= LOW && after < LOW && !w.timers.moraleLow) {
    w.timers.moraleLow = w.time;
    chron(w, "misc", "잇따른 불행에 사람들의 사기가 크게 꺾였다. 일손이 무거워지고 웃음소리가 줄었다.");
  } else if (w.timers.moraleLow && after >= RECOVERED) {
    w.timers.moraleLow = 0;
    chron(w, "misc", "사람들이 다시 기운을 차렸다. 마을에 웃음소리가 돌아왔다.");
  }
}

/** 하루에 한 번: 사기는 살림살이에 맞는 자리로 천천히 돌아온다 */
export function dailyMorale(w: WorldState, comfort: { housed: boolean; fed: boolean }) {
  if (!living(w).length) return;
  const base = 62 + (comfort.housed ? 6 : -6) + (comfort.fed ? 6 : -8);
  shiftMorale(w, (base - moraleOf(w)) * 0.22);
}

export function moraleLabel(m: number) {
  return m >= 75 ? "높음" : m >= 50 ? "보통" : m >= LOW ? "떨어짐" : "바닥";
}
