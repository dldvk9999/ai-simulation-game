"use client";
// 마우스 조작: 클릭 = 치기, 드래그 = 옮기기, 연타 = 불 지피기, 건물 세 번 연달아 = 부수기. 빈 곳 드래그 = 시점 회전.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useHud } from "@/game/hud";
import { groundHit, Pick, pickWorld } from "@/game/picking";
import { STRUCTS } from "@/sim/data";
import { RAPID_CLICKS } from "@/sim/interactions";
import type { Terrain } from "@/sim/terrain";
import { findById } from "@/sim/world";
import { useAmbience, useRuntime } from "./context";
import { env } from "./env";

export const camState = {
  tx: 0, tz: 0, ty: 2,
  yaw: 0, pitch: 0.75, dist: 38,
  cur: { tx: 0, tz: 0, ty: 2, yaw: 0, pitch: 0.75, dist: 38 },
  ready: false,
  camera: null as THREE.Camera | null,
};

const DRAG_PX = 6;
const RAPID_WINDOW = 1700;

export function Controls({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const { camera, gl, size } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const keys = useRef(new Set<string>());

  // 카메라 초기 위치: 야영지에서 바다를 바라보도록
  useEffect(() => {
    if (camState.ready || !rt.world) return;
    const { x, z } = rt.world.camp;
    const len = Math.hypot(x, z) || 1;
    // 카메라는 바다 쪽에서 야영지와 섬 안쪽을 바라본다
    camState.tx = x;
    camState.tz = z;
    camState.yaw = Math.atan2(x / len, z / len);
    camState.pitch = 0.6;
    camState.dist = 34;
    Object.assign(camState.cur, { tx: camState.tx, tz: camState.tz, ty: 2, yaw: camState.yaw, pitch: camState.pitch, dist: 70 });
    camState.ready = true;
  }, [rt.world]);

  useEffect(() => {
    const el = gl.domElement;
    type Down = { x: number; y: number; button: number; pick: Pick | null; mode: "pending" | "orbit" | "pan" | "drag"; t: number; lastSend: number };
    let down: Down | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    // 두 손가락 제스처: 중심점 이동 = 시점 이동, 간격 변화 = 확대/축소
    let gesture: { d: number; mx: number; my: number } | null = null;
    const clicks: { t: number; x: number; z: number }[] = [];
    let lastHover = 0;
    let lastPersonTap = { id: -1, t: 0 };
    // 같은 건물을 빠르게 세 번 누르면 내구도가 깎인다
    const taps = { id: -1, n: 0, t: 0 };

    const gestureOf = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    /** 화면에서 dx, dy 픽셀만큼 땅을 끈다. 터치는 손가락 아래 땅이 따라오도록 화면 크기에 맞춘다 */
    const panBy = (dx: number, dy: number, touch: boolean) => {
      const fov = ((camera as THREE.PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
      const k = touch ? (2 * camState.dist * Math.tan(fov / 2)) / Math.max(1, el.clientHeight) : camState.dist * 0.0018;
      const ky = touch ? k / Math.max(0.35, Math.sin(camState.pitch)) : k;
      const sy = Math.sin(camState.yaw), cy = Math.cos(camState.yaw);
      camState.tx += -dx * cy * k - dy * sy * ky;
      camState.tz += dx * sy * k - dy * cy * ky;
      if (useHud.getState().followId != null) useHud.setState({ followId: null });
    };

    const rayAt = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      ndc.current.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      raycaster.current.setFromCamera(ndc.current, camera);
      return raycaster.current.ray;
    };

    const groundAt = (cx: number, cy: number) => {
      const ray = rayAt(cx, cy);
      return groundHit(terrain, ray.origin, ray.direction);
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      amb?.start();
      if (pointers.size >= 2) {
        gesture = pointers.size === 2 ? gestureOf() : null;
        if (down?.mode === "drag" && down.pick) endDrag(down.pick, e.clientX, e.clientY);
        down = null;
        return;
      }
      const w = rt.world;
      const pick = w ? pickWorld(w, terrain, rayAt(e.clientX, e.clientY)) : null;
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      down = { x: e.clientX, y: e.clientY, button: e.button, pick, mode: pan ? "pan" : "pending", t: performance.now(), lastSend: 0 };
    };

    const startDrag = (p: Pick) => {
      if (p.k !== "item" && p.k !== "animal" && p.k !== "fish") return false;
      rt.interact({ kind: "dragStart", target: { k: p.k, id: p.id }, x: p.x, z: p.z });
      el.style.cursor = "grabbing";
      return true;
    };
    const endDrag = (p: Pick, cx: number, cy: number) => {
      const g = groundAt(cx, cy);
      const x = g?.x ?? rt.dragLocal?.x ?? p.x;
      const z = g?.z ?? rt.dragLocal?.z ?? p.z;
      rt.interact({ kind: "dragEnd", target: { k: p.k, id: p.id }, x, z });
      rt.localFx.push({ type: "drop", x, z });
      el.style.cursor = "";
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      // movementX는 모바일 사파리에서 0으로 오기도 해서 직접 계산한다
      const mdx = prev ? e.clientX - prev.x : 0;
      const mdy = prev ? e.clientY - prev.y : 0;
      if (prev) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        if (gesture && pointers.size === 2) {
          const g = gestureOf();
          if (gesture.d > 10 && g.d > 10) camState.dist = THREE.MathUtils.clamp(camState.dist * (gesture.d / g.d), 7, 230);
          panBy(g.mx - gesture.mx, g.my - gesture.my, true);
          gesture = g;
        }
        return;
      }
      if (!down) {
        if (prev || e.pointerType !== "mouse") return;
        // 호버 커서
        const now = performance.now();
        if (now - lastHover > 90 && rt.world) {
          lastHover = now;
          const p = pickWorld(rt.world, terrain, rayAt(e.clientX, e.clientY));
          el.style.cursor = p && (p.k === "item" || p.k === "animal" || p.k === "fish") ? "grab" : p && p.k !== "ground" && p.k !== "water" ? "pointer" : "";
        }
        return;
      }
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (down.mode === "pending" && Math.hypot(dx, dy) > DRAG_PX) {
        if (down.pick && startDrag(down.pick)) down.mode = "drag";
        else down.mode = "orbit";
      }
      if (down.mode === "orbit") {
        camState.yaw -= mdx * 0.0055;
        camState.pitch = THREE.MathUtils.clamp(camState.pitch + mdy * 0.0045, 0.12, 1.45);
      } else if (down.mode === "pan") {
        panBy(mdx, mdy, e.pointerType !== "mouse");
      } else if (down.mode === "drag" && down.pick) {
        const g = groundAt(e.clientX, e.clientY);
        if (g) {
          const now = performance.now();
          const target = { k: down.pick.k, id: down.pick.id };
          if (now - down.lastSend > 66 || rt.isHost) {
            down.lastSend = now;
            rt.interact({ kind: "dragMove", target, x: g.x, z: g.z });
          } else if (rt.dragLocal) {
            rt.dragLocal.x = g.x;
            rt.dragLocal.z = g.z;
          }
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 2) gesture = gestureOf();
      else if (pointers.size < 2) gesture = null;
      if (!down) return;
      const d = down;
      down = null;
      if (d.mode === "drag" && d.pick) {
        endDrag(d.pick, e.clientX, e.clientY);
        return;
      }
      if (d.mode !== "pending" || d.button !== 0) return;
      click(d.pick);
    };

    const click = (p: Pick | null) => {
      if (!p || !rt.world) return;
      if (p.k === "person") {
        const hud = useHud.getState();
        // 같은 사람을 빠르게 두 번 누르면 따라가기 (모바일에는 dblclick이 없을 수 있다)
        const now = performance.now();
        const twice = lastPersonTap.id === p.id && now - lastPersonTap.t < 420;
        lastPersonTap = { id: p.id ?? -1, t: now };
        useHud.setState({ selectedId: p.id ?? null, structId: null, followId: twice ? p.id ?? null : hud.followId === p.id ? p.id : hud.followId });
        if (!hud.hint) useHud.setState({ hint: "사람은 건드릴 수 없어요. 대신 주변 환경을 바꿔 도와줄 수 있어요." });
        return;
      }
      rt.interact({ kind: "hit", target: { k: p.k, id: p.id }, x: p.x, z: p.z });
      rt.localFx.push({ type: "click", x: p.x, z: p.z });
      const st = p.k === "structure" ? findById(rt.world.structures, p.id) : undefined;
      useHud.setState(st ? { structId: st.id, selectedId: null } : { structId: null });
      if (st && st.type !== "campfire") {
        const now = performance.now();
        taps.n = taps.id === st.id && now - taps.t < 650 ? taps.n + 1 : 1;
        taps.id = st.id;
        taps.t = now;
        const name = STRUCTS[st.type].name;
        if (st.type === "raft" || st.type === "grave") return;
        if (taps.n === 2) useHud.setState({ hint: `🔨 한 번 더 두드리면 ${name}에 금이 가요` });
        if (taps.n >= 3) {
          taps.n = 0;
          rt.interact({ kind: "smash", target: { k: "structure", id: st.id }, x: st.x, z: st.z });
          rt.localFx.push({ type: "crack", x: st.x, z: st.z });
          useHud.setState({ hint: `💥 쾅! ${name}의 내구도가 깎였어요` });
        }
        return;
      }
      if (p.k === "beast") useHud.setState({ hint: "💫 맹수가 휘청거려요! 사람들이 맞설 틈이 생겼어요." });
      // 연타 → 불 지피기
      const now = performance.now();
      while (clicks.length && now - clicks[0].t > RAPID_WINDOW) clicks.shift();
      const near = clicks.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) < 2.2);
      if (near.length !== clicks.length) clicks.length = 0;
      clicks.push({ t: now, x: p.x, z: p.z });
      const n = clicks.length;
      const flammable = p.k === "ground" || p.k === "item" || (p.k === "structure" && st?.type === "campfire");
      if (n >= 2 && flammable) {
        rt.localFx.push({ type: "spark", x: p.x, z: p.z });
        useHud.setState({ hint: `불씨가 일어나고 있어요… ${"●".repeat(n)}${"○".repeat(Math.max(0, RAPID_CLICKS - n))}` });
      }
      if (n >= RAPID_CLICKS && flammable) {
        clicks.length = 0;
        const it = p.k === "item" ? findById(rt.world.items, p.id) : undefined;
        const st = p.k === "structure" ? findById(rt.world.structures, p.id) : undefined;
        const target = it && (it.res === "wood" || it.res === "stick") ? { k: "item" as const, id: it.id } : st?.type === "campfire" ? { k: "structure" as const, id: st.id } : { k: "ground" as const };
        rt.interact({ kind: "ignite", target, x: p.x, z: p.z });
        useHud.setState({ hint: "🔥 불을 지폈어요!" });
      }
    };

    const onDbl = (e: MouseEvent) => {
      const w = rt.world;
      if (!w) return;
      const p = pickWorld(w, terrain, rayAt(e.clientX, e.clientY));
      if (p?.k === "person") {
        useHud.setState({ selectedId: p.id ?? null, followId: p.id ?? null });
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camState.dist = THREE.MathUtils.clamp(camState.dist * Math.exp(e.deltaY * 0.0012), 7, 230);
    };
    const onCtx = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.type === "keydown") keys.current.add(e.key.toLowerCase());
      else keys.current.delete(e.key.toLowerCase());
    };
    const onBlur = () => keys.current.clear();

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __pick: unknown }).__pick = (cx: number, cy: number) => (rt.world ? pickWorld(rt.world, terrain, rayAt(cx, cy)) : null);
    }
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("dblclick", onDbl);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [gl, camera, terrain, rt, amb, size]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const k = keys.current;
    const sp = camState.dist * 0.9 * dt;
    const sy = Math.sin(camState.yaw), cy = Math.cos(camState.yaw);
    let mx = 0, mz = 0;
    if (k.has("w") || k.has("arrowup")) mz -= 1;
    if (k.has("s") || k.has("arrowdown")) mz += 1;
    if (k.has("a") || k.has("arrowleft")) mx -= 1;
    if (k.has("d") || k.has("arrowright")) mx += 1;
    if (mx || mz) {
      camState.tx += (mx * cy + mz * sy) * sp;
      camState.tz += (-mx * sy + mz * cy) * sp;
      useHud.setState({ followId: null });
    }
    if (k.has("q")) camState.yaw += dt * 1.2;
    if (k.has("e")) camState.yaw -= dt * 1.2;

    // 따라가기
    const fid = useHud.getState().followId;
    if (fid != null && rt.world) {
      const p = findById(rt.world.people, fid);
      if (p) {
        camState.tx += (p.x - camState.tx) * (1 - Math.exp(-dt * 3));
        camState.tz += (p.z - camState.tz) * (1 - Math.exp(-dt * 3));
      }
    }
    const lim = 150;
    camState.tx = THREE.MathUtils.clamp(camState.tx, -lim, lim);
    camState.tz = THREE.MathUtils.clamp(camState.tz, -lim, lim);
    camState.ty = Math.max(0, terrain.height(camState.tx, camState.tz)) + 1.2;

    const c = camState.cur;
    const f = 1 - Math.exp(-dt * 6);
    c.tx += (camState.tx - c.tx) * f;
    c.tz += (camState.tz - c.tz) * f;
    c.ty += (camState.ty - c.ty) * f;
    c.yaw += (camState.yaw - c.yaw) * f;
    c.pitch += (camState.pitch - c.pitch) * f;
    c.dist += (camState.dist - c.dist) * (1 - Math.exp(-dt * 4));
    const cp = Math.cos(c.pitch);
    let px = c.tx + Math.sin(c.yaw) * cp * c.dist;
    let pz = c.tz + Math.cos(c.yaw) * cp * c.dist;
    let py = c.ty + Math.sin(c.pitch) * c.dist;
    // 지형 아래로 들어가지 않게
    const floor = Math.max(terrain.height(px, pz), 0) + 1.5;
    if (py < floor) py = floor;
    px = THREE.MathUtils.clamp(px, -400, 400);
    pz = THREE.MathUtils.clamp(pz, -400, 400);
    // 지진: 화면이 떨린다
    const q = env.quake;
    if (q > 0.01) {
      const a = q * Math.min(1.2, c.dist * 0.03);
      px += (Math.random() - 0.5) * a;
      py += (Math.random() - 0.5) * a * 0.6;
      pz += (Math.random() - 0.5) * a;
    }
    camera.position.set(px, py, pz);
    camera.lookAt(c.tx, c.ty, c.tz);
    amb?.rumble(q);
    camState.camera = camera;
  });

  return null;
}
