import type { FishKind, Metal, Res, Role, Stock, StructureType } from "./types";

export const ERAS = ["뗀석기 시대", "신석기 시대", "청동기 시대", "철기 시대", "과학 시대"] as const;

export interface TechDef {
  id: string;
  name: string;
  era: number;
  cost: number;
  prereq: string[];
  desc: string;
  /** 모두가 죽어도 이 흔적이 남아 있으면 다음 사람이 알아본다 */
  evidence?: StructureType | Res;
  /** 겪거나 찾아내야 비로소 고민하기 시작한다 */
  needs?: { found?: string[]; event?: ("quake" | "typhoon" | "tsunami" | "sick" | "beast" | "fire")[] };
}

export const TECHS: TechDef[] = [
  { id: "knapping", name: "뗀석기", era: 0, cost: 0, prereq: [], desc: "돌을 깨뜨려 날카로운 주먹도끼를 만든다.", evidence: "handaxe" },
  { id: "fire", name: "불 피우기", era: 0, cost: 150, prereq: ["knapping"], desc: "마찰로 불씨를 만들고 불을 지킨다.", evidence: "campfire" },
  { id: "leanto", name: "움막", era: 0, cost: 110, prereq: ["knapping"], desc: "나뭇가지와 풀로 비바람을 막는다.", evidence: "leanto" },
  { id: "spear", name: "나무 창", era: 0, cost: 120, prereq: ["knapping"], desc: "끝을 뾰족하게 다듬은 창으로 사냥한다.", evidence: "spear" },
  { id: "cordage", name: "끈 꼬기", era: 0, cost: 140, prereq: ["knapping"], desc: "식물 섬유를 꼬아 튼튼한 끈을 만든다.", evidence: "rope" },
  { id: "cooking", name: "요리", era: 0, cost: 120, prereq: ["fire"], desc: "불에 익혀 먹으면 배도 든든하고 탈도 없다." },
  { id: "stoneaxe", name: "돌도끼", era: 0, cost: 200, prereq: ["cordage"], desc: "돌날을 자루에 묶어 나무를 벤다.", evidence: "axe" },
  { id: "basket", name: "바구니", era: 0, cost: 160, prereq: ["cordage"], desc: "더 많이 나르고 모아둘 수 있다.", evidence: "basket" },
  { id: "clothing", name: "가죽옷", era: 0, cost: 220, prereq: ["cordage", "spear"], desc: "짐승 가죽으로 추위를 막는다." },
  { id: "herbs", name: "약초 감별", era: 0, cost: 140, prereq: ["knapping"], desc: "먹는 풀과 약이 되는 풀을 가려낸다. 약초즙으로 가벼운 감기를 다스린다.", evidence: "herbal", needs: { event: ["sick"] } },

  { id: "polished", name: "간석기", era: 1, cost: 300, prereq: ["stoneaxe"], desc: "돌을 갈아 오래 쓰는 도구를 만든다.", evidence: "workshop" },
  { id: "hut", name: "오두막", era: 1, cost: 300, prereq: ["stoneaxe", "leanto"], desc: "통나무 기둥과 지붕을 갖춘 집.", evidence: "hut" },
  { id: "fishing", name: "낚시 도구", era: 1, cost: 260, prereq: ["cordage", "spear"], desc: "낚싯대로 물고기를 낚는다.", evidence: "rod" },
  { id: "bow", name: "활과 화살", era: 1, cost: 350, prereq: ["cordage", "spear"], desc: "멀리서 사냥감을 맞힌다.", evidence: "bow" },
  { id: "drying", name: "훈제와 건조", era: 1, cost: 250, prereq: ["cooking", "cordage"], desc: "음식을 말려 오래 보관한다.", evidence: "rack" },
  { id: "pottery", name: "토기", era: 1, cost: 380, prereq: ["fire", "polished"], desc: "흙을 구워 그릇을 만든다.", evidence: "kiln" },
  { id: "agriculture", name: "농경", era: 1, cost: 500, prereq: ["polished", "basket"], desc: "씨앗을 심고 거둔다.", evidence: "farm" },
  { id: "husbandry", name: "목축", era: 1, cost: 450, prereq: ["agriculture", "cordage"], desc: "짐승을 길들여 기른다.", evidence: "pen" },
  { id: "weaving", name: "직조", era: 1, cost: 420, prereq: ["agriculture"], desc: "실을 엮어 옷감을 짠다." },
  { id: "net", name: "그물", era: 1, cost: 300, prereq: ["fishing"], desc: "끈으로 그물을 엮어 한 번에 여러 마리를 건진다.", evidence: "net" },
  { id: "remedy", name: "약 달이기", era: 1, cost: 340, prereq: ["herbs", "pottery"], desc: "약초와 땅에서 캔 뿌리를 토기에 달여 탕약을 만든다.", evidence: "remedy", needs: { found: ["root"] } },
  { id: "bracing", name: "버팀목 공법", era: 1, cost: 320, prereq: ["hut"], desc: "기둥을 엇갈려 묶어 흔들림과 바람에 버틴다.", needs: { event: ["quake", "typhoon"] } },
  { id: "mining", name: "채광", era: 1, cost: 280, prereq: ["polished"], desc: "곡괭이로 광맥을 캐어 구리·주석·철을 얻는다. 아주 드물게 은과 금, 다이아몬드도 나온다.", evidence: "pickaxe", needs: { found: ["vein"] } },
  { id: "watchtower", name: "망루", era: 1, cost: 300, prereq: ["hut", "bow"], desc: "높은 망루에 올라 맹수를 먼저 알아보고, 위에서 화살을 쏜다.", evidence: "watchtower", needs: { event: ["beast"] } },

  { id: "loghouse", name: "통나무집", era: 2, cost: 600, prereq: ["hut", "polished"], desc: "넓고 따뜻한 통나무집.", evidence: "loghouse" },
  { id: "well", name: "우물", era: 2, cost: 550, prereq: ["pottery"], desc: "마을 가운데에서 물을 긷는다.", evidence: "well" },
  { id: "metallurgy", name: "청동 야금", era: 2, cost: 900, prereq: ["pottery"], desc: "광석을 녹여 금속을 얻는다.", evidence: "smelter" },
  { id: "wheel", name: "바퀴", era: 2, cost: 700, prereq: ["loghouse"], desc: "수레로 무거운 짐을 나른다." },
  { id: "writing", name: "문자", era: 2, cost: 1000, prereq: ["pottery", "agriculture"], desc: "지식을 기록해 후대에 남긴다.", evidence: "library" },
  { id: "boat", name: "배", era: 2, cost: 800, prereq: ["loghouse", "cordage"], desc: "먼 바다에서 고기를 잡는다.", evidence: "dock" },
  { id: "bronzeweapon", name: "청동 무기", era: 2, cost: 650, prereq: ["metallurgy"], desc: "구리와 주석을 녹여 섞은 청동으로 날카로운 검을 벼린다.", evidence: "sword", needs: { found: ["copper", "tin"], event: ["beast"] } },
  { id: "fireproof", name: "불에 강한 건축", era: 2, cost: 700, prereq: ["metallurgy"], desc: "구운 기와로 지붕을 잇고 흙과 석회를 바른 벽으로, 불길이 쉽게 옮겨붙지 않는 집을 짓는다.", needs: { event: ["fire"] } },
  { id: "goldsmith", name: "귀금속 세공", era: 2, cost: 600, prereq: ["metallurgy"], desc: "은과 금을 다듬어 장신구를 만든다. 반짝이는 것을 몸에 지니면 마음이 든든해진다.", evidence: "jewelry", needs: { found: ["silver"] } },

  { id: "iron", name: "철기", era: 3, cost: 1500, prereq: ["metallurgy"], desc: "단단한 철로 도구를 만든다." },
  { id: "masonry", name: "석조 건축", era: 3, cost: 1400, prereq: ["iron", "wheel"], desc: "돌을 다듬어 튼튼한 집을 짓는다.", evidence: "stonehouse" },
  { id: "medicine", name: "약 조제", era: 2, cost: 1100, prereq: ["writing", "remedy"], desc: "약초·뿌리·약돌을 배합해 깊은 병도 고치는 약을 만든다.", evidence: "medicine", needs: { found: ["mineral"] } },
  { id: "mathematics", name: "수학", era: 3, cost: 1600, prereq: ["writing"], desc: "수와 도형으로 세상을 잰다." },
  { id: "windmill", name: "풍차", era: 3, cost: 2000, prereq: ["wheel", "masonry"], desc: "바람의 힘으로 곡식을 빻는다.", evidence: "windmill" },
  { id: "navigation", name: "항해술", era: 3, cost: 1300, prereq: ["boat", "mathematics"], desc: "별과 해를 보고 먼바다의 길을 찾는다. 배를 타고 더 멀리 고기를 잡으러 간다." },
  { id: "forecast", name: "기상 관측", era: 3, cost: 1400, prereq: ["mathematics"], desc: "구름과 바람, 바다를 살펴 큰 재해를 미리 알아챈다.", needs: { event: ["typhoon", "tsunami"] } },
  { id: "seawall", name: "방파제", era: 3, cost: 1400, prereq: ["masonry"], desc: "해안에 돌로 둑을 쌓아 큰 물결을 막는다.", evidence: "seawall", needs: { event: ["tsunami"] } },
  { id: "ironweapon", name: "철제 무기", era: 3, cost: 1100, prereq: ["iron"], desc: "철을 달궈 두드려 단단하고 긴 창을 만든다.", evidence: "ironsword", needs: { found: ["iron"], event: ["beast"] } },
  { id: "fortress", name: "성루 축조", era: 3, cost: 1200, prereq: ["masonry", "watchtower"], desc: "돌을 높이 쌓은 성루에서 큰 짐승도 막아 낸다.", evidence: "fort", needs: { event: ["beast"] } },
  { id: "architecture", name: "건축학", era: 3, cost: 1300, prereq: ["masonry", "mathematics"], desc: "층을 쌓아 올리는 법을 셈해, 여러 가족이 함께 사는 높은 집을 짓는다. 마을도 반듯하게 나눈다.", evidence: "townhouse" },

  { id: "astronomy", name: "천문학", era: 4, cost: 2400, prereq: ["mathematics"], desc: "별의 움직임으로 계절을 읽는다.", evidence: "observatory" },
  { id: "science", name: "과학적 방법", era: 4, cost: 3200, prereq: ["astronomy", "medicine"], desc: "관찰하고 실험해 진리를 찾는다." },
  { id: "steam", name: "증기 기관", era: 4, cost: 4000, prereq: ["science", "iron"], desc: "끓는 물의 힘으로 기계를 움직인다. 공장을 세운다.", evidence: "factory" },
  { id: "firearm", name: "화약 무기", era: 4, cost: 900, prereq: ["science", "ironweapon"], desc: "화약의 힘으로 멀리서 큰 짐승을 쓰러뜨린다. 포대도 세운다.", evidence: "musket", needs: { event: ["beast"] } },
  { id: "highrise", name: "고층 건축", era: 4, cost: 1500, prereq: ["steam", "architecture"], desc: "철골과 증기 기계로 여러 층의 높은 건물을 올린다.", evidence: "apartment" },
  { id: "rifle", name: "강선 소총", era: 4, cost: 1600, prereq: ["firearm", "steam"], desc: "총열 안에 홈을 새겨 더 멀리, 더 정확하게 쏜다.", evidence: "rifle" },
  { id: "electricity", name: "전기", era: 4, cost: 5200, prereq: ["steam"], desc: "밤을 밝히는 빛을 만든다.", evidence: "lighthouse" },
  { id: "quakeproof", name: "내진 설계", era: 4, cost: 2600, prereq: ["science", "masonry"], desc: "흔들려도 무너지지 않게 짓는 법을 계산해 낸다.", needs: { event: ["quake"] } },
  { id: "shipbuilding", name: "조선술", era: 4, cost: 3000, prereq: ["navigation", "science"], desc: "큰 돛배를 지어 섬 밖 세상으로 나아간다.", evidence: "shipyard" },
  { id: "quantum", name: "양자 이론", era: 4, cost: 5000, prereq: ["electricity"], desc: "눈에 보이지 않는 가장 작은 세계의 법칙을 밝힌다." },
  { id: "portal", name: "차원문", era: 4, cost: 6000, prereq: ["quantum"], desc: "공간을 접어 아득히 먼 곳과 이어지는 문을 연다.", evidence: "portal" },
];

// 시대가 올라갈수록 훨씬 오래 걸린다 (게임 1일 = 현실 20분 기준으로
// 신석기 ≈ 반나절, 청동기 ≈ 2일, 철기 ≈ 4~5일, 전기 ≈ 2주 정도가 목표)
const ERA_COST_MUL = [1.3, 5.5, 70, 150, 800];
for (const t of TECHS) t.cost = Math.round(t.cost * ERA_COST_MUL[t.era]);

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export interface StructDef {
  name: string;
  cost: Stock;
  /** 필요한 작업 시간(게임 시간) */
  work: number;
  tech?: string;
  cap?: number;
  radius: number;
  /** 집 등급 (높을수록 좋음) */
  tier?: number;
  /** 처음 내구도 (큰 건물일수록 높다) */
  hp: number;
  /** 대략의 높이 (한 층) */
  h: number;
  /** 무엇에 쓰는 건물인지 */
  use: Purpose;
}

export type Purpose = "home" | "defense" | "craft" | "food" | "store" | "civic" | "sea" | "mine" | "care" | "faith" | "trade" | "rule" | "misc";
export const PURPOSE_NAME: Record<Purpose, string> = {
  home: "사람이 잠자는 곳", defense: "맹수를 막는 곳", craft: "도구를 만드는 곳", food: "먹을 것을 마련하는 곳", store: "물건을 쌓아 두는 곳",
  civic: "함께 모이고 배우는 곳", sea: "바다로 나가는 곳", mine: "광석을 캐는 곳", care: "아픈 사람을 돌보는 곳",
  faith: "믿음을 모아 의식을 올리는 곳", trade: "물건을 사고파는 곳", rule: "왕이 나라를 다스리는 곳", misc: "",
};

export const STRUCTS: Record<StructureType, StructDef> = {
  campfire: { name: "모닥불", cost: { stone: 3, stick: 2 }, work: 0.3, tech: "fire", radius: 0.9, hp: 30, h: 0.4, use: "food" },
  leanto: { name: "움막", cost: { stick: 10, fiber: 4 }, work: 2.5, tech: "leanto", cap: 2, radius: 1.8, tier: 1, hp: 60, h: 1.4, use: "home" },
  hut: { name: "오두막", cost: { wood: 10, stick: 8, rope: 2 }, work: 6, tech: "hut", cap: 3, radius: 2.3, tier: 2, hp: 120, h: 3.2, use: "home" },
  loghouse: { name: "통나무집", cost: { wood: 22, stone: 6, rope: 2 }, work: 12, tech: "loghouse", cap: 4, radius: 2.9, tier: 3, hp: 200, h: 3.4, use: "home" },
  stonehouse: { name: "돌집", cost: { stone: 28, wood: 8, metal: 2 }, work: 18, tech: "masonry", cap: 5, radius: 3.1, tier: 4, hp: 340, h: 3.8, use: "home" },
  storage: { name: "창고", cost: { wood: 8, stick: 6 }, work: 4, tech: "basket", radius: 1.9, hp: 130, h: 1.6, use: "store" },
  rack: { name: "건조대", cost: { stick: 8, rope: 1 }, work: 2, tech: "drying", radius: 1.3, hp: 50, h: 1.6, use: "food" },
  kiln: { name: "가마", cost: { stone: 10, clay: 6 }, work: 5, tech: "pottery", radius: 1.5, hp: 140, h: 1.4, use: "craft" },
  farm: { name: "밭", cost: { stick: 4 }, work: 2, tech: "agriculture", radius: 2.6, hp: 60, h: 0.3, use: "food" },
  pen: { name: "가축 우리", cost: { wood: 8, stick: 10, rope: 2 }, work: 5, tech: "husbandry", radius: 3.2, hp: 90, h: 0.9, use: "food" },
  well: { name: "우물", cost: { stone: 14, rope: 1 }, work: 8, tech: "well", radius: 1.2, hp: 160, h: 2.1, use: "food" },
  workshop: { name: "작업장", cost: { wood: 14, stone: 6 }, work: 8, tech: "polished", radius: 2.4, hp: 150, h: 2.1, use: "craft" },
  smelter: { name: "용광로", cost: { stone: 18, clay: 8 }, work: 10, tech: "metallurgy", radius: 1.7, hp: 230, h: 2.8, use: "craft" },
  dock: { name: "선착장", cost: { wood: 20, rope: 4 }, work: 12, tech: "boat", radius: 2.8, hp: 170, h: 0.6, use: "sea" },
  library: { name: "서고", cost: { wood: 16, stone: 16 }, work: 16, tech: "writing", radius: 2.8, hp: 320, h: 3.6, use: "civic" },
  windmill: { name: "풍차", cost: { wood: 24, stone: 20, metal: 4 }, work: 20, tech: "windmill", radius: 2.5, hp: 300, h: 5.4, use: "food" },
  observatory: { name: "천문대", cost: { stone: 36, metal: 8, wood: 10 }, work: 26, tech: "astronomy", radius: 3, hp: 400, h: 4, use: "civic" },
  lighthouse: { name: "등대", cost: { stone: 44, metal: 20 }, work: 34, tech: "electricity", radius: 2.4, hp: 480, h: 8.8, use: "sea" },
  grave: { name: "무덤", cost: { stone: 2 }, work: 0.6, radius: 0.8, hp: 40, h: 0.8, use: "misc" },
  raft: { name: "난파 뗏목", cost: {}, work: 0, radius: 1.5, hp: 30, h: 0.4, use: "misc" },
  bench: { name: "쉼터 의자", cost: { wood: 3 }, work: 1.5, tech: "stoneaxe", radius: 1, hp: 30, h: 0.8, use: "misc" },
  infirmary: { name: "요양소", cost: { wood: 6, stick: 8, fiber: 4 }, work: 4, tech: "leanto", cap: 4, radius: 2.2, hp: 90, h: 1.8, use: "care" },
  seawall: { name: "방파제", cost: { stone: 30 }, work: 14, tech: "seawall", radius: 3.4, hp: 650, h: 1.4, use: "sea" },
  banner: { name: "깃발", cost: {}, work: 0, radius: 0.6, hp: 25, h: 3.3, use: "misc" },
  hall: { name: "회관", cost: { wood: 16, stick: 10, rope: 3 }, work: 14, tech: "hut", radius: 3, hp: 340, h: 3.9, use: "civic" },
  shipyard: { name: "조선소", cost: { wood: 40, rope: 10, metal: 10 }, work: 30, tech: "shipbuilding", radius: 3.4, hp: 420, h: 3.2, use: "sea" },
  portal: { name: "차원문", cost: { stone: 40, metal: 40, diamond: 1 }, work: 40, tech: "portal", radius: 2.8, hp: 900, h: 4.4, use: "civic" },
  watchtower: { name: "망루", cost: { wood: 12, stick: 10, rope: 3 }, work: 8, tech: "watchtower", radius: 1.6, hp: 220, h: 2.6, use: "defense" },
  fort: { name: "성루", cost: { stone: 40, wood: 8, metal: 4 }, work: 22, tech: "fortress", radius: 2.6, hp: 720, h: 2.6, use: "defense" },
  battery: { name: "포대", cost: { stone: 30, metal: 16 }, work: 24, tech: "firearm", radius: 2.4, hp: 820, h: 2.4, use: "defense" },
  townhouse: { name: "연립주택", cost: { stone: 34, wood: 14, metal: 3 }, work: 26, tech: "architecture", cap: 8, radius: 3.4, tier: 5, hp: 560, h: 2.4, use: "home" },
  apartment: { name: "아파트", cost: { stone: 40, metal: 24, wood: 6 }, work: 36, tech: "highrise", cap: 14, radius: 3.6, tier: 6, hp: 960, h: 2.4, use: "home" },
  forge: { name: "대장간", cost: { stone: 16, wood: 10, clay: 4 }, work: 10, tech: "metallurgy", radius: 2.2, hp: 260, h: 2.6, use: "craft" },
  factory: { name: "공장", cost: { stone: 30, metal: 20, wood: 10 }, work: 30, tech: "steam", radius: 3.6, hp: 680, h: 3, use: "craft" },
  mine: { name: "광산", cost: { wood: 14, stick: 8, rope: 2 }, work: 10, tech: "mining", radius: 2.2, hp: 260, h: 2.4, use: "mine" },
  shrine: { name: "제단", cost: { stone: 8, wood: 3 }, work: 4, tech: "agriculture", radius: 1.7, hp: 140, h: 2.4, use: "faith" },
  market: { name: "장터", cost: { wood: 8, stick: 6, fiber: 4 }, work: 5, tech: "polished", radius: 2.6, hp: 110, h: 2.2, use: "trade" },
  palace: { name: "왕궁", cost: { stone: 30, wood: 18, metal: 4 }, work: 26, tech: "masonry", radius: 4.2, hp: 760, h: 5.2, use: "rule" },
};

export const HOUSE_TYPES: StructureType[] = ["leanto", "hut", "loghouse", "stonehouse", "townhouse", "apartment"];

/** 층을 쌓는 건물 */
export const STORIED = new Set<StructureType>(["townhouse", "apartment", "watchtower", "fort", "factory"]);
/** 설계 없이 바로 짓는 작은 것들 */
/** 나무로 지어 불이 붙고 바람·지진에 약한 건물 */
export const WOODEN = new Set<StructureType>(["leanto", "hut", "loghouse", "storage", "rack", "workshop", "pen", "dock", "bench", "infirmary", "hall", "farm", "windmill", "shipyard", "watchtower", "mine", "market"]);
export const NO_DESIGN = new Set<StructureType>(["campfire", "grave", "raft", "banner", "farm", "bench", "leanto", "rack", "pen"]);

export interface Recipe {
  id: string;
  out: Res | "furOutfit" | "clothOutfit";
  qty: number;
  name: string;
  tech: string;
  cost: Stock;
  hours: number;
  needs?: StructureType;
}

export const RECIPES: Recipe[] = [
  { id: "handaxe", out: "handaxe", qty: 1, name: "주먹도끼", tech: "knapping", cost: { stone: 2 }, hours: 0.5 },
  { id: "spear", out: "spear", qty: 1, name: "나무 창", tech: "spear", cost: { stick: 2, stone: 1 }, hours: 0.6 },
  { id: "rope", out: "rope", qty: 1, name: "끈", tech: "cordage", cost: { fiber: 3 }, hours: 0.5 },
  { id: "axe", out: "axe", qty: 1, name: "돌도끼", tech: "stoneaxe", cost: { stick: 1, stone: 2, rope: 1 }, hours: 0.8 },
  { id: "basket", out: "basket", qty: 1, name: "바구니", tech: "basket", cost: { fiber: 6 }, hours: 0.8 },
  { id: "rod", out: "rod", qty: 1, name: "낚싯대", tech: "fishing", cost: { stick: 2, rope: 1 }, hours: 0.6 },
  { id: "bow", out: "bow", qty: 1, name: "활", tech: "bow", cost: { stick: 2, rope: 2 }, hours: 1 },
  { id: "hoe", out: "hoe", qty: 1, name: "괭이", tech: "agriculture", cost: { stick: 2, stone: 1, rope: 1 }, hours: 0.7 },
  { id: "pot", out: "pot", qty: 1, name: "토기", tech: "pottery", cost: { clay: 3 }, hours: 1, needs: "kiln" },
  { id: "metal", out: "metal", qty: 1, name: "금속", tech: "metallurgy", cost: { ore: 3, wood: 1 }, hours: 1.5, needs: "smelter" },
  { id: "fur", out: "furOutfit", qty: 1, name: "가죽옷", tech: "clothing", cost: { hide: 3, rope: 1 }, hours: 1.2 },
  { id: "cloth", out: "clothOutfit", qty: 1, name: "옷", tech: "weaving", cost: { fiber: 8 }, hours: 1.5 },
  { id: "net", out: "net", qty: 1, name: "그물", tech: "net", cost: { rope: 3, fiber: 2 }, hours: 1 },
  { id: "herbal", out: "herbal", qty: 1, name: "약초즙", tech: "herbs", cost: { herb: 2 }, hours: 0.4 },
  { id: "remedy", out: "remedy", qty: 2, name: "탕약", tech: "remedy", cost: { herb: 2, root: 1 }, hours: 0.8, needs: "kiln" },
  { id: "medicine", out: "medicine", qty: 2, name: "약", tech: "medicine", cost: { herb: 1, root: 1, mineral: 1 }, hours: 1.2, needs: "workshop" },
  { id: "pickaxe", out: "pickaxe", qty: 1, name: "곡괭이", tech: "mining", cost: { stick: 2, stone: 2, rope: 1 }, hours: 0.8 },
  { id: "bronze", out: "metal", qty: 3, name: "청동", tech: "metallurgy", cost: { copper: 2, tin: 1, wood: 1 }, hours: 1.5, needs: "smelter" },
  { id: "ironbar", out: "metal", qty: 3, name: "무쇠", tech: "iron", cost: { iron: 2, wood: 2 }, hours: 1.6, needs: "smelter" },
  { id: "sword", out: "sword", qty: 1, name: "청동검", tech: "bronzeweapon", cost: { copper: 2, tin: 1, stick: 1 }, hours: 1.4, needs: "forge" },
  { id: "ironsword", out: "ironsword", qty: 1, name: "철창", tech: "ironweapon", cost: { iron: 3, wood: 1 }, hours: 1.6, needs: "forge" },
  { id: "musket", out: "musket", qty: 1, name: "화승총", tech: "firearm", cost: { iron: 3, wood: 2, metal: 1 }, hours: 2, needs: "forge" },
  { id: "rifle", out: "rifle", qty: 1, name: "소총", tech: "rifle", cost: { iron: 2, metal: 2, wood: 1 }, hours: 1.4, needs: "factory" },
  { id: "jewel_s", out: "jewelry", qty: 1, name: "은 장신구", tech: "goldsmith", cost: { silver: 2 }, hours: 1, needs: "forge" },
  { id: "jewel_g", out: "jewelry", qty: 2, name: "금 장신구", tech: "goldsmith", cost: { gold: 1 }, hours: 1, needs: "forge" },
];

/** 맹수와 싸울 때 쓰는 무기 (좋은 것부터) */
export const WEAPONS: { res: Res; name: string; dmg: number; range: number; gun?: boolean }[] = [
  { res: "rifle", name: "소총", dmg: 85, range: 11, gun: true },
  { res: "musket", name: "화승총", dmg: 55, range: 9, gun: true },
  { res: "ironsword", name: "철창", dmg: 34, range: 2 },
  { res: "sword", name: "청동검", dmg: 22, range: 1.7 },
  { res: "bow", name: "활", dmg: 13, range: 8 },
  { res: "spear", name: "나무 창", dmg: 9, range: 2 },
];
export const BARE_HANDS = { res: "" as const, name: "맨손", dmg: 4, range: 1.5 };

/** 광맥: 많이 묻힌 것일수록 흔하고 잘 나온다. 귀한 것일수록 캐내기도 어렵다 */
export const METAL_INFO: Record<Metal, { name: string; veins: number; purity: number; regen: number; color: string }> = {
  iron: { name: "철광석", veins: 9, purity: 0.9, regen: 1, color: "#9c4f34" },
  copper: { name: "구리", veins: 7, purity: 0.82, regen: 1, color: "#c9773a" },
  tin: { name: "주석", veins: 4, purity: 0.66, regen: 0.6, color: "#c9cdd2" },
  silver: { name: "은", veins: 2, purity: 0.4, regen: 0.3, color: "#eef2f7" },
  gold: { name: "금", veins: 1, purity: 0.25, regen: 0.2, color: "#f2c230" },
  diamond: { name: "다이아몬드", veins: 1, purity: 0.08, regen: 0.1, color: "#bfefff" },
};
export const METALS = Object.keys(METAL_INFO) as Metal[];
/** 어느 광맥을 캐든 아주 드물게 섞여 나오는 것 */
export const LUCKY: Partial<Record<Metal, number>> = { silver: 0.02, gold: 0.006, diamond: 0.0015 };

export const FOOD: Partial<Record<Res, number>> = {
  berry: 12,
  fruit: 18,
  crop: 14,
  meat: 20,
  fish: 17,
  cookedMeat: 40,
  cookedFish: 34,
  meal: 55,
};
export const FOODS = Object.keys(FOOD) as Res[];
export const RAW_FOODS: Res[] = ["meat", "fish"];

/** 하루 동안 썩는 비율 (보관 시설이 있으면 줄어듦) */
export const SPOIL: Partial<Record<Res, number>> = {
  berry: 0.18,
  fruit: 0.1,
  meat: 0.35,
  fish: 0.4,
  cookedMeat: 0.15,
  cookedFish: 0.15,
  crop: 0.02,
  meal: 0.1,
};

export const RES_NAME: Record<Res, string> = {
  wood: "통나무", stick: "나뭇가지", stone: "돌", fiber: "섬유", hide: "가죽", clay: "점토",
  ore: "광석", metal: "금속", rope: "끈", herb: "약초", berry: "열매", fruit: "과일",
  meat: "생고기", fish: "생선", cookedMeat: "구운 고기", cookedFish: "구운 생선", crop: "곡식",
  meal: "스튜", handaxe: "주먹도끼", spear: "창", axe: "돌도끼", basket: "바구니", rod: "낚싯대",
  bow: "활", hoe: "괭이", pot: "토기", net: "그물",
  root: "약뿌리", mineral: "약돌", herbal: "약초즙", remedy: "탕약", medicine: "약",
  copper: "구리", tin: "주석", iron: "철광석", silver: "은", gold: "금", diamond: "다이아몬드",
  pickaxe: "곡괭이", sword: "청동검", ironsword: "철창", musket: "화승총", rifle: "소총", jewelry: "장신구",
};

export const TOOLS: Res[] = ["handaxe", "spear", "axe", "basket", "rod", "bow", "hoe", "pot", "net", "pickaxe", "sword", "ironsword", "musket", "rifle"];

/** 약: 몇 단계까지 듣는지, 몇 단계를 낮추는지 */
export const MEDS: { res: Res; upTo: number; drop: number }[] = [
  { res: "herbal", upTo: 2, drop: 1 },
  { res: "remedy", upTo: 4, drop: 1 },
  { res: "medicine", upTo: 5, drop: 3 },
];

export const FISH_INFO: Record<FishKind, { name: string; qty: number; depth: [number, number]; w: number; boat?: boolean }> = {
  fish: { name: "정어리", qty: 1, depth: [0.5, 3.4], w: 34 },
  mackerel: { name: "고등어", qty: 2, depth: [1.2, 4.5], w: 20 },
  flatfish: { name: "넙치", qty: 2, depth: [0.4, 2.0], w: 12 },
  bigfish: { name: "도미", qty: 3, depth: [1.0, 4.0], w: 12 },
  squid: { name: "오징어", qty: 2, depth: [2.0, 6.0], w: 10 },
  tuna: { name: "참치", qty: 6, depth: [4.5, 7.5], w: 6, boat: true },
};

export const ROLE_NAME: Record<Role, string> = {
  leader: "이끄는 사람", farmer: "농부", fisher: "어부", hunter: "사냥꾼", builder: "목수", scholar: "학자",
  crafter: "장인", healer: "치유사", cook: "요리사", sailor: "뱃사람", guard: "지킴이", king: "왕", minister: "대신",
};
export const ROLE_ICON: Record<Role, string> = {
  leader: "🎖️", farmer: "🌾", fisher: "🎣", hunter: "🏹", builder: "🔨", scholar: "📖",
  crafter: "🛠️", healer: "🌿", cook: "🍲", sailor: "⛵", guard: "🛡️", king: "👑", minister: "📜",
};
