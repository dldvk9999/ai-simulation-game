"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { heightOf } from "@/sim/building";
import { roadLinks } from "@/sim/civic";
import { STRUCTS } from "@/sim/data";
import type { Terrain } from "@/sim/terrain";
import type { Structure, StructureType } from "@/sim/types";
import { shipPose } from "@/sim/voyage";
import { useAmbience, useRuntime, useWorldVersion } from "./context";
import { env } from "./env";
import { G, merge, part, vcMat } from "./geo";

const WOOD = "#9c6b43";
const WOOD_D = "#7a5235";
const STRAW = "#d9b65a";
const STONE = "#a8a39a";
const STONE_D = "#8c877f";
const ROOF = "#a5483a";

/** 박공지붕: x축을 따라 용마루, 양 끝은 벽 색 삼각형 */
function gable(w: number, d: number, h: number, y: number, color: string, wall: string) {
  const len = Math.hypot(d / 2, h) + 0.2;
  const ang = Math.atan2(h, d / 2);
  return [
    part(G.box, { color, pos: [0, y + h / 2, d / 4], scale: [w + 0.35, 0.12, len], rot: [ang, 0, 0] }),
    part(G.box, { color, pos: [0, y + h / 2, -d / 4], scale: [w + 0.35, 0.12, len], rot: [-ang, 0, 0] }),
    part(G.cyl(1, 1, w, 3), { color: wall, pos: [0, y + h / 3, 0], rot: [-Math.PI / 2, 0, Math.PI / 2], scale: [d / Math.sqrt(3), 1, h / 1.5] }),
  ];
}

interface Model {
  geo: THREE.BufferGeometry;
  windows?: THREE.BufferGeometry;
}

const BRICK = "#b5654a";
const CREAM = "#efe4cc";
const SLATE = "#56606b";

/** 층마다 창을 낸다 (앞뒤, 양옆) */
function floorWindows(w: number, d: number, y: number, per: number) {
  const out = [];
  for (let i = 0; i < per; i++) {
    const z = -d / 2 + (d / per) * (i + 0.5);
    out.push(part(G.box, { color: "#ffffff", pos: [w / 2 + 0.02, y, z], scale: [0.06, 0.62, 0.5] }));
    out.push(part(G.box, { color: "#ffffff", pos: [-w / 2 - 0.02, y, z], scale: [0.06, 0.62, 0.5] }));
  }
  for (const x of [-w / 4, w / 4]) {
    out.push(part(G.box, { color: "#ffffff", pos: [x, y, d / 2 + 0.02], scale: [0.5, 0.62, 0.06] }));
    out.push(part(G.box, { color: "#ffffff", pos: [x, y, -d / 2 - 0.02], scale: [0.5, 0.62, 0.06] }));
  }
  return out;
}

/** 층수에 따라 높아지는 건물들 */
function storied(type: StructureType, lv: number): Model | null {
  switch (type) {
    case "watchtower": {
      // 나무 기둥 위의 망대: 층마다 가새를 엇갈려 묶었다
      const H = lv * 2.2;
      const parts = [];
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(part(G.cyl(0.09, 0.12, H + 0.4, 5), { color: WOOD_D, pos: [x * 0.85, (H + 0.4) / 2, z * 0.85], rot: [z * 0.05, 0, -x * 0.05] }));
      for (let i = 0; i < lv; i++) {
        const y = 1.1 + i * 2.2;
        parts.push(part(G.box, { color: WOOD, pos: [0.85, y, 0], scale: [0.06, 0.08, 2.2], rot: [0.75, 0, 0] }));
        parts.push(part(G.box, { color: WOOD, pos: [-0.85, y, 0], scale: [0.06, 0.08, 2.2], rot: [-0.75, 0, 0] }));
        parts.push(part(G.box, { color: WOOD, pos: [0, y, 0.85], scale: [2.2, 0.08, 0.06], rot: [0, 0, 0.75] }));
        parts.push(part(G.box, { color: WOOD, pos: [0, y, -0.85], scale: [2.2, 0.08, 0.06], rot: [0, 0, -0.75] }));
      }
      parts.push(part(G.box, { color: WOOD, pos: [0, H, 0], scale: [2.3, 0.14, 2.3] }));
      for (const [x, z, w, d] of [[1.1, 0, 0.08, 2.3], [-1.1, 0, 0.08, 2.3], [0, 1.1, 2.3, 0.08], [0, -1.1, 2.3, 0.08]]) parts.push(part(G.box, { color: WOOD_D, pos: [x, H + 0.45, z], scale: [w, 0.7, d] }));
      parts.push(part(G.cone(1.75, 1.2, 4), { color: STRAW, pos: [0, H + 1.85, 0], rot: [0, Math.PI / 4, 0] }));
      for (const [x, z] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) parts.push(part(G.cyl(0.05, 0.05, 1.3, 4), { color: WOOD_D, pos: [x * 1.05, H + 0.9, z * 1.05] }));
      // 사다리
      parts.push(part(G.box, { color: WOOD_D, pos: [1.25, H / 2, 0.25], scale: [0.06, H, 0.06], rot: [0, 0, 0.12] }));
      parts.push(part(G.box, { color: WOOD_D, pos: [1.25, H / 2, -0.25], scale: [0.06, H, 0.06], rot: [0, 0, 0.12] }));
      for (let y = 0.5; y < H; y += 0.5) parts.push(part(G.box, { color: WOOD, pos: [1.25 + (H / 2 - y) * 0.12, y, 0], scale: [0.05, 0.05, 0.5] }));
      return { geo: merge(parts) };
    }
    case "fort": {
      // 돌을 쌓은 성루: 위에는 성가퀴, 벽에는 활 쏘는 구멍
      const H = lv * 2.3;
      const parts = [
        part(G.box, { color: STONE_D, pos: [0, 0.3, 0], scale: [4.0, 0.6, 4.0] }),
        part(G.cyl(1.9, 2.15, H, 4), { color: "#b7b1a7", pos: [0, H / 2 + 0.3, 0], rot: [0, Math.PI / 4, 0] }),
        part(G.box, { color: STONE_D, pos: [0, H + 0.4, 0], scale: [3.1, 0.25, 3.1] }),
        part(G.box, { color: "#4f3a2a", pos: [1.56, 1.0, 0], scale: [0.1, 1.5, 0.9] }),
      ];
      for (let i = 0; i < 4; i++) for (const k of [-1, 0, 1]) {
        const a = (i * Math.PI) / 2;
        const ox = Math.cos(a) * 1.5 - Math.sin(a) * k * 1.05, oz = Math.sin(a) * 1.5 + Math.cos(a) * k * 1.05;
        parts.push(part(G.box, { color: "#c2bdb3", pos: [ox, H + 0.8, oz], scale: [0.5, 0.55, 0.5] }));
      }
      const slits = [];
      for (let f = 1; f < lv; f++) for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + 0.0;
        slits.push(part(G.box, { color: "#ffffff", pos: [Math.cos(a) * 1.62, f * 2.3 + 0.5, Math.sin(a) * 1.62], scale: [i % 2 ? 0.14 : 0.06, 0.55, i % 2 ? 0.06 : 0.14] }));
      }
      parts.push(part(G.cyl(0.04, 0.04, 1.8, 4), { color: WOOD_D, pos: [-1.1, H + 1.5, -1.1] }));
      return { geo: merge(parts), windows: slits.length ? merge(slits) : undefined };
    }
    case "battery": {
      // 둥근 돌 포대 위에 대포 한 문
      const parts = [
        part(G.cyl(2.2, 2.4, 1.5, 12), { color: "#a8a39a", pos: [0, 0.75, 0] }),
        part(G.cyl(2.25, 2.25, 0.5, 12), { color: STONE_D, pos: [0, 1.75, 0] }),
        part(G.cyl(1.8, 1.8, 0.1, 12), { color: "#8f8a82", pos: [0, 1.55, 0] }),
        part(G.box, { color: WOOD_D, pos: [0.2, 1.9, 0], scale: [1.0, 0.3, 0.8] }),
        part(G.cyl(0.32, 0.32, 0.12, 8), { color: WOOD_D, pos: [0.2, 1.75, 0.48], rot: [Math.PI / 2, 0, 0] }),
        part(G.cyl(0.32, 0.32, 0.12, 8), { color: WOOD_D, pos: [0.2, 1.75, -0.48], rot: [Math.PI / 2, 0, 0] }),
        part(G.cyl(0.17, 0.24, 2.2, 8), { color: "#2f3135", pos: [1.0, 2.25, 0], rot: [0, 0, -Math.PI / 2 + 0.18] }),
        part(G.box, { color: "#4f3a2a", pos: [-2.25, 0.6, 0], scale: [0.1, 1.0, 0.8] }),
      ];
      for (let i = 0; i < 6; i++) parts.push(part(G.ico(0.14, 0), { color: "#2f3135", pos: [-0.6 + (i % 3) * 0.28, 1.72 + Math.floor(i / 3) * 0.22, -1.0] }));
      return { geo: merge(parts) };
    }
    case "townhouse": {
      // 여러 가족이 함께 사는 층집: 층마다 띠를 두르고 창을 냈다
      const W = 5.0, D = 3.8, FH = 2.4, H = lv * FH;
      const parts = [part(G.box, { color: STONE_D, pos: [0, 0.15, 0], scale: [W + 0.3, 0.3, D + 0.3] })];
      const win = [];
      for (let f = 0; f < lv; f++) {
        parts.push(part(G.box, { color: f % 2 ? "#dcd2bd" : CREAM, pos: [0, f * FH + FH / 2 + 0.2, 0], scale: [W, FH, D] }));
        parts.push(part(G.box, { color: BRICK, pos: [0, (f + 1) * FH + 0.2, 0], scale: [W + 0.12, 0.14, D + 0.12] }));
        win.push(...floorWindows(W, D, f * FH + 1.5, 3));
      }
      parts.push(...gable(W, D, 1.4, H + 0.27, ROOF, CREAM));
      parts.push(part(G.box, { color: "#4f3a2a", pos: [W / 2 + 0.03, 0.95, 0], scale: [0.06, 1.5, 0.8] }));
      parts.push(part(G.box, { color: BRICK, pos: [-1.4, H + 1.4, -1.0], scale: [0.45, 1.4, 0.45] }));
      return { geo: merge(parts), windows: merge(win) };
    }
    case "apartment": {
      // 철골 고층 건물: 옥상에는 물탱크
      const W = 5.4, D = 5.0, FH = 2.4, H = lv * FH;
      const parts = [
        part(G.box, { color: "#8f949a", pos: [0, 0.15, 0], scale: [W + 0.4, 0.3, D + 0.4] }),
        part(G.box, { color: "#d9d6cf", pos: [0, H / 2 + 0.3, 0], scale: [W, H, D] }),
        part(G.box, { color: "#a6abb1", pos: [0, H + 0.42, 0], scale: [W + 0.15, 0.25, D + 0.15] }),
        part(G.cyl(0.6, 0.6, 1.2, 10), { color: "#8a6a4a", pos: [-1.3, H + 1.15, 1.1] }),
        part(G.cone(0.65, 0.4, 10), { color: "#6e5034", pos: [-1.3, H + 1.95, 1.1] }),
        part(G.box, { color: SLATE, pos: [W / 2 + 0.5, 2.6, 0], scale: [1.0, 0.12, 2.0] }),
        part(G.box, { color: "#3b4652", pos: [W / 2 + 0.03, 1.2, 0], scale: [0.06, 2.0, 1.4] }),
      ];
      for (let f = 1; f < lv; f++) parts.push(part(G.box, { color: "#bfbab1", pos: [0, f * FH + 0.3, 0], scale: [W + 0.08, 0.1, D + 0.08] }));
      const win = [];
      for (let f = 0; f < lv; f++) win.push(...floorWindows(W, D, f * FH + 1.5, 4));
      return { geo: merge(parts), windows: merge(win) };
    }
    case "factory": {
      // 톱니 지붕의 벽돌 공장과 높은 굴뚝
      const W = 6.2, D = 4.4, FH = 2.6, H = lv * FH;
      const parts = [
        part(G.box, { color: STONE_D, pos: [0, 0.15, 0], scale: [W + 0.3, 0.3, D + 0.3] }),
        part(G.box, { color: BRICK, pos: [0, H / 2 + 0.3, 0], scale: [W, H, D] }),
        part(G.cyl(0.45, 0.6, H + 5, 10), { color: "#8e4a36", pos: [-W / 2 + 0.6, (H + 5) / 2, -D / 2 + 0.6] }),
        part(G.cyl(0.5, 0.5, 0.3, 10), { color: "#3a3a3a", pos: [-W / 2 + 0.6, H + 5.1, -D / 2 + 0.6] }),
        part(G.box, { color: "#3b4652", pos: [W / 2 + 0.03, 1.2, 0], scale: [0.06, 2.0, 1.6] }),
      ];
      for (let i = 0; i < 4; i++) {
        const z = -D / 2 + D / 8 + (i * D) / 4;
        parts.push(part(G.box, { color: SLATE, pos: [0, H + 0.75, z], scale: [W, 0.1, 1.3], rot: [0.55, 0, 0] }));
      }
      const win = [];
      for (let f = 0; f < lv; f++) win.push(...floorWindows(W, D, f * FH + 1.6, 4));
      return { geo: merge(parts), windows: merge(win) };
    }
  }
  return null;
}

function buildModel(type: StructureType, lv = 1): Model {
  const tall = storied(type, lv);
  if (tall) return tall;
  switch (type) {
    case "campfire": {
      const parts = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part(G.dodec(0.15), { color: i % 2 ? STONE : STONE_D, pos: [Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55] }));
      }
      parts.push(part(G.cyl(0.07, 0.07, 0.9, 5), { color: "#6b4630", pos: [0, 0.12, 0], rot: [0, 0.6, Math.PI / 2] }));
      parts.push(part(G.cyl(0.07, 0.07, 0.9, 5), { color: "#5e3d29", pos: [0, 0.16, 0], rot: [0, -0.9, Math.PI / 2] }));
      parts.push(part(G.cyl(0.4, 0.45, 0.03, 10), { color: "#3b3631", pos: [0, 0.02, 0] }));
      return { geo: merge(parts) };
    }
    case "leanto":
      return {
        geo: merge([
          part(G.cyl(0.06, 0.07, 1.7, 5), { color: WOOD_D, pos: [0.7, 0.85, 0.9] }),
          part(G.cyl(0.06, 0.07, 1.7, 5), { color: WOOD_D, pos: [0.7, 0.85, -0.9] }),
          part(G.box, { color: WOOD, pos: [0.05, 0.95, 0], scale: [1.9, 0.08, 2.1], rot: [0, 0, 0.75] }),
          part(G.box, { color: "#5f9e47", pos: [0.0, 1.02, 0], scale: [1.95, 0.1, 2.2], rot: [0, 0, 0.75] }),
          part(G.box, { color: "#8a7a4a", pos: [0.2, 0.04, 0], scale: [1.4, 0.06, 1.6] }),
        ]),
      };
    case "hut":
      return {
        geo: merge([
          part(G.cyl(1.55, 1.6, 1.4, 10), { color: WOOD, pos: [0, 0.7, 0] }),
          part(G.cone(2.1, 1.7, 10), { color: STRAW, pos: [0, 2.2, 0] }),
          part(G.cyl(0.12, 0.12, 0.3, 5), { color: "#b8953f", pos: [0, 3.1, 0] }),
          part(G.box, { color: "#3e2a1c", pos: [1.52, 0.55, 0], scale: [0.12, 1.1, 0.7] }),
        ]),
      };
    case "loghouse":
      return {
        geo: merge([
          part(G.box, { color: "#a0683f", pos: [0, 0.9, 0], scale: [3.4, 1.8, 2.8] }),
          part(G.box, { color: "#8a5634", pos: [0, 0.35, 0], scale: [3.5, 0.15, 2.9] }),
          part(G.box, { color: "#8a5634", pos: [0, 1.0, 0], scale: [3.5, 0.15, 2.9] }),
          part(G.box, { color: "#8a5634", pos: [0, 1.6, 0], scale: [3.5, 0.15, 2.9] }),
          ...gable(3.4, 2.8, 1.1, 1.8, "#7a3b2a", "#a0683f"),
          part(G.box, { color: "#5a3b26", pos: [1.72, 0.65, 0], scale: [0.08, 1.3, 0.75] }),
          part(G.box, { color: STONE_D, pos: [-1.0, 2.8, 0.8], scale: [0.4, 1.2, 0.4] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [1.72, 1.15, 0.95], scale: [0.06, 0.5, 0.5] }),
          part(G.box, { color: "#ffffff", pos: [1.72, 1.15, -0.95], scale: [0.06, 0.5, 0.5] }),
        ]),
      };
    case "stonehouse":
      return {
        geo: merge([
          part(G.box, { color: "#c2bdb3", pos: [0, 1.1, 0], scale: [3.8, 2.2, 3.2] }),
          part(G.box, { color: STONE_D, pos: [0, 0.15, 0], scale: [3.95, 0.3, 3.35] }),
          ...gable(3.8, 3.2, 1.3, 2.2, ROOF, "#c2bdb3"),
          part(G.box, { color: "#4f3a2a", pos: [1.92, 0.75, 0], scale: [0.08, 1.4, 0.8] }),
          part(G.box, { color: STONE_D, pos: [-1.1, 3.3, -0.9], scale: [0.45, 1.4, 0.45] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [1.92, 1.4, 1.1], scale: [0.06, 0.6, 0.55] }),
          part(G.box, { color: "#ffffff", pos: [1.92, 1.4, -1.1], scale: [0.06, 0.6, 0.55] }),
          part(G.box, { color: "#ffffff", pos: [0, 1.4, 1.62], scale: [0.6, 0.6, 0.06] }),
        ]),
      };
    case "storage":
      return {
        geo: merge([
          part(G.box, { color: "#8f6a45", pos: [0, 0.65, 0], scale: [2.2, 1.3, 1.8] }),
          part(G.box, { color: "#6e4a30", pos: [0, 1.4, 0], scale: [2.5, 0.12, 2.1], rot: [0.12, 0, 0] }),
          part(G.box, { color: "#c09a62", pos: [1.3, 0.25, 0.6], scale: [0.45, 0.45, 0.45] }),
          part(G.cyl(0.25, 0.2, 0.4, 7), { color: "#d2b071", pos: [1.3, 0.2, -0.5] }),
        ]),
      };
    case "rack": {
      const parts = [];
      for (const z of [-0.9, 0.9]) {
        parts.push(part(G.cyl(0.04, 0.05, 1.7, 4), { color: WOOD_D, pos: [0.3, 0.8, z], rot: [0, 0, 0.35] }));
        parts.push(part(G.cyl(0.04, 0.05, 1.7, 4), { color: WOOD_D, pos: [-0.3, 0.8, z], rot: [0, 0, -0.35] }));
      }
      parts.push(part(G.cyl(0.04, 0.04, 2.0, 4), { color: WOOD, pos: [0, 1.5, 0], rot: [Math.PI / 2, 0, 0] }));
      for (let i = 0; i < 4; i++) parts.push(part(G.ico(0.14, 0), { color: i % 2 ? "#c98a4a" : "#b5653d", pos: [0, 1.25, -0.6 + i * 0.4], scale: [0.5, 1.6, 0.5] }));
      return { geo: merge(parts) };
    }
    case "kiln":
      return {
        geo: merge([
          part(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), { color: "#b0664a" }),
          part(G.box, { color: "#2a1d18", pos: [1.0, 0.3, 0], scale: [0.2, 0.5, 0.5] }),
          part(G.cyl(0.18, 0.22, 0.5, 6), { color: "#9a553c", pos: [0, 1.25, 0] }),
        ]),
      };
    case "farm": {
      const parts = [part(G.box, { color: "#8a6844", pos: [0, 0.0, 0], scale: [4.4, 0.3, 4.4] })];
      for (let i = 0; i < 4; i++) parts.push(part(G.box, { color: "#6e5034", pos: [-1.65 + i * 1.1, 0.16, 0], scale: [0.3, 0.06, 4.1] }));
      for (const [x, z] of [[2.2, 2.2], [2.2, -2.2], [-2.2, 2.2], [-2.2, -2.2]]) parts.push(part(G.cyl(0.05, 0.06, 0.7, 4), { color: WOOD_D, pos: [x, 0.35, z] }));
      return { geo: merge(parts) };
    }
    case "pen": {
      const parts = [part(G.cyl(3.0, 3.0, 0.05, 16), { color: "#c8b26a", pos: [0, 0.03, 0] })];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        parts.push(part(G.cyl(0.06, 0.07, 0.9, 4), { color: WOOD_D, pos: [Math.cos(a) * 3.1, 0.45, Math.sin(a) * 3.1] }));
        const a2 = ((i + 0.5) / 14) * Math.PI * 2;
        if (i !== 0) parts.push(part(G.box, { color: WOOD, pos: [Math.cos(a2) * 3.08, 0.6, Math.sin(a2) * 3.08], scale: [0.06, 0.08, 1.4], rot: [0, -a2, 0] }));
      }
      return { geo: merge(parts) };
    }
    case "well":
      return {
        geo: merge([
          part(G.cyl(0.8, 0.85, 0.8, 10), { color: STONE, pos: [0, 0.4, 0] }),
          part(G.cyl(0.62, 0.62, 0.05, 10), { color: "#2f4f5a", pos: [0, 0.78, 0] }),
          part(G.cyl(0.05, 0.05, 1.6, 4), { color: WOOD_D, pos: [0, 1.2, 0.75] }),
          part(G.cyl(0.05, 0.05, 1.6, 4), { color: WOOD_D, pos: [0, 1.2, -0.75] }),
          part(G.box, { color: ROOF, pos: [0, 2.05, 0], scale: [1.3, 0.1, 1.9] }),
          part(G.cyl(0.14, 0.12, 0.22, 6), { color: "#8a5f3d", pos: [0, 1.2, 0] }),
        ]),
      };
    case "workshop":
      return {
        geo: merge([
          ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => part(G.cyl(0.07, 0.08, 1.9, 5), { color: WOOD_D, pos: [x * 1.3, 0.95, z * 1.0] })),
          part(G.box, { color: STRAW, pos: [0, 2.0, 0], scale: [3.0, 0.14, 2.4], rot: [0.08, 0, 0] }),
          part(G.box, { color: WOOD, pos: [0, 0.55, 0], scale: [1.6, 0.12, 0.8] }),
          part(G.box, { color: WOOD_D, pos: [0, 0.27, 0], scale: [1.4, 0.5, 0.1] }),
          part(G.dodec(0.18), { color: STONE_D, pos: [0.4, 0.7, 0.1] }),
          part(G.box, { color: "#6b6b6b", pos: [-0.8, 0.35, -0.6], scale: [0.5, 0.45, 0.35] }),
        ]),
      };
    case "smelter":
      return {
        geo: merge([
          part(G.cyl(0.65, 0.95, 2.6, 8), { color: "#8f8a82", pos: [0, 1.3, 0] }),
          part(G.cyl(0.7, 0.7, 0.2, 8), { color: STONE_D, pos: [0, 2.65, 0] }),
          part(G.box, { color: STONE_D, pos: [0.9, 0.3, 0], scale: [0.6, 0.6, 0.8] }),
        ]),
        windows: merge([part(G.box, { color: "#ffffff", pos: [0.86, 0.6, 0], scale: [0.12, 0.4, 0.4] })]),
      };
    case "dock": {
      const parts = [part(G.box, { color: "#a07850", pos: [2.4, 0.35, 0], scale: [5.6, 0.12, 1.5] })];
      for (let i = 0; i < 4; i++) for (const z of [-0.7, 0.7]) parts.push(part(G.cyl(0.08, 0.08, 1.6, 5), { color: WOOD_D, pos: [0.4 + i * 1.6, -0.2, z] }));
      // 작은 배
      parts.push(part(G.box, { color: "#c2763d", pos: [3.6, 0.05, 1.5], scale: [2.0, 0.35, 0.7] }));
      parts.push(part(G.box, { color: "#e9e1d0", pos: [3.6, 0.25, 1.5], scale: [1.6, 0.1, 0.5] }));
      return { geo: merge(parts) };
    }
    case "library":
      return {
        geo: merge([
          part(G.box, { color: "#e8dcc0", pos: [0, 1.25, 0], scale: [3.6, 2.5, 4.0] }),
          part(G.box, { color: "#c9b48a", pos: [0, 0.1, 0], scale: [4.4, 0.2, 4.6] }),
          ...[-1.5, -0.5, 0.5, 1.5].map((z) => part(G.cyl(0.14, 0.16, 2.4, 8), { color: "#f3ead6", pos: [2.05, 1.3, z] })),
          part(G.box, { color: "#d9c79e", pos: [0.3, 2.6, 0], scale: [4.4, 0.2, 4.5] }),
          ...gable(4.4, 4.5, 0.9, 2.7, "#8a6a4a", "#e8dcc0"),
          part(G.box, { color: "#5a3b26", pos: [1.82, 0.85, 0], scale: [0.06, 1.5, 0.8] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [0, 1.5, 2.02], scale: [0.6, 0.8, 0.05] }),
          part(G.box, { color: "#ffffff", pos: [0, 1.5, -2.02], scale: [0.6, 0.8, 0.05] }),
        ]),
      };
    case "windmill":
      return {
        geo: merge([
          part(G.cyl(0.85, 1.3, 4.2, 8), { color: "#ece4d3", pos: [0, 2.1, 0] }),
          part(G.cone(1.1, 1.2, 8), { color: "#8a4b32", pos: [0, 4.8, 0] }),
          part(G.box, { color: "#5a3b26", pos: [1.18, 0.6, 0], scale: [0.08, 1.1, 0.6] }),
        ]),
        windows: merge([part(G.box, { color: "#ffffff", pos: [1.0, 2.6, 0], scale: [0.06, 0.45, 0.4] })]),
      };
    case "observatory":
      return {
        geo: merge([
          part(G.cyl(1.8, 1.9, 2.2, 12), { color: "#dcd6cc", pos: [0, 1.1, 0] }),
          part(new THREE.SphereGeometry(1.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), { color: "#9aa9b8", pos: [0, 2.2, 0] }),
          part(G.box, { color: "#2a3340", pos: [0.95, 3.0, 0], scale: [1.2, 0.9, 0.35], rot: [0, 0, -0.7] }),
          part(G.cyl(0.12, 0.12, 1.4, 6), { color: "#4a4f57", pos: [1.25, 3.25, 0], rot: [0, 0, -0.9] }),
          part(G.box, { color: "#5a3b26", pos: [1.86, 0.7, 0], scale: [0.08, 1.3, 0.7] }),
        ]),
      };
    case "lighthouse": {
      const parts = [];
      const bands = 6;
      for (let i = 0; i < bands; i++) {
        const r0 = 1.1 - i * 0.05, r1 = 1.1 - (i + 1) * 0.05;
        parts.push(part(G.cyl(r1, r0, 1.15, 12), { color: i % 2 ? "#d8473b" : "#f4f1ea", pos: [0, 0.575 + i * 1.15, 0] }));
      }
      parts.push(part(G.cyl(1.05, 1.05, 0.15, 12), { color: "#3d3d42", pos: [0, 7.0, 0] }));
      parts.push(part(G.cone(0.85, 0.9, 12), { color: "#d8473b", pos: [0, 8.35, 0] }));
      parts.push(part(G.box, { color: "#4f3a2a", pos: [1.08, 0.6, 0], scale: [0.08, 1.1, 0.6] }));
      return {
        geo: merge(parts),
        windows: merge([part(G.cyl(0.6, 0.6, 0.85, 10), { color: "#ffffff", pos: [0, 7.5, 0] })]),
      };
    }
    case "grave":
      return {
        geo: merge([
          part(G.ico(0.55, 0), { color: "#7b6248", scale: [1.3, 0.35, 0.8], pos: [0, 0.05, 0] }),
          part(G.box, { color: "#a8a39a", pos: [-0.65, 0.4, 0], scale: [0.12, 0.8, 0.45] }),
          part(G.ico(0.07, 0), { color: "#ffe066", pos: [0.2, 0.25, 0.25] }),
          part(G.ico(0.07, 0), { color: "#ff9ec7", pos: [0.35, 0.22, -0.2] }),
          part(G.ico(0.07, 0), { color: "#ffffff", pos: [0.05, 0.27, -0.05] }),
        ]),
      };
    case "raft": {
      const parts = [];
      for (let i = 0; i < 5; i++) parts.push(part(G.cyl(0.13, 0.13, 2.2, 6), { color: i % 2 ? "#8a6a48" : "#7a5c3e", pos: [0, 0.1, -0.56 + i * 0.28], rot: [0, 0, Math.PI / 2] }));
      parts.push(part(G.box, { color: "#c9b48a", pos: [0.6, 0.22, 0], scale: [0.08, 0.06, 1.5] }));
      parts.push(part(G.box, { color: "#c9b48a", pos: [-0.6, 0.22, 0], scale: [0.08, 0.06, 1.5] }));
      return { geo: merge(parts) };
    }
    case "bench":
      return {
        geo: merge([
          part(G.box, { color: WOOD, pos: [0, 0.45, 0], scale: [0.5, 0.08, 1.6] }),
          part(G.box, { color: WOOD_D, pos: [0, 0.22, 0.65], scale: [0.4, 0.44, 0.1] }),
          part(G.box, { color: WOOD_D, pos: [0, 0.22, -0.65], scale: [0.4, 0.44, 0.1] }),
          part(G.box, { color: WOOD, pos: [-0.22, 0.75, 0], scale: [0.06, 0.5, 1.6] }),
        ]),
      };
    case "infirmary":
      // 하얀 천막에 초록 십자: 아픈 사람이 떨어져 쉬는 곳
      return {
        geo: merge([
          part(G.box, { color: "#a89a72", pos: [0, 0.03, 0], scale: [3.2, 0.06, 2.8] }),
          ...gable(3.0, 2.6, 1.7, 0.02, "#f3efe6", "#e8e2d4"),
          part(G.box, { color: "#3fa45b", pos: [1.53, 0.78, 0], scale: [0.04, 0.5, 0.15] }),
          part(G.box, { color: "#3fa45b", pos: [1.53, 0.78, 0], scale: [0.04, 0.15, 0.5] }),
          part(G.box, { color: "#d9d2c3", pos: [-0.5, 0.18, 0.6], scale: [1.6, 0.2, 0.6] }),
          part(G.box, { color: "#d9d2c3", pos: [-0.5, 0.18, -0.6], scale: [1.6, 0.2, 0.6] }),
          part(G.cyl(0.04, 0.05, 1.9, 4), { color: WOOD_D, pos: [1.4, 0.9, 0] }),
          part(G.cyl(0.04, 0.05, 1.9, 4), { color: WOOD_D, pos: [-1.4, 0.9, 0] }),
        ]),
      };
    case "seawall": {
      // 바다를 향해 길게 쌓은 돌둑
      const parts = [part(G.box, { color: STONE_D, pos: [0, 0.55, 0], scale: [1.3, 1.3, 6.6] })];
      for (let i = 0; i < 9; i++) parts.push(part(G.dodec(0.35), { color: i % 2 ? STONE : "#b4afa6", pos: [0.62, 0.3 + (i % 3) * 0.35, -2.9 + i * 0.72], scale: [0.6, 0.8, 1] }));
      parts.push(part(G.box, { color: "#bdb8ae", pos: [0, 1.25, 0], scale: [1.4, 0.18, 6.8] }));
      return { geo: merge(parts) };
    }
    case "banner":
      return {
        geo: merge([
          part(G.cyl(0.05, 0.06, 3.2, 5), { color: WOOD_D, pos: [0, 1.6, 0] }),
          part(G.ico(0.09, 0), { color: "#e0c070", pos: [0, 3.25, 0] }),
          ...[0, 1, 2].map((i) => part(G.dodec(0.16), { color: STONE_D, pos: [Math.cos(i * 2.1) * 0.22, 0.08, Math.sin(i * 2.1) * 0.22] })),
        ]),
      };
    case "hall":
      // 문명을 세우면 모두가 모이는 회관
      return {
        geo: merge([
          part(G.box, { color: "#c9b48a", pos: [0, 0.15, 0], scale: [5.2, 0.3, 4.4] }),
          part(G.box, { color: "#efe4cc", pos: [-0.3, 1.45, 0], scale: [4.0, 2.3, 3.8] }),
          ...[-1.4, -0.47, 0.47, 1.4].map((z) => part(G.cyl(0.15, 0.17, 2.4, 8), { color: "#f6efdf", pos: [2.2, 1.4, z] })),
          part(G.box, { color: "#d6c49c", pos: [0.25, 2.7, 0], scale: [5.0, 0.22, 4.3] }),
          ...gable(5.0, 4.3, 1.1, 2.8, "#5d7a9a", "#efe4cc"),
          part(G.box, { color: "#5a3b26", pos: [1.72, 0.95, 0], scale: [0.06, 1.6, 0.9] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [-0.3, 1.7, 1.92], scale: [0.7, 0.8, 0.05] }),
          part(G.box, { color: "#ffffff", pos: [-0.3, 1.7, -1.92], scale: [0.7, 0.8, 0.05] }),
        ]),
      };
    case "shipyard": {
      // 바다로 뻗은 경사로와 나무 비계 (배는 따로 그린다)
      const parts = [
        part(G.box, { color: "#8f6a45", pos: [1.2, 0.05, 0], scale: [5.4, 0.16, 2.6], rot: [0, 0, -0.08] }),
        part(G.box, { color: "#a07850", pos: [-1.6, 0.3, 1.7], scale: [2.2, 0.5, 0.9] }),
      ];
      for (let i = 0; i < 4; i++) {
        parts.push(part(G.cyl(0.07, 0.08, 3.2, 5), { color: WOOD_D, pos: [-0.8 + i * 1.3, 1.5, 1.45] }));
        parts.push(part(G.cyl(0.07, 0.08, 3.2, 5), { color: WOOD_D, pos: [-0.8 + i * 1.3, 1.5, -1.45] }));
      }
      parts.push(part(G.box, { color: WOOD, pos: [1.15, 3.1, 1.45], scale: [4.3, 0.12, 0.12] }));
      parts.push(part(G.box, { color: WOOD, pos: [1.15, 3.1, -1.45], scale: [4.3, 0.12, 0.12] }));
      parts.push(part(G.box, { color: "#c9b48a", pos: [-1.6, 0.62, 1.7], scale: [0.6, 0.18, 0.6] }));
      return { geo: merge(parts) };
    }
    case "shrine": {
      // 돌 제단: 층계 위에 제물상, 양쪽 돌기둥 위로 등불이 밝다
      const parts = [
        part(G.box, { color: STONE_D, pos: [0, 0.15, 0], scale: [3.2, 0.3, 3.2] }),
        part(G.box, { color: STONE, pos: [0, 0.4, 0], scale: [2.4, 0.22, 2.4] }),
        part(G.box, { color: "#b9b2a5", pos: [-0.3, 0.85, 0], scale: [1.1, 0.7, 0.9] }),
        part(G.box, { color: "#b23a3a", pos: [-0.3, 1.22, 0], scale: [1.15, 0.05, 0.95] }),
        part(G.dodec(0.18), { color: "#e6c06a", pos: [-0.3, 1.38, 0.2] }),
        part(G.ico(0.12, 0), { color: "#d9504a", pos: [-0.3, 1.33, -0.22] }),
        // 뒤편의 선돌
        part(G.box, { color: STONE_D, pos: [-1.1, 1.3, 0], scale: [0.35, 2.2, 0.8], rot: [0, 0, 0.04] }),
        part(G.box, { color: "#c9c2b5", pos: [-1.1, 2.45, 0], scale: [0.4, 0.12, 0.9] }),
      ];
      for (const z of [-1.2, 1.2]) {
        parts.push(part(G.cyl(0.13, 0.16, 1.7, 6), { color: STONE, pos: [0.9, 1.0, z] }));
        parts.push(part(G.box, { color: WOOD_D, pos: [0.9, 1.92, z], scale: [0.36, 0.08, 0.36] }));
      }
      return {
        geo: merge(parts),
        windows: merge([-1.2, 1.2].map((z) => part(G.box, { color: "#ffffff", pos: [0.9, 2.08, z], scale: [0.24, 0.24, 0.24] }))),
      };
    }
    case "market": {
      // 장터: 알록달록한 차양 아래 좌판 셋
      const parts = [part(G.box, { color: "#c9b48a", pos: [0, 0.03, 0], scale: [5.0, 0.06, 4.4] })];
      const awn = ["#e07a5f", "#f2cc8f", "#81b29a"];
      [[-1.5, -1.2], [1.5, -1.2], [0, 1.4]].forEach(([x, z], i) => {
        for (const [dx, dz] of [[-0.6, -0.45], [0.6, -0.45], [-0.6, 0.45], [0.6, 0.45]]) parts.push(part(G.cyl(0.04, 0.05, 1.8, 4), { color: WOOD_D, pos: [x + dx, 0.9, z + dz] }));
        parts.push(part(G.box, { color: awn[i], pos: [x, 1.85, z], scale: [1.5, 0.08, 1.2], rot: [0.12, 0, 0] }));
        parts.push(part(G.box, { color: WOOD, pos: [x, 0.62, z], scale: [1.3, 0.1, 0.8] }));
        parts.push(part(G.box, { color: ["#d9504a", "#f4a261", "#6aa84f"][i], pos: [x - 0.35, 0.75, z], scale: [0.3, 0.16, 0.3] }));
        parts.push(part(G.box, { color: ["#e9c46a", "#8d6e63", "#4dabf7"][i], pos: [x + 0.3, 0.75, z + 0.1], scale: [0.35, 0.18, 0.28] }));
      });
      return { geo: merge(parts) };
    }
    case "palace": {
      // 왕궁: 돌 기단 위 흰 벽, 붉은 기둥, 겹지붕과 금빛 용마루
      return {
        geo: merge([
          part(G.box, { color: STONE_D, pos: [0, 0.3, 0], scale: [8.6, 0.6, 7.4] }),
          part(G.box, { color: STONE, pos: [3.6, 0.15, 0], scale: [1.6, 0.3, 2.6] }),
          part(G.box, { color: CREAM, pos: [-0.4, 2.0, 0], scale: [6.0, 2.8, 5.6] }),
          ...[-2.2, -0.75, 0.75, 2.2].map((z) => part(G.cyl(0.2, 0.22, 3.0, 8), { color: "#b03a2e", pos: [3.0, 2.0, z] })),
          part(G.box, { color: "#d6c49c", pos: [0.3, 3.5, 0], scale: [7.4, 0.25, 6.6] }),
          ...gable(7.4, 6.6, 1.5, 3.6, "#3f5872", CREAM),
          part(G.box, { color: "#e7c35a", pos: [0.3, 5.15, 0], scale: [7.6, 0.16, 0.22] }),
          part(G.box, { color: CREAM, pos: [-0.4, 4.6, 0], scale: [3.2, 1.0, 2.8] }),
          ...gable(3.6, 3.2, 0.9, 5.1, "#3f5872", CREAM),
          part(G.box, { color: "#e7c35a", pos: [-0.4, 6.05, 0], scale: [3.8, 0.12, 0.18] }),
          part(G.box, { color: "#5a3b26", pos: [2.62, 1.4, 0], scale: [0.08, 2.0, 1.4] }),
          part(G.cyl(0.05, 0.06, 2.6, 5), { color: WOOD_D, pos: [4.0, 1.6, 2.9] }),
          part(G.box, { color: "#c0392b", pos: [4.0, 2.6, 3.25], scale: [0.04, 0.6, 0.7] }),
          part(G.cyl(0.05, 0.06, 2.6, 5), { color: WOOD_D, pos: [4.0, 1.6, -2.9] }),
          part(G.box, { color: "#c0392b", pos: [4.0, 2.6, -3.25], scale: [0.04, 0.6, 0.7] }),
        ]),
        windows: merge([
          part(G.box, { color: "#ffffff", pos: [-0.4, 2.2, 2.82], scale: [1.4, 1.0, 0.05] }),
          part(G.box, { color: "#ffffff", pos: [-0.4, 2.2, -2.82], scale: [1.4, 1.0, 0.05] }),
        ]),
      };
    }
    case "forge": {
      // 화덕과 모루가 있는 대장간: 화덕 불빛은 밤에도 빛난다
      return {
        geo: merge([
          part(G.box, { color: STONE_D, pos: [0, 0.1, 0], scale: [3.4, 0.2, 3.0] }),
          ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => part(G.cyl(0.09, 0.1, 2.3, 5), { color: WOOD_D, pos: [x * 1.45, 1.15, z * 1.25] })),
          part(G.box, { color: "#6e4a30", pos: [0, 2.35, 0], scale: [3.5, 0.14, 3.0], rot: [0.1, 0, 0] }),
          part(G.box, { color: "#a8a39a", pos: [-0.9, 0.7, -0.6], scale: [1.2, 1.2, 1.2] }),
          part(G.cyl(0.32, 0.4, 2.8, 6), { color: "#8f8a82", pos: [-0.9, 2.4, -0.6] }),
          part(G.box, { color: "#3a3a3d", pos: [0.6, 0.6, 0.5], scale: [0.7, 0.25, 0.32] }),
          part(G.box, { color: "#3a3a3d", pos: [0.6, 0.35, 0.5], scale: [0.3, 0.5, 0.25] }),
          part(G.box, { color: WOOD, pos: [1.0, 0.45, -0.8], scale: [0.6, 0.7, 0.5] }),
        ]),
        windows: merge([part(G.box, { color: "#ffffff", pos: [-0.28, 0.65, -0.6], scale: [0.06, 0.45, 0.6] })]),
      };
    }
    case "mine": {
      // 바위 언덕에 뚫은 갱도 입구와 광차
      const parts = [
        part(G.dodec(1.9), { color: "#7d736b", scale: [1.3, 0.85, 1.25], pos: [-0.9, 0.9, 0] }),
        part(G.box, { color: "#1b1714", pos: [0.25, 0.85, 0], scale: [0.4, 1.5, 1.2] }),
        part(G.cyl(0.09, 0.1, 1.8, 5), { color: WOOD_D, pos: [0.5, 0.9, 0.7] }),
        part(G.cyl(0.09, 0.1, 1.8, 5), { color: WOOD_D, pos: [0.5, 0.9, -0.7] }),
        part(G.box, { color: WOOD, pos: [0.5, 1.85, 0], scale: [0.22, 0.2, 1.8] }),
        part(G.box, { color: "#5e5a55", pos: [1.6, 0.03, 0.3], scale: [2.4, 0.06, 0.08] }),
        part(G.box, { color: "#5e5a55", pos: [1.6, 0.03, -0.3], scale: [2.4, 0.06, 0.08] }),
        part(G.box, { color: "#6b5d50", pos: [1.9, 0.4, 0], scale: [0.9, 0.45, 0.7] }),
        part(G.ico(0.15, 0), { color: "#9c4f34", pos: [1.8, 0.7, 0.1] }),
        part(G.ico(0.13, 0), { color: "#c9773a", pos: [2.05, 0.68, -0.1] }),
        part(G.cyl(0.12, 0.12, 0.08, 6), { color: "#2f3135", pos: [1.6, 0.15, 0.36], rot: [Math.PI / 2, 0, 0] }),
        part(G.cyl(0.12, 0.12, 0.08, 6), { color: "#2f3135", pos: [2.2, 0.15, 0.36], rot: [Math.PI / 2, 0, 0] }),
      ];
      return { geo: merge(parts), windows: merge([part(G.box, { color: "#ffffff", pos: [0.48, 1.2, 0], scale: [0.04, 0.16, 0.16] })]) };
    }
    case "casino": {
      // 금빛 기둥에 붉은 지붕을 얹은 놀이터: 앞이 트여 탁자에 둘러선 사람들이 보인다. 간판의 전구는 밤에 빛난다
      const GOLD = "#e0b84a", RED = "#c0353f", WALL = "#6b2430";
      const parts = [
        part(G.box, { color: "#6b5a4e", pos: [0, 0.12, 0], scale: [5.0, 0.24, 4.2] }),
        part(G.box, { color: "#8e2f3f", pos: [0.05, 0.25, 0], scale: [4.6, 0.04, 3.8] }),
        part(G.box, { color: WALL, pos: [-2.25, 1.4, 0], scale: [0.25, 2.3, 4.0] }),
        part(G.box, { color: GOLD, pos: [-2.1, 2.45, 0], scale: [0.1, 0.12, 4.0] }),
        ...[[2.1, 1.85], [2.1, -1.85], [-2.1, 1.85], [-2.1, -1.85]].map(([x, z]) => part(G.cyl(0.13, 0.15, 2.5, 8), { color: GOLD, pos: [x, 1.35, z] })),
        part(G.box, { color: GOLD, pos: [0, 2.65, 0], scale: [5.1, 0.16, 4.3] }),
        part(G.cone(3.55, 1.5, 4), { color: RED, pos: [0, 3.48, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.84] }),
        part(G.ico(0.18, 0), { color: GOLD, pos: [0, 4.3, 0] }),
        // 간판: 붉은 판에 흰 주사위 두 개
        part(G.box, { color: GOLD, pos: [2.28, 3.05, 0], scale: [0.1, 0.9, 3.0] }),
        part(G.box, { color: "#b0202e", pos: [2.33, 3.05, 0], scale: [0.06, 0.74, 2.84] }),
        part(G.box, { color: "#f8f4ea", pos: [2.38, 3.05, 0.55], scale: [0.06, 0.48, 0.48], rot: [0.3, 0, 0] }),
        part(G.box, { color: "#f8f4ea", pos: [2.38, 3.05, -0.55], scale: [0.06, 0.48, 0.48], rot: [-0.2, 0, 0] }),
        ...[[0.55, 0], [0.55, 0.12], [-0.55, -0.12], [-0.55, 0.12]].map(([z, dz]) => part(G.box, { color: "#c92a2a", pos: [2.42, 3.05 + dz, z + dz], scale: [0.04, 0.09, 0.09] })),
        // 입구의 커다란 주사위
        part(G.box, { color: "#f8f4ea", pos: [2.95, 0.5, 1.75], scale: [0.6, 0.6, 0.6], rot: [0, 0.5, 0] }),
        part(G.box, { color: "#c92a2a", pos: [3.05, 0.42, -1.75], scale: [0.5, 0.5, 0.5], rot: [0, -0.4, 0] }),
      ];
      for (const z of [0.95, -0.95]) {
        parts.push(part(G.box, { color: "#2f7d4f", pos: [0.3, 0.82, z], scale: [1.4, 0.08, 0.8] }));
        parts.push(part(G.box, { color: "#5a3b26", pos: [0.3, 0.86, z], scale: [1.48, 0.04, 0.88] }));
        parts.push(part(G.box, { color: "#6e4a30", pos: [0.3, 0.53, z], scale: [0.18, 0.56, 0.18] }));
        parts.push(part(G.box, { color: "#f4f1ea", pos: [0.15, 0.91, z + 0.1], scale: [0.1, 0.1, 0.1], rot: [0, 0.5, 0] }));
        parts.push(part(G.box, { color: "#f4f1ea", pos: [0.42, 0.91, z - 0.12], scale: [0.1, 0.1, 0.1], rot: [0, 1.1, 0] }));
        parts.push(part(G.cyl(0.07, 0.07, 0.08, 8), { color: "#ffd43b", pos: [0.7, 0.9, z] }));
        parts.push(part(G.cyl(0.07, 0.07, 0.16, 8), { color: "#e03131", pos: [-0.1, 0.94, z] }));
      }
      const bulbs = [-1.3, -0.65, 0, 0.65, 1.3].map((z) => part(G.ico(0.07, 0), { color: "#ffffff", pos: [2.38, 2.6, z] }));
      return { geo: merge(parts), windows: merge(bulbs) };
    }
    case "portal": {
      // 돌기둥 사이의 고리 (안쪽 빛은 따로 그린다)
      const parts = [
        part(G.cyl(2.4, 2.6, 0.35, 16), { color: "#8c8f99", pos: [0, 0.17, 0] }),
        part(new THREE.TorusGeometry(1.9, 0.28, 8, 28), { color: "#6d7280", pos: [0, 2.45, 0], rot: [0, Math.PI / 2, 0] }),
        part(G.box, { color: "#5d6270", pos: [0, 1.1, 2.15], scale: [0.6, 2.0, 0.6] }),
        part(G.box, { color: "#5d6270", pos: [0, 1.1, -2.15], scale: [0.6, 2.0, 0.6] }),
      ];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part(G.box, { color: "#9fe8ff", pos: [0, 2.45 + Math.sin(a) * 1.9, Math.cos(a) * 1.9], scale: [0.36, 0.16, 0.16], rot: [a, 0, 0] }));
      }
      return { geo: merge(parts) };
    }
  }
  return { geo: merge([part(G.box, { color: WOOD, pos: [0, 0.5, 0] })]) };
}

const MODELS = new Map<string, Model>();
const modelOf = (t: StructureType, lv = 1) => {
  const key = `${t}:${lv}`;
  let m = MODELS.get(key);
  if (!m) MODELS.set(key, (m = buildModel(t, lv)));
  return m;
};

const windowMat = new THREE.MeshStandardMaterial({ color: "#bfe3ff", emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0, flatShading: true });
const scaffoldMat = new THREE.MeshStandardMaterial({ color: "#c9a26b", flatShading: true, transparent: true, opacity: 0.85 });
const ghostMat = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.18, depthWrite: false });
/** 아직 설계 중인 건물: 푸른 도면처럼 */
/** 불에 강한 재질(기와 지붕·흙벽)로 지은 건물은 붉은 흙빛이 돈다 */
const fpMat = vcMat.clone();
fpMat.color.set("#f2c9b4");
const planMat = new THREE.MeshBasicMaterial({ color: "#7fb8ff", transparent: true, opacity: 0.2, depthWrite: false, wireframe: true });
const stringMat = new THREE.MeshBasicMaterial({ color: "#f2e6c9" });
const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4);
const rubbleGeo = merge([
  part(G.box, { color: "#7a5235", pos: [1.1, 0.08, 0.6], scale: [0.9, 0.12, 0.18], rot: [0, 0.6, 0.1] }),
  part(G.box, { color: "#8c6a48", pos: [0.9, 0.1, -0.7], scale: [0.7, 0.12, 0.16], rot: [0, -0.4, -0.15] }),
  part(G.dodec(0.18), { color: "#8c877f", pos: [-1.0, 0.1, 0.8] }),
  part(G.dodec(0.14), { color: "#9b968e", pos: [-0.8, 0.08, -0.9] }),
  part(G.box, { color: "#6e4a30", pos: [-1.2, 0.07, 0], scale: [0.18, 0.1, 0.8], rot: [0, 0.3, 0] }),
]);

const flameGeo = new THREE.ConeGeometry(0.32, 0.9, 7, 1, true);
const flameInnerGeo = new THREE.ConeGeometry(0.18, 0.55, 6);
const flameMat = new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const flameInnerMat = new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.95, depthWrite: false });
/** 불타는 건물 위의 내구도 막대 */
const barGeo = new THREE.PlaneGeometry(2.2, 0.22);
const barBackMat = new THREE.MeshBasicMaterial({ color: "#2b2522", transparent: true, opacity: 0.75, depthTest: false });
const barFillMats = Array.from({ length: 8 }, () => new THREE.MeshBasicMaterial({ color: "#7bd88f", depthTest: false, transparent: true }));
/** 곁불: 가장자리의 붉은 불 혀 */
const flameEdgeMat = new THREE.MeshBasicMaterial({ color: "#ff5a1f", transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
const beamGeo = new THREE.ConeGeometry(2.2, 26, 16, 1, true).rotateZ(Math.PI / 2).translate(13, 0, 0);
const beamMat = new THREE.MeshBasicMaterial({ color: "#fff3c4", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });

/** 불타는 건물은 검게 그을린다 */
const charMat = vcMat.clone();
charMat.color.set("#7d6c62");

function StructureMesh({ s, terrain }: { s: Structure & { burnt?: boolean }; terrain: Terrain }) {
  const model = modelOf(s.type, s.lv ?? 1);
  const def = STRUCTS[s.type];
  const planning = s.plan === 0 && s.prog < 1;
  const flatOnGround = s.type === "farm" || s.type === "pen" || s.type === "grave";
  const groundY = s.type === "dock" ? 0 : s.type === "raft" ? Math.max(-0.15, terrain.height(s.x, s.z)) : terrain.height(s.x, s.z) - (flatOnGround ? 0.1 : 0.05);
  const done = s.prog >= 1;
  const sy = done ? 1 : planning ? 0.02 : 0.12 + 0.88 * s.prog;
  // 밭·우리는 땅의 기울기를 따라 눕힌다
  const tilt = useMemo(() => {
    if (!flatOnGround) return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.rot);
    const e = 1.5;
    const n = new THREE.Vector3(
      -(terrain.height(s.x + e, s.z) - terrain.height(s.x - e, s.z)) / (2 * e),
      1,
      -(terrain.height(s.x, s.z + e) - terrain.height(s.x, s.z - e)) / (2 * e),
    ).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.rot));
  }, [flatOnGround, s.x, s.z, s.rot, terrain]);
  // 재해로 부서지면 기울고 내려앉는다. 고치는 동안에는 비계가 선다
  const dmg = s.dmg ?? 0;
  return (
    <group position={[s.x, groundY, s.z]} quaternion={tilt}>
      <group scale={[1, sy * (1 - dmg * 0.3), 1]} rotation={[dmg * 0.14, 0, dmg * 0.1]}>
        <mesh geometry={model.geo} material={s.burnt ? charMat : s.fp ? fpMat : vcMat} castShadow receiveShadow />
        {model.windows && <mesh geometry={model.windows} material={windowMat} />}
      </group>
      {dmg > 0 && (
        <>
          <mesh geometry={rubbleGeo} material={vcMat} scale={Math.max(0.6, def.radius * 0.55)} castShadow />
          {[[1, 1], [-1, -1]].map(([x, z], i) => (
            <mesh key={i} geometry={poleGeo} material={scaffoldMat} position={[x * def.radius * 0.8, 1, z * def.radius * 0.8]} scale={[1, 2, 1]} />
          ))}
        </>
      )}
      {!done && planning && (
        <>
          <mesh geometry={model.geo} material={planMat} />
          {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z], i) => (
            <mesh key={i} geometry={poleGeo} material={stringMat} position={[x * def.radius * 0.75, 0.3, z * def.radius * 0.75]} scale={[1, 0.6, 1]} />
          ))}
          {[[0, 1], [0, -1], [1, 0], [-1, 0]].map(([x, z], i) => (
            <mesh key={`s${i}`} geometry={poleGeo} material={stringMat} position={[x * def.radius * 0.75, 0.5, z * def.radius * 0.75]}
              rotation={x ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]} scale={[0.4, def.radius * 1.5, 0.4]} />
          ))}
        </>
      )}
      {!done && !planning && (
        <>
          <mesh geometry={model.geo} material={ghostMat} />
          {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z], i) => (
            <mesh key={i} geometry={poleGeo} material={scaffoldMat} position={[x * def.radius * 0.8, 1, z * def.radius * 0.8]} scale={[1, 2 * (s.lv ?? 1), 1]} />
          ))}
        </>
      )}
    </group>
  );
}

export function Structures({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(150);
  // 건설 진행도는 구조 버전과 무관하게 천천히 갱신
  const [tick, setTick] = useState(0);
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < 1500) return;
    last.current = now;
    // 짓는 중이거나 불타는 건물이 있으면 모양(기울기·그을음)을 자주 고친다
    if (rt.world?.structures.some((s) => s.prog < 1) || rt.world?.blazes.length) setTick((t) => t + 1);
  });
  const list = useMemo(() => (rt.world ? rt.world.structures.map((s) => ({ ...s, burnt: rt.world!.blazes.some((b) => b.sid === s.id) })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, tick]);

  return (
    <group>
      {list.map((s) => (
        <StructureMesh key={s.id} s={s} terrain={terrain} />
      ))}
      <Fires terrain={terrain} />
      <Specials terrain={terrain} />
      <Stockpile terrain={terrain} />
      <Roads terrain={terrain} />
      <Ride terrain={terrain} />
    </group>
  );
}

/** 모닥불·불타는 나무: 불꽃 메시는 모두, 실제 조명은 카메라 가까운 4개만 */
function Fires({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const amb = useAmbience();
  const { camera } = useThree();
  const flames = useRef<THREE.Group>(null);
  const lights = useRef<THREE.PointLight[]>([]);
  const bars = useRef<THREE.Group>(null);
  const POOL = 64;
  const BARS = 8;
  useFrame((state) => {
    const w = rt.world;
    const g = flames.current;
    if (!w || !g) return;
    const t = state.clock.elapsedTime;
    const fires: { x: number; y: number; z: number; s: number; d: number }[] = [];
    for (const s of w.structures) {
      if (s.type === "campfire" && s.lit) {
        const y = terrain.height(s.x, s.z);
        fires.push({ x: s.x, y: y + 0.1, z: s.z, s: 0.6 + Math.min(1, s.fuel / 60) * 0.6, d: 0 });
      }
    }
    for (const p of w.plants) {
      if (p.burn) fires.push({ x: p.x, y: terrain.height(p.x, p.z) + 1.2 * p.s, z: p.z, s: 2.4 * p.s, d: 0 });
    }
    // 번지는 불길: 건물은 지붕 둘레에, 땅불은 불길 안에 고루
    for (const b of w.blazes ?? []) {
      const st = b.sid != null ? w.structures.find((s) => s.id === b.sid) : undefined;
      const n = st ? 8 : Math.min(14, 4 + Math.round(b.r * 1.3));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.id * 0.7;
        const k = (i * 0.618 + b.id * 0.13) % 1;
        // 건물은 지붕과 벽 둘레에 번갈아, 땅불은 불길 안에 고루
        const roof = !!st && i % 2 === 0;
        const rr = st ? b.r * (roof ? 0.35 : 0.8) : b.r * (0.2 + k * 0.75);
        const x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr;
        const y = terrain.height(x, z) + (st ? (roof ? heightOf(st) * 0.8 : 0.1) : 0.05);
        fires.push({ x, y, z, s: (st ? 1.5 : 1.35) * (0.4 + b.heat * 0.9) * (0.75 + k * 0.5), d: 0 });
      }
    }
    let near = 0;
    for (const f of fires) {
      f.d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z);
      near = Math.max(near, 1 - Math.min(1, f.d / 30));
    }
    amb?.update({ rain: env.rain, wind: env.wind, day: env.day, fire: near, sea: 1 - Math.min(1, camera.position.y / 160) });
    fires.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const child = g.children[i] as THREE.Group;
      const f = fires[i];
      if (!f) {
        child.visible = false;
        continue;
      }
      child.visible = true;
      const flick = 1 + Math.sin(t * 13 + i * 3) * 0.08 + Math.sin(t * 23 + i) * 0.05;
      child.position.set(f.x, f.y + 0.35 * f.s, f.z);
      child.scale.set(f.s, f.s * flick, f.s);
      child.rotation.y = t * 1.5 + i;
    }
    // 불타는 건물 위에 내구도 막대: 불길이 클수록 빨리 줄어든다
    const bg = bars.current;
    if (bg) {
      const burning = (w.blazes ?? []).map((b) => (b.sid != null ? w.structures.find((s) => s.id === b.sid) : undefined)).filter((s): s is Structure => !!s);
      for (let i = 0; i < BARS; i++) {
        const bar = bg.children[i] as THREE.Group;
        const s = burning[i];
        if (!s) {
          bar.visible = false;
          continue;
        }
        bar.visible = true;
        const k = Math.max(0, 1 - (s.dmg ?? 0));
        bar.position.set(s.x, terrain.height(s.x, s.z) + heightOf(s) * 0.85 + 0.9, s.z);
        bar.scale.setScalar(1.4);
        bar.quaternion.copy(camera.quaternion);
        const fill = bar.children[1] as THREE.Mesh;
        fill.scale.x = Math.max(0.001, k);
        fill.position.x = -(1 - k) * 1.1;
        (fill.material as THREE.MeshBasicMaterial).color.set(k > 0.6 ? "#7bd88f" : k > 0.3 ? "#ffd43b" : "#ff6b6b");
      }
    }
    for (let i = 0; i < lights.current.length; i++) {
      const L = lights.current[i];
      const f = fires[i];
      if (!L) continue;
      if (!f || f.d > 90) {
        L.intensity = 0;
        continue;
      }
      L.position.set(f.x, f.y + 0.9, f.z);
      L.intensity = (6 + Math.sin(t * 17 + i) * 1.2) * f.s * (0.35 + env.night * 0.9);
    }
  });
  return (
    <>
      <group ref={bars}>
        {Array.from({ length: BARS }, (_, i) => (
          <group key={i} visible={false}>
            <mesh geometry={barGeo} material={barBackMat} scale={[1.05, 1.25, 1]} renderOrder={20} />
            <mesh geometry={barGeo} material={barFillMats[i]} position-z={0.01} renderOrder={21} />
          </group>
        ))}
      </group>
      <group ref={flames}>
        {Array.from({ length: POOL }, (_, i) => (
          <group key={i} visible={false}>
            <mesh geometry={flameGeo} material={flameMat} />
            <mesh geometry={flameInnerGeo} material={flameInnerMat} position-y={-0.1} />
            <mesh geometry={flameGeo} material={flameEdgeMat} position={[0.2, -0.17, 0.06]} scale={[0.6, 0.66, 0.6]} rotation-z={-0.28} />
            <mesh geometry={flameGeo} material={flameEdgeMat} position={[-0.18, -0.2, -0.1]} scale={[0.55, 0.56, 0.55]} rotation-z={0.32} />
          </group>
        ))}
      </group>
      {[0, 1, 2, 3].map((i) => (
        <pointLight
          key={i}
          ref={(l) => {
            if (l) lights.current[i] = l;
          }}
          color="#ff9a45"
          intensity={0}
          distance={14}
          decay={1.6}
        />
      ))}
    </>
  );
}

/** 풍차 날개, 등대 불빛, 창문 불빛 */
function Specials({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(500);
  const mills = useRef<THREE.Group[]>([]);
  const beams = useRef<THREE.Group[]>([]);
  const { windmills, lighthouses, banners, shipyards, portals } = useMemo(() => {
    const w = rt.world;
    const done = (t: StructureType) => (w ? w.structures.filter((s) => s.type === t && s.prog >= 1) : []);
    return {
      windmills: done("windmill"),
      lighthouses: done("lighthouse"),
      banners: (w ? w.structures.filter((s) => s.type === "banner") : []).map((s) => ({ s, hue: w?.groups.find((g) => g.id === s.group)?.hue ?? 0.1 })),
      shipyards: done("shipyard"),
      portals: done("portal"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const flags = useRef<THREE.Mesh[]>([]);
  const ships = useRef<THREE.Group[]>([]);
  const bladeGeo = useMemo(
    () => merge([0, 1, 2, 3].map((i) => part(G.box, { color: "#efe6d2", pos: [0, Math.cos((i * Math.PI) / 2) * 1.5, Math.sin((i * Math.PI) / 2) * 1.5], scale: [0.06, i % 2 ? 0.45 : 3.0, i % 2 ? 3.0 : 0.45] }))),
    [],
  );
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    for (const m of mills.current) if (m) m.rotation.x += dt * (0.4 + env.wind * 1.6);
    flags.current.forEach((m, i) => {
      if (!m) return;
      m.rotation.y = env.windAngle + Math.sin(t * (1.5 + env.wind * 3) + i) * (0.15 + env.wind * 0.25);
      m.scale.x = 1 - Math.abs(Math.sin(t * 3 + i)) * 0.08;
    });
    const w = rt.world;
    shipyards.forEach((s, i) => {
      const g = ships.current[i];
      if (!g || !w) return;
      const pose = shipPose(w, s, env.time);
      g.visible = !!pose;
      if (!pose) return;
      g.position.set(pose.x, Math.sin(t * 1.1 + i) * 0.08 + 0.05, pose.z);
      g.rotation.set(Math.sin(t * 0.9 + i) * 0.03, -pose.rot, Math.sin(t * 0.7) * 0.04);
    });
    portalMat.uniforms.uTime.value = t;
    const busy = w?.voyages.some((v) => v.via === "portal" && (!v.left || Math.abs(env.time - v.left) < 1800 || Math.abs(v.back - env.time) < 1800));
    const u = portalMat.uniforms.uGlow;
    u.value += ((busy ? 1.6 : 0.8) - u.value) * Math.min(1, dt * 2);
    for (const b of beams.current) {
      if (!b) continue;
      b.rotation.y = t * 0.6;
      b.visible = env.night > 0.3 || env.cloud > 0.8;
    }
    windowMat.emissiveIntensity = env.night * (env.electric ? 1.6 : 0.7) + (1 - env.day) * 0.3;
  });
  return (
    <>
      {windmills.map((s, i) => (
        <group key={s.id} position={[s.x, terrain.height(s.x, s.z), s.z]} rotation-y={-s.rot}>
          <group
            position={[1.25, 3.9, 0]}
            ref={(g) => {
              if (g) mills.current[i] = g;
            }}
          >
            <mesh geometry={bladeGeo} material={vcMat} castShadow />
          </group>
        </group>
      ))}
      {banners.map(({ s, hue }, i) => (
        <group key={s.id} position={[s.x, terrain.height(s.x, s.z) + 2.75, s.z]}>
          <mesh
            ref={(m) => {
              if (m) flags.current[i] = m;
            }}
            geometry={flagGeo}
            material={flagMat(hue)}
            castShadow
          />
        </group>
      ))}
      {shipyards.map((s, i) => (
        <group
          key={s.id}
          ref={(g) => {
            if (g) ships.current[i] = g;
          }}
        >
          <mesh geometry={shipGeo} material={vcMat} castShadow />
          <mesh geometry={sailGeo} material={sailMat} position={[0.2, 3.2, 0]} castShadow />
        </group>
      ))}
      {portals.map((s) => (
        <group key={s.id} position={[s.x, terrain.height(s.x, s.z), s.z]} rotation-y={-s.rot}>
          <mesh geometry={portalDiscGeo} material={portalMat} position={[0, 2.45, 0]} rotation-y={Math.PI / 2} />
        </group>
      ))}
      {lighthouses.map((s, i) => (
        <group
          key={s.id}
          position={[s.x, terrain.height(s.x, s.z) + 7.5, s.z]}
          ref={(g) => {
            if (g) beams.current[i] = g;
          }}
        >
          <mesh geometry={beamGeo} material={beamMat} />
          <mesh geometry={beamGeo} material={beamMat} rotation-y={Math.PI} />
        </group>
      ))}
    </>
  );
}

// ─── 깃발 · 배 · 차원문 ───────────────────────────────────────────────

const flagGeo = new THREE.PlaneGeometry(1.3, 0.8, 6, 2).translate(0.66, 0, 0);
const flagMats = new Map<number, THREE.MeshStandardMaterial>();
function flagMat(hue: number) {
  const k = Math.round(hue * 64);
  let m = flagMats.get(k);
  if (!m) flagMats.set(k, (m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(k / 64, 0.62, 0.55), side: THREE.DoubleSide, flatShading: true })));
  return m;
}

/** 섬 밖으로 나가는 큰 돛배 */
const shipGeo = merge([
  part(G.box, { color: "#7a5235", pos: [0, 0.35, 0], scale: [5.2, 0.9, 1.7] }),
  part(G.cone(0.85, 1.4, 4), { color: "#7a5235", pos: [3.25, 0.35, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.75] }),
  part(G.box, { color: "#a07850", pos: [0, 0.85, 0], scale: [5.0, 0.12, 1.5] }),
  part(G.box, { color: "#5a3b26", pos: [-2.2, 1.25, 0], scale: [1.0, 0.7, 1.4] }),
  part(G.cyl(0.08, 0.1, 5.4, 6), { color: "#5a3b26", pos: [0.2, 3.4, 0] }),
  part(G.box, { color: "#c2763d", pos: [0, 0.05, 0], scale: [5.25, 0.2, 1.75] }),
]);
const sailGeo = new THREE.BoxGeometry(0.06, 3.4, 2.6);
const sailMat = new THREE.MeshStandardMaterial({ color: "#f4efe2", flatShading: true });

const portalDiscGeo = new THREE.CircleGeometry(1.75, 48);
const portalMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uGlow: { value: 0.8 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uGlow; varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      float a = atan(p.y, p.x);
      float swirl = sin(a * 3.0 + r * 9.0 - uTime * 2.4) * 0.5 + 0.5;
      float ring = smoothstep(1.0, 0.82, r);
      vec3 col = mix(vec3(0.35, 0.2, 0.9), vec3(0.4, 0.95, 1.0), swirl);
      col = mix(col, vec3(1.0), smoothstep(0.35, 0.0, r) * 0.8);
      gl_FragColor = vec4(col * uGlow, ring * (0.55 + swirl * 0.35));
    }`,
});

/** 창고 옆에 쌓인 자원 */
// ─── 세금으로 닦은 길과 들인 탈것 ───────────────────────────────────

/** 길: 흙길 → 자갈길 → 돌길 → 포장도로 */
const ROAD_COLOR = ["", "#b08d5e", "#bcb3a2", "#9a958c", "#4c4f55"];
const ROAD_WIDTH = [0, 0.9, 1.1, 1.3, 1.6];
const ROAD_MAX = 2400;

function Roads({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(400);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: ROAD_COLOR[1], roughness: 1, flatShading: true }), []);
  useEffect(() => {
    const w = rt.world;
    const m = mesh.current;
    if (!w || !m) return;
    const { lv, to } = roadLinks(w);
    let n = 0;
    if (lv) {
      mat.color.set(ROAD_COLOR[lv]);
      const width = ROAD_WIDTH[lv];
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const c = w.camp;
      for (const t of to) {
        const len = Math.hypot(t.x - c.x, t.z - c.z);
        if (len < 3) continue;
        const ang = Math.atan2(t.z - c.z, t.x - c.x);
        const step = 1.4;
        // 모닥불 둘레와 건물 바로 앞까지만
        for (let d = 1.6; d < len - 1.5 && n < ROAD_MAX; d += step) {
          const x = c.x + Math.cos(ang) * d, z = c.z + Math.sin(ang) * d;
          const h = terrain.height(x, z);
          if (h < 0.1) continue;
          const h2 = terrain.height(x + Math.cos(ang) * 0.7, z + Math.sin(ang) * 0.7);
          const h0 = terrain.height(x - Math.cos(ang) * 0.7, z - Math.sin(ang) * 0.7);
          q.setFromEuler(e.set(0, -ang, Math.atan2(h2 - h0, 1.4), "YXZ"));
          M.compose(p.set(x, h + 0.03, z), q, s.set(step + 0.15, 0.06, width));
          m.setMatrixAt(n++, M);
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, terrain]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, ROAD_MAX]} material={mat} receiveShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

/** 탈것: 창고 곁에 세워 둔다 (손수레 → 소달구지 → 마차 → 자동차) */
const RIDE_GEO: THREE.BufferGeometry[] = [
  merge([part(G.box, { color: WOOD, pos: [0, 0.5, 0], scale: [0.2, 0.2, 0.2] })]),
  merge([
    part(G.box, { color: WOOD, pos: [0, 0.55, 0], scale: [1.2, 0.3, 0.8] }),
    part(G.box, { color: WOOD_D, pos: [0.95, 0.45, 0.25], scale: [0.8, 0.06, 0.06] }),
    part(G.box, { color: WOOD_D, pos: [0.95, 0.45, -0.25], scale: [0.8, 0.06, 0.06] }),
    ...[0.48, -0.48].map((z) => part(G.cyl(0.32, 0.32, 0.08, 10), { color: "#5a3b26", pos: [-0.1, 0.32, z], rot: [Math.PI / 2, 0, 0] })),
  ]),
  merge([
    part(G.box, { color: WOOD, pos: [-0.6, 0.65, 0], scale: [1.6, 0.4, 1.0] }),
    ...[0.58, -0.58].map((z) => part(G.cyl(0.38, 0.38, 0.08, 10), { color: "#5a3b26", pos: [-0.6, 0.38, z], rot: [Math.PI / 2, 0, 0] })),
    part(G.box, { color: "#6b4a32", pos: [1.1, 0.85, 0], scale: [1.2, 0.6, 0.55] }),
    part(G.box, { color: "#6b4a32", pos: [1.85, 0.95, 0], scale: [0.4, 0.38, 0.36] }),
    part(G.cone(0.05, 0.25, 4), { color: "#f4ead2", pos: [1.85, 1.22, 0.18] }),
    part(G.cone(0.05, 0.25, 4), { color: "#f4ead2", pos: [1.85, 1.22, -0.18] }),
    ...[[0.7, 0.18], [0.7, -0.18], [1.5, 0.18], [1.5, -0.18]].map(([x, z]) => part(G.box, { color: "#5e412b", pos: [x, 0.3, z], scale: [0.14, 0.6, 0.14] })),
  ]),
  merge([
    part(G.box, { color: "#7a3b2a", pos: [-0.6, 1.0, 0], scale: [1.5, 0.9, 1.1] }),
    part(G.box, { color: "#5a3b26", pos: [-0.6, 1.52, 0], scale: [1.6, 0.1, 1.2] }),
    ...[[-1.1, 0.6], [-1.1, -0.6], [-0.1, 0.6], [-0.1, -0.6]].map(([x, z]) => part(G.cyl(0.36, 0.36, 0.08, 10), { color: "#3e2a1c", pos: [x, 0.38, z], rot: [Math.PI / 2, 0, 0] })),
    part(G.box, { color: "#f0e6d6", pos: [1.25, 1.0, 0], scale: [1.1, 0.55, 0.42] }),
    part(G.box, { color: "#f0e6d6", pos: [1.9, 1.3, 0], scale: [0.36, 0.42, 0.3], rot: [0, 0, -0.4] }),
    ...[[0.9, 0.14], [0.9, -0.14], [1.6, 0.14], [1.6, -0.14]].map(([x, z]) => part(G.box, { color: "#d9cbb5", pos: [x, 0.38, z], scale: [0.12, 0.76, 0.12] })),
  ]),
  merge([
    part(G.box, { color: "#2f6fb0", pos: [0, 0.55, 0], scale: [2.4, 0.5, 1.1] }),
    part(G.box, { color: "#24578c", pos: [-0.15, 1.0, 0], scale: [1.3, 0.45, 1.0] }),
    part(G.box, { color: "#cfe8ff", pos: [0.52, 1.0, 0], scale: [0.04, 0.36, 0.9] }),
    ...[[0.8, 0.56], [0.8, -0.56], [-0.8, 0.56], [-0.8, -0.56]].map(([x, z]) => part(G.cyl(0.3, 0.3, 0.16, 12), { color: "#222326", pos: [x, 0.3, z], rot: [Math.PI / 2, 0, 0] })),
    part(G.box, { color: "#ffe9a8", pos: [1.21, 0.62, 0.38], scale: [0.03, 0.12, 0.2] }),
    part(G.box, { color: "#ffe9a8", pos: [1.21, 0.62, -0.38], scale: [0.03, 0.12, 0.2] }),
  ]),
];

function Ride({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const version = useWorldVersion(1000);
  const w = rt.world;
  const lv = w?.civic?.lv.transport ?? 0;
  const st = w?.structures.find((s) => s.type === "storage" && s.prog >= 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const at = useMemo(() => (st ? { x: st.x + Math.cos(st.rot + 1.2) * 3.4, z: st.z + Math.sin(st.rot + 1.2) * 3.4, r: st.rot + 0.3 } : null), [version, st?.id]);
  if (!lv || !at) return null;
  return (
    <mesh geometry={RIDE_GEO[Math.min(4, lv)]} material={vcMat} position={[at.x, terrain.height(at.x, at.z), at.z]} rotation-y={-at.r} castShadow />
  );
}

function Stockpile({ terrain }: { terrain: Terrain }) {
  const rt = useRuntime();
  const logs = useRef<THREE.InstancedMesh>(null);
  const stones = useRef<THREE.InstancedMesh>(null);
  const food = useRef<THREE.InstancedMesh>(null);
  const last = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const w = rt.world;
    if (!w) return;
    const now = performance.now();
    if (now - last.current < 1000) return;
    last.current = now;
    const st = w.structures.find((s) => s.type === "storage" && s.prog >= 1);
    const bx = st ? st.x - 1.6 : w.camp.x - 2.4;
    const bz = st ? st.z + 1.4 : w.camp.z + 1.6;
    const y = terrain.height(bx, bz);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const place = (mesh: THREE.InstancedMesh | null, n: number, fn: (i: number) => [number, number, number, number], lying = false) => {
      if (!mesh) return;
      const c = Math.min(n, mesh.instanceMatrix.count);
      for (let i = 0; i < c; i++) {
        const [x, yy, z, r] = fn(i);
        q.setFromEuler(e.set(lying ? Math.PI / 2 : 0, r, 0));
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, yy, z), q, new THREE.Vector3(1, 1, 1)));
      }
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    const wood = Math.min(24, Math.floor((w.stock.wood ?? 0) + (w.stock.stick ?? 0) / 3));
    place(logs.current, wood, (i) => [bx + (i % 4) * 0.24 - 0.36, y + 0.12 + Math.floor(i / 4) * 0.2, bz, 0], true);
    const stone = Math.min(16, Math.floor((w.stock.stone ?? 0) / 2));
    place(stones.current, stone, (i) => [bx + 1.4 + (i % 4) * 0.25 - 0.3, y + 0.12 + Math.floor(i / 8) * 0.2, bz + (Math.floor(i / 4) % 2) * 0.3, i]);
    let f = 0;
    for (const r of ["berry", "fruit", "meat", "fish", "cookedMeat", "cookedFish", "crop", "meal"] as const) f += w.stock[r] ?? 0;
    place(food.current, Math.min(14, Math.ceil(f / 3)), (i) => [bx - 0.3 + (i % 5) * 0.22, y + 0.12 + Math.floor(i / 5) * 0.18, bz - 1.0, i]);
  });
  return (
    <>
      <instancedMesh ref={logs} args={[undefined, undefined, 24]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.11, 0.11, 1.0, 6]} />
        <meshStandardMaterial color="#8a5a3b" flatShading />
      </instancedMesh>
      <instancedMesh ref={stones} args={[undefined, undefined, 16]} castShadow frustumCulled={false}>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#9b968e" flatShading />
      </instancedMesh>
      <instancedMesh ref={food} args={[undefined, undefined, 14]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial color="#e2453a" flatShading />
      </instancedMesh>
    </>
  );
}
