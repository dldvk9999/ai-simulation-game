import { json, validId, validViewer } from "@/server/api";
import { getStore } from "@/server/storage";

// 창을 닫을 때 sendBeacon으로 호출된다 (본문은 text/plain JSON)
export async function POST(req: Request) {
  let body: { worldId?: unknown; viewerId?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { worldId, viewerId } = body;
  if (!validId(worldId) || !validViewer(viewerId)) return json({ error: "bad_request" }, 400);
  try {
    await getStore().removeViewer(worldId, viewerId);
    return json({ ok: true });
  } catch (e) {
    console.error("leave failed", e);
    return json({ error: "server" }, 500);
  }
}
