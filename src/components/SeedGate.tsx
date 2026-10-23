"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { JoinResponse } from "@/game/runtime";
import { InstallButton } from "./InstallButton";

const Game = dynamic(() => import("@/components/game/Game"), { ssr: false });

export default function SeedGate() {
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [join, setJoin] = useState<JoinResponse | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = seed.trim();
    if (!s || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/world/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: s }),
      });
      const data = await res.json();
      if (res.status === 409) setMsg("이 섬은 이미 3명이 지켜보고 있어요. 잠시 후 다시 와 주세요.");
      else if (!res.ok) setMsg(data.error === "bad_seed" ? "시드는 1~64자로 입력해 주세요." : "섬을 찾지 못했어요. 잠시 후 다시 시도해 주세요.");
      else setJoin(data as JoinResponse);
    } catch {
      setMsg("연결이 불안정해요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  if (join) return <Game join={join} onExit={() => setJoin(null)} />;

  return (
    <main className="gate">
      <div className="gate-sky" />
      <div className="gate-sea">
        <i />
        <i />
        <i />
      </div>
      <form className="gate-form" onSubmit={submit}>
        <input
          autoFocus
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="섬의 시드를 입력하세요"
          maxLength={64}
          aria-label="섬의 시드"
          disabled={busy}
        />
        <p className={`gate-msg ${msg ? "err" : ""}`}>{msg ?? (busy ? "파도를 건너는 중…" : "처음 쓰는 시드라면 새로운 무인도가 시작돼요")}</p>
      </form>
      <InstallButton kind="gate" />
    </main>
  );
}
