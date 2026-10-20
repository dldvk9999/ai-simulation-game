import { pick, RngHolder } from "./rng";

export const NAMES_M = [
  "도윤", "서준", "하준", "은우", "시우", "지호", "예준", "유준", "수호", "이안", "선우", "주원",
  "건우", "태오", "민준", "우진", "지안", "로운", "한결", "다온", "산", "강", "율", "윤호", "태양", "바람",
];
export const NAMES_F = [
  "서아", "하윤", "지아", "하은", "수아", "아린", "지유", "윤슬", "나은", "다은", "소율", "채원",
  "이서", "시아", "예린", "하린", "유나", "온유", "새봄", "가을", "보라", "나래", "별", "솔", "단비", "누리",
];

export function randomName(r: RngHolder, sex: "M" | "F", taken: Set<string>) {
  const pool = (sex === "M" ? NAMES_M : NAMES_F).filter((n) => !taken.has(n));
  if (pool.length) return pick(r, pool);
  return pick(r, sex === "M" ? NAMES_M : NAMES_F) + (taken.size + 1);
}

function hasBatchim(word: string) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

/** 한국어 조사: josa("하늘", "이/가") → "하늘이" */
export function josa(word: string, pair: "이/가" | "은/는" | "을/를" | "과/와" | "아/야" | "으로/로") {
  const [a, b] = pair.split("/");
  if (pair === "으로/로") {
    const c = word.charCodeAt(word.length - 1);
    const jong = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
    return word + (jong === 0 || jong === 8 ? b : a);
  }
  return word + (hasBatchim(word) ? a : b);
}

/** 상황별 혼잣말. {name}, {food}, {tech} 등은 호출부에서 치환 */
export const THOUGHTS: Record<string, string[]> = {
  wake: ["여긴... 어디지?", "살아남아야 해.", "파도 소리... 섬인가?"],
  morning: ["좋은 아침이야.", "오늘도 힘내자.", "햇살이 따뜻하다."],
  hungry: ["배가 고파...", "뭐라도 먹어야겠어.", "꼬르륵..."],
  starving: ["힘이 없어...", "먹을 게 필요해..."],
  thirsty: ["목이 말라...", "물을 찾아야 해."],
  rainDrink: ["빗물이라도 마시자.", "하늘에서 물이 내려온다!"],
  tired: ["졸려...", "조금만 쉬자.", "오늘은 여기까지."],
  sleepOut: ["별이 이불이네.", "땅바닥이 딱딱해..."],
  sleepHome: ["역시 지붕 아래가 최고야.", "포근하다..."],
  cold: ["으... 추워.", "몸이 떨려...", "불이 있으면 좋겠다."],
  warmFire: ["불이 따뜻해.", "타닥타닥, 좋은 소리야."],
  eat: ["맛있다!", "살 것 같아.", "냠냠."],
  eatFav: ["역시 {food}이(가) 최고야!", "{food}! 제일 좋아해."],
  eatRaw: ["날것은 좀 그렇네...", "익혀 먹으면 좋겠는데."],
  rainLike: ["비 냄새가 좋아.", "빗소리가 마음을 차분하게 해."],
  rainDislike: ["비가 그쳤으면...", "온몸이 젖었어."],
  storm: ["천둥이 무서워...", "어서 몸을 피하자!", "하늘이 화가 났나 봐."],
  snow: ["눈이다...!", "하얗게 물들었네.", "손이 시려."],
  clear: ["하늘이 맑다.", "바람이 기분 좋아."],
  sunset: ["노을이 예쁘다.", "오늘 하루도 무사했어."],
  sea: ["파도 소리가 좋아.", "저 바다 너머엔 뭐가 있을까?", "언젠가 집에 갈 수 있을까..."],
  stars: ["저 별들은 무엇일까?", "별이 쏟아질 것 같아.", "별자리가 계절마다 바뀌네."],
  think: ["이걸 이렇게 하면...?", "더 좋은 방법이 있을 거야.", "음... 생각해보자.", "왜 그럴까?"],
  eureka: ["알아냈다! {tech}!", "그래, 이거야! {tech}!", "{tech}... 이렇게 하는 거였어!"],
  buildDone: ["드디어 완성이야!", "제법 근사한데?", "땀 흘린 보람이 있어."],
  lonely: ["누군가 있었으면...", "외로워.", "말할 상대가 그리워."],
  chat: ["오늘 어땠어?", "같이 있어서 좋다.", "그거 알아?", "하하, 정말?"],
  gift: ["어? 이게 어디서...?", "하늘이 주신 선물인가?", "누가 두고 간 거지?"],
  fireSeen: ["뜨거운 빛...! 따뜻해.", "이걸 다룰 수 있다면...", "불... 신기하다."],
  shake: ["바람인가?", "방금 뭐였지?", "누가 있나?"],
  grief: ["{name}... 보고 싶어.", "{name}, 편히 쉬어."],
  birth: ["우리 아기...!", "작은 손이 따뜻해."],
  newcomer: ["사람이다!", "혼자가 아니었어...!", "괜찮아요? 정신 차려요!"],
  fail: ["에잇!", "다시 해보자.", "놓쳤다..."],
  fear: ["무서워...", "조심해야 해."],
  toolBreak: ["도구가 부서졌어...", "새로 만들어야겠네."],
  chop: ["영차!", "조금만 더!"],
  gather: ["이 정도면 되겠지.", "차곡차곡."],
  hunt: ["조용히...", "저기 있다."],
  fish: ["물고기야, 와라...", "입질이 올까?"],
  build: ["뚝딱뚝딱.", "튼튼하게 짓자."],
  farm: ["잘 자라렴.", "흙 냄새가 좋다."],
  play: ["까르르!", "잡아봐라~"],
  happy: ["행복해.", "오늘은 좋은 날이야.", "콧노래가 나오네."],
  sad: ["왠지 우울해...", "하아..."],
  angry: ["짜증 나!", "왜 이렇게 안 되지?"],
  love: ["{name}, 고마워.", "{name}와(과) 함께라서 다행이야."],
  craft: ["톡, 톡... 조심조심.", "모양이 나오기 시작했어."],
  cook: ["좋은 냄새!", "골고루 익히자."],
  mourn: ["잊지 않을게."],
  sick: ["몸이 안 좋아...", "조금 쉬어야겠어."],
};

export function thought(r: RngHolder, key: string, vars: Record<string, string> = {}) {
  const list = THOUGHTS[key];
  if (!list) return "";
  let s = pick(r, list);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(`{${k}}이(가)`, josa(v, "이/가")).replace(`{${k}}와(과)`, josa(v, "과/와")).replaceAll(`{${k}}`, v);
  }
  return s;
}

export const EMOJI: Record<string, string> = {
  joy: "😊", sadness: "😢", fear: "😨", anger: "😠", surprise: "😲", love: "🥰", calm: "😌",
  sleep: "💤", think: "🤔", eureka: "💡", hungry: "🍖", thirsty: "💧", cold: "🥶", chat: "💬",
  music: "🎵", gift: "🎁", fire: "🔥", work: "💪", baby: "👶", grief: "🕯️", sick: "🤒",
};
