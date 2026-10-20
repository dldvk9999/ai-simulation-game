"use client";
import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useRef, useState } from "react";
import type { Ambience } from "@/game/audio";
import type { GameRuntime } from "@/game/runtime";

export const RuntimeContext = createContext<GameRuntime | null>(null);
export const AudioContext3D = createContext<Ambience | null>(null);
/** 사람 머리 위 이름표를 그리는 DOM 레이어 */
export const LabelContext = createContext<HTMLDivElement | null>(null);
export const useLabelLayer = () => useContext(LabelContext);

export function useRuntime() {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error("RuntimeContext missing");
  return rt;
}

export const useAmbience = () => useContext(AudioContext3D);

/** 런타임의 구조 버전이 바뀔 때만 다시 렌더링 */
export function useWorldVersion(throttleMs = 0) {
  const rt = useRuntime();
  const [v, setV] = useState(rt.version);
  const last = useRef(0);
  useFrame(() => {
    if (rt.version !== v) {
      const now = performance.now();
      if (now - last.current >= throttleMs) {
        last.current = now;
        setV(rt.version);
      }
    }
  });
  return v;
}
