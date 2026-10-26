// 나라 이후의 살림을 시험한다: npx tsx scripts/sim-society.ts [days] [seed] [dt]
import { writeFileSync } from "fs";
import { DAY } from "../src/sim/constants";
import { dayOf } from "../src/sim/clock";
import { ERAS } from "../src/sim/data";
import { currentEra } from "../src/sim/settlement";
import { step } from "../src/sim/step";
import { createWorld } from "../src/sim/world";

const days = Number(process.argv[2] ?? 1200);
const seed = Number(process.argv[3] ?? 777);
const dt = Number(process.argv[4] ?? 600);
const show = new Set((process.argv[5] ?? "beast,casino,civic,nation,era").split(","));
const w = createWorld(seed);
const t0 = performance.now();
let last = 0;
const causes: Record<string, number> = {};
const seen = new Set<number>();
for (let d = 0; d < days; d++) {
  const end = w.time + DAY;
  while (w.time < end) step(w, dt);
  const total = w.stats.chron ?? 0;
  for (const c of w.chronicle.slice(w.chronicle.length - Math.min(total - last, w.chronicle.length))) if (show.has(c.k)) console.log(`  [${c.k}] ${c.text}`);
  last = total;
  for (const p of w.people) if (!p.alive && !seen.has(p.id)) {
    seen.add(p.id);
    causes[p.cause] = (causes[p.cause] ?? 0) + 1;
  }
  if (d % 100 === 99) {
    const alive = w.people.filter((p) => p.alive);
    const wounded = alive.filter((p) => p.wound).length;
    const addicts = alive.filter((p) => p.gamble?.addict && p.gamble.addict > w.time).length;
    console.log(`[day ${dayOf(w.time)}] ${ERAS[currentEra(w)]} pop ${alive.length} deaths ${JSON.stringify(causes)} wounded ${wounded} addicts ${addicts} casino ${w.casino ? `${w.casino.open ? "open" : "closed"} cap ${w.casino.cap} plays ${w.casino.plays} took ${Math.round(w.casino.took)} paid ${Math.round(w.casino.paid)} addicts ${w.casino.addicts}` : "-"} civic ${w.civic ? `fund ${Math.round(w.civic.fund)} lv ${JSON.stringify(w.civic.lv)}` : "-"} morale ${Math.round(w.morale)}`);
  }
}
console.log(`elapsed ${(performance.now() - t0).toFixed(0)}ms, json ${(JSON.stringify(w).length / 1024).toFixed(1)}KB`);
if (process.env.SAVE) writeFileSync(process.env.SAVE, JSON.stringify(w));
