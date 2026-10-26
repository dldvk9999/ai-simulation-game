// 실시간 걸음(부딪힘 포함)을 시험한다: npx tsx scripts/sim-walk.ts [미리 돌릴 날] [시드] [실시간 시간]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { WALK_STATS, solidAt } from "../src/sim/collide";
import { DAY, HOUR } from "../src/sim/constants";
import { ERAS } from "../src/sim/data";
import { currentEra } from "../src/sim/settlement";
import { advanceSync, step } from "../src/sim/step";
import { createWorld, migrateWorld } from "../src/sim/world";
import type { WorldState } from "../src/sim/types";

const days = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 777);
const hours = Number(process.argv[4] ?? 12);
mkdirSync(".cache", { recursive: true });
const file = `.cache/w-${seed}-${days}.json`;
let w: WorldState;
if (existsSync(file)) w = migrateWorld(JSON.parse(readFileSync(file, "utf8")));
else {
  w = createWorld(seed);
  advanceSync(w, days * DAY, 600);
  writeFileSync(file, JSON.stringify(w));
}
console.log(`day ${Math.floor(w.time / DAY) + 1} ${ERAS[currentEra(w)]} pop ${w.people.filter((p) => p.alive).length} structs ${w.structures.length} plants ${w.plants.length} rocks ${w.rocks.length}`);
const deaths0 = w.stats.deaths;
let inside = 0, overlap = 0, samples = 0, worst = 0;
const t0 = performance.now();
const end = w.time + hours * HOUR;
let n = 0;
while (w.time < end) {
  const s0 = performance.now();
  step(w, 7.2);
  worst = Math.max(worst, performance.now() - s0);
  n++;
  if (n % 50 === 0) {
    const ps = w.people.filter((p) => p.alive && !p.away && p.act?.k !== "carried");
    for (const p of ps) {
      samples++;
      const walking = p.act && p.act.ph !== 1;
      if (walking && solidAt(w, p.x, p.z, true)) inside++;
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (a.act?.ph === 1 || b.act?.ph === 1) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < 0.3) overlap++;
    }
  }
}
const ms = performance.now() - t0;
console.log(`steps ${n} avg ${(ms / n).toFixed(2)}ms worst ${worst.toFixed(1)}ms | walking-inside-solid ${inside}/${samples} pair-overlap ${overlap} deaths +${w.stats.deaths - deaths0}`);
console.log(WALK_STATS);
const acts: Record<string, number> = {};
for (const p of w.people) if (p.alive && p.act) acts[p.act.k] = (acts[p.act.k] ?? 0) + 1;
console.log(acts);
