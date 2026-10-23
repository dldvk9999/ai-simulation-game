import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import { MAX_VIEWERS } from "@/sim/constants";
import { getStore } from "./storage";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** 시드 → 섬 id. 소금값 환경 변수 이름(ISLAND_KEY_SALT)은 이미 배포된 섬을 찾아야 해서 그대로 둔다 */
export function worldIdFor(seed: string) {
  const salt = process.env.ISLAND_KEY_SALT ?? "lonely-island";
  return createHash("sha256").update(`${salt}:${seed}`).digest("hex").slice(0, 40);
}

export function normalizeSeed(raw: unknown) {
  if (typeof raw !== "string") return null;
  const seed = raw.trim().normalize("NFC");
  if (seed.length < 1 || seed.length > 64) return null;
  return seed;
}

export const validId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
export const validViewer = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(v);

/** 저장 요청 본문: JSON 또는 gzip(JSON) */
export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const type = req.headers.get("content-type") ?? "";
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    const txt = type.includes("octet-stream") ? gunzipSync(buf, { maxOutputLength: 12_000_000 }).toString("utf8") : buf.toString("utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function isActiveViewer(worldId: string, viewerId: string) {
  const viewers = await getStore().viewers(worldId);
  if (viewers.includes(viewerId)) return true;
  // 하트비트가 잠깐 끊겼다가 돌아온 경우: 자리가 남아 있으면 다시 받아준다
  if (viewers.length < MAX_VIEWERS) {
    await getStore().touchViewer(worldId, viewerId);
    return true;
  }
  return false;
}
