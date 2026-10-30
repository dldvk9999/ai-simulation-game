// 같은 섬을 보는 관찰자들(최대 3명) 사이의 실시간 통신.
// Supabase가 설정되어 있으면 Realtime(Broadcast + Presence), 아니면 같은 브라우저 탭끼리 BroadcastChannel.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export interface Member {
  id: string;
  joinedAt: number;
}

export interface Envelope {
  t: string;
  from: string;
  to?: string;
  d?: unknown;
}

export interface Transport {
  connect(): Promise<void>;
  send(t: string, d?: unknown, to?: string): void;
  close(): void;
  onMessage: (m: Envelope) => void;
  onPresence: (members: Member[]) => void;
}

export class LocalTransport implements Transport {
  onMessage: (m: Envelope) => void = () => {};
  onPresence: (members: Member[]) => void = () => {};
  private bc: BroadcastChannel;
  private members = new Map<string, { joinedAt: number; seen: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private worldId: string, private me: string, private joinedAt: number) {
    this.bc = new BroadcastChannel(`island-${worldId}`);
  }

  async connect() {
    this.bc.onmessage = (ev: MessageEvent<Envelope>) => {
      const m = ev.data;
      if (!m || m.from === this.me) return;
      if (m.t === "_hb") {
        const known = this.members.has(m.from);
        this.members.set(m.from, { joinedAt: (m.d as { joinedAt: number }).joinedAt, seen: Date.now() });
        if (!known) this.emitPresence();
        return;
      }
      if (m.t === "_bye") {
        this.members.delete(m.from);
        this.emitPresence();
        return;
      }
      if (m.to && m.to !== this.me) return;
      this.onMessage(m);
    };
    this.members.set(this.me, { joinedAt: this.joinedAt, seen: Date.now() });
    const beat = () => {
      this.bc.postMessage({ t: "_hb", from: this.me, d: { joinedAt: this.joinedAt } });
      const cut = Date.now() - 5000;
      let changed = false;
      for (const [id, v] of this.members) {
        if (id !== this.me && v.seen < cut) {
          this.members.delete(id);
          changed = true;
        }
      }
      if (changed) this.emitPresence();
    };
    beat();
    this.timer = setInterval(beat, 1500);
    this.emitPresence();
  }

  private emitPresence() {
    this.onPresence([...this.members].map(([id, v]) => ({ id, joinedAt: v.joinedAt })));
  }

  send(t: string, d?: unknown, to?: string) {
    this.bc.postMessage({ t, from: this.me, to, d } satisfies Envelope);
  }

  close() {
    try {
      this.bc.postMessage({ t: "_bye", from: this.me });
    } catch {}
    if (this.timer) clearInterval(this.timer);
    this.bc.close();
  }
}

export class SupabaseTransport implements Transport {
  onMessage: (m: Envelope) => void = () => {};
  onPresence: (members: Member[]) => void = () => {};
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;

  constructor(
    private cfg: { url: string; key: string },
    private worldId: string,
    private me: string,
    private joinedAt: number,
  ) {}

  async connect() {
    const { createClient } = await import("@supabase/supabase-js");
    this.client = createClient(this.cfg.url, this.cfg.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const ch = this.client.channel(`island-${this.worldId}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.me } },
    });
    this.channel = ch;
    ch.on("broadcast", { event: "m" }, ({ payload }) => {
      const m = payload as Envelope;
      if (!m || m.from === this.me) return;
      if (m.to && m.to !== this.me) return;
      this.onMessage(m);
    });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState<{ joinedAt: number }>();
      const list: Member[] = Object.entries(st).map(([id, metas]) => ({ id, joinedAt: metas[0]?.joinedAt ?? Date.now() }));
      if (!list.some((m) => m.id === this.me)) list.push({ id: this.me, joinedAt: this.joinedAt });
      this.onPresence(list);
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("realtime timeout")), 10000);
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          await ch.track({ joinedAt: this.joinedAt });
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`realtime ${status}`));
        }
      });
    });
  }

  send(t: string, d?: unknown, to?: string) {
    void this.channel?.send({ type: "broadcast", event: "m", payload: { t, from: this.me, to, d } satisfies Envelope });
  }

  close() {
    if (this.channel) {
      void this.channel.untrack();
      void this.client?.removeChannel(this.channel);
    }
    this.channel = null;
  }
}

// ─── 압축 ──────────────────────────────────────────────────────────────

const hasCompression = () => typeof CompressionStream !== "undefined";

export async function gzipBytes(text: string): Promise<Uint8Array | null> {
  if (!hasCompression()) return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function toB64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 식물의 0인 값(그루터기·불·열매·다시 자랄 때)은 빼고 보낸다: 불러올 때 0으로 채운다 */
const PLANT_ZERO = new Set(["stump", "regrow", "burn", "fruit"]);
/** 식물의 방향·크기는 번호에서 다시 계산한다 (plantLook) */
const PLANT_LOOK = new Set(["rot", "s"]);
/** 욕구는 0..100이라 정수로 충분하다 */
const NEED_KEYS = new Set(["hunger", "thirst", "energy", "warmth", "social", "fun"]);
/** 식물 · 바위 · 짐승 · 물고기의 자리와 방향은 10cm 단위로 */
const COARSE = new Set(["x", "z", "tx", "tz", "rot", "s"]);
const coarse = (o: object) => "kind" in o && ("regrow" in o || "amt" in o || "tame" in o || "dies" in o);
/** 소수는 둘째 자리까지만: 위치·욕구·감정 값에는 충분하고 저장·전송 크기가 절반으로 준다. 시각·돈처럼 큰 수는 정수로 */
export function compact(this: unknown, k: string, v: unknown) {
  if ((PLANT_LOOK.has(k) || (v === 0 && PLANT_ZERO.has(k))) && this && typeof this === "object" && "regrow" in this && "kind" in this) return undefined;
  // 말풍선은 몇 초뿐이라 저장하지 않는다 (움직임과 함께 따로 보낸다)
  if (k === "bubble") return undefined;
  if (typeof v !== "number" || Number.isInteger(v)) return v;
  if (Math.abs(v) >= 1000) return Math.round(v);
  if (NEED_KEYS.has(k)) return Math.round(v);
  if (COARSE.has(k) && this && typeof this === "object" && coarse(this)) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

/** 큰 상태를 Realtime 메시지로 보내기 위해 gzip+base64 */
export async function pack(obj: unknown): Promise<{ z?: string; j?: string }> {
  const text = JSON.stringify(obj, compact);
  const gz = await gzipBytes(text);
  return gz ? { z: toB64(gz) } : { j: text };
}

export async function unpack<T>(p: { z?: string; j?: string }): Promise<T> {
  if (p.z) return JSON.parse(await gunzipText(fromB64(p.z))) as T;
  return JSON.parse(p.j ?? "null") as T;
}
