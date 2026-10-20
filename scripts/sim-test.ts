// 헤드리스로 섬을 돌려 보며 균형을 확인한다: npx tsx scripts/sim-test.ts [days] [seed]
import { DAY } from "../src/sim/constants";
import { ageYears, dayOf } from "../src/sim/clock";
import { ERAS } from "../src/sim/data";
import { currentEra } from "../src/sim/settlement";
import { step } from "../src/sim/step";
import { createWorld } from "../src/sim/world";

const days = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 12345);
const fine = process.argv.includes("--fine");
const w = createWorld(seed);
const t0 = performance.now();
let lastChron = 0;
const dt = fine ? 7.2 : 600;
for (let d = 0; d < days; d++) {
  const end = w.time + DAY;
  while (w.time < end) step(w, dt);
  for (; lastChron < w.chronicle.length; lastChron++) console.log("  " + w.chronicle[lastChron].text);
  const alive = w.people.filter((p) => p.alive);
  const s = Object.entries(w.stock).filter(([, v]) => (v ?? 0) >= 1).map(([k, v]) => `${k}:${Math.floor(v!)}`).join(" ");
  console.log(
    `[day ${dayOf(w.time)}] pop ${alive.length} era ${ERAS[currentEra(w)]} techs ${w.tech.known.length} focus ${w.tech.focus} ` +
      `plants ${w.plants.length} animals ${w.animals.length} fish ${w.fish.length} items ${w.items.length} structs ${w.structures.length}`,
  );
  console.log(`    stock ${s}`);
  for (const p of alive) {
    const n = p.needs;
    console.log(
      `    ${p.name}(${ageYears(p.birth, w.time).toFixed(0)}) hp${p.health.toFixed(0)} hu${n.hunger.toFixed(0)} th${n.thirst.toFixed(0)} en${n.energy.toFixed(0)} wa${n.warmth.toFixed(0)} so${n.social.toFixed(0)} fu${n.fun.toFixed(0)} act=${p.act?.k}/${p.act?.ph} outfit=${p.outfit}`,
    );
  }
}
console.log(`elapsed ${(performance.now() - t0).toFixed(0)}ms, json ${(JSON.stringify(w).length / 1024).toFixed(1)}KB`);
