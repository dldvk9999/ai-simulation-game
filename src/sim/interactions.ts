// 관찰자의 손길: 치기(클릭) · 옮기기(드래그) · 불 지피기(연타) · 건물 두드리기(세 번 연달아)
import { beastName } from "./beasts";
import { smash } from "./building";
import { TIME_SCALE } from "./constants";
import { METAL_INFO, TECH_BY_ID } from "./data";
import { isTree } from "./ecology";
import { sparkNear } from "./fire";
import { feel, lying, say } from "./people";
import { chance, range } from "./rng";
import { addResearch } from "./settlement";
import type { Terrain } from "./terrain";
import type { Interaction, WorldState } from "./types";
import { addFx, bump, chron, dist, findById, knows, makeItem, makeStructure, removeById } from "./world";

export const RAPID_CLICKS = 5;
export const MAX_PLAYER_FIRES = 3;

function nearbyReact(w: WorldState, x: number, z: number, r: number, key: string, amt = 0.15) {
  for (const p of w.people) {
    if (!p.alive || lying(p)) continue;
    if (dist(p.x, p.z, x, z) < r) {
      feel(w, p, "surprise", amt, amt > 0.2);
      if (chance(w, 0.35)) say(w, p, key, {}, "❓");
    }
  }
}

function dropNear(w: WorldState, T: Terrain, res: Parameters<typeof makeItem>[1], x: number, z: number) {
  for (let k = 0; k < 6; k++) {
    const a = range(w, 0, Math.PI * 2);
    const d = range(w, 0.8, 1.6);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (T.height(px, pz) > 0.05) {
      const it = makeItem(w, res, 1, px, pz, w.time);
      w.items.push(it);
      addFx(w, "drop", px, pz, it.id);
      bump(w);
      return it;
    }
  }
  return null;
}

export function applyInteraction(w: WorldState, T: Terrain, i: Interaction) {
  switch (i.kind) {
    case "hit": return hit(w, T, i);
    case "ignite": return ignite(w, T, i);
    case "dragStart": return dragStart(w, i);
    case "dragMove": return dragMove(w, i);
    case "dragEnd": return dragEnd(w, T, i);
    case "smash": {
      const s = i.target.k === "structure" ? findById(w.structures, i.target.id) : undefined;
      if (s) smash(w, T, s);
      return;
    }
  }
}

function hit(w: WorldState, T: Terrain, i: Interaction) {
  const { k, id } = i.target;
  if (k === "plant") {
    const p = findById(w.plants, id);
    if (!p) return;
    addFx(w, "shake", p.x, p.z, p.id);
    if (p.stump || p.burn) return;
    if (p.g >= 1 && p.fruit > 0 && (p.kind === "palm" || p.kind === "fruit" || p.kind === "bush") && chance(w, 0.7)) {
      p.fruit--;
      dropNear(w, T, p.kind === "bush" ? "berry" : "fruit", p.x, p.z);
    } else if (isTree(p.kind) && p.g >= 0.6 && chance(w, 0.3)) {
      dropNear(w, T, "stick", p.x, p.z);
    }
    nearbyReact(w, p.x, p.z, 10, "shake");
    return;
  }
  if (k === "rock") {
    const r = findById(w.rocks, id);
    if (!r) return;
    addFx(w, "chip", r.x, r.z, r.id);
    if (r.amt >= 1 && chance(w, 0.4)) {
      r.amt -= 1;
      const res = r.kind === "ore" ? (knows(w, "metallurgy") ? "ore" : "stone")
        : r.kind === "vein" && r.ore && knows(w, "mining") && chance(w, METAL_INFO[r.ore].purity) ? r.ore
        : r.kind === "clay" ? "clay" : "stone";
      dropNear(w, T, res, r.x, r.z);
    }
    nearbyReact(w, r.x, r.z, 8, "shake");
    return;
  }
  if (k === "animal") {
    const a = findById(w.animals, id);
    if (!a || a.held) return;
    a.st = "stun";
    a.until = Math.max(a.until, w.time) + 10 * TIME_SCALE;
    a.until = Math.min(a.until, w.time + 40 * TIME_SCALE);
    addFx(w, "stun", a.x, a.z, a.id);
    nearbyReact(w, a.x, a.z, 8, "shake");
    return;
  }
  if (k === "beast") {
    // 맹수를 내리치면 잠깐 휘청인다 (센 놈일수록 금방 정신을 차린다)
    const b = findById(w.beasts, id);
    if (!b || b.st === "dead" || b.st === "leave") return;
    b.st = "stun";
    b.stun = Math.min(Math.max(b.stun, w.time) + (9 / Math.sqrt(b.pow)) * TIME_SCALE, w.time + 25 * TIME_SCALE);
    addFx(w, "stun", b.x, b.z, b.id);
    for (const p of w.people) {
      if (!p.alive || lying(p) || dist(p.x, p.z, b.x, b.z) > 20) continue;
      feel(w, p, "surprise", 0.3, false);
      if (chance(w, 0.3)) say(w, p, "beastStun", { beast: beastName(b) }, "❗");
    }
    return;
  }
  if (k === "fish") {
    const f = findById(w.fish, id);
    if (!f || f.held) return;
    f.st = "stun";
    f.until = w.time + 12 * TIME_SCALE;
    f.dies = Math.max(f.dies, w.time + 60 * TIME_SCALE);
    addFx(w, "splash", f.x, f.z, f.id);
    return;
  }
  if (k === "structure") {
    const s = findById(w.structures, id);
    if (!s) return;
    if (s.type === "campfire" && s.lit) {
      s.fuel = Math.min(100, s.fuel + 2);
      addFx(w, "spark", s.x, s.z, s.id);
    } else addFx(w, "hit", s.x, s.z, s.id);
    return;
  }
  if (k === "item") {
    const it = findById(w.items, id);
    if (it) addFx(w, "hit", it.x, it.z, it.id);
    return;
  }
  if (k === "water") {
    addFx(w, "splash", i.x, i.z);
    return;
  }
  addFx(w, "hit", i.x, i.z);
}

function ignite(w: WorldState, T: Terrain, i: Interaction) {
  const W = w.weather.type;
  const { x, z } = i;
  if (T.height(x, z) < 0.1 || T.inPond(x, z, 0.3)) {
    addFx(w, "fizzle", x, z);
    return;
  }
  if (W === "storm" || (W === "rain" && chance(w, 0.5)) || (W === "snow" && chance(w, 0.3))) {
    addFx(w, "fizzle", x, z);
    return;
  }
  // 대상이 장작이면 그 자리에서
  let fuel = 40;
  if (i.target.k === "item") {
    const it = findById(w.items, i.target.id);
    if (it && (it.res === "wood" || it.res === "stick")) {
      fuel += it.qty * (it.res === "wood" ? 40 : 22);
      removeById(w.items, it.id);
      bump(w);
    }
  }
  let fire = i.target.k === "structure" ? findById(w.structures, i.target.id) : undefined;
  if (fire && fire.type !== "campfire") fire = undefined;
  if (!fire) fire = w.structures.find((s) => s.type === "campfire" && dist(s.x, s.z, x, z) < 2.5);
  if (!fire) {
    const mine = w.structures.filter((s) => s.type === "campfire" && s.byPlayer && s.lit);
    if (mine.length >= MAX_PLAYER_FIRES) {
      addFx(w, "fizzle", x, z);
      return;
    }
    fire = makeStructure(w, "campfire", x, z, 0, true);
    fire.byPlayer = 1;
    w.structures.push(fire);
  }
  const wasLit = fire.lit;
  fire.lit = 1;
  fire.fuel = Math.min(100, Math.max(fire.fuel, 0) + fuel);
  addFx(w, "ignite", fire.x, fire.z, fire.id);
  bump(w);
  // 바로 곁의 나무 건물에 옮겨붙을 수 있다
  sparkNear(w, fire.x, fire.z);
  if (wasLit) return;

  const unknown = !knows(w, "fire");
  let witnessed = false;
  for (const p of w.people) {
    if (!p.alive || lying(p)) continue;
    const d = dist(p.x, p.z, fire.x, fire.z);
    if (d > 18) continue;
    witnessed = true;
    feel(w, p, "surprise", 0.5);
    feel(w, p, "joy", 0.2, false);
    p.seen[`f${fire.id}`] = w.time;
    say(w, p, unknown ? "fireSeen" : "warmFire", {}, "🔥", true);
    if (unknown) addResearch(w, p, TECH_BY_ID.fire.cost * 0.35, "fire");
    p.seen.reeval = 0;
  }
  if (unknown && witnessed && !w.chronicle.some((c) => c.k === "gift" && c.text.includes("불"))) {
    chron(w, "gift", "누군가의 손길로 불씨가 피어올랐다. 사람들은 그 빛을 오래 바라보았다.");
  }
}

function dragStart(w: WorldState, i: Interaction) {
  const { k, id } = i.target;
  if (k === "item") {
    const it = findById(w.items, id);
    if (it && !it.held) {
      it.held = i.by;
      // 누가 줍고 있었다면 포기
      for (const p of w.people) if (p.act?.tid === it.id && p.act.k === "collect") p.act = null;
    }
  } else if (k === "animal") {
    const a = findById(w.animals, id);
    if (a && !a.held && a.lead == null) {
      a.held = i.by;
      a.st = "held";
      for (const p of w.people) if (p.act?.tid === a.id && (p.act.k === "hunt" || p.act.k === "tame")) p.act = null;
    }
  } else if (k === "fish") {
    const f = findById(w.fish, id);
    if (f && !f.held) {
      f.held = i.by;
      f.st = "held";
    }
  }
}

function dragMove(w: WorldState, i: Interaction) {
  const { k, id } = i.target;
  const e = k === "item" ? findById(w.items, id) : k === "animal" ? findById(w.animals, id) : k === "fish" ? findById(w.fish, id) : undefined;
  if (e && e.held === i.by) {
    e.x = i.x;
    e.z = i.z;
  }
}

function dragEnd(w: WorldState, T: Terrain, i: Interaction) {
  const { k, id } = i.target;
  if (k === "item") {
    const it = findById(w.items, id);
    if (!it || it.held !== i.by) return;
    it.x = i.x;
    it.z = i.z;
    it.held = null;
    it.gift = w.time;
    it.t = w.time;
    addFx(w, "drop", it.x, it.z, it.id);
  } else if (k === "animal") {
    const a = findById(w.animals, id);
    if (!a || a.held !== i.by) return;
    a.x = i.x;
    a.z = i.z;
    a.held = null;
    a.gift = w.time;
    // 놓으면 잠깐 어리둥절
    a.st = "stun";
    a.until = w.time + 6 * TIME_SCALE;
    addFx(w, "drop", a.x, a.z, a.id);
  } else if (k === "fish") {
    const f = findById(w.fish, id);
    if (!f || f.held !== i.by) return;
    f.x = i.x;
    f.z = i.z;
    f.held = null;
    f.gift = w.time;
    f.st = "swim";
    f.tx = f.x;
    f.tz = f.z;
    if (T.height(f.x, f.z) < 0.05) addFx(w, "splash", f.x, f.z, f.id);
  }
  bump(w);
}

/** 연결이 끊긴 관찰자가 쥐고 있던 것을 놓는다 */
export function releaseHeld(w: WorldState, by: string | ((id: string) => boolean)) {
  const match = typeof by === "string" ? (h: string | null) => h === by : (h: string | null) => h != null && by(h);
  for (const it of w.items) if (match(it.held)) it.held = null;
  for (const a of w.animals) if (match(a.held)) {
    a.held = null;
    a.st = "idle";
  }
  for (const f of w.fish) if (match(f.held)) {
    f.held = null;
    f.st = "swim";
  }
}
