import { MAX_VIEWERS } from "@/sim/constants";
import { json, validId, validViewer } from "@/server/api";
import { getStore } from "@/server/storage";

export async function POST(req: Request) {
  let body: { worldId?: unknown; viewerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { worldId, viewerId } = body;
  if (!validId(worldId) || !validViewer(viewerId)) return json({ error: "bad_request" }, 400);
  try {
    const store = getStore();
    const viewers = await store.viewers(worldId);
    if (!viewers.includes(viewerId) && viewers.length >= MAX_VIEWERS) return json({ error: "full" }, 409);
    await store.touchViewer(worldId, viewerId);
    return json({ viewers: viewers.includes(viewerId) ? viewers.length : viewers.length + 1 });
  } catch (e) {
    console.error("heartbeat failed", e);
    return json({ error: "server" }, 500);
  }
}
