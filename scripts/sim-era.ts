// 시대별 도달 시점과 성능 측정: npx tsx scripts/sim-era.ts [days] [seed]
import { DAY } from "../src/sim/constants";
import { dayOf } from "../src/sim/clock";
import { ERAS } from "../src/sim/data";
import { currentEra } from "../src/sim/settlement";
import { step } from "../src/sim/step";
import { createWorld } from "../src/sim/world";

const days = Number(process.argv[2] ?? 600);
const seed = Number(process.argv[3] ?? 777);
const dt = Number(process.argv[4] ?? 1200);
const w = createWorld(seed);
const t0 = performance.now();
let era = 0;
let lastTechs = 0;
for (let d = 0; d < days; d++) {
  const end = w.time + DAY;
  while (w.time < end) step(w, dt);
  const e = currentEra(w);
  if (e !== era) {
    era = e;
    console.log(`day ${dayOf(w.time)}: ${ERAS[e]} (pop ${w.people.filter((p) => p.alive).length})`);
  }
  if (d % 50 === 0 || w.tech.known.length !== lastTechs && d % 10 === 0) {
    lastTechs = w.tech.known.length;
    const alive = w.people.filter((p) => p.alive);
    const s = Object.entries(w.stock).filter(([, v]) => (v ?? 0) >= 1).map(([k, v]) => `${k}:${Math.floor(v!)}`).join(" ");
    console.log(`  [${dayOf(w.time)}] pop ${alive.length} techs ${w.tech.known.length} focus ${w.tech.focus} ${Math.floor(w.tech.prog[w.tech.focus ?? ""] ?? 0)} structs ${w.structures.length} deaths ${w.stats.deaths} births ${w.stats.births} gen ${w.stats.generation} | ${s}`);
  }
}
console.log(`elapsed ${(performance.now() - t0).toFixed(0)}ms, json ${(JSON.stringify(w).length / 1024).toFixed(1)}KB`);
const kinds: Record<string, number> = {};
for (const c of w.chronicle) kinds[c.k] = (kinds[c.k] ?? 0) + 1;
console.log(kinds);
