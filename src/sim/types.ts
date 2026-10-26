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
  | "handaxe" | "spear" | "axe" | "basket" | "rod" | "bow" | "hoe" | "pot" | "net"
  /** 약재 원료와 약 */
  | "root" | "mineral" | "herbal" | "remedy" | "medicine"
  /** 광맥에서 캐는 금속과 보석 */
  | Metal
  /** 곡괭이 · 무기 · 장신구 */
  | "pickaxe" | "sword" | "ironsword" | "musket" | "rifle" | "jewelry";

export type Metal = "copper" | "tin" | "iron" | "silver" | "gold" | "diamond";

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

export type RockKind = "rock" | "boulder" | "ore" | "clay" | "mineral" | "vein";

export interface Rock {
  id: number;
  kind: RockKind;
  x: number;
  z: number;
  amt: number;
  max: number;
  s: number;
  rot: number;
  /** 광맥(vein)에서 주로 나오는 것 */
  ore?: Metal;
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

export type FishKind = "fish" | "bigfish" | "mackerel" | "flatfish" | "squid" | "tuna";

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
  | "observatory" | "lighthouse" | "grave" | "raft" | "bench"
  | "infirmary" | "seawall" | "banner" | "hall" | "shipyard" | "portal"
  | "watchtower" | "fort" | "battery" | "townhouse" | "apartment" | "forge" | "factory" | "mine"
  /** 종교의 제단 · 장터 · 왕궁 */
  | "shrine" | "market" | "palace"
  /** 나라를 세운 뒤에 짓는 도박장 */
  | "casino";

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
  /** 재해로 부서진 정도 0..1 (0.6 이상이면 쓸 수 없음) */
  dmg?: number;
  /** 수리에 필요한 재료를 이미 냈는지 */
  fix?: number;
  /** 어느 무리의 것인지 (깃발·분리해 나간 무리의 집) */
  group?: number;
  /** 층수 (시대가 발전할수록 높게 짓는다) */
  lv?: number;
  /** 0이면 아직 설계 중이라 공사를 시작하지 못한다 */
  plan?: number;
  /** 불에 강한 재질(기와·흙벽)로 지었다 */
  fp?: number;
  /** 어느 종교의 제단인지 */
  faith?: number;
}

export type Emotion = "joy" | "sadness" | "fear" | "anger" | "surprise" | "love";
export type Need = "hunger" | "thirst" | "energy" | "warmth" | "social" | "fun";
export type Trait = "openness" | "conscientiousness" | "extraversion" | "agreeableness" | "neuroticism";
export type Outfit = "rag" | "fur" | "cloth" | "modern";

export type Gesture =
  | "cheer" | "dance" | "slump" | "cower" | "stomp" | "startle" | "heart" | "stretch" | "wave" | "think" | "cough";

export type ActKind =
  | "idle" | "wander" | "sleep" | "eat" | "drink" | "forage" | "gather" | "craft" | "build"
  | "think" | "hunt" | "fish" | "cook" | "tend" | "makefire" | "chat" | "leisure" | "farm"
  | "shelter" | "warm" | "mourn" | "care" | "collect" | "react" | "unconscious" | "explore"
  | "tame" | "play" | "follow"
  | "rest" | "isolate" | "nurse" | "medicate" | "dig" | "council" | "repair" | "evacuate" | "fight" | "board"
  | "defend" | "hide" | "design"
  /** 불 끄기 · 불길에서 달아나기 */
  | "douse" | "flee"
  /** 아기는 안겨 다니고, 어린이는 떼쓰고 조르고 울고, 일곱 살부터는 어른 일을 거든다 */
  | "carried" | "fuss" | "assist"
  /** 제단에서 올리는 의식 · 물건 바꾸기 · 나라를 지키러 바닷가에 모이기 */
  | "rite" | "trade" | "muster"
  /** 도박장에서 한 판 · 게임중독으로 집에 틀어박힘 · 대신이 중독될 만한 사람을 타이름 */
  | "gamble" | "addict" | "counsel";

export type Anim =
  | "idle" | "walk" | "run" | "chop" | "pick" | "sit" | "sleep" | "eat" | "think" | "knap"
  | "hammer" | "fish" | "talk" | "sing" | "swim" | "lie" | "carry" | "dig" | "stir" | "cheer"
  | "dance" | "slump" | "cower" | "stomp" | "startle" | "heart" | "stretch" | "wave" | "pray"
  | "drink" | "throw" | "play" | "cough" | "fight" | "row" | "aim" | "slash" | "mine"
  | "scoop" | "bucket" | "douse"
  | "held" | "crawl" | "cry" | "tantrum" | "beg" | "hug" | "scold"
  | "dice" | "limp";

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
  /** 감기 단계 0(건강) · 1~5 */
  ill?: number;
  illAt?: number;
  illNext?: number;
  /** 독감(더 독한 감기)인지 */
  flu?: number;
  /** 이 시각까지는 다시 걸리지 않는다 */
  immune?: number;
  /** 무리(조직·문명) */
  group?: number | null;
  role?: Role | null;
  /** 저마다의 뜻: [새로움을 좇음 0..1, 함께함을 중히 여김 0..1] */
  vals?: [number, number];
  /** 타고난 뜻: 남에게 물들어도 조금씩 여기로 돌아온다 */
  core?: [number, number];
  /** 섬 밖에 나가 있는 동안 */
  away?: { until: number; via: "ship" | "portal"; trip: number } | null;
  /** 열 살이 되기 전의 마음: 바라는 것과 말썽, 혼난 뒤 얌전한 시간 */
  kid?: KidMind;
  /** 믿는 종교 */
  faith?: number | null;
  /** 가진 돈과 제 몫으로 챙긴 물건 */
  purse?: number;
  pack?: Stock;
  /** 맹수에게 물리거나 다친 상처 */
  wound?: Wound | null;
  /** 도박장에서의 기록과 게임중독 */
  gamble?: Gamble;
}

/** 상처: 1 가벼운 상처 · 2 큰 상처. 나을 때까지 절뚝이고 일이 더디다 */
export interface Wound {
  sev: 1 | 2;
  until: number;
  /** 무엇에 다쳤는지 */
  by: string;
}

export interface Gamble {
  /** 요즘 한 판 수와 이긴 판 수 (날마다 조금씩 잊는다) */
  plays: number;
  wins: number;
  last: number;
  /** 게임중독: 이 시각까지 집에서 나오지 못한다 */
  addict?: number;
  /** 이 시각까지는 도박장에 가지 않는다 (타이름을 들었거나 중독에서 막 벗어났다) */
  rest?: number;
  /** 지금까지 딴 돈과 잃은 돈 */
  won: number;
  lost: number;
}

export type KidWant = "hungry" | "play" | "tantrum" | "cry" | "cling" | "sleepy";

export interface KidMind {
  /** 지금 부모에게 바라는 것과 바라기 시작한 시각 */
  want: KidWant | null;
  since: number;
  /** 말썽 0..1 (너무 쌓이면 혼이 난다) */
  mis: number;
  /** 이 시각까지는 혼난 게 생각나서 얌전하다 */
  good: number;
  /** 마지막으로 떼쓴 시각 */
  fuss: number;
}

export type Role =
  | "leader" | "farmer" | "fisher" | "hunter" | "builder" | "scholar" | "crafter" | "healer" | "cook" | "sailor" | "guard"
  /** 나라의 왕과 대신 */
  | "king" | "minister";

export type GroupKind = "org" | "civ" | "nation";

/** 나라의 정부: 왕정 → 왕과 대신들 → 의회를 둔 왕정 */
export interface Government {
  kind: "monarchy" | "cabinet" | "parliament";
  /** 재상 · 장군 · 재무관 */
  chancellor?: number | null;
  general?: number | null;
  treasurer?: number | null;
  since: number;
}

export interface Group {
  id: number;
  kind: GroupKind;
  name: string;
  /** 깃발 색 (hue 0..1) */
  hue: number;
  founded: number;
  leader: number | null;
  vals: [number, number];
  /** 분열해 따로 터를 잡았으면 그 자리 */
  camp: { x: number; z: number } | null;
  /** 다른 무리와의 긴장 (0..1.5) */
  tension: Record<string, number>;
  war: { with: number; since: number; until: number } | null;
  lastWar?: number;
  /** 문명 안에서 뜻이 벌어진 날이 쌓인 정도 */
  strain?: number;
  /** 나라: 세운 날, 정부 */
  crowned?: number;
  gov?: Government;
}

/** 종교가 비는 것: 단비(풍년) · 풍요 · 무병 · 수호 · 저주 */
export type Faith = "rain" | "bounty" | "health" | "peace" | "curse";

export interface Religion {
  id: number;
  name: string;
  aim: Faith;
  founded: number;
  hue: number;
  /** 의식을 올리자고 부른 시각 (0이면 없음)과 모인 사람 */
  call: number;
  gathered: number[];
  lastRite: number;
  rites: number;
  /** 저주가 향하는 무리 */
  target?: number | null;
}

/** 의식이 통한 동안의 효험 */
export interface Blessing {
  aim: Faith;
  until: number;
  power: number;
  by: number;
}

/** 경제: 지금 쓰는 화폐(시대), 나라 곳간, 거래 수 */
export interface Economy {
  era: number;
  treasury: number;
  trades: number;
  started: number;
}

/** 도박장: 쌓인 돈은 나라 살림(세금·복지)으로 옮겨 쓴다 */
export interface Casino {
  open: boolean;
  /** 아직 나라 살림으로 옮기지 않은 돈 */
  bank: number;
  plays: number;
  /** 지금까지 사람들이 잃은 돈과 딴 돈 */
  took: number;
  paid: number;
  /** 문을 닫은 시각과 그때 중독되어 있던 사람들 */
  closed: number;
  ids: number[];
  /** 한 번에 걸 수 있는 가장 큰 돈 (대신들이 정한다) */
  cap: number;
  /** 왕이 놀이를 권하는 정도 0..1 */
  push: number;
  /** 지금까지 게임중독에 빠진 횟수 */
  addicts: number;
  /** 조용한 날이 이어진 수 (거는 돈을 다시 풀 때) · 거는 돈 이야기를 남긴 시각 */
  calm?: number;
  capLog?: number;
}

/** 세금으로 고쳐 나가는 것들: 길 · 탈것 · 의료 · 복지 · 무역 */
export type CivicKind = "road" | "transport" | "medical" | "welfare" | "trade";

export interface Civic {
  /** 나라 살림 (세금과 도박장에서 모인 돈) */
  fund: number;
  lv: Record<CivicKind, number>;
  /** 백성들이 불편하다고 말한 정도 */
  voice: Record<CivicKind, number>;
  /** 마지막으로 백성의 소리를 듣고 고친 시각 */
  last: number;
  taxed: number;
  spent: number;
}

/** 바다 건너의 다른 나라 */
export interface Nation {
  id: number;
  name: string;
  hue: number;
  /** 국력, 우리 나라를 대하는 마음 (-1 적대 … 1 우호), 있는 쪽 (각도) */
  power: number;
  mood: number;
  /** 타고난 기질: 마음이 이쪽으로 돌아온다 (-0.6 호전적 … 0.5 온화) */
  temper?: number;
  /** 무역한 횟수 */
  trades?: number;
  dir: number;
  met: number;
  lastTrade: number;
  war: { since: number; until: number } | null;
  lastWar?: number;
}

/** 다른 나라의 배가 와 있다: 무역선 또는 전함 */
export interface Visit {
  nation: number;
  kind: "trade" | "war";
  arrive: number;
  until: number;
  /** 싸움에서 우리가 이긴 정도 (-1 … 1) */
  score?: number;
}

export type DisasterType = "quake" | "typhoon" | "tsunami";

export interface Disaster {
  type: DisasterType;
  /** 실제로 덮치는 시각 (그 전에는 예보 단계) */
  start: number;
  until: number;
  power: number;
  /** 쓰나미가 밀려오는 방향 */
  ang: number;
  /** 피해 판정 단계 */
  hit: number;
  /** 미리 알아챘는지 */
  warned: number;
  /** 피해 집계 */
  toll: { broken: number; ruined: number; crops: number; trees: number; hurt: number; lost: number };
}

export interface Voyage {
  id: number;
  via: "ship" | "portal";
  crew: number[];
  /** 모이기 시작한 시각, 떠난 시각, 돌아올 시각 */
  called: number;
  left: number;
  back: number;
  from: { x: number; z: number; rot: number };
}

export type BeastKind = "wolf" | "bear" | "tiger" | "sabertooth" | "dragon";

/** 사람을 해칠 수 있는 맹수. 섬에서 보낸 날이 길수록 강한 놈이 나타난다 */
export interface Beast {
  id: number;
  kind: BeastKind;
  x: number;
  z: number;
  rot: number;
  /** 어슬렁 · 쫓기 · 덮치기 · 기절 · 물러남 · 쓰러짐 */
  st: "prowl" | "chase" | "maul" | "stun" | "leave" | "dead";
  hp: number;
  max: number;
  /** 강한 정도 (나타난 날에 따라 정해진다) */
  pow: number;
  tx: number;
  tz: number;
  /** 노리는 사람 / 부수는 건물 */
  target: number | null;
  siege: number | null;
  /** 이 시각이 지나면 숲으로 돌아간다 */
  until: number;
  stun: number;
  /** 다음 공격까지 남은 시간 */
  atk: number;
  /** 돌아갈 곳 */
  home: { x: number; z: number };
  born: number;
  /** 쓰러진 뒤 사라지는 시각 */
  gone?: number;
  /** 맞서 싸운 사람들 */
  foes: number[];
  /** 아무도 물지 못하고 헛걸음한 시간 (오래되면 제풀에 물러난다) */
  bored?: number;
  /** 용: 하늘 높이 떠 있는 정도 0..1, 다음에 불을 뿜을 수 있는 시각 */
  fly?: number;
  breath?: number;
  /** 사람을 해치고 배를 채웠다 (곧 돌아간다) */
  ate?: number;
}

export type ChronicleKind =
  | "arrive" | "discover" | "build" | "birth" | "death" | "couple" | "weather" | "gift" | "era" | "misc" | "season"
  | "disease" | "disaster" | "society" | "voyage" | "beast" | "fire" | "family" | "faith" | "trade" | "nation"
  | "casino" | "civic";

export interface ChronicleEntry {
  t: number;
  k: ChronicleKind;
  text: string;
}

export type FxType =
  | "hit" | "spark" | "ignite" | "fizzle" | "chip" | "shake" | "splash" | "lightning" | "eureka"
  | "drop" | "stun" | "complete" | "birth" | "arrive" | "catch" | "chop"
  | "dust" | "heal" | "clash" | "portal" | "collapse"
  | "roar" | "shot" | "bite" | "crack" | "douse" | "cry" | "coin" | "pray"
  | "breath" | "dice";

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
  /** chron: 지금까지 쓰인 연대기 항목 수 (오래된 항목은 지워져도 계속 센다) */
  stats: { births: number; deaths: number; arrivals: number; maxPop: number; generation: number; created: number; chron?: number };
  timers: {
    castaway: number; fish: number; day: number; strike: number; animals: number; stormLog?: number; snowLog?: number;
    disaster?: number; voyage?: number; council?: number;
    /** 다음 맹수가 올 수 있는 날, 오늘 나타날 시각, 사기가 바닥난 시각, 무기 이야기를 남긴 시각 */
    beast?: number; beastAt?: number; moraleLow?: number; weaponGap?: number;
    /** 불이 번진 이야기 · 아이를 혼낸 이야기를 마지막으로 남긴 시각 (연대기가 넘치지 않게) */
    fireLog?: number; scoldLog?: number;
    /** 이번 습격에서 맹수가 해친 사람 수와 넘지 않을 수 (섬 사람 수에 따라) */
    beastKills?: number; beastCap?: number;
    /** 도박 이야기를 마지막으로 남긴 시각 */
    casinoLog?: number;
  };
  fx: Fx[];
  // ─── v2 ───
  groups: Group[];
  disaster: Disaster | null;
  /** 겪어 본 일들 (대비책 연구의 계기) */
  history: {
    quake: number; typhoon: number; tsunami: number; sick: number; wars: number; lastDisaster: number; lastType: DisasterType | null;
    /** 맹수가 나타난 횟수와 마지막 시각 */
    beast?: number; lastBeast?: number;
    /** 불이 난 횟수와 마지막 시각 */
    fire?: number; lastFire?: number;
    /** 마지막으로 비가 온 시각 (기우제) */
    lastRain?: number;
  };
  /** 찾아낸 약재 원료 · 광맥 · 금속 */
  found: string[];
  /** 아직 아무도 모르는 광맥 */
  deposits: { x: number; z: number }[];
  voyages: Voyage[];
  // ─── v3 ───
  beasts: Beast[];
  /** 사람들의 사기 0..100 */
  morale: number;
  /** 이미 설계해 본 건물 ("종류:층수") */
  designs: string[];
  // ─── v4 ───
  /** 타오르는 불길 */
  blazes: Blaze[];
  // ─── v5 ───
  religions: Religion[];
  blessings: Blessing[];
  economy: Economy | null;
  /** 바다 건너의 나라들과 지금 와 있는 배 */
  nations: Nation[];
  visit: Visit | null;
  // ─── v6 ───
  casino: Casino | null;
  civic: Civic | null;
}

/** 불길: 건물에 붙었거나(sid) 번개·관찰자의 불씨로 땅에 번진 불 */
export interface Blaze {
  id: number;
  x: number;
  z: number;
  /** 지금 불길의 반경과 커질 수 있는 끝 */
  r: number;
  max: number;
  /** 세기 0..1 (0이 되면 꺼진다) */
  heat: number;
  /** 타고 있는 건물 */
  sid?: number;
  /** 땅불이 다 타 버릴 때까지 남은 시간 */
  fuel: number;
  t: number;
  why: "lightning" | "hand" | "spread";
  /** 물을 끼얹은 사람들 */
  by: number[];
}

export type InteractionKind = "hit" | "ignite" | "dragStart" | "dragMove" | "dragEnd" | "smash";
export type TargetKind = "plant" | "rock" | "animal" | "fish" | "item" | "structure" | "ground" | "water" | "person" | "beast";

export interface Interaction {
  kind: InteractionKind;
  target: { k: TargetKind; id?: number };
  x: number;
  z: number;
  by: string;
}
