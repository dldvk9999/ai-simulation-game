import { create } from "zustand";
import type { ChronicleEntry, Emotion, Need, Outfit, WeatherType } from "@/sim/types";

export type Phase = "connecting" | "catchup" | "syncing" | "running" | "error";

export interface PersonSummary {
  id: number;
  name: string;
  age: number;
  sex: "M" | "F";
  emoji: string;
  action: string;
  alive: boolean;
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
}

export interface Toast {
  id: number;
  text: string;
  kind: string;
  at: number;
}

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
  generation: number;
  people: PersonSummary[];
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
  generation: 1,
  people: [],
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
