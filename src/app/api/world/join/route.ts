import { randomUUID } from "crypto";
import { MAX_VIEWERS } from "@/sim/constants";
import { json, normalizeKey, worldIdFor } from "@/server/api";
import { getStore, supabaseEnv } from "@/server/storage";

// 키를 받아 섬을 찾는다. 없으면 state: null (클라이언트가 새 섬을 만든다)
export async function POST(req: Request) {
  let body: { key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const key = normalizeKey(body.key);
  if (!key) return json({ error: "bad_key" }, 400);

  const store = getStore();
  const worldId = worldIdFor(key);
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
