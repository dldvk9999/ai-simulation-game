// 행동을 만드는 작은 도구 (ai.ts · 육아 · 불 끄기가 함께 쓴다)
import type { Act, ActKind, Person, WorldState } from "./types";

export function act(w: WorldState, k: ActKind, x: number, z: number, t: number, extra: Partial<Act> = {}): Act {
  return { k, ph: 0, tx: x, tz: z, t, started: w.time, ...extra };
}

/** 같은 장소에 겹쳐 서지 않도록 사람마다 조금씩 다른 자리 */
export function spot(p: Person, x: number, z: number, r = 1.4) {
  const a = (p.id * 2.399) % (Math.PI * 2);
  return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
}
