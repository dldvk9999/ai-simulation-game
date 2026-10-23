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

/** 지형: 처음 섬(CORE_RADIUS)은 그대로 두고 바깥으로 넓혀 넓이를 두 배로 만들었다 */
export const WORLD_SIZE = 320;
export const TERRAIN_RES = 341;
export const CORE_RADIUS = 66;
export const ISLAND_RADIUS = 93;
/** 처음 섬에 견준 넓이 배율 (≈ 2) */
export const AREA_MUL = (ISLAND_RADIUS / CORE_RADIUS) ** 2;
export const SEA_LEVEL = 0;

/** 걷기 속도(게임 초당 유닛). 현실 기준 초당 약 2.4유닛. */
export const WALK_SPEED = 2.4 / TIME_SCALE;
export const ANIMAL_SPEED = 2.0 / TIME_SCALE;

export const START_HOUR = 7;
/** 나라를 세우려면 30명이 넘어야 해서 넉넉히 */
export const MAX_POP = 60;
/** 나라를 세울 수 있는 사람 수 */
export const NATION_POP = 30;
/** 이만큼 모이면 조직이나 문명을 이룰 수 있다 */
export const GROUP_POP = 10;
export const CHRONICLE_LIMIT = 240;
/** 시대가 넘어가는 데 걸리는 날이 처음보다 2.5배 길다 (맹수가 세지는 빠르기도 이에 맞춘다) */
export const ERA_STRETCH = 2.5;
/** 그러려면 시대마다 연구가 이만큼 더디다 (표류자가 가져오는 지식·사람이 느는 빠르기는 그대로라서 1/2.5보다 작다) */
export const ERA_PACE = [0.11, 0.12, 0.25, 0.26, 0.26];

/** 오래 비워둔 섬을 따라잡을 때 허용하는 최대 게임 시간(현실 약 60일). */
export const MAX_CATCHUP = DAY * 72 * 60;

export const SCHEMA_VERSION = 5;
