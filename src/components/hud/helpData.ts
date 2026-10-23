// 도움말: 카테고리마다 기능 하나씩 넘겨 본다. 그림은 public/help/<id>.webp (실제 게임 화면)
import { GROUP_POP, MAX_VIEWERS } from "@/sim/constants";

export interface HelpItem {
  id: string;
  icon: string;
  title: string;
  body: string;
  /** 터치 기기에서는 이 설명을 대신 보여 준다 */
  touch?: string;
}

export interface HelpCat {
  id: string;
  icon: string;
  name: string;
  items: HelpItem[];
}

export const HELP: HelpCat[] = [
  {
    id: "hand",
    icon: "🖐️",
    name: "손길",
    items: [
      { id: "hit", icon: "👆", title: "치기", body: "나무·바위·동물을 누르세요. 열매나 돌이 떨어지고, 동물은 잠깐 기절해요.", touch: "나무·바위·동물을 톡 누르세요. 열매나 돌이 떨어지고, 동물은 잠깐 기절해요." },
      { id: "drag", icon: "✋", title: "옮기기", body: "물건이나 동물을 끌어다 놓아요. 사람 앞에 두면 선물로 알고 반가워해요." },
      { id: "ignite", icon: "🔥", title: "불 지피기", body: "같은 자리를 빠르게 5번 누르면 불이 붙어요. 나무 건물 바로 옆이면 불이 옮겨붙을 수 있어요." },
      { id: "smash", icon: "🔨", title: "건물 두드리기", body: "건물을 빠르게 3번 누르면 내구도가 깎여요. 0이 되면 무너지고, 사람들의 사기가 꺾여요." },
      { id: "camera", icon: "🎥", title: "둘러보기", body: "빈 곳을 끌면 회전, 우클릭·Shift로 끌면 이동, 휠로 확대해요. 사람을 두 번 누르면 따라가요.", touch: "한 손가락으로 끌면 회전, 두 손가락으로 끌면 이동, 벌리고 오므리면 확대예요. 사람을 두 번 누르면 따라가요." },
    ],
  },
  {
    id: "people",
    icon: "👪",
    name: "사람",
    items: [
      { id: "mind", icon: "💭", title: "마음 보기", body: "사람을 누르면 기분·욕구·성격이 보여요. 사람은 직접 건드릴 수 없어요." },
      { id: "baby", icon: "👶", title: "어린이 · 0~2살", body: "열 살 전의 아이는 부모의 손길로 자라요. 0~2살은 걷지 못해 품에 안겨 다니고, 말 대신 옹알이를 해요. 배고프거나 혼자 남으면 울고, 부모는 젖을 먹이고 달래요." },
      { id: "kid", icon: "🧒", title: "어린이 · 3~9살", body: "세 살부터 걷고 말해요. 부모 곁에서만 놀고, 놀아 달라 조르고, 떼쓰고, 울다가 지나치면 혼나요. 일곱 살부터는 생각이 자라 일을 거들어요." },
      { id: "sick", icon: "🤧", title: "감기와 약", body: "춥거나 비를 맞으면 감기에 걸려요. 심해지면 요양소에서 쉬고, 약초로 약을 지어 먹어요." },
      { id: "morale", icon: "💪", title: "사기", body: "아기가 태어나거나 맹수를 물리치면 오르고, 집이 무너지거나 사람이 다치면 꺾여요. 사기가 높으면 일이 빨라요." },
      { id: "groups", icon: "🏳️", title: "무리와 문명", body: `${GROUP_POP}명이 넘으면 뜻이 맞는 사람끼리 무리를 이뤄요. 뜻이 너무 다르면 다투다 갈라서기도 해요.` },
    ],
  },
  {
    id: "island",
    icon: "🏝️",
    name: "섬",
    items: [
      { id: "time", icon: "⏳", title: "시간", body: "섬의 하루는 현실 20분이에요. 창을 닫아도 시간은 흐르고, 다시 오면 그동안의 일을 알려 줘요." },
      { id: "veins", icon: "⛏️", title: "광맥", body: "바깥쪽 바위 언덕에서 철·구리·주석을 캐요. 은·금·다이아몬드는 아주 드물어요." },
      { id: "beast", icon: "🐺", title: "맹수", body: "가끔 맹수가 사람을 노려요. 오래 살수록 늑대 → 곰 → 호랑이 → 검치호로 세지고, 사람들은 그 시대의 무기로 맞서요." },
      { id: "disaster", icon: "🌀", title: "재해", body: "아주 드물게 지진·태풍·쓰나미가 와요. 함께 고치고, 다음 재해에 대비할 방법을 궁리해요." },
    ],
  },
  {
    id: "fire",
    icon: "🔥",
    name: "불",
    items: [
      { id: "wildfire", icon: "⚡", title: "번개와 산불", body: "폭풍 속 번개가 드물게 땅에 떨어지면 불길이 일어요. 그 자리에 있던 동물은 피하지 못해요." },
      { id: "douse", icon: "🪣", title: "불 끄기", body: "불이 나면 사람들이 우물·연못·바다에서 물을 퍼 날라 꺼요. 비가 오면 불길이 잦아들어요." },
      { id: "fireproof", icon: "🧱", title: "불에 강한 집", body: "청동기 시대에 불을 겪고 나면 기와 지붕과 흙벽으로, 불이 잘 붙지 않는 집을 지어요." },
    ],
  },
  {
    id: "growth",
    icon: "🏛️",
    name: "발전",
    items: [
      { id: "tech", icon: "💡", title: "시대와 지식", body: "생각하고 겪으며 지식을 터득해요. 뗀석기 → 간석기 → 청동기 → 철기 → 과학 시대로, 천천히 나아가요." },
      { id: "build", icon: "🏗️", title: "건물", body: "쓸모에 맞게 설계해서 지어요. 시대가 지날수록 더 높고 반듯하게 지어요." },
      { id: "voyage", icon: "⛵", title: "섬 밖으로", body: "과학 시대가 되면 큰 배나 차원문을 만들어 섬 밖 세상에 다녀와요." },
    ],
  },
  {
    id: "together",
    icon: "👁️",
    name: "함께",
    items: [
      { id: "viewers", icon: "👁️", title: "함께 지켜보기", body: `같은 시드를 입력하면 최대 ${MAX_VIEWERS}명이 같은 섬을 함께 지켜봐요.` },
      { id: "app", icon: "📥", title: "앱으로 설치", body: "📥 앱 다운로드를 누르면 홈 화면에 설치돼요. 이미 설치했다면 버튼이 보이지 않아요." },
    ],
  },
];
