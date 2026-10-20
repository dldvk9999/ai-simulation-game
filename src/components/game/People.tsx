"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ageYears } from "@/sim/clock";
import { dominant } from "@/sim/people";
import type { Terrain } from "@/sim/terrain";
import { EMOJI } from "@/sim/text";
import type { Person } from "@/sim/types";
import { findById } from "@/sim/world";
import { useHud } from "@/game/hud";
import { useLabelLayer, useRuntime, useWorldVersion } from "./context";
import { follow, lerpAngle } from "./env";
import { flat } from "./geo";

const SKIN = ["#f6d7c3", "#eec1a0", "#dfa984", "#c08560", "#946042"];
const HAIR = ["#2b211c", "#4a3426", "#7a5230", "#c9a16a", "#1c1c1c", "#9b3b26", "#5a4030"];
const RAG = ["#c9bba0", "#a8b8c8", "#b9a58c", "#c7b7b0"];
const CLOTH = ["#e07a5f", "#81b29a", "#f2cc8f", "#3d85c6", "#c27ba0", "#8fbc5a", "#6c8ebf"];
const MODERN = ["#4a90d9", "#efefef", "#d9534f", "#5cb85c", "#f0ad4e", "#7b68ee"];
const pickC = (arr: string[], v: number) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];

function outfitColors(p: Person) {
  switch (p.outfit) {
    case "fur": return { top: "#8a6040", pants: "#6e4a30" };
    case "cloth": { const c = pickC(CLOTH, p.hue.cloth); return { top: c, pants: new THREE.Color(c).multiplyScalar(0.6).getStyle() }; }
    case "modern": return { top: pickC(MODERN, p.hue.cloth), pants: "#3b4a5a" };
    default: return { top: pickC(RAG, p.hue.cloth), pants: "#6b7a8a" };
  }
}

const box = new THREE.BoxGeometry(1, 1, 1);
const headGeo = new THREE.IcosahedronGeometry(0.2, 1);
const eyeMat = flat("#1d1d1f");
const blushMat = new THREE.MeshBasicMaterial({ color: "#ff8fa3", transparent: true, opacity: 0.7 });
const ringGeo = new THREE.RingGeometry(0.5, 0.62, 24);
const ringMat = new THREE.MeshBasicMaterial({ color: "#fff6c2", transparent: true, opacity: 0.85, depthWrite: false });
const toolMats = { wood: flat("#8a5f3d"), stone: flat("#8c877f"), string: flat("#e8e2d0") };

const CARRY_COLOR: Record<string, string> = {
  wood: "#8a5a3b", stick: "#9b6b45", stone: "#9b968e", fiber: "#bcd46a", clay: "#b0664a", ore: "#5d5753", herb: "#9a7ad6",
  berry: "#c2265a", fruit: "#e9823a", meat: "#d77a7a", fish: "#8fb8d6", crop: "#d9c25a",
};

interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  eyes: THREE.Group;
  blush: THREE.Group;
  carry: THREE.Mesh;
  tools: Record<string, THREE.Object3D>;
  ring: THREE.Mesh;
}

function PersonView({ id, terrain }: { id: number; terrain: Terrain }) {
  const rt = useRuntime();
  const { camera, size } = useThree();
  const layer = useLabelLayer();
  const p0 = rt.world ? findById(rt.world.people, id) : undefined;
  const rig = useRef<Partial<Rig>>({});
  const disp = useRef({ x: p0?.x ?? 0, z: p0?.z ?? 0, r: p0?.rot ?? 0 });
  const label = useMemo(() => {
    const el = document.createElement("div");
    el.className = "person-tag";
    const text = document.createElement("div");
    text.className = "bubble";
    text.style.display = "none";
    const emo = document.createElement("div");
    emo.className = "emo";
    const name = document.createElement("div");
    name.className = "name";
    el.append(text, emo, name);
    return { el, text, emo, name };
  }, []);
  useEffect(() => {
    if (!layer) return;
    layer.appendChild(label.el);
    return () => label.el.remove();
  }, [layer, label]);
  const head = useMemo(() => new THREE.Vector3(), []);
  const last = useRef({ text: "", emoji: "", vis: "" });
  const phase = useMemo(() => (id * 1.618) % 6.28, [id]);

  const outfitKey = p0 ? `${p0.outfit}` : "rag";
  const mats = useMemo(() => {
    if (!p0) return null;
    const oc = outfitColors(p0);
    const yrs = rt.world ? ageYears(p0.birth, rt.world.time) : 30;
    const hair = yrs > 62 ? "#d8d4cc" : pickC(HAIR, p0.hue.hair);
    return {
      skin: flat(pickC(SKIN, p0.hue.skin)),
      hair: flat(hair),
      top: flat(oc.top),
      pants: flat(oc.pants),
      long: p0.sex === "F",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, outfitKey]);

  useFrame((state, dt) => {
    const w = rt.world;
    const r = rig.current as Rig;
    if (!w || !r.root) return;
    const p = findById(w.people, id);
    if (!p) return;
    const selected = useHud.getState().selectedId === id;
    const t = state.clock.elapsedTime + phase;
    follow(disp.current, p.x, p.z, dt, 7);
    disp.current.r = lerpAngle(disp.current.r, p.rot, 1 - Math.exp(-dt * 8));
    const yrs = ageYears(p.birth, w.time);
    const scale = 0.42 + 0.58 * Math.min(1, yrs / 16);
    const ground = terrain.height(disp.current.x, disp.current.z);
    r.root.position.set(disp.current.x, Math.max(ground, -0.55), disp.current.z);
    r.root.rotation.y = -disp.current.r;
    r.root.scale.setScalar(scale);

    // 초기 자세
    let by = 0, bz = 0, bx = 0, tz = yrs > 64 ? -0.18 : 0, tx = 0, hz = 0, hy = 0, hx = 0;
    let aL = 0.05, aR = 0.05, aLx = -0.08, aRx = 0.08, lL = 0, lR = 0;
    let eyes = 1;
    let tool = "";
    const anim = p.alive ? p.anim : "lie";
    const s = Math.sin;
    switch (anim) {
      case "walk": case "carry": {
        const k = s(t * 9);
        lL = k * 0.55; lR = -k * 0.55;
        aL = -k * 0.45; aR = k * 0.45;
        by = Math.abs(s(t * 9)) * 0.04;
        if (anim === "carry") { aL = 0.9; aR = 0.9; aLx = -0.25; aRx = 0.25; }
        if (p.emo.sadness > 0.5) { hz = -0.35; tz -= 0.1; }
        break;
      }
      case "run": case "play": {
        const k = s(t * 14);
        lL = k * 0.9; lR = -k * 0.9;
        aL = -k * 0.8; aR = k * 0.8;
        by = Math.abs(s(t * 14)) * 0.08;
        tz -= 0.18;
        if (anim === "play") { aL = 2.6 + k * 0.3; aR = 2.6 - k * 0.3; }
        break;
      }
      case "chop": {
        const k = (s(t * 6) + 1) / 2;
        aL = aR = 1.2 + k * 1.6; aLx = -0.15; aRx = 0.15;
        tz = -0.1 - (1 - k) * 0.25;
        tool = "axe";
        break;
      }
      case "pick": case "dig": {
        tz = -0.85; lL = lR = 0.25; by = -0.05;
        aL = 0.9 + s(t * 4) * 0.25; aR = 0.9 - s(t * 4) * 0.25;
        if (anim === "dig") { aL = aR = 0.8 + s(t * 5) * 0.5; tool = "stick"; }
        break;
      }
      case "knap": case "stir": {
        by = -0.45; lL = lR = 1.5;
        tz = -0.25;
        aL = 0.9; aR = 1.0 + Math.abs(s(t * 11)) * 0.5;
        if (anim === "stir") { aR = 1.1 + s(t * 4) * 0.3; aRx = 0.2 + Math.cos(t * 4) * 0.2; tool = "stick"; }
        break;
      }
      case "hammer": {
        aR = 1.6 + Math.abs(s(t * 9)) * 1.0; aL = 0.6;
        tz = -0.2;
        tool = "hammer";
        break;
      }
      case "sit": case "think": case "eat": case "sing": case "talk": {
        if (anim !== "talk") { by = -0.48; lL = lR = 1.45; }
        aL = aR = 0.35;
        if (anim === "think") { aR = 2.4; aRx = -0.35; hz = 0.12; hx = 0.15; }
        if (anim === "eat") { aR = 2.1 + s(t * 6) * 0.25; aRx = -0.2; }
        if (anim === "sing") { tx = s(t * 2) * 0.12; hx = s(t * 2) * 0.2; hz = 0.2; }
        if (anim === "talk") { aR = 0.6 + Math.abs(s(t * 3)) * 0.8; hz = s(t * 4) * 0.08; }
        if (anim === "sit") hy = s(t * 0.4) * 0.5;
        break;
      }
      case "drink": case "pray": {
        by = -0.42; lL = lR = 1.5; tz = anim === "drink" ? -0.7 : -0.3; hz = -0.4;
        aL = aR = 1.1; aLx = 0.2; aRx = -0.2;
        break;
      }
      case "sleep": case "lie": {
        bz = Math.PI / 2; by = 0.18; eyes = 0.12;
        aL = aR = 0.1; aLx = -0.2; aRx = 0.2;
        bx = 0;
        break;
      }
      case "swim": {
        bz = -Math.PI / 2 + 0.2; by = -0.25;
        aL = s(t * 4) * 2; aR = -s(t * 4) * 2;
        lL = s(t * 8) * 0.3; lR = -s(t * 8) * 0.3;
        hz = 0.8;
        break;
      }
      case "fish": {
        aL = aR = 1.0; aLx = 0.25; aRx = -0.25;
        tool = "rod";
        if (p.act?.sub === "spear") tool = "spear";
        if (p.act?.sub === "hand") { tz = -0.7; aL = aR = 1.1 + s(t * 5) * 0.2; tool = ""; }
        break;
      }
      case "throw": {
        const k = (t * 1.5) % 1;
        aR = k < 0.7 ? 2.8 : 2.8 - (k - 0.7) * 8;
        aL = 0.4;
        tool = "spear";
        break;
      }
      case "cheer": {
        by = Math.abs(s(t * 8)) * 0.35;
        aL = 2.9 + s(t * 10) * 0.2; aR = 2.9 - s(t * 10) * 0.2; aLx = -0.35; aRx = 0.35;
        hz = 0.25;
        break;
      }
      case "dance": {
        tx = s(t * 5) * 0.25;
        aL = 2.4 + s(t * 5) * 0.6; aR = 2.4 - s(t * 5) * 0.6;
        lL = Math.max(0, s(t * 5)) * 0.5; lR = Math.max(0, -s(t * 5)) * 0.5;
        by = Math.abs(s(t * 10)) * 0.08;
        break;
      }
      case "slump": {
        hz = -0.55; tz = -0.25; aL = aR = -0.05; by = -0.03;
        break;
      }
      case "cower": {
        by = -0.4; lL = lR = 1.3; tz = -0.45; hz = -0.4;
        aL = aR = 2.5; aLx = -0.6; aRx = 0.6;
        bx = s(t * 45) * 0.03;
        break;
      }
      case "stomp": {
        const k = s(t * 14);
        lL = Math.max(0, k) * 0.6; lR = Math.max(0, -k) * 0.6;
        aL = aR = 0.3 + Math.abs(k) * 0.4; aLx = -0.4; aRx = 0.4;
        hz = -0.15;
        break;
      }
      case "startle": {
        tz = 0.3; by = 0.08 + Math.abs(s(t * 6)) * 0.05;
        aLx = -1.3; aRx = 1.3; aL = aR = 0.6;
        break;
      }
      case "heart": {
        aL = aR = 1.3; aLx = 0.55; aRx = -0.55;
        tx = s(t * 2) * 0.1; hz = 0.15;
        break;
      }
      case "stretch": {
        aL = aR = 3.0; aLx = -0.2; aRx = 0.2; tz = 0.12 + s(t * 1.5) * 0.05;
        break;
      }
      case "wave": {
        aR = 2.8; aRx = 0.4 + s(t * 9) * 0.35;
        break;
      }
      default: {
        // 숨쉬기 + 두리번
        hy = s(t * 0.5) * 0.45;
        tz += s(t * 2) * 0.02;
        if (p.emo.sadness > 0.5) { hz = -0.4; aL = aR = -0.02; }
        if (p.emo.joy > 0.6) hz = 0.12;
      }
    }

    r.body.position.set(bx, by, 0);
    r.body.rotation.set(0, 0, bz);
    r.torso.rotation.set(tx, 0, tz);
    r.head.rotation.set(hx, hy, hz);
    r.armL.rotation.set(aLx, 0, aL);
    r.armR.rotation.set(aRx, 0, aR);
    r.legL.rotation.set(0, 0, lL);
    r.legR.rotation.set(0, 0, lR);
    r.eyes.scale.set(1, eyes, 1);
    r.blush.visible = p.emo.joy > 0.45 || p.emo.love > 0.4;
    for (const [k, o] of Object.entries(r.tools)) o.visible = k === tool;
    r.carry.visible = !!p.carry && anim !== "sleep";
    if (p.carry) (r.carry.material as THREE.MeshStandardMaterial).color.set(CARRY_COLOR[p.carry.res] ?? "#a07850");
    r.ring.visible = selected;

    // 말풍선
    const dist = camera.position.distanceTo(r.root.position);
    const el = label.el;
    label.name.textContent = p.name;
    head.set(r.root.position.x, r.root.position.y + (anim === "sleep" || anim === "lie" ? 0.9 : 2.2) * scale, r.root.position.z).project(camera);
    const onScreen = head.z < 1 && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1;
    if (onScreen) el.style.transform = `translate(${((head.x + 1) / 2) * size.width}px, ${((1 - head.y) / 2) * size.height}px) translate(-50%, -100%)`;
    {
      const bubble = p.bubble && p.bubble.until > w.time ? p.bubble : null;
      const [emo, strength] = dominant(p);
      // 평온할 때는 이모지를 숨겨 화면을 덜 어지럽힌다
      const emoji = !p.alive ? "🕯️" : anim === "sleep" ? "💤" : bubble?.emoji || (strength > 0.35 || selected ? EMOJI[emo] ?? "" : "");
      const text = bubble && dist < 70 ? bubble.text : "";
      const vis = dist > 150 || !onScreen ? "none" : "flex";
      if (vis !== last.current.vis) {
        el.style.display = vis;
        last.current.vis = vis;
      }
      if (text !== last.current.text) {
        label.text.textContent = text;
        label.text.style.display = text ? "block" : "none";
        last.current.text = text;
      }
      if (emoji !== last.current.emoji) {
        label.emo.textContent = emoji;
        last.current.emoji = emoji;
      }
      label.name.style.opacity = selected || dist < 28 ? "1" : "0";
    }
  });

  if (!p0 || !mats) return null;
  const set = <K extends keyof Rig>(k: K) => (o: Rig[K] | null) => {
    if (o) rig.current[k] = o;
  };
  const tools = (k: string) => (o: THREE.Object3D | null) => {
    if (!o) return;
    rig.current.tools ??= {};
    rig.current.tools[k] = o;
  };

  return (
    <group ref={set("root")}>
      <mesh ref={set("ring")} geometry={ringGeo} material={ringMat} rotation-x={-Math.PI / 2} position-y={0.05} visible={false} />
      <group ref={set("body")}>
        {/* 다리 */}
        <group ref={set("legL")} position={[0, 0.82, 0.11]}>
          <mesh geometry={box} material={mats.pants} position-y={-0.4} scale={[0.15, 0.8, 0.15]} castShadow />
          <mesh geometry={box} material={mats.skin} position={[0.04, -0.82, 0]} scale={[0.2, 0.06, 0.13]} />
        </group>
        <group ref={set("legR")} position={[0, 0.82, -0.11]}>
          <mesh geometry={box} material={mats.pants} position-y={-0.4} scale={[0.15, 0.8, 0.15]} castShadow />
          <mesh geometry={box} material={mats.skin} position={[0.04, -0.82, 0]} scale={[0.2, 0.06, 0.13]} />
        </group>
        {/* 몸통 */}
        <group ref={set("torso")} position-y={0.8}>
          <mesh geometry={box} material={mats.top} position-y={0.3} scale={[0.26, 0.62, 0.42]} castShadow />
          <mesh ref={set("carry")} geometry={box} position={[-0.22, 0.38, 0]} scale={[0.22, 0.36, 0.34]} visible={false} castShadow>
            <meshStandardMaterial color="#a07850" flatShading />
          </mesh>
          <group ref={set("armL")} position={[0, 0.56, 0.27]}>
            <mesh geometry={box} material={mats.top} position-y={-0.15} scale={[0.12, 0.32, 0.12]} castShadow />
            <mesh geometry={box} material={mats.skin} position-y={-0.43} scale={[0.1, 0.26, 0.1]} />
          </group>
          <group ref={set("armR")} position={[0, 0.56, -0.27]}>
            <mesh geometry={box} material={mats.top} position-y={-0.15} scale={[0.12, 0.32, 0.12]} castShadow />
            <mesh geometry={box} material={mats.skin} position-y={-0.43} scale={[0.1, 0.26, 0.1]} />
            {/* 손에 든 도구 */}
            <group position={[0.05, -0.55, 0]}>
              <group ref={tools("axe")} visible={false} rotation-z={Math.PI / 2}>
                <mesh geometry={box} material={toolMats.wood} scale={[0.04, 0.55, 0.04]} position-y={0.1} />
                <mesh geometry={box} material={toolMats.stone} scale={[0.08, 0.14, 0.18]} position={[0, 0.34, 0.05]} />
              </group>
              <group ref={tools("hammer")} visible={false} rotation-z={Math.PI / 2}>
                <mesh geometry={box} material={toolMats.wood} scale={[0.04, 0.4, 0.04]} position-y={0.1} />
                <mesh geometry={box} material={toolMats.stone} scale={[0.1, 0.1, 0.18]} position-y={0.3} />
              </group>
              <group ref={tools("spear")} visible={false} rotation-z={Math.PI / 2}>
                <mesh geometry={box} material={toolMats.wood} scale={[0.035, 1.6, 0.035]} position-y={0.2} />
                <mesh geometry={box} material={toolMats.stone} scale={[0.06, 0.14, 0.06]} position-y={1.05} />
              </group>
              <group ref={tools("rod")} visible={false} rotation-z={Math.PI / 2 + 0.6}>
                <mesh geometry={box} material={toolMats.wood} scale={[0.03, 1.8, 0.03]} position-y={0.8} />
                <mesh geometry={box} material={toolMats.string} scale={[0.008, 1.2, 0.008]} position={[0.3, 1.2, 0]} rotation-z={-1.0} />
              </group>
              <group ref={tools("stick")} visible={false} rotation-z={Math.PI / 2}>
                <mesh geometry={box} material={toolMats.wood} scale={[0.03, 0.6, 0.03]} position-y={0.15} />
              </group>
            </group>
          </group>
          {/* 머리 */}
          <group ref={set("head")} position-y={0.66}>
            <mesh geometry={headGeo} material={mats.skin} position-y={0.17} scale={[1, 1.05, 1]} castShadow />
            <mesh geometry={box} material={mats.hair} position={[-0.03, 0.33, 0]} scale={[0.4, 0.12, 0.42]} />
            {mats.long ? (
              <mesh geometry={box} material={mats.hair} position={[-0.16, 0.12, 0]} scale={[0.12, 0.42, 0.4]} />
            ) : (
              <mesh geometry={box} material={mats.hair} position={[-0.15, 0.22, 0]} scale={[0.1, 0.2, 0.38]} />
            )}
            <group ref={set("eyes")} position={[0.185, 0.2, 0]}>
              <mesh geometry={box} material={eyeMat} position-z={0.075} scale={[0.02, 0.05, 0.035]} />
              <mesh geometry={box} material={eyeMat} position-z={-0.075} scale={[0.02, 0.05, 0.035]} />
            </group>
            <group ref={set("blush")} position={[0.18, 0.12, 0]} visible={false}>
              <mesh geometry={box} material={blushMat} position-z={0.11} scale={[0.01, 0.035, 0.06]} />
              <mesh geometry={box} material={blushMat} position-z={-0.11} scale={[0.01, 0.035, 0.06]} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

export function People({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(100);
  const ids = useMemo(() => (rt.world ? rt.world.people.map((p) => `${p.id}:${p.outfit}`) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);
  return (
    <group>
      {ids.map((k) => {
        const id = Number(k.split(":")[0]);
        return <PersonView key={k} id={id} terrain={terrain} />;
      })}
    </group>
  );
}
