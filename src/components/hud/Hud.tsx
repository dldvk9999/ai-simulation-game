"use client";
import { useEffect, useState } from "react";
import { InstallButton } from "@/components/InstallButton";
import { useHud, type GroupSummary, type PersonSummary } from "@/game/hud";
import type { ChronicleEntry } from "@/sim/types";
import type { GameRuntime } from "@/game/runtime";
import type { Ambience } from "@/game/audio";
import { GROUP_POP, MAX_VIEWERS } from "@/sim/constants";
import { HELP } from "./helpData";
import { ERAS, TECHS } from "@/sim/data";
import { moraleLabel } from "@/sim/morale";
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

/** 터치 위주 기기인지 (게임 화면은 클라이언트에서만 렌더링된다) */
function useTouch() {
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);
  return touch;
}

type PanelKey = "people" | "chronicle" | "tech" | "help";
const MENU: { key: PanelKey; icon: string; label: string }[] = [
  { key: "people", icon: "👥", label: "사람들 · 창고" },
  { key: "chronicle", icon: "📜", label: "연대기" },
  { key: "tech", icon: "💡", label: "지식" },
  { key: "help", icon: "❔", label: "도움말" },
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
          <StructCard />
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
  const [menu, setMenu] = useState(false);
  const toggle = (p: typeof s.panel) => useHud.setState({ panel: s.panel === p ? "none" : p });
  const exit = () => {
    rt.leave();
    onExit();
  };
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
          {s.abroad > 0 && <span className="chip">⛵ {s.abroad}명 섬 밖</span>}
          {s.disaster && (
            <span className="chip alert">
              {s.disaster.icon} {s.disaster.name}{s.disaster.coming ? " 다가옴" : ""}
            </span>
          )}
          {s.war && <span className="chip alert">⚔️ 무리끼리 다툼</span>}
          {s.fire && (
            <span className="chip alert fire">
              🔥 {s.fire.houses ? `건물 ${s.fire.houses}채 화재` : "산불"}{s.fire.count > s.fire.houses && s.fire.houses ? ` · 산불 ${s.fire.count - s.fire.houses}` : ""}
            </span>
          )}
          {s.beast && (
            <span className="chip alert">
              {s.beast.icon} {s.beast.name}{s.beast.count > 1 ? ` ${s.beast.count}마리` : ""} 출몰
            </span>
          )}
          <span className={`chip morale ${s.morale >= 75 ? "hi" : s.morale >= 50 ? "" : s.morale >= 35 ? "low" : "bad"}`} title="사기가 높으면 일과 연구가 잘 되고, 낮으면 마음이 가라앉아요">
            {s.morale >= 50 ? "💪" : "😞"} 사기 {s.morale} · {moraleLabel(s.morale)}
          </span>
          <span className="chip" title={s.isHost ? "이 화면이 섬의 시간을 돌리고 있어요" : "다른 관찰자와 함께 보는 중"}>
            👁 {s.viewers}/{MAX_VIEWERS}
          </span>
          {s.generation > 1 && <span className="chip">🌱 {s.generation}세대</span>}
        </div>
        {s.offline && s.viewers <= 1 && <div className="tiny">로컬 모드 · 같은 브라우저 탭끼리만 함께 볼 수 있어요</div>}
      </div>
      {/* 데스크톱: 아이콘 줄 */}
      <div className="toolbar">
        {MENU.map((m) => (
          <button key={m.key} className={s.panel === m.key ? "on" : ""} onClick={() => toggle(m.key)} title={m.label}>
            {m.icon}
          </button>
        ))}
        <InstallButton kind="tool" />
        <button onClick={mute} title="소리">{s.muted ? "🔇" : "🔊"}</button>
        <button onClick={exit} title="나가기">🚪</button>
      </div>
      {/* 모바일: 햄버거 버튼 하나에 모아서 */}
      <button className={`menu-btn ${menu ? "on" : ""}`} onClick={() => setMenu((v) => !v)} aria-label="메뉴" aria-expanded={menu}>
        <i />
        <i />
        <i />
      </button>
      {menu && (
        <>
          <div className="menu-back" onClick={() => setMenu(false)} />
          <nav className="card mobile-menu">
            {MENU.map((m) => (
              <button
                key={m.key}
                className={s.panel === m.key ? "on" : ""}
                onClick={() => {
                  useHud.setState({ panel: m.key });
                  setMenu(false);
                }}
              >
                <span>{m.icon}</span>
                {m.label}
              </button>
            ))}
            <InstallButton kind="menu" onPick={() => setMenu(false)} />
            <button onClick={mute}>
              <span>{s.muted ? "🔇" : "🔊"}</span>
              {s.muted ? "소리 켜기" : "소리 끄기"}
            </button>
            <button onClick={exit}>
              <span>🚪</span>
              나가기
            </button>
          </nav>
        </>
      )}
    </>
  );
}

/** 사람 한 줄: 누르면 그 사람을 보고 따라간다 (섬 밖에 있으면 보기만) */
function PersonRow({ p }: { p: PersonSummary }) {
  const selected = useHud((s) => s.selectedId === p.id);
  const following = useHud((s) => s.followId === p.id);
  return (
    <button
      className={`person-row ${selected ? "sel" : ""} ${p.away ? "away" : ""}`}
      onClick={() => useHud.setState({ selectedId: p.id, followId: p.away ? null : p.id })}
      title={p.away ? p.name : `${p.name} 따라가기`}
    >
      <span className="emoji">{p.emoji}</span>
      <span className="pname">
        {p.role && <span className="role">{p.role}</span>}
        {p.name}
      </span>
      <span className="age">{p.age}세</span>
      {following && <span className="follow">●</span>}
      <span className="pact">{p.action}</span>
    </button>
  );
}

const groupColor = (hue: number) => `hsl(${Math.round(hue * 360)} 62% 55%)`;

type GroupRow = Pick<GroupSummary, "id" | "title" | "stage" | "count" | "war" | "apart" | "leader"> & { hue: number | null; people: PersonSummary[] };

/** 무리 단위로 묶는다: 조직·문명, 무소속, 섬 밖에 나간 사람 */
function useGroupRows(): GroupRow[] | null {
  const people = useHud((s) => s.people);
  const groups = useHud((s) => s.groups);
  const pop = useHud((s) => s.pop + s.abroad);
  if (!groups.length || pop < GROUP_POP) return null;
  const alive = people.filter((p) => p.alive);
  const rows: GroupRow[] = groups.map((g) => ({ ...g, people: alive.filter((p) => p.group === g.id && !p.away) }));
  const known = new Set(groups.map((g) => g.id));
  const loners = alive.filter((p) => (p.group == null || !known.has(p.group)) && !p.away);
  if (loners.length) rows.push({ id: -1, title: "무소속", stage: "어느 무리에도 속하지 않음", count: loners.length, war: null, apart: false, leader: "", hue: null, people: loners });
  const away = alive.filter((p) => p.away);
  if (away.length) rows.push({ id: -2, title: "섬 밖에 나간 사람들", stage: "항해·여행 중", count: away.length, war: null, apart: false, leader: "", hue: null, people: away });
  return rows;
}

function GroupHeader({ g, open }: { g: GroupRow; open: boolean }) {
  return (
    <button
      className={`group-row ${open ? "open" : ""}`}
      onClick={() => useHud.setState({ openGroup: open ? null : g.id })}
      aria-expanded={open}
    >
      <span className="flag" style={{ background: g.hue == null ? "#c9bba0" : groupColor(g.hue) }}>{g.id === -2 ? "⛵" : ""}</span>
      <span className="gname">{g.title}</span>
      <span className="gcount">{g.people.length}명</span>
      <span className="chev">{open ? "▾" : "▸"}</span>
      <span className="gstage">
        {g.stage}
        {g.leader && ` · 👑 ${g.leader}`}
        {g.apart && " · 따로 터를 잡음"}
        {g.war && <b className="gwar"> · ⚔️ {g.war}와(과) 다툼</b>}
      </span>
    </button>
  );
}

function PeopleList() {
  const people = useHud((s) => s.people);
  const hasCard = useHud((s) => s.selected != null);
  const openGroup = useHud((s) => s.openGroup);
  const rows = useGroupRows();
  const alive = people.filter((p) => p.alive);
  if (!alive.length) return null;
  return (
    <div className={`card people ${hasCard ? "compact" : ""}`}>
      {rows
        ? rows.map((g) => (
            <div key={g.id} className="group">
              <GroupHeader g={g} open={openGroup === g.id} />
              {openGroup === g.id && g.people.map((p) => <PersonRow key={p.id} p={p} />)}
            </div>
          ))
        : alive.map((p) => <PersonRow key={p.id} p={p} />)}
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
          {p.illName && <div className={`ill lv${p.ill}`}>🤒 {p.illName} ({p.ill}단계)</div>}
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
        {p.groupName && <div>🏳️ {p.groupName}{p.role && ` · ${p.role}`}</div>}
        {p.traits.length > 0 && <div>🧭 {p.traits.join(" · ")}</div>}
        <div>💭 뜻: {p.view}</div>
        <div>💗 {p.likes}</div>
        <div>🏠 {p.home}{p.carry && ` · 🎒 ${p.carry}`}</div>
        {p.family.length > 0 && <div>👪 {p.family.join(" · ")}</div>}
        {p.skills.length > 0 && <div>🛠 {p.skills.join(" · ")}</div>}
      </div>
      {!p.away && (
        <button className="follow-btn" onClick={() => useHud.setState({ followId: followId === p.id ? null : p.id })}>
          {followId === p.id ? "따라가기 멈추기" : "따라가기"}
        </button>
      )}
    </div>
  );
}

/** 눌러 본 건물: 용도와 내구도 */
function StructCard() {
  const st = useHud((s) => s.structure);
  const person = useHud((s) => s.selected);
  if (!st || person) return null;
  const k = st.max ? st.hp / st.max : 0;
  return (
    <div className="card person struct">
      <div className="phead">
        <span className="big">{st.state.startsWith("🔥") ? "🔥" : "🏠"}</span>
        <div>
          <div className="pn">
            {st.name} {st.floors > 1 && <span className="sub">{st.floors}층</span>}
          </div>
          <div className="sub">{st.use}{st.use && " · "}{st.state}</div>
        </div>
        <button className="x" onClick={() => useHud.setState({ structId: null })}>✕</button>
      </div>
      <div className="bars">
        <Bar v={k * 100} color={k > 0.6 ? "#69db7c" : k > 0.3 ? "#ffd43b" : "#ff6b6b"} label="내구도" />
      </div>
      <div className="meta">
        <div>🧱 {st.hp} / {st.max}</div>
        {st.who && <div>👪 {st.who}</div>}
        {st.note && <div>📌 {st.note}</div>}
        <div className="tiny">빠르게 세 번 누르면 내구도가 깎여요. 0이 되면 무너져요.</div>
      </div>
    </div>
  );
}

function Drawer() {
  const panel = useHud((s) => s.panel);
  if (panel === "help") return <HelpModal />;
  if (panel === "none" || panel === "people") return panel === "people" ? <PeopleDrawer /> : null;
  return (
    <div className="card drawer">
      <button className="x" onClick={() => useHud.setState({ panel: "none" })}>✕</button>
      {panel === "chronicle" && <Chronicle />}
      {panel === "tech" && <TechTree />}
    </div>
  );
}

function PersonItem({ p }: { p: PersonSummary }) {
  return (
    <li onClick={() => p.alive && useHud.setState({ selectedId: p.id, followId: p.away ? null : p.id })} className={p.alive ? "" : "gone"}>
      {p.emoji} {p.role && <span className="role">{p.role}</span>}<b>{p.name}</b> {p.age}세 · {p.action}
    </li>
  );
}

function PeopleDrawer() {
  const people = useHud((s) => s.people);
  const stock = useHud((s) => s.stock);
  const openGroup = useHud((s) => s.openGroup);
  const rows = useGroupRows();
  const gone = people.filter((p) => !p.alive);
  return (
    <div className="card drawer">
      <button className="x" onClick={() => useHud.setState({ panel: "none" })}>✕</button>
      <h3>섬 사람들</h3>
      {rows ? (
        <div className="glist">
          {rows.map((g) => (
            <div key={g.id} className="group">
              <GroupHeader g={g} open={openGroup === g.id} />
              {openGroup === g.id && (
                <ul className="plist inner">
                  {g.people.map((p) => <PersonItem key={p.id} p={p} />)}
                </ul>
              )}
            </div>
          ))}
          {gone.length > 0 && (
            <ul className="plist">
              {gone.map((p) => <PersonItem key={p.id} p={p} />)}
            </ul>
          )}
        </div>
      ) : (
        <ul className="plist">
          {people.map((p) => <PersonItem key={p.id} p={p} />)}
        </ul>
      )}
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

/** 쪽 넘기기: ‹ ● ○ ○ › */
function Pager({ page, pages, onPage, dots = true }: { page: number; pages: number; onPage: (n: number) => void; dots?: boolean }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label="이전">‹</button>
      {dots && pages <= 8 ? (
        <span className="dots">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} className={i === page ? "on" : ""} onClick={() => onPage(i)} aria-label={`${i + 1}쪽`} />
          ))}
        </span>
      ) : (
        <span className="num">{page + 1} / {pages}</span>
      )}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="다음">›</button>
    </div>
  );
}

/** 도움말: 왼쪽에서 카테고리를 고르고, 오른쪽에서 기능 하나씩 그림과 함께 넘겨 본다 */
function HelpModal() {
  const touch = useTouch();
  const [cat, setCat] = useState(0);
  const [page, setPage] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const c = HELP[cat];
  const item = c.items[Math.min(page, c.items.length - 1)];
  const close = () => useHud.setState({ panel: "none" });
  const go = (n: number) => setPage(Math.max(0, Math.min(c.items.length - 1, n)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setPage((v) => Math.min(c.items.length - 1, v + 1));
      if (e.key === "ArrowLeft") setPage((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c.items.length]);
  return (
    <div className="modal-back help-back" onClick={close}>
      <div className="card help-modal" role="dialog" aria-label="도움말" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={close} aria-label="닫기">✕</button>
        <nav className="help-cats">
          <h3>도움말</h3>
          {HELP.map((h, i) => (
            <button key={h.id} className={i === cat ? "on" : ""} onClick={() => { setCat(i); setPage(0); }}>
              <span>{h.icon}</span>
              {h.name}
              <i>{h.items.length}</i>
            </button>
          ))}
        </nav>
        <section className="help-page" key={item.id}>
          <div className="help-img">
            {broken[item.id] ? (
              <span className="help-emoji">{item.icon}</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/help/${item.id}.webp`} alt={item.title} loading="lazy" onError={() => setBroken((b) => ({ ...b, [item.id]: true }))} />
            )}
          </div>
          <div className="help-text">
            <div className="help-title">
              {item.icon} {item.title}
              <span className="sub">{c.name} · {Math.min(page, c.items.length - 1) + 1}/{c.items.length}</span>
            </div>
            <p>{touch && item.touch ? item.touch : item.body}</p>
          </div>
          <Pager page={Math.min(page, c.items.length - 1)} pages={c.items.length} onPage={go} />
        </section>
      </div>
    </div>
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
  const covered = useHud((s) => s.panel !== "none" || s.selected != null || s.structure != null);
  // 건물 카드가 열려 있으면 그 위로 올린다
  const raised = useHud((s) => s.structure != null && s.selected == null);
  const touch = useTouch();
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
  // 패널이나 인물 카드가 열려 있으면 그 위에 겹치지 않게 숨긴다
  if (covered && !hint) return null;
  return (
    <div className={`hint-wrap ${raised ? "raised" : ""}`}>
      {hint && <div className="hint">{hint}</div>}
      {show && !hint && (
        <div className="hint soft">
          {touch ? "탭: 치기 · 끌기: 옮기기 · 연타: 불 · 두 손가락: 시점 이동" : "클릭: 치기 · 드래그: 옮기기 · 연타: 불 지피기 · 빈 곳 드래그: 시점 회전"}
        </div>
      )}
    </div>
  );
}

/** 자리를 비운 동안의 연대기: 한 쪽에 15개씩 */
const AWAY_PAGE = 15;

function Away() {
  const away = useHud((s) => s.away);
  if (!away) return null;
  return <AwayModal key={`${away.days}:${away.entries.length}`} entries={away.entries} days={away.days} />;
}

function AwayModal({ entries, days }: { entries: ChronicleEntry[]; days: number }) {
  const pages = Math.max(1, Math.ceil(entries.length / AWAY_PAGE));
  const [page, setPage] = useState(0);
  const label = days >= 1 ? `${Math.floor(days)}일` : `${Math.max(1, Math.round(days * 24))}시간`;
  const list = entries.slice(page * AWAY_PAGE, page * AWAY_PAGE + AWAY_PAGE);
  return (
    <div className="modal-back">
      <div className="card modal away">
        <h3>
          당신이 없는 동안 ({label})
          <span className="sub"> · 이야기 {entries.length}개</span>
        </h3>
        <ul className="chron">
          {list.map((c, i) => (
            <li key={page * AWAY_PAGE + i} className={`k-${c.k}`}>{c.text}</li>
          ))}
        </ul>
        <Pager page={page} pages={pages} onPage={(n) => setPage(Math.max(0, Math.min(pages - 1, n)))} dots={false} />
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
