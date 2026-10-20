import { isActiveViewer, json, validId, validViewer } from "@/server/api";
import { getStore } from "@/server/storage";

// 호스트가 갑자기 사라졌을 때 남은 관찰자가 마지막 저장본을 다시 받는다
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
    if (!(await isActiveViewer(worldId, viewerId))) return json({ error: "not_viewer" }, 403);
    const row = await getStore().load(worldId);
    return json({ state: row?.state ?? null, savedAt: row?.updatedAt ?? null, now: Date.now() });
  } catch (e) {
    console.error("load failed", e);
    return json({ error: "server" }, 500);
  }
}
