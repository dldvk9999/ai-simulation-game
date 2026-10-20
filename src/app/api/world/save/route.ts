import { isActiveViewer, json, readBody, validId, validViewer } from "@/server/api";
import { getStore } from "@/server/storage";

// 호스트(시뮬레이션을 돌리는 관찰자)가 주기적으로 섬 상태를 저장한다
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return json({ error: "bad_request" }, 400);
  const { worldId, viewerId, state, simTime } = body;
  if (!validId(worldId) || !validViewer(viewerId)) return json({ error: "bad_request" }, 400);
  if (!state || typeof state !== "object" || typeof simTime !== "number" || !Number.isFinite(simTime)) {
    return json({ error: "bad_state" }, 400);
  }
  const s = state as { v?: unknown; seed?: unknown; time?: unknown; people?: unknown };
  if (typeof s.seed !== "number" || typeof s.time !== "number" || !Array.isArray(s.people)) {
    return json({ error: "bad_state" }, 400);
  }
  try {
    if (!(await isActiveViewer(worldId, viewerId))) return json({ error: "not_viewer" }, 403);
    const store = getStore();
    // 시간이 거꾸로 가는 저장은 받지 않는다 (호스트가 바뀌는 순간의 경합 방지)
    const prev = await store.meta(worldId);
    if (prev && prev.simTime > simTime + 600) return json({ error: "stale", savedAt: prev.updatedAt }, 409);
    const savedAt = await store.save(worldId, state, simTime);
    return json({ savedAt });
  } catch (e) {
    console.error("save failed", e);
    return json({ error: "server" }, 500);
  }
}
