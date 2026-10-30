// 엔딩을 시험한다: npx tsx scripts/sim-ending.ts [미리 돌릴 날] [시드] [종류|all|wait] [스텝 길이]
// 과학 시대의 섬을 만들어 두고 (.cache에 저장), 엔딩마다 끝까지 돌려 단계와 결과를 확인한다.
// wait: 엔딩을 일으키지 않고 저절로 시작될 때까지 돌려 본다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { compact } from "../src/game/net";
import { dayOf, hourOf } from "../src/sim/clock";
import { DAY, HOUR } from "../src/sim/constants";
import { ERAS } from "../src/sim/data";
import { beginEnding, creditsOf, ENDING_KINDS, endingTitle } from "../src/sim/ending";
import { currentEra } from "../src/sim/settlement";
import { advanceSync, step } from "../src/sim/step";
import { getTerrain } from "../src/sim/terrain";
import type { EndingKind, WorldState } from "../src/sim/types";
import { createWorld, deathless, humans, migrateWorld } from "../src/sim/world";

const days = Number(process.argv[2] ?? 500);
const seed = Number(process.argv[3] ?? 777);
const which = process.argv[4] ?? "all";
const dt = Number(process.argv[5] ?? 7.2);
mkdirSync(".cache", { recursive: true });
const file = `.cache/e-${seed}-${days}.json`;
let base: string;
if (existsSync(file)) base = readFileSync(file, "utf8");
else {
  const w = createWorld(seed);
  // 엔딩이 저절로 시작되지 않게 점친 날을 미리 채워 두며 돌린다
  for (let d = 0; d < days; d++) {
    w.timers.endRoll = dayOf(w.time);
    advanceSync(w, DAY, 600);
  }
  base = JSON.stringify(w);
  writeFileSync(file, base);
}
const load = () => migrateWorld(JSON.parse(base) as WorldState);
const size = (w: WorldState) => (gzipSync(JSON.stringify({ ...w, fx: [] }, compact as never)).length / 1024).toFixed(1);
{
  const w = load();
  console.log(`day ${dayOf(w.time)} ${ERAS[currentEra(w)]} pop ${humans(w).length} structs ${w.structures.length} save ${size(w)}KB gz annals ${w.annals?.length}`);
}

if (which === "wait") {
  const w = load();
  w.timers.endRoll = 0;
  const t0 = w.time;
  while (!w.ending && w.time - t0 < 120 * DAY) step(w, 600);
  console.log(w.ending ? `ending '${w.ending.kind}' began after ${((w.ending.t0 - t0) / DAY).toFixed(1)} days at ${hourOf(w.ending.t0).toFixed(1)}h` : "no ending in 120 days");
  process.exit(0);
}

const kinds: [EndingKind, boolean | undefined][] = which === "all"
  ? ENDING_KINDS.flatMap((k): [EndingKind, boolean | undefined][] => (k === "alien" ? [["alien", true], ["alien", false]] : [[k, undefined]]))
  : which.startsWith("alien") ? [["alien", which !== "alien-lose"]] : [[which as EndingKind, undefined]];

for (const [kind, win] of kinds) {
  const w = load();
  const T = getTerrain(w.seed);
  const pop0 = humans(w).length;
  beginEnding(w, T, kind, win);
  const e = w.ending!;
  let ph = -1;
  let worst = 0, steps = 0, ms = 0;
  const end = w.time + 3 * DAY;
  while (e.done == null && w.time < end) {
    if (e.ph !== ph) {
      ph = e.ph;
      const on = w.people.filter((p) => p.alive && !p.away);
      const scene = on.filter((p) => p.act?.k === "scene");
      const arrived = scene.filter((p) => p.act!.ph === 1).length;
      console.log(`  ${kind}${kind === "alien" ? (e.win ? "+" : "-") : ""} ph${ph} at +${((w.time - e.t0) / HOUR).toFixed(2)}h on-island ${on.length} scene ${scene.length} arrived ${arrived} humans ${humans(w).length} n ${e.n}`);
    }
    const s0 = performance.now();
    step(w, dt);
    const d = performance.now() - s0;
    worst = Math.max(worst, d);
    ms += d;
    steps++;
  }
  // 끝난 직후 반나절 더 돌려 평소대로 돌아오는지
  for (let i = 0; i < (12 * HOUR) / 600; i++) step(w, 600);
  const alive = w.people.filter((p) => p.alive);
  const c = creditsOf(w);
  console.log(`${endingTitle(e)}: done ${e.done != null} after ${((((e.done ?? w.time) - e.t0) / HOUR)).toFixed(2)}h | pop ${pop0} → alive ${alive.length} humans ${humans(w).length} robots ${alive.filter((p) => p.robot).length} deathless ${alive.filter((p) => deathless(w, p)).length} scene-left ${alive.filter((p) => p.act?.k === "scene").length}`);
  console.log(`  structs ${w.structures.length} ruined ${w.structures.filter((s) => (s.dmg ?? 0) >= 0.6).length} plants ${w.plants.length} stumps ${w.plants.filter((p) => p.stump).length} scar ${w.scar ?? 0} | step avg ${(ms / steps).toFixed(2)}ms worst ${worst.toFixed(1)}ms | save ${size(w)}KB`);
  console.log(`  credits: ${c?.annals.length} annals, ${c?.cast.length} cast, story "${c?.story[0]}"`);
  console.log(`  last chron: ${w.chronicle.slice(-3).map((x) => x.text).join(" / ")}`);
}
