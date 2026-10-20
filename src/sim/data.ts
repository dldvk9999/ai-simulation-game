import type { Res, Stock, StructureType } from "./types";

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

  { id: "polished", name: "간석기", era: 1, cost: 300, prereq: ["stoneaxe"], desc: "돌을 갈아 오래 쓰는 도구를 만든다.", evidence: "workshop" },
  { id: "hut", name: "오두막", era: 1, cost: 300, prereq: ["stoneaxe", "leanto"], desc: "통나무 기둥과 지붕을 갖춘 집.", evidence: "hut" },
  { id: "fishing", name: "낚시 도구", era: 1, cost: 260, prereq: ["cordage", "spear"], desc: "낚싯대로 물고기를 낚는다.", evidence: "rod" },
  { id: "bow", name: "활과 화살", era: 1, cost: 350, prereq: ["cordage", "spear"], desc: "멀리서 사냥감을 맞힌다.", evidence: "bow" },
  { id: "drying", name: "훈제와 건조", era: 1, cost: 250, prereq: ["cooking", "cordage"], desc: "음식을 말려 오래 보관한다.", evidence: "rack" },
  { id: "pottery", name: "토기", era: 1, cost: 380, prereq: ["fire", "polished"], desc: "흙을 구워 그릇을 만든다.", evidence: "kiln" },
  { id: "agriculture", name: "농경", era: 1, cost: 500, prereq: ["polished", "basket"], desc: "씨앗을 심고 거둔다.", evidence: "farm" },
  { id: "husbandry", name: "목축", era: 1, cost: 450, prereq: ["agriculture", "cordage"], desc: "짐승을 길들여 기른다.", evidence: "pen" },
  { id: "weaving", name: "직조", era: 1, cost: 420, prereq: ["agriculture"], desc: "실을 엮어 옷감을 짠다." },

  { id: "loghouse", name: "통나무집", era: 2, cost: 600, prereq: ["hut", "polished"], desc: "넓고 따뜻한 통나무집.", evidence: "loghouse" },
  { id: "well", name: "우물", era: 2, cost: 550, prereq: ["pottery"], desc: "마을 가운데에서 물을 긷는다.", evidence: "well" },
  { id: "metallurgy", name: "청동 야금", era: 2, cost: 900, prereq: ["pottery"], desc: "광석을 녹여 금속을 얻는다.", evidence: "smelter" },
  { id: "wheel", name: "바퀴", era: 2, cost: 700, prereq: ["loghouse"], desc: "수레로 무거운 짐을 나른다." },
  { id: "writing", name: "문자", era: 2, cost: 1000, prereq: ["pottery", "agriculture"], desc: "지식을 기록해 후대에 남긴다.", evidence: "library" },
  { id: "boat", name: "배", era: 2, cost: 800, prereq: ["loghouse", "cordage"], desc: "먼 바다에서 고기를 잡는다.", evidence: "dock" },

  { id: "iron", name: "철기", era: 3, cost: 1500, prereq: ["metallurgy"], desc: "단단한 철로 도구를 만든다." },
  { id: "masonry", name: "석조 건축", era: 3, cost: 1400, prereq: ["iron", "wheel"], desc: "돌을 다듬어 튼튼한 집을 짓는다.", evidence: "stonehouse" },
  { id: "medicine", name: "약초학", era: 3, cost: 1200, prereq: ["writing"], desc: "약초로 병과 상처를 다스린다." },
  { id: "mathematics", name: "수학", era: 3, cost: 1600, prereq: ["writing"], desc: "수와 도형으로 세상을 잰다." },
  { id: "windmill", name: "풍차", era: 3, cost: 2000, prereq: ["wheel", "masonry"], desc: "바람의 힘으로 곡식을 빻는다.", evidence: "windmill" },

  { id: "astronomy", name: "천문학", era: 4, cost: 2400, prereq: ["mathematics"], desc: "별의 움직임으로 계절을 읽는다.", evidence: "observatory" },
  { id: "science", name: "과학적 방법", era: 4, cost: 3200, prereq: ["astronomy", "medicine"], desc: "관찰하고 실험해 진리를 찾는다." },
  { id: "steam", name: "증기 기관", era: 4, cost: 4000, prereq: ["science", "iron"], desc: "끓는 물의 힘으로 기계를 움직인다." },
  { id: "electricity", name: "전기", era: 4, cost: 5200, prereq: ["steam"], desc: "밤을 밝히는 빛을 만든다.", evidence: "lighthouse" },
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
}

export const STRUCTS: Record<StructureType, StructDef> = {
  campfire: { name: "모닥불", cost: { stone: 3, stick: 2 }, work: 0.3, tech: "fire", radius: 0.9 },
  leanto: { name: "움막", cost: { stick: 10, fiber: 4 }, work: 2.5, tech: "leanto", cap: 2, radius: 1.8, tier: 1 },
  hut: { name: "오두막", cost: { wood: 10, stick: 8, rope: 2 }, work: 6, tech: "hut", cap: 3, radius: 2.3, tier: 2 },
  loghouse: { name: "통나무집", cost: { wood: 22, stone: 6, rope: 2 }, work: 12, tech: "loghouse", cap: 4, radius: 2.9, tier: 3 },
  stonehouse: { name: "돌집", cost: { stone: 28, wood: 8, metal: 2 }, work: 18, tech: "masonry", cap: 5, radius: 3.1, tier: 4 },
  storage: { name: "창고", cost: { wood: 8, stick: 6 }, work: 4, tech: "basket", radius: 1.9 },
  rack: { name: "건조대", cost: { stick: 8, rope: 1 }, work: 2, tech: "drying", radius: 1.3 },
  kiln: { name: "가마", cost: { stone: 10, clay: 6 }, work: 5, tech: "pottery", radius: 1.5 },
  farm: { name: "밭", cost: { stick: 4 }, work: 2, tech: "agriculture", radius: 2.6 },
  pen: { name: "가축 우리", cost: { wood: 8, stick: 10, rope: 2 }, work: 5, tech: "husbandry", radius: 3.2 },
  well: { name: "우물", cost: { stone: 14, rope: 1 }, work: 8, tech: "well", radius: 1.2 },
  workshop: { name: "작업장", cost: { wood: 14, stone: 6 }, work: 8, tech: "polished", radius: 2.4 },
  smelter: { name: "용광로", cost: { stone: 18, clay: 8 }, work: 10, tech: "metallurgy", radius: 1.7 },
  dock: { name: "선착장", cost: { wood: 20, rope: 4 }, work: 12, tech: "boat", radius: 2.8 },
  library: { name: "서고", cost: { wood: 16, stone: 16 }, work: 16, tech: "writing", radius: 2.8 },
  windmill: { name: "풍차", cost: { wood: 24, stone: 20, metal: 4 }, work: 20, tech: "windmill", radius: 2.5 },
  observatory: { name: "천문대", cost: { stone: 36, metal: 8, wood: 10 }, work: 26, tech: "astronomy", radius: 3 },
  lighthouse: { name: "등대", cost: { stone: 44, metal: 20 }, work: 34, tech: "electricity", radius: 2.4 },
  grave: { name: "무덤", cost: { stone: 2 }, work: 0.6, radius: 0.8 },
  raft: { name: "난파 뗏목", cost: {}, work: 0, radius: 1.5 },
  bench: { name: "쉼터 의자", cost: { wood: 3 }, work: 1.5, tech: "stoneaxe", radius: 1 },
};

export const HOUSE_TYPES: StructureType[] = ["leanto", "hut", "loghouse", "stonehouse"];

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
];

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
  bow: "활", hoe: "괭이", pot: "토기",
};

export const TOOLS: Res[] = ["handaxe", "spear", "axe", "basket", "rod", "bow", "hoe", "pot"];
