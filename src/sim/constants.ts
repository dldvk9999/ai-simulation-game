// 시간 단위는 모두 "게임 초"다. 현실 1초 = 게임 72초 → 게임 하루 = 현실 20분.
export const TIME_SCALE = 72;
export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;
export const DAYS_PER_SEASON = 7;
export const YEAR = DAY * DAYS_PER_SEASON * 4;

/** 호스트가 실시간으로 시뮬레이션을 돌리는 주기(현실 ms). */
export const SIM_TICK_MS = 100;
export const MAX_VIEWERS = 3;

/** 지형 */
export const WORLD_SIZE = 240;
export const TERRAIN_RES = 257;
export const ISLAND_RADIUS = 66;
export const SEA_LEVEL = 0;

/** 걷기 속도(게임 초당 유닛). 현실 기준 초당 약 2.4유닛. */
export const WALK_SPEED = 2.4 / TIME_SCALE;
export const ANIMAL_SPEED = 2.0 / TIME_SCALE;

export const START_HOUR = 7;
export const MAX_POP = 24;
export const CHRONICLE_LIMIT = 240;

/** 오래 비워둔 섬을 따라잡을 때 허용하는 최대 게임 시간(현실 약 60일). */
export const MAX_CATCHUP = DAY * 72 * 60;

export const SCHEMA_VERSION = 1;
