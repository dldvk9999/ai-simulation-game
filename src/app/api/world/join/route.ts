import { randomUUID } from "crypto";
import { MAX_VIEWERS } from "@/sim/constants";
import { json, normalizeSeed, worldIdFor } from "@/server/api";
import { getStore, supabaseEnv } from "@/server/storage";

// 시드를 받아 섬을 찾는다. 없으면 state: null (클라이언트가 새 섬을 만든다)
export async function POST(req: Request) {
  let body: { seed?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  // 예전 화면(이미 열려 있던 탭)은 key 로 보낸다
  const seed = normalizeSeed(body.seed ?? body.key);
  if (!seed) return json({ error: "bad_seed" }, 400);

  const store = getStore();
  const worldId = worldIdFor(seed);
  try {
    const viewers = await store.viewers(worldId);
    if (viewers.length >= MAX_VIEWERS) return json({ error: "full", viewers: viewers.length }, 409);
    const viewerId = randomUUID();
    await store.touchViewer(worldId, viewerId);
    const row = await store.load(worldId);
    const env = supabaseEnv();
    return json({
      worldId,
      viewerId,
      state: row?.state ?? null,
      savedAt: row?.updatedAt ?? null,
      now: Date.now(),
      viewers: viewers.length + 1,
      storage: store.kind,
      realtime: env ? { url: env.url, key: env.anon } : null,
    });
  } catch (e) {
    console.error("join failed", e);
    return json({ error: "server" }, 500);
  }
}
