"use client";
import { useEffect, useState } from "react";
import { useHud } from "@/game/hud";
import type { GameRuntime } from "@/game/runtime";
import type { Ambience } from "@/game/audio";
import { MAX_VIEWERS } from "@/sim/constants";
import { ERAS, TECHS } from "@/sim/data";
import { WEATHER_ICON, WEATHER_NAME } from "@/sim/weather";

const NEED_LABEL: [string, string, string][] = [
  ["hunger", "배부름", "#f4a261"],
  ["thirst", "수분", "#4dabf7"],
  ["energy", "기력", "#9775fa"],
  ["warmth", "체온", "#ff6b6b"],
  ["social", "교류", "#f783ac"],
  ["fun", "즐거움", "#51cf66"],
];
const EMO_LABEL: [string, string, string][] = [
  ["joy", "기쁨", "#ffd43b"],
  ["love", "애정", "#f783ac"],
  ["surprise", "놀람", "#74c0fc"],
  ["sadness", "슬픔", "#748ffc"],
  ["fear", "두려움", "#b197fc"],
  ["anger", "화남", "#ff6b6b"],
];

export function Hud({ rt, amb, onExit }: { rt: GameRuntime; amb: Ambience; onExit: () => void }) {
  const phase = useHud((s) => s.phase);
  return (
    <div className="hud">
      {phase === "running" && (
        <>
          <TopBar rt={rt} amb={amb} onExit={onExit} />
          <PeopleList />
          <PersonCard />
          <Drawer />
          <Toasts />
          <Hint />
          <Away />
        </>
      )}
      <Overlay onExit={onExit} />
    </div>
  );
}

function TopBar({ rt, amb, onExit }: { rt: GameRuntime; amb: Ambience; onExit: () => void }) {
  const s = useHud();
  const toggle = (p: typeof s.panel) => useHud.setState({ panel: s.panel === p ? "none" : p });
  const mute = () => {
    const m = !s.muted;
    amb.setMuted(m);
    useHud.setState({ muted: m });
    try {
      localStorage.setItem("island:muted", m ? "1" : "0");
    } catch {}
  };
  return (
    <>
      <div className="card status">
        <div className="day">
          🏝️ <b>{s.day}일째</b> <span className="sub">{s.year}년차</span>
        </div>
        <div className="row">
          {s.season} · {s.tod} {s.clock}
        </div>
        <div className="row">
          {WEATHER_ICON[s.weather]} {WEATHER_NAME[s.weather]} · {s.temp}°C
        </div>
        <div className="chips">
          <span className="chip era">{s.era}</span>
          <span className="chip">👥 {s.pop}명</span>
          <span className="chip" title={s.isHost ? "이 화면이 섬의 시간을 돌리고 있어요" : "다른 관찰자와 함께 보는 중"}>
            👁 {s.viewers}/{MAX_VIEWERS}
          </span>
          {s.generation > 1 && <span className="chip">🌱 {s.generation}세대</span>}
        </div>
        {s.offline && s.viewers <= 1 && <div className="tiny">로컬 모드 · 같은 브라우저 탭끼리만 함께 볼 수 있어요</div>}
      </div>
      <div className="toolbar">
        <button className={s.panel === "people" ? "on" : ""} onClick={() => toggle("people")} title="사람들">👥</button>
        <button className={s.panel === "chronicle" ? "on" : ""} onClick={() => toggle("chronicle")} title="연대기">📜</button>
        <button className={s.panel === "tech" ? "on" : ""} onClick={() => toggle("tech")} title="지식">💡</button>
        <button className={s.panel === "help" ? "on" : ""} onClick={() => toggle("help")} title="도움말">❔</button>
        <button onClick={mute} title="소리">{s.muted ? "🔇" : "🔊"}</button>
        <button
          onClick={() => {
            rt.leave();
            onExit();
          }}
          title="나가기"
        >
          🚪
        </button>
      </div>
    </>
  );
}

function PeopleList() {
  const people = useHud((s) => s.people);
  const selectedId = useHud((s) => s.selectedId);
  const followId = useHud((s) => s.followId);
  const hasCard = useHud((s) => s.selected != null);
  const alive = people.filter((p) => p.alive);
  if (!alive.length) return null;
  return (
    <div className={`card people ${hasCard ? "compact" : ""}`}>
      {alive.map((p) => (
        <button
          key={p.id}
          className={`person-row ${selectedId === p.id ? "sel" : ""}`}
          onClick={() => useHud.setState({ selectedId: p.id, followId: p.id })}
          title={`${p.name} 따라가기`}
        >
          <span className="emoji">{p.emoji}</span>
          <span className="pname">{p.name}</span>
          <span className="age">{p.age}세</span>
          {followId === p.id && <span className="follow">●</span>}
          <span className="pact">{p.action}</span>
        </button>
      ))}
    </div>
  );
}

function Bar({ v, color, label }: { v: number; color: string; label: string }) {
  return (
    <div className="bar">
      <span className="blabel">{label}</span>
      <span className="btrack">
        <span className="bfill" style={{ width: `${Math.max(2, Math.min(100, v))}%`, background: color }} />
      </span>
    </div>
  );
}

function PersonCard() {
  const p = useHud((s) => s.selected);
  const followId = useHud((s) => s.followId);
  if (!p) return null;
  return (
    <div className="card person">
      <div className="phead">
        <span className="big">{p.emoji}</span>
        <div>
          <div className="pn">
            {p.name} <span className="sub">{p.sex === "M" ? "♂" : "♀"} {p.age}세</span>
          </div>
          <div className="sub">
            {p.alive ? `${p.mainEmotion} · ${p.action}` : "영원히 잠들었어요"}
            {p.preg && " · 🤰"}
          </div>
        </div>
        <button className="x" onClick={() => useHud.setState({ selectedId: null, followId: null })}>✕</button>
      </div>
      {p.thought && <div className="thought">“{p.thought}”</div>}
      {p.alive && (
        <>
          <div className="bars">
            <Bar v={p.health} color="#ff8787" label="건강" />
            {NEED_LABEL.map(([k, l, c]) => (
              <Bar key={k} v={p.needs[k as keyof typeof p.needs]} color={c} label={l} />
            ))}
          </div>
          <div className="emos">
            {EMO_LABEL.map(([k, l, c]) => {
              const v = p.emo[k as keyof typeof p.emo];
              return (
                <span key={k} className="emo-dot" style={{ opacity: 0.25 + v * 0.75 }} title={`${l} ${Math.round(v * 100)}`}>
                  <i style={{ background: c, transform: `scale(${0.5 + v * 0.8})` }} />
                  {l}
                </span>
              );
            })}
          </div>
        </>
      )}
      <div className="meta">
        {p.traits.length > 0 && <div>🧭 {p.traits.join(" · ")}</div>}
        <div>💗 {p.likes}</div>
        <div>🏠 {p.home}{p.carry && ` · 🎒 ${p.carry}`}</div>
        {p.family.length > 0 && <div>👪 {p.family.join(" · ")}</div>}
        {p.skills.length > 0 && <div>🛠 {p.skills.join(" · ")}</div>}
      </div>
      <button className="follow-btn" onClick={() => useHud.setState({ followId: followId === p.id ? null : p.id })}>
        {followId === p.id ? "따라가기 멈추기" : "따라가기"}
      </button>
    </div>
  );
}

function Drawer() {
  const panel = useHud((s) => s.panel);
  if (panel === "none" || panel === "people") return panel === "people" ? <PeopleDrawer /> : null;
  return (
    <div className="card drawer">
      <button className="x" onClick={() => useHud.setState({ panel: "none" })}>✕</button>
      {panel === "chronicle" && <Chronicle />}
      {panel === "tech" && <TechTree />}
      {panel === "help" && <Help />}
    </div>
  );
}

function PeopleDrawer() {
  const people = useHud((s) => s.people);
  const stock = useHud((s) => s.stock);
  return (
    <div className="card drawer">
      <button className="x" onClick={() => useHud.setState({ panel: "none" })}>✕</button>
      <h3>섬 사람들</h3>
      <ul className="plist">
        {people.map((p) => (
          <li key={p.id} onClick={() => p.alive && useHud.setState({ selectedId: p.id, followId: p.id })} className={p.alive ? "" : "gone"}>
            {p.emoji} <b>{p.name}</b> {p.age}세 · {p.action}
          </li>
        ))}
      </ul>
      <h3>창고</h3>
      <div className="stock">
        {stock.length === 0 && <span className="sub">아직 모아둔 것이 없어요</span>}
        {stock.map(([k, v]) => (
          <span key={k} className="chip">
            {k} {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function Chronicle() {
  const list = useHud((s) => s.chronicle);
  return (
    <>
      <h3>섬의 연대기</h3>
      <ul className="chron">
        {[...list].reverse().map((c, i) => (
          <li key={`${c.t}-${i}`} className={`k-${c.k}`}>
            {c.text}
          </li>
        ))}
      </ul>
    </>
  );
}

function TechTree() {
  const tech = useHud((s) => s.tech);
  const known = new Set(tech.known);
  return (
    <>
      <h3>터득한 지식</h3>
      {tech.focus && (
        <div className="focus">
          지금 고민 중: <b>{TECHS.find((t) => t.id === tech.focus)?.name}</b>
          <span className="btrack">
            <span className="bfill" style={{ width: `${Math.min(100, (tech.progress / tech.cost) * 100)}%`, background: "#ffd43b" }} />
          </span>
        </div>
      )}
      {ERAS.map((era, e) => (
        <div key={era} className="era-block">
          <div className="era-name">{era}</div>
          <div className="techs">
            {TECHS.filter((t) => t.era === e).map((t) => {
              const ok = known.has(t.id);
              const avail = !ok && t.prereq.every((p) => known.has(p));
              return (
                <div key={t.id} className={`tech ${ok ? "known" : avail ? "avail" : "locked"} ${tech.focus === t.id ? "cur" : ""}`} title={t.desc}>
                  {ok ? "✓ " : avail ? "… " : "🔒 "}
                  {ok || avail ? t.name : "???"}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function Help() {
  return (
    <>
      <h3>섬을 돌보는 방법</h3>
      <ul className="help">
        <li>🖱️ <b>클릭</b> — 치기. 나무를 흔들면 열매나 가지가 떨어지고, 바위를 치면 돌이 떨어져요. 동물이나 물고기를 치면 잠시 기절해요.</li>
        <li>✋ <b>드래그</b> — 물건·동물·물고기를 집어 옮겨요. 사람 앞에 놓아주면 선물로 여기고 반가워해요.</li>
        <li>🔥 <b>연타</b> — 같은 자리를 빠르게 {5}번 클릭하면 불이 붙어요. 장작 위면 더 오래 타요. 비가 오면 잘 안 붙어요.</li>
        <li>👤 사람은 건드릴 수 없어요. 클릭하면 마음과 상태를 볼 수 있고, 더블클릭하면 따라가요.</li>
        <li>🎥 빈 곳 드래그: 회전 · 우클릭/Shift 드래그: 이동 · 휠: 확대 · WASD/QE 키도 돼요.</li>
        <li>⏳ 섬의 하루는 현실 20분이에요. 창을 닫아도 섬의 시간은 계속 흘러요.</li>
        <li>👁 같은 키로 최대 {MAX_VIEWERS}명이 함께 지켜볼 수 있어요.</li>
      </ul>
    </>
  );
}

function Toasts() {
  const toasts = useHud((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast k-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Hint() {
  const hint = useHud((s) => s.hint);
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => useHud.setState({ hint: null }), 3200);
    return () => clearTimeout(id);
  }, [hint]);
  useEffect(() => {
    const id = setTimeout(() => setShow(false), 25000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="hint-wrap">
      {hint && <div className="hint">{hint}</div>}
      {show && !hint && <div className="hint soft">클릭: 치기 · 드래그: 옮기기 · 연타: 불 지피기 · 빈 곳 드래그: 시점 회전</div>}
    </div>
  );
}

function Away() {
  const away = useHud((s) => s.away);
  if (!away) return null;
  const days = away.days >= 1 ? `${Math.floor(away.days)}일` : `${Math.max(1, Math.round(away.days * 24))}시간`;
  return (
    <div className="modal-back">
      <div className="card modal">
        <h3>당신이 없는 동안 ({days})</h3>
        <ul className="chron">
          {away.entries.slice(-30).map((c, i) => (
            <li key={i} className={`k-${c.k}`}>{c.text}</li>
          ))}
        </ul>
        <button className="primary" onClick={() => useHud.setState({ away: null })}>섬으로 돌아가기</button>
      </div>
    </div>
  );
}

function Overlay({ onExit }: { onExit: () => void }) {
  const phase = useHud((s) => s.phase);
  const error = useHud((s) => s.error);
  const catchup = useHud((s) => s.catchup);
  if (phase === "running") return null;
  let body: React.ReactNode = <p>섬에 다가가는 중…</p>;
  if (phase === "syncing") body = <p>함께 지켜보는 사람의 섬에 연결하는 중…</p>;
  if (phase === "catchup") {
    const days = catchup.done / 86400;
    const pct = catchup.total ? (catchup.done / catchup.total) * 100 : 0;
    body = (
      <>
        <p>당신이 없는 동안 섬의 시간이 흘렀어요</p>
        <p className="big-num">{days < 1 ? `${Math.round(days * 24)}시간` : `${Math.floor(days)}일`}</p>
        <span className="btrack wide">
          <span className="bfill" style={{ width: `${pct}%`, background: "#ffd43b" }} />
        </span>
      </>
    );
  }
  if (phase === "error") {
    body = (
      <>
        <p>{error ?? "문제가 생겼어요."}</p>
        <button className="primary" onClick={onExit}>처음으로</button>
      </>
    );
  }
  return (
    <div className="overlay">
      <div className="wave-dots"><i /><i /><i /></div>
      {body}
    </div>
  );
}
