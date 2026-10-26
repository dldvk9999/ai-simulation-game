// 실시간 걸음으로 맹수 습격을 여러 번 겪어 본다: npx tsx scripts/sim-beast.ts <저장 파일> [횟수] [종류] [남길 사람 수]
import { readFileSync } from "fs";
import { spawnBeasts, threatOf, kindFor } from "../src/sim/beasts";
import { HOUR } from "../src/sim/constants";
import { getTerrain } from "../src/sim/terrain";
import { step } from "../src/sim/step";
import { migrateWorld } from "../src/sim/world";
import type { BeastKind, WorldState } from "../src/sim/types";

const file = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
const force = process.argv[4] as BeastKind | undefined;
const keep = Number(process.argv[5] ?? 0);
const base = readFileSync(file, "utf8");
const sum = { deaths: 0, wounded: 0, slain: 0, fled: 0, attacks: 0 };
for (let r = 0; r < runs; r++) {
  const w: WorldState = migrateWorld(JSON.parse(base));
  w.rng = (w.rng + r * 7919) | 0;
  if (keep) {
    // 작은 마을: 몇 명만 남긴다
    const alive = w.people.filter((p) => p.alive && !p.away);
    for (const p of alive.slice(keep)) { p.alive = 0; }
    w.people = w.people.filter((p) => p.alive);
  }
  const T = getTerrain(w.seed);
  const pop0 = w.people.filter((p) => p.alive && !p.away).length;
  const deaths0 = w.stats.deaths;
  let pow = threatOf(w);
  if (force) pow = { wolf: 1.5, bear: 4, tiger: 8, sabertooth: 15, dragon: 24 }[force] * (pow / threatOf(w));
  const bs = spawnBeasts(w, T, force === "dragon" ? Math.max(20, pow) : pow);
  sum.attacks++;
  const end = w.time + 10 * HOUR;
  while (w.time < end && w.beasts.length) step(w, 7.2);
  const pop1 = w.people.filter((p) => p.alive && !p.away).length;
  const wounded = w.people.filter((p) => p.alive && p.wound).length;
  const d = w.stats.deaths - deaths0;
  const slain = w.chronicle.filter((c) => c.k === "beast" && /쓰러뜨렸|물리쳤/.test(c.text) && c.t >= end - 10 * HOUR).length;
  sum.deaths += d; sum.wounded += wounded; sum.slain += slain;
  if (process.env.V) for (const c of w.chronicle.filter((c) => c.k === "beast" && c.t >= end - 10 * HOUR)) console.log("    " + c.text);
  console.log(`run ${r}: ${bs.length}× ${bs[0]?.kind} pow ${bs[0]?.pow.toFixed(1)} pop ${pop0}→${pop1} deaths ${d} cap ${w.timers.beastCap} wounded ${wounded} slain ${slain}`);
}
console.log(sum, `kind by threat now: ${kindFor(threatOf(migrateWorld(JSON.parse(base))))}`);
