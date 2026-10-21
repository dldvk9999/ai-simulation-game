// 섬 저장소. Supabase 환경변수가 있으면 Supabase, 없으면 로컬 파일(개발용)을 쓴다.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export interface WorldRow {
  state: unknown;
  simTime: number;
  updatedAt: number;
}

export interface Store {
  kind: "supabase" | "file";
  load(id: string): Promise<WorldRow | null>;
  meta(id: string): Promise<{ simTime: number; updatedAt: number } | null>;
  save(id: string, state: unknown, simTime: number): Promise<number>;
  touchViewer(id: string, viewer: string): Promise<void>;
  viewers(id: string): Promise<string[]>;
  removeViewer(id: string, viewer: string): Promise<void>;
}

/** 이 시간 동안 하트비트가 없으면 관찰자에서 빠진다 */
export const VIEWER_TTL_MS = 40_000;

export function supabaseEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && anon && secret ? { url, anon, secret } : null;
}

class SupabaseStore implements Store {
  kind = "supabase" as const;
  private db: SupabaseClient;
  constructor(url: string, secret: string) {
    this.db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async load(id: string) {
    const { data, error } = await this.db.from("worlds").select("state, sim_time, updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { state: data.state, simTime: Number(data.sim_time), updatedAt: new Date(data.updated_at).getTime() };
  }
  async meta(id: string) {
    const { data, error } = await this.db.from("worlds").select("sim_time, updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { simTime: Number(data.sim_time), updatedAt: new Date(data.updated_at).getTime() } : null;
  }
  async save(id: string, state: unknown, simTime: number) {
    const now = new Date();
    const { error } = await this.db
      .from("worlds")
      .upsert({ id, state, sim_time: simTime, updated_at: now.toISOString() }, { onConflict: "id" });
    if (error) throw error;
    return now.getTime();
  }
  async touchViewer(id: string, viewer: string) {
    const { error } = await this.db
      .from("world_viewers")
      .upsert({ world_id: id, viewer_id: viewer, last_seen: new Date().toISOString() }, { onConflict: "world_id,viewer_id" });
    if (error) throw error;
  }
  async viewers(id: string) {
    const since = new Date(Date.now() - VIEWER_TTL_MS).toISOString();
    const { data, error } = await this.db.from("world_viewers").select("viewer_id").eq("world_id", id).gt("last_seen", since);
    if (error) throw error;
    // 오래된 행은 가끔 정리
    if (Math.random() < 0.05) {
      await this.db.from("world_viewers").delete().lt("last_seen", new Date(Date.now() - 3600_000).toISOString());
    }
    return (data ?? []).map((r) => r.viewer_id as string);
  }
  async removeViewer(id: string, viewer: string) {
    await this.db.from("world_viewers").delete().eq("world_id", id).eq("viewer_id", viewer);
  }
}

type ViewerMap = Map<string, Map<string, number>>;
const g = globalThis as unknown as { __islandViewers?: ViewerMap };

class FileStore implements Store {
  kind = "file" as const;
  private dir: string;
  private viewersMap: ViewerMap;
  constructor() {
    // Vercel 등 읽기 전용 환경에서는 임시 폴더(휘발성)를 쓴다
    this.dir = process.env.VERCEL ? path.join(os.tmpdir(), "island-data") : path.join(process.cwd(), ".data", "worlds");
    this.viewersMap = g.__islandViewers ??= new Map();
  }
  private file(id: string) {
    return path.join(this.dir, `${id.replace(/[^a-f0-9]/g, "")}.json`);
  }
  async load(id: string) {
    try {
      const txt = await fs.readFile(this.file(id), "utf8");
      return JSON.parse(txt) as WorldRow;
    } catch {
      return null;
    }
  }
  async meta(id: string) {
    const row = await this.load(id);
    return row ? { simTime: row.simTime, updatedAt: row.updatedAt } : null;
  }
  async save(id: string, state: unknown, simTime: number) {
    await fs.mkdir(this.dir, { recursive: true });
    const updatedAt = Date.now();
    const data = JSON.stringify({ state, simTime, updatedAt });
    const tmp = this.file(id) + ".tmp";
    await fs.writeFile(tmp, data);
    try {
      await fs.rename(tmp, this.file(id));
    } catch {
      // Windows(특히 OneDrive 폴더)에서는 다른 프로세스가 잡고 있으면 rename이 실패한다
      await fs.writeFile(this.file(id), data);
      await fs.rm(tmp, { force: true });
    }
    return updatedAt;
  }
  private map(id: string) {
    let m = this.viewersMap.get(id);
    if (!m) this.viewersMap.set(id, (m = new Map()));
    return m;
  }
  async touchViewer(id: string, viewer: string) {
    this.map(id).set(viewer, Date.now());
  }
  async viewers(id: string) {
    const m = this.map(id);
    const cut = Date.now() - VIEWER_TTL_MS;
    for (const [v, t] of m) if (t < cut) m.delete(v);
    return [...m.keys()];
  }
  async removeViewer(id: string, viewer: string) {
    this.map(id).delete(viewer);
  }
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const env = supabaseEnv();
  store = env ? new SupabaseStore(env.url, env.secret) : new FileStore();
  return store;
}
