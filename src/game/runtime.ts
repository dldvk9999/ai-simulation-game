// 브라우저 쪽 게임 런타임: 시뮬레이션 루프, 호스트 선출, 동기화, 저장.
import { actLabel } from "@/sim/ai";
import { ageYears, clockLabel, dayOf, seasonOf, SEASONS, timeOfDayLabel, yearOf } from "@/sim/clock";
import { MAX_VIEWERS, SCHEMA_VERSION, SIM_TICK_MS, TIME_SCALE } from "@/sim/constants";
import { ERAS, RES_NAME, TECH_BY_ID } from "@/sim/data";
import { applyInteraction, releaseHeld } from "@/sim/interactions";
import { dominant, mood } from "@/sim/people";
import { hashString } from "@/sim/rng";
import { currentEra } from "@/sim/settlement";
import { advance, step } from "@/sim/step";
import { getTerrain, Terrain } from "@/sim/terrain";
import { EMOJI } from "@/sim/text";
import type { Act, Anim, Fx, Interaction, Person, Res, WorldState } from "@/sim/types";
import { createWorld, findById } from "@/sim/world";
import { useHud, type PersonDetail, type PersonSummary } from "./hud";
import { Envelope, gzipBytes, LocalTransport, Member, pack, SupabaseTransport, Transport, unpack } from "./net";

export interface JoinResponse {
  worldId: string;
  viewerId: string;
  state: WorldState | null;
  savedAt: number | null;
  now: number;
  viewers: number;
  storage: string;
  realtime: { url: string; key: string } | null;
}

type PersonDyn = {
  i: number; x: number; z: number; r: number; a: Anim; g: string | 0; b: [string, string, number] | 0;
  c: Res | 0; k: string; ph: number; s?: string; rs?: string; l: number;
  n?: number[]; e?: number[]; hp?: number; o?: string;
};

interface Dyn {
  t: number;
  rev: number;
  w: WorldState["weather"];
  st: WorldState["stock"];
  tech: WorldState["tech"];
  p: PersonDyn[];
  a: [number, number, number, number, string, string | 0][];
  f: [number, number, number, number, string, string | 0][];
  i: [number, number, number, string | 0][];
  fx: Fx[];
}

const NEED_KEYS = ["hunger", "thirst", "energy", "warmth", "social", "fun"] as const;
const EMO_KEYS = ["joy", "sadness", "fear", "anger", "surprise", "love"] as const;

const TRAIT_LABEL: Record<string, [string, string]> = {
  openness: ["호기심 많음", "신중함"],
  conscientiousness: ["성실함", "느긋함"],
  extraversion: ["외향적", "내향적"],
  agreeableness: ["다정함", "고집 셈"],
  neuroticism: ["예민함", "침착함"],
};
export const EMO_LABEL: Record<string, string> = {
  joy: "기쁨", sadness: "슬픔", fear: "두려움", anger: "화남", surprise: "놀람", love: "애정", calm: "평온",
};
const LEISURE_LABEL: Record<string, string> = { sea: "바다 바라보기", sing: "노래", stars: "별 보기", draw: "모래 그림", swim: "수영" };
const WEATHER_LIKE: Record<string, string> = { clear: "맑은 날", rain: "비 오는 날", snow: "눈 오는 날", cloudy: "흐린 날", storm: "폭풍" };
const SKILL_LABEL: Record<string, string> = {
  gather: "채집", hunt: "사냥", fish: "낚시", build: "건축", craft: "손재주", think: "사색", farm: "농사", cook: "요리", fire: "불 다루기",
};
const TOAST_KINDS = new Set(["discover", "era", "birth", "death", "arrive", "couple", "build", "gift"]);

/** 이전 버전 저장본도 읽을 수 있게 빠진 필드를 채운다 */
export function normalizeWorld(raw: WorldState): WorldState {
  const w = raw;
  w.v = SCHEMA_VERSION;
  w.fx = [];
  for (const a of w.animals) a.held = null;
  for (const f of w.fish) f.held = null;
  for (const it of w.items) it.held = null;
  w.timers ??= { castaway: 0, fish: 0, day: dayOf(w.time), strike: 0, animals: 0 };
  return w;
}

export const seedOf = (worldId: string) => parseInt(worldId.slice(0, 8), 16) ^ hashString(worldId);

export class GameRuntime {
  world: WorldState | null = null;
  terrain: Terrain;
  readonly worldId: string;
  readonly viewerId: string;
  readonly joinedAt: number;
  isHost = false;
  members: Member[] = [];
  /** 렌더러가 목록을 다시 만들어야 하는지 판단하는 버전 */
  version = 0;
  /** 내가 끌고 있는 것 (화면에 즉시 반영) */
  dragLocal: { k: "item" | "animal" | "fish"; id: number; x: number; z: number } | null = null;
  /** 화면에서만 보이는 즉각적인 반응 (클릭 등) */
  localFx: { type: string; x: number; z: number }[] = [];

  private transport: Transport;
  private timers: ReturnType<typeof setInterval>[] = [];
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private lastReal = 0;
  private lastRev = -1;
  private lastFullRev = -1;
  private lastFullAt = 0;
  private lastFxSent = 0;
  private dynCount = 0;
  private pendingHellos = new Set<string>();
  private catchingUp = false;
  private disposed = false;
  private lastChron = 0;
  private toastId = 0;
  private savedOnce = false;
  private join: JoinResponse;
  private joinPerf: number;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(join: JoinResponse) {
    this.join = join;
    this.joinPerf = performance.now();
    this.worldId = join.worldId;
    this.viewerId = join.viewerId;
    this.joinedAt = join.now;
    this.terrain = getTerrain(join.state?.seed ?? seedOf(join.worldId));
    this.transport = join.realtime
      ? new SupabaseTransport(join.realtime, this.worldId, this.viewerId, this.joinedAt)
      : new LocalTransport(this.worldId, this.viewerId, this.joinedAt);
    useHud.setState({ storage: join.storage, viewers: join.viewers, offline: !join.realtime });
  }

  // ─── 시작 ────────────────────────────────────────────────────────────

  async start() {
    this.transport.onMessage = (m) => this.onMessage(m);
    this.transport.onPresence = (list) => this.onPresence(list);
    try {
      await this.transport.connect();
    } catch (e) {
      console.warn("실시간 연결 실패, 혼자 관찰합니다", e);
      this.transport = new LocalTransport(this.worldId, this.viewerId, this.joinedAt);
      this.transport.onMessage = (m) => this.onMessage(m);
      this.transport.onPresence = (list) => this.onPresence(list);
      await this.transport.connect();
      useHud.setState({ offline: true });
    }
    await new Promise((r) => setTimeout(r, 900));
    if (this.disposed) return;
    const others = this.members.filter((m) => m.id !== this.viewerId);
    if (others.length && this.electedHost() !== this.viewerId) {
      this.requestSync();
    } else {
      await this.hostFromSave(this.join.state, this.join.savedAt, this.join.now, this.joinPerf);
    }
    void this.heartbeat();
    this.timers.push(setInterval(() => this.heartbeat(), 15000));
    this.timers.push(setInterval(() => this.pushHud(), 250));
    this.timers.push(setInterval(() => this.rememberSeen(), 10000));
  }

  private electedHost() {
    const list = [...this.members].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    return list[0]?.id ?? this.viewerId;
  }

  private requestSync() {
    useHud.setState({ phase: this.world ? "running" : "syncing" });
    this.transport.send("hello");
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      if (!this.isHost && !this.disposed && !this.world) this.requestSync();
    }, 4000);
  }

  private async hostFromSave(state: WorldState | null, savedAt: number | null, serverNow: number, perfAt: number) {
    const lastSeen = this.loadSeen();
    let w: WorldState;
    let elapsedMs = 0;
    if (state) {
      w = normalizeWorld(state);
      elapsedMs = savedAt ? serverNow - savedAt + (performance.now() - perfAt) : 0;
    } else {
      w = createWorld(seedOf(this.worldId), serverNow);
    }
    this.terrain = getTerrain(w.seed);
    const gameSec = Math.max(0, (elapsedMs / 1000) * TIME_SCALE);
    if (gameSec > 60) {
      this.catchingUp = true;
      useHud.setState({ phase: "catchup", catchup: { done: 0, total: gameSec } });
      await advance(w, gameSec, (done, total) => useHud.setState({ catchup: { done, total } }));
      this.catchingUp = false;
    }
    if (this.disposed) return;
    this.world = w;
    this.lastChron = w.chronicle.length;
    this.bumpVersion();
    // 자리를 비운 사이의 이야기
    if (lastSeen != null && w.time - lastSeen > 3600) {
      const entries = w.chronicle.filter((c) => c.t > lastSeen && c.k !== "weather" && c.k !== "season");
      if (entries.length) useHud.setState({ away: { entries, days: (w.time - lastSeen) / 86400 } });
    }
    this.becomeHost();
    void this.save();
  }

  private becomeHost() {
    if (this.isHost || !this.world) return;
    this.isHost = true;
    this.lastReal = performance.now();
    this.simTimer = setInterval(() => this.tick(), SIM_TICK_MS);
    this.timers.push(setInterval(() => this.isHost && void this.save(), 15000));
    this.timers.push(setInterval(() => this.broadcast(), 300));
    useHud.setState({ phase: "running", isHost: true });
    for (const id of this.pendingHellos) void this.sendFull(id);
    this.pendingHellos.clear();
  }

  private demote() {
    if (!this.isHost) return;
    this.isHost = false;
    if (this.simTimer) clearInterval(this.simTimer);
    this.simTimer = null;
    useHud.setState({ isHost: false });
    this.requestSync();
  }

  // ─── 호스트 루프 ─────────────────────────────────────────────────────

  private tick() {
    const w = this.world;
    if (!w || !this.isHost) return;
    const now = performance.now();
    const dtReal = Math.min(now - this.lastReal, 10 * 60 * 1000) / 1000;
    this.lastReal = now;
    let dt = dtReal * TIME_SCALE;
    while (dt > 0) {
      const d = Math.min(dt, 36);
      step(w, d);
      dt -= d;
    }
    if (w.rev !== this.lastRev) this.bumpVersion();
  }

  private bumpVersion() {
    this.version++;
    if (this.world) this.lastRev = this.world.rev;
  }

  private broadcast() {
    const w = this.world;
    if (!w || !this.isHost || this.members.length < 2) return;
    const now = performance.now();
    if ((w.rev !== this.lastFullRev && now - this.lastFullAt > 1200) || now - this.lastFullAt > 6000) {
      void this.sendFull();
      return;
    }
    this.transport.send("dyn", this.packDyn(++this.dynCount % 4 === 0));
  }

  private async sendFull(to?: string) {
    const w = this.world;
    if (!w) return;
    this.lastFullRev = w.rev;
    this.lastFullAt = performance.now();
    const snapshot = { ...w, fx: [] };
    this.transport.send("full", await pack(snapshot), to);
  }

  private packDyn(detail: boolean): Dyn {
    const w = this.world!;
    const r1 = (v: number) => Math.round(v * 100) / 100;
    const fx = w.fx.filter((f) => f.id > this.lastFxSent);
    if (fx.length) this.lastFxSent = fx[fx.length - 1].id;
    return {
      t: w.time,
      rev: w.rev,
      w: w.weather,
      st: w.stock,
      tech: w.tech,
      p: w.people.map((p) => {
        const d: PersonDyn = {
          i: p.id, x: r1(p.x), z: r1(p.z), r: r1(p.rot), a: p.anim, g: p.gesture ?? 0,
          b: p.bubble ? [p.bubble.text, p.bubble.emoji, p.bubble.until] : 0,
          c: p.carry?.res ?? 0, k: p.act?.k ?? "", ph: p.act?.ph ?? 0, s: p.act?.sub, rs: p.act?.res, l: p.alive,
        };
        if (detail) {
          d.n = NEED_KEYS.map((k) => Math.round(p.needs[k]));
          d.e = EMO_KEYS.map((k) => Math.round(p.emo[k] * 100));
          d.hp = Math.round(p.health);
          d.o = p.outfit;
        }
        return d;
      }),
      a: w.animals.map((a) => [a.id, r1(a.x), r1(a.z), r1(a.rot), a.st, a.held ?? 0]),
      f: w.fish.map((f) => [f.id, r1(f.x), r1(f.z), r1(f.rot), f.st, f.held ?? 0]),
      i: w.items.filter((i) => i.held).map((i) => [i.id, r1(i.x), r1(i.z), i.held ?? 0]),
      fx,
    };
  }

  private applyDyn(d: Dyn) {
    const w = this.world;
    if (!w) return;
    w.time = d.t;
    w.weather = d.w;
    w.stock = d.st;
    w.tech = d.tech;
    let unknown = false;
    for (const q of d.p) {
      const p = findById(w.people, q.i);
      if (!p) {
        unknown = true;
        continue;
      }
      p.x = q.x;
      p.z = q.z;
      p.rot = q.r;
      p.anim = q.a;
      p.gesture = (q.g || null) as Person["gesture"];
      p.bubble = q.b ? { text: q.b[0], emoji: q.b[1], until: q.b[2] } : null;
      p.carry = q.c ? { res: q.c, qty: 1 } : null;
      p.alive = q.l;
      p.act = q.k ? ({ k: q.k, ph: q.ph, sub: q.s, res: q.rs, tx: p.x, tz: p.z, t: 0, started: 0 } as Act) : null;
      if (q.n) NEED_KEYS.forEach((k, i) => (p.needs[k] = q.n![i]));
      if (q.e) EMO_KEYS.forEach((k, i) => (p.emo[k] = q.e![i] / 100));
      if (q.hp != null) p.health = q.hp;
      if (q.o) p.outfit = q.o as Person["outfit"];
    }
    for (const [id, x, z, rot, st, held] of d.a) {
      const a = findById(w.animals, id);
      if (!a) {
        unknown = true;
        continue;
      }
      a.x = x; a.z = z; a.rot = rot; a.st = st as typeof a.st; a.held = held || null;
    }
    for (const [id, x, z, rot, st, held] of d.f) {
      const f = findById(w.fish, id);
      if (!f) continue;
      f.x = x; f.z = z; f.rot = rot; f.st = st as typeof f.st; f.held = held || null;
    }
    for (const [id, x, z, held] of d.i) {
      const it = findById(w.items, id);
      if (!it) continue;
      it.x = x; it.z = z; it.held = held || null;
    }
    for (const f of d.fx) w.fx.push(f);
    const cutoff = w.time - 6 * TIME_SCALE;
    w.fx = w.fx.filter((f) => f.t >= cutoff);
    if (unknown && d.rev !== w.rev) this.transport.send("hello");
  }

  // ─── 메시지 / 접속자 ─────────────────────────────────────────────────

  private onMessage(m: Envelope) {
    switch (m.t) {
      case "hello":
        if (this.isHost && !this.catchingUp) void this.sendFull(m.from);
        else if (this.catchingUp || this.electedHost() === this.viewerId) this.pendingHellos.add(m.from);
        break;
      case "full":
        if (this.isHost) break;
        void unpack<WorldState>(m.d as { z?: string; j?: string }).then((w) => {
          if (this.isHost || this.disposed) return;
          const first = !this.world;
          this.world = normalizeWorld(w);
          this.terrain = getTerrain(w.seed);
          if (first) this.lastChron = w.chronicle.length;
          this.bumpVersion();
          useHud.setState({ phase: "running" });
        });
        break;
      case "dyn":
        if (!this.isHost) this.applyDyn(m.d as Dyn);
        break;
      case "act":
        if (this.isHost && this.world) {
          const i = m.d as Interaction;
          applyInteraction(this.world, this.terrain, { ...i, by: m.from });
          if (this.world.rev !== this.lastRev) this.bumpVersion();
        }
        break;
    }
  }

  private onPresence(list: Member[]) {
    this.members = list;
    useHud.setState({ viewers: list.length });
    // 동시에 들어와 서버 제한을 비껴간 경우: 가장 늦게 온 사람이 물러난다
    if (list.length > MAX_VIEWERS) {
      const order = [...list].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
      if (order.findIndex((m) => m.id === this.viewerId) >= MAX_VIEWERS) {
        useHud.setState({ phase: "error", error: "이 섬은 이미 3명이 지켜보고 있어요." });
        this.dispose();
        this.leave();
        return;
      }
    }
    const host = this.electedHost();
    if (this.isHost && host !== this.viewerId) {
      this.demote();
      return;
    }
    if (this.isHost && this.world) {
      const ids = new Set(list.map((m) => m.id));
      releaseHeld(this.world, (id) => !ids.has(id));
    }
    if (!this.isHost && host === this.viewerId && !this.catchingUp && useHud.getState().phase !== "connecting") {
      // 호스트가 떠났다. 내가 이어서 섬을 돌린다
      if (this.world) this.becomeHost();
      else void this.reloadAndHost();
    }
  }

  private async reloadAndHost() {
    try {
      const t0 = performance.now();
      const res = await fetch("/api/world/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId: this.worldId, viewerId: this.viewerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (this.world) return this.becomeHost();
      await this.hostFromSave(data.state, data.savedAt, data.now, t0);
    } catch (e) {
      useHud.setState({ phase: "error", error: "섬을 다시 불러오지 못했어요." });
      console.error(e);
    }
  }

  // ─── 관찰자의 손길 ───────────────────────────────────────────────────

  interact(i: Omit<Interaction, "by">) {
    const full: Interaction = { ...i, by: this.viewerId };
    if (i.kind === "dragStart" || i.kind === "dragMove") {
      this.dragLocal = { k: i.target.k as "item" | "animal" | "fish", id: i.target.id!, x: i.x, z: i.z };
    } else if (i.kind === "dragEnd") {
      this.dragLocal = null;
    }
    if (!this.world) return;
    if (this.isHost) {
      applyInteraction(this.world, this.terrain, full);
      if (this.world.rev !== this.lastRev) this.bumpVersion();
    } else {
      this.transport.send("act", full);
    }
  }

  // ─── 저장 / 하트비트 ─────────────────────────────────────────────────

  async save(keepalive = false) {
    const w = this.world;
    if (!w || !this.isHost) return;
    const body = JSON.stringify({ worldId: this.worldId, viewerId: this.viewerId, state: { ...w, fx: [] }, simTime: w.time });
    try {
      const gz = await gzipBytes(body);
      const payload = gz ?? body;
      const size = gz ? gz.byteLength : body.length;
      const res = await fetch("/api/world/save", {
        method: "POST",
        headers: { "content-type": gz ? "application/octet-stream" : "application/json" },
        body: payload as BodyInit,
        keepalive: keepalive && size < 60000,
      });
      if (res.ok) this.savedOnce = true;
    } catch (e) {
      if (!keepalive) console.warn("저장 실패", e);
    }
  }

  private async heartbeat() {
    try {
      const res = await fetch("/api/world/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId: this.worldId, viewerId: this.viewerId }),
      });
      if (res.status === 409) useHud.setState({ phase: "error", error: "다른 관찰자들로 자리가 가득 찼어요." });
    } catch {}
  }

  private seenKey() {
    return `island:lastSeen:${this.worldId}`;
  }

  private loadSeen(): number | null {
    try {
      const v = localStorage.getItem(this.seenKey());
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  }

  rememberSeen() {
    if (!this.world) return;
    try {
      localStorage.setItem(this.seenKey(), String(this.world.time));
    } catch {}
  }

  /** 창을 닫거나 숨길 때 */
  flush() {
    this.rememberSeen();
    if (this.isHost) void this.save(true);
  }

  leave() {
    this.flush();
    try {
      navigator.sendBeacon("/api/world/leave", JSON.stringify({ worldId: this.worldId, viewerId: this.viewerId }));
    } catch {}
  }

  /** 컴포넌트 정리 시: 자리는 유지한다 (창을 닫거나 나가기를 누를 때만 leave) */
  dispose() {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    if (this.simTimer) clearInterval(this.simTimer);
    for (const t of this.timers) clearInterval(t);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.transport.close();
  }

  get saved() {
    return this.savedOnce;
  }

  // ─── HUD ─────────────────────────────────────────────────────────────

  pushHud() {
    const w = this.world;
    if (!w) return;
    const hud = useHud.getState();
    const t = w.time;
    const summaries: PersonSummary[] = w.people.map((p) => ({
      id: p.id,
      name: p.name,
      age: Math.floor(ageYears(p.birth, t)),
      sex: p.sex,
      emoji: p.alive ? (p.act?.k === "sleep" ? "💤" : EMOJI[dominant(p)[0]] ?? "😌") : "🕯️",
      action: p.alive ? actLabel(p.act) : "영원히 잠듦",
      alive: !!p.alive,
    }));
    const sel = hud.selectedId != null ? findById(w.people, hud.selectedId) : undefined;
    const focus = w.tech.focus;
    const toasts = hud.toasts.filter((x) => Date.now() - x.at < 7000);
    if (w.chronicle.length < this.lastChron) this.lastChron = 0;
    for (; this.lastChron < w.chronicle.length; this.lastChron++) {
      const c = w.chronicle[this.lastChron];
      if (TOAST_KINDS.has(c.k)) toasts.push({ id: ++this.toastId, text: c.text, kind: c.k, at: Date.now() });
    }
    useHud.setState({
      day: dayOf(t),
      year: yearOf(t),
      season: SEASONS[seasonOf(t)],
      clock: clockLabel(t),
      tod: timeOfDayLabel(t),
      weather: w.weather.type,
      temp: Math.round(w.weather.temp),
      era: ERAS[currentEra(w)],
      pop: w.people.filter((p) => p.alive).length,
      generation: w.stats.generation,
      people: summaries,
      selected: sel ? this.detail(sel) : null,
      stock: (Object.entries(w.stock) as [Res, number][])
        .filter(([, v]) => v >= 1)
        .map(([k, v]) => [RES_NAME[k] ?? k, Math.floor(v)] as [string, number]),
      tech: {
        known: w.tech.known,
        focus,
        progress: focus ? w.tech.prog[focus] ?? 0 : 0,
        cost: focus ? TECH_BY_ID[focus].cost : 1,
      },
      chronicle: w.chronicle.slice(-80),
      toasts: toasts.slice(-4),
      isHost: this.isHost,
    });
  }

  private detail(p: Person): PersonDetail {
    const w = this.world!;
    const [emo] = dominant(p);
    const traits: string[] = [];
    for (const [k, [hi, lo]] of Object.entries(TRAIT_LABEL)) {
      const v = p.traits[k as keyof Person["traits"]];
      if (v > 0.62) traits.push(hi);
      else if (v < 0.38) traits.push(lo);
    }
    const name = (id: number | null | undefined) => (id != null ? findById(w.people, id)?.name : undefined);
    const family: string[] = [];
    const partner = name(p.partner);
    if (partner) family.push(`💞 ${partner}`);
    for (const id of p.parents) {
      const n = name(id);
      if (n) family.push(`부모 ${n}`);
    }
    for (const q of w.people) if (q.parents.includes(p.id)) family.push(`아이 ${q.name}`);
    const friends = Object.entries(p.rel)
      .filter(([id, v]) => v > 0.45 && Number(id) !== p.partner)
      .map(([id]) => name(Number(id)))
      .filter(Boolean) as string[];
    if (friends.length) family.push(`친구 ${friends.slice(0, 3).join(", ")}`);
    const skills = Object.entries(p.skills)
      .filter(([, v]) => (v ?? 0) > 0.15)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3)
      .map(([k, v]) => `${SKILL_LABEL[k] ?? k} ${"★".repeat(Math.max(1, Math.round((v ?? 0) * 5)))}`);
    const home = findById(w.structures, p.home);
    return {
      id: p.id,
      name: p.name,
      age: Math.floor(ageYears(p.birth, w.time)),
      sex: p.sex,
      emoji: EMOJI[emo] ?? "😌",
      action: p.alive ? actLabel(p.act) : "영원히 잠듦",
      alive: !!p.alive,
      needs: { ...p.needs },
      emo: { ...p.emo },
      health: p.health,
      mood: mood(p),
      mainEmotion: EMO_LABEL[emo],
      traits,
      likes: `${RES_NAME[p.likes.food]} · ${WEATHER_LIKE[p.likes.weather]} · ${LEISURE_LABEL[p.likes.leisure] ?? ""}${p.fears ? " · 천둥을 무서워함" : ""}`,
      thought: p.bubble && p.bubble.until > w.time ? p.bubble.text : "",
      family,
      skills,
      outfit: p.outfit,
      carry: p.carry ? RES_NAME[p.carry.res] : "",
      home: home ? (home.type === "leanto" ? "움막" : home.type === "hut" ? "오두막" : home.type === "loghouse" ? "통나무집" : "돌집") : "집 없음",
      preg: !!p.preg,
    };
  }
}
