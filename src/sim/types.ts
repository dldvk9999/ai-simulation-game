export type WeatherType = "clear" | "cloudy" | "rain" | "storm" | "snow";

export interface Weather {
  type: WeatherType;
  prev: WeatherType;
  changedAt: number;
  until: number;
  temp: number;
  wind: number;
  /** 0..1 쌓인 눈 */
  snow: number;
  /** 0..1 젖은 정도 */
  wet: number;
  nextStrike: number;
}

/** 자원/식량/도구는 모두 창고(stock)의 개수로 관리한다. */
export type Res =
  | "wood" | "stick" | "stone" | "fiber" | "hide" | "clay" | "ore" | "metal" | "rope" | "herb"
  | "berry" | "fruit" | "meat" | "fish" | "cookedMeat" | "cookedFish" | "crop" | "meal"
  | "handaxe" | "spear" | "axe" | "basket" | "rod" | "bow" | "hoe" | "pot";

export type Stock = Partial<Record<Res, number>>;

export type PlantKind = "palm" | "tree" | "pine" | "fruit" | "bush" | "fiber" | "herb" | "crop";

export interface Plant {
  id: number;
  kind: PlantKind;
  x: number;
  z: number;
  /** 성장 0..1 */
  g: number;
  fruit: number;
  rot: number;
  s: number;
  /** 1이면 베어진 그루터기 */
  stump: number;
  /** 다시 자라기 시작하는 시각 */
  regrow: number;
  /** 불타는 중이면 꺼지는 시각 */
  burn: number;
  farm?: number;
}

export type RockKind = "rock" | "boulder" | "ore" | "clay";

export interface Rock {
  id: number;
  kind: RockKind;
  x: number;
  z: number;
  amt: number;
  max: number;
  s: number;
  rot: number;
}

export type AnimalKind = "rabbit" | "boar" | "goat" | "crab" | "fowl";
export type AnimalState = "idle" | "move" | "flee" | "stun" | "held" | "sleep";

export interface Animal {
  id: number;
  kind: AnimalKind;
  x: number;
  z: number;
  rot: number;
  st: AnimalState;
  tx: number;
  tz: number;
  until: number;
  born: number;
  tame: number;
  /** 플레이어가 마지막으로 옮겨놓은 시각 */
  gift: number;
  /** 잡고 있는 관찰자 id */
  held: string | null;
  /** 우리로 데려가는 사람 id */
  lead?: number;
}

export type FishKind = "fish" | "bigfish";

export interface Fish {
  id: number;
  kind: FishKind;
  x: number;
  z: number;
  rot: number;
  st: "swim" | "stun" | "held";
  tx: number;
  tz: number;
  until: number;
  dies: number;
  gift: number;
  held: string | null;
}

export interface Item {
  id: number;
  res: Res;
  qty: number;
  x: number;
  z: number;
  t: number;
  /** 플레이어가 떨어뜨렸거나 옮겨놓은 시각(선물 인식용) */
  gift: number;
  held: string | null;
}

export type StructureType =
  | "campfire" | "leanto" | "hut" | "loghouse" | "stonehouse" | "storage" | "rack" | "kiln"
  | "farm" | "pen" | "well" | "workshop" | "smelter" | "dock" | "library" | "windmill"
  | "observatory" | "lighthouse" | "grave" | "raft" | "bench";

export interface Structure {
  id: number;
  type: StructureType;
  x: number;
  z: number;
  rot: number;
  /** 건설 진행도 0..1 */
  prog: number;
  /** 이미 투입된 재료 */
  paid: number;
  fuel: number;
  lit: number;
  name?: string;
  /** 플레이어가 만든 불 */
  byPlayer?: number;
  /** 업그레이드 대상(완공 시 교체) */
  replaces?: number;
  t: number;
}

export type Emotion = "joy" | "sadness" | "fear" | "anger" | "surprise" | "love";
export type Need = "hunger" | "thirst" | "energy" | "warmth" | "social" | "fun";
export type Trait = "openness" | "conscientiousness" | "extraversion" | "agreeableness" | "neuroticism";
export type Outfit = "rag" | "fur" | "cloth" | "modern";

export type Gesture =
  | "cheer" | "dance" | "slump" | "cower" | "stomp" | "startle" | "heart" | "stretch" | "wave" | "think";

export type ActKind =
  | "idle" | "wander" | "sleep" | "eat" | "drink" | "forage" | "gather" | "craft" | "build"
  | "think" | "hunt" | "fish" | "cook" | "tend" | "makefire" | "chat" | "leisure" | "farm"
  | "shelter" | "warm" | "mourn" | "care" | "collect" | "react" | "unconscious" | "explore"
  | "tame" | "play" | "follow";

export type Anim =
  | "idle" | "walk" | "run" | "chop" | "pick" | "sit" | "sleep" | "eat" | "think" | "knap"
  | "hammer" | "fish" | "talk" | "sing" | "swim" | "lie" | "carry" | "dig" | "stir" | "cheer"
  | "dance" | "slump" | "cower" | "stomp" | "startle" | "heart" | "stretch" | "wave" | "pray"
  | "drink" | "throw" | "play";

export interface Act {
  k: ActKind;
  /** 0 이동, 1 작업, 2 귀환 */
  ph: 0 | 1 | 2;
  tx: number;
  tz: number;
  t: number;
  tid?: number;
  res?: Res;
  n?: number;
  sub?: string;
  run?: number;
  started: number;
}

export interface Person {
  id: number;
  name: string;
  sex: "M" | "F";
  birth: number;
  x: number;
  z: number;
  rot: number;
  traits: Record<Trait, number>;
  /** 사람마다 다른 감정 민감도 */
  sens: Record<Emotion, number>;
  likes: { food: Res; weather: WeatherType; leisure: string };
  fears: WeatherType | null;
  needs: Record<Need, number>;
  health: number;
  emo: Record<Emotion, number>;
  act: Act | null;
  anim: Anim;
  gesture: Gesture | null;
  gestureUntil: number;
  bubble: { text: string; emoji: string; until: number } | null;
  carry: { res: Res; qty: number } | null;
  skills: Partial<Record<string, number>>;
  home: number | null;
  partner: number | null;
  parents: number[];
  rel: Record<string, number>;
  preg: number;
  pregBy: number | null;
  grief: { id: number; until: number } | null;
  outfit: Outfit;
  hue: { skin: number; hair: number; cloth: number };
  alive: number;
  died: number;
  cause: string;
  lastThought: number;
  seen: Record<string, number>;
}

export type ChronicleKind =
  | "arrive" | "discover" | "build" | "birth" | "death" | "couple" | "weather" | "gift" | "era" | "misc" | "season";

export interface ChronicleEntry {
  t: number;
  k: ChronicleKind;
  text: string;
}

export type FxType =
  | "hit" | "spark" | "ignite" | "fizzle" | "chip" | "shake" | "splash" | "lightning" | "eureka"
  | "drop" | "stun" | "complete" | "birth" | "arrive" | "catch" | "chop";

export interface Fx {
  id: number;
  t: number;
  type: FxType;
  x: number;
  z: number;
  ref?: number;
  v?: number;
}

export interface WorldState {
  v: number;
  seed: number;
  rng: number;
  time: number;
  nextId: number;
  /** 구조적 변화(추가/삭제)가 생길 때마다 증가 */
  rev: number;
  weather: Weather;
  people: Person[];
  plants: Plant[];
  rocks: Rock[];
  animals: Animal[];
  fish: Fish[];
  items: Item[];
  structures: Structure[];
  stock: Stock;
  tech: { known: string[]; prog: Record<string, number>; focus: string | null };
  camp: { x: number; z: number };
  chronicle: ChronicleEntry[];
  stats: { births: number; deaths: number; arrivals: number; maxPop: number; generation: number; created: number };
  timers: { castaway: number; fish: number; day: number; strike: number; animals: number; stormLog?: number; snowLog?: number };
  fx: Fx[];
}

export type InteractionKind = "hit" | "ignite" | "dragStart" | "dragMove" | "dragEnd";
export type TargetKind = "plant" | "rock" | "animal" | "fish" | "item" | "structure" | "ground" | "water" | "person";

export interface Interaction {
  kind: InteractionKind;
  target: { k: TargetKind; id?: number };
  x: number;
  z: number;
  by: string;
}
