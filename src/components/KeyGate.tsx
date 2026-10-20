"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { JoinResponse } from "@/game/runtime";

const Game = dynamic(() => import("@/components/game/Game"), { ssr: false });

export default function KeyGate() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [join, setJoin] = useState<JoinResponse | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!k || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/world/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const data = await res.json();
      if (res.status === 409) setMsg("이 섬은 이미 3명이 지켜보고 있어요. 잠시 후 다시 와 주세요.");
      else if (!res.ok) setMsg(data.error === "bad_key" ? "키는 1~64자로 입력해 주세요." : "섬을 찾지 못했어요. 잠시 후 다시 시도해 주세요.");
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
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="섬의 키를 입력하세요"
          maxLength={64}
          aria-label="섬의 키"
          disabled={busy}
        />
        <p className={`gate-msg ${msg ? "err" : ""}`}>{msg ?? (busy ? "파도를 건너는 중…" : "처음 쓰는 키라면 새로운 무인도가 시작돼요")}</p>
      </form>
    </main>
  );
}
