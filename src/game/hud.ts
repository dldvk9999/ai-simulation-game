import { create } from "zustand";
import type { Credits } from "@/sim/ending";
import type { ChronicleEntry, Emotion, EndingKind, Need, Outfit, WeatherType } from "@/sim/types";

export type Phase = "connecting" | "catchup" | "syncing" | "running" | "error";

export interface PersonSummary {
  id: number;
  name: string;
  age: number;
  sex: "M" | "F";
  emoji: string;
  action: string;
  alive: boolean;
  group: number | null;
  /** 역할 아이콘 */
  role: string;
  ill: number;
  away: boolean;
}

export interface GroupSummary {
  id: number;
  kind: "org" | "civ" | "nation";
  title: string;
  stage: string;
  hue: number;
  count: number;
  leader: string;
  war: string | null;
  /** 따로 터를 잡았는지 */
  apart: boolean;
  members: number[];
}

export interface PersonDetail extends PersonSummary {
  needs: Record<Need, number>;
  emo: Record<Emotion, number>;
  health: number;
  mood: number;
  mainEmotion: string;
  traits: string[];
  likes: string;
  thought: string;
  family: string[];
  skills: string[];
  outfit: Outfit;
  carry: string;
  home: string;
  preg: boolean;
  role: string;
  illName: string;
  groupName: string;
  view: string;
  /** 믿는 종교 · 가진 돈과 꾸러미 */
  faith: string;
  wallet: string;
  /** 상처 · 도박장 기록 */
  wound: string;
  gamble: string;
}

/** 눌러 본 건물 */
export interface StructDetail {
  id: number;
  name: string;
  floors: number;
  use: string;
  hp: number;
  max: number;
  state: string;
  who: string;
  note: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: string;
  at: number;
}

/** 맞이한 엔딩: 연출 중이거나 끝났다 */
export interface EndingHud {
  kind: EndingKind;
  icon: string;
  title: string;
  caption: string;
  ph: number;
  /** 지금 단계가 얼마나 지났는지 0..1 */
  prog: number;
  done: boolean;
  key: number;
}

export type PeopleTab = "people" | "nation" | "stock";

export interface HudState {
  phase: Phase;
  error: string | null;
  catchup: { done: number; total: number };
  isHost: boolean;
  viewers: number;
  storage: string;
  offline: boolean;
  day: number;
  year: number;
  season: string;
  clock: string;
  tod: string;
  weather: WeatherType;
  temp: number;
  era: string;
  pop: number;
  abroad: number;
  /** 기계의 몸을 얻은 로봇 수 · 지금 배속 */
  robots: number;
  speed: number;
  ending: EndingHud | null;
  credits: Credits | null;
  creditsOpen: boolean;
  confirmRestart: boolean;
  /** 사람들 패널에서 고른 칸 */
  peopleTab: PeopleTab;
  generation: number;
  people: PersonSummary[];
  groups: GroupSummary[];
  /** 펼쳐 본 무리 */
  openGroup: number | null;
  disaster: { name: string; icon: string; coming: boolean } | null;
  war: boolean;
  /** 사기 0..100 */
  morale: number;
  beast: { name: string; icon: string; count: number } | null;
  /** 타오르는 불길 수와 그중 건물에 붙은 불 */
  fire: { count: number; houses: number } | null;
  /** 나라 · 바다 건너 배 · 효험 */
  nation: { name: string; king: string; gov: string; ministers: string; foreign: { name: string; mood: string; war: boolean }[] } | null;
  ship: { name: string; war: boolean } | null;
  blessings: { icon: string; name: string }[];
  /** 종교와 경제 (사람들 패널) */
  faiths: { name: string; icon: string; wish: string; count: number; rites: number }[];
  economy: { currency: string; treasury: string; trades: number } | null;
  /** 도박장 · 나라 살림 (세금) */
  casino: { open: boolean; cap: string; addicts: number; plays: number; net: string; push: boolean } | null;
  civic: { fund: string; taxed: string; spent: string; done: string; voice: string } | null;
  structId: number | null;
  structure: StructDetail | null;
  selectedId: number | null;
  followId: number | null;
  selected: PersonDetail | null;
  stock: [string, number][];
  tech: { known: string[]; focus: string | null; progress: number; cost: number };
  chronicle: ChronicleEntry[];
  toasts: Toast[];
  away: { entries: ChronicleEntry[]; days: number } | null;
  panel: "none" | "chronicle" | "tech" | "help" | "people";
  muted: boolean;
  hint: string | null;
}

export const useHud = create<HudState>(() => ({
  phase: "connecting",
  error: null,
  catchup: { done: 0, total: 0 },
  isHost: false,
  viewers: 1,
  storage: "",
  offline: false,
  day: 1,
  year: 1,
  season: "봄",
  clock: "07:00",
  tod: "아침",
  weather: "clear",
  temp: 18,
  era: "",
  pop: 0,
  abroad: 0,
  robots: 0,
  speed: 1,
  ending: null,
  credits: null,
  creditsOpen: false,
  confirmRestart: false,
  peopleTab: "people",
  generation: 1,
  people: [],
  groups: [],
  openGroup: null,
  disaster: null,
  war: false,
  morale: 70,
  beast: null,
  fire: null,
  nation: null,
  ship: null,
  blessings: [],
  faiths: [],
  economy: null,
  casino: null,
  civic: null,
  structId: null,
  structure: null,
  selectedId: null,
  followId: null,
  selected: null,
  stock: [],
  tech: { known: [], focus: null, progress: 0, cost: 1 },
  chronicle: [],
  toasts: [],
  away: null,
  panel: "none",
  muted: false,
  hint: null,
}));
