"use client";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Ambience } from "@/game/audio";
import { useHud } from "@/game/hud";
import { GameRuntime, type JoinResponse } from "@/game/runtime";
import { beginEnding } from "@/sim/ending";
import { step } from "@/sim/step";
import { Hud } from "@/components/hud/Hud";
import { AudioContext3D, LabelContext, RuntimeContext, useRuntime, useWorldVersion } from "./context";
import { camState, Controls } from "./Controls";
import { Effects } from "./Effects";
import { EndingFx } from "./Ending";
import { Flora } from "./Flora";
import { People } from "./People";
import { SkyAndLight } from "./SkyAndLight";
import { Structures } from "./Structures";
import { TerrainMesh } from "./Terrain";
import { Animals, FishSchool, Items, Rocks } from "./Things";
import { Beasts } from "./Beasts";
import { Fleet } from "./Fleet";
import { Water } from "./Water";
import { WeatherFx } from "./WeatherFx";

function Scene() {
  const rt = useRuntime();
  useWorldVersion(1000);
  const terrain = rt.terrain;
  return (
    <>
      <SkyAndLight />
      <TerrainMesh terrain={terrain} />
      <Water terrain={terrain} />
      <Flora terrain={terrain} />
      <Rocks terrain={terrain} />
      <Structures terrain={terrain} />
      <Items terrain={terrain} />
      <Animals terrain={terrain} />
      <Beasts terrain={terrain} />
      <Fleet terrain={terrain} />
      <FishSchool terrain={terrain} />
      <People terrain={terrain} />
      <WeatherFx terrain={terrain} />
      <Effects terrain={terrain} />
      <EndingFx terrain={terrain} />
      <Controls terrain={terrain} />
    </>
  );
}

export default function Game({ join, onExit }: { join: JoinResponse; onExit: () => void }) {
  const [rt, setRt] = useState<GameRuntime | null>(null);
  const [amb] = useState(() => new Ambience());
  const phase = useHud((s) => s.phase);
  const labels = useRef<HTMLDivElement>(null);
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null);
  useEffect(() => setLabelLayer(labels.current), []);

  useEffect(() => {
    useHud.setState({ phase: "connecting", error: null, selectedId: null, followId: null, away: null, panel: "none", toasts: [] });
    camState.ready = false;
    const r = new GameRuntime(join);
    setRt(r);
    // 개발용: 콘솔에서 장면을 꾸며 볼 수 있게 (도움말 그림 · 엔딩 확인)
    if (process.env.NODE_ENV !== "production") (window as unknown as { __island: unknown }).__island = { rt: r, camState, hud: useHud, sim: { beginEnding, step } };
    void r.start();
    let muted = false;
    try {
      muted = localStorage.getItem("island:muted") === "1";
    } catch {}
    amb.setMuted(muted);
    useHud.setState({ muted });
    amb.start();
    const onVis = () => {
      if (document.visibilityState === "hidden") r.flush();
    };
    const onHide = () => r.leave();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      r.dispose();
    };
  }, [join, amb]);

  useEffect(() => () => amb.dispose(), [amb]);

  return (
    <div className="game">
      {rt && phase === "running" && (
        <RuntimeContext.Provider value={rt}>
          <AudioContext3D.Provider value={amb}>
            <LabelContext.Provider value={labelLayer}>
            <Canvas
              shadows="percentage"
              dpr={[1, 1.75]}
              camera={{ fov: 45, near: 0.5, far: 2000, position: [0, 60, 80] }}
              gl={{ antialias: true, powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.05;
              }}
            >
              <Scene />
            </Canvas>
            </LabelContext.Provider>
          </AudioContext3D.Provider>
        </RuntimeContext.Provider>
      )}
      <div className="labels" ref={labels} />
      {rt && <Hud rt={rt} amb={amb} onExit={onExit} />}
    </div>
  );
}
