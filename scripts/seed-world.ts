// 개발용: 로컬 파일 저장소(.data)에 미리 진행된 섬을 만들어 둔다.
// npx tsx scripts/seed-world.ts <key> <게임 일수> [자리 비운 현실 분]
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { DAY } from "../src/sim/constants";
import { hashString } from "../src/sim/rng";
import { advanceSync } from "../src/sim/step";
import { createWorld } from "../src/sim/world";

const key = process.argv[2] ?? "demo";
const days = Number(process.argv[3] ?? 30);
const awayMin = Number(process.argv[4] ?? 0);
const salt = process.env.ISLAND_KEY_SALT ?? "lonely-island";
const worldId = createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 40);
const seed = parseInt(worldId.slice(0, 8), 16) ^ hashString(worldId);
const w = createWorld(seed);
advanceSync(w, days * DAY, 600);
const dir = path.join(process.cwd(), ".data", "worlds");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${worldId}.json`), JSON.stringify({ state: w, simTime: w.time, updatedAt: Date.now() - awayMin * 60000 }));
console.log(`key=${key} id=${worldId} time=${w.time} day=${Math.floor(w.time / DAY) + 1} pop=${w.people.filter((p) => p.alive).length} techs=${w.tech.known.length} structs=${w.structures.length}`);
