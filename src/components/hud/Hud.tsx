"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { InstallButton } from "@/components/InstallButton";
import { useHud, type GroupSummary, type PeopleTab, type PersonSummary } from "@/game/hud";
import type { Credits } from "@/sim/ending";
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
          <SpeedButtons rt={rt} />
          <EndingBanner />
          <Away />
          <CreditsModal rt={rt} />
          <RestartConfirm rt={rt} />
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
          {s.robots > 0 && <span className="chip robot">🤖 로봇 {s.robots}</span>}
          {s.abroad > 0 && <span className="chip">⛵ {s.abroad}명 섬 밖</span>}
          {s.speed > 1 && <span className="chip fast">⏩ {s.speed}배속</span>}
          {s.ending?.done && (
            <button className="chip ending" onClick={() => useHud.setState({ creditsOpen: true })} title="크레딧 다시 보기">
              🏁 {s.ending.title}
            </button>
          )}
          {s.disaster && (
            <span className="chip alert">
              {s.disaster.icon} {s.disaster.name}{s.disaster.coming ? " 다가옴" : ""}
            </span>
          )}
          {s.war && <span className="chip alert">⚔️ 무리끼리 다툼</span>}
          {s.nation && <span className="chip nation" title={`${s.nation.gov}${s.nation.ministers ? ` · ${s.nation.ministers}` : ""}`}>👑 {s.nation.name}</span>}
          {s.ship && <span className={`chip ${s.ship.war ? "alert" : ""}`}>{s.ship.war ? `⚔️ ${s.ship.name} 전함` : `⛵ ${s.ship.name} 상선`}</span>}
          {s.blessings.map((b) => (
            <span key={b.name} className="chip bless" title="의식이 통하는 동안">{b.icon} {b.name}</span>
          ))}
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
          {s.casino && (!s.casino.open || s.casino.addicts > 0) && (
            <span className={`chip ${s.casino.open ? "" : "alert"}`} title="게임중독에 빠지면 사흘 동안 집에서 나오지 못해요">
              {s.casino.open ? `🎰 게임중독 ${s.casino.addicts}명` : `⛔ 도박장 닫힘${s.casino.addicts ? ` · 중독 ${s.casino.addicts}명` : ""}`}
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
        {s.ending?.done && <button onClick={() => useHud.setState({ confirmRestart: true })} title="새로 시작하기">🔄</button>}
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
            {s.ending?.done && (
              <button onClick={() => { useHud.setState({ confirmRestart: true }); setMenu(false); }}>
                <span>🔄</span>
                새로 시작하기
              </button>
            )}
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

type GroupRow = Pick<GroupSummary, "id" | "title" | "stage" | "count" | "war" | "apart" | "leader"> & { kind?: GroupSummary["kind"]; hue: number | null; people: PersonSummary[] };

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
        {g.leader && ` · ${g.kind === "nation" ? "👑 왕" : "🎖️"} ${g.leader}`}
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

/** 사람 카드에서 펼쳐 둔 칸 (다른 사람을 눌러도 그대로, 이 브라우저에만 기억한다) */
const OPEN_KEY = "island:card-open";
function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function Section({ id, title, hint, open, onToggle, children }: { id: string; title: string; hint?: string; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <div className={`sect ${open ? "open" : ""}`}>
      <button className="sect-head" aria-expanded={open} onClick={() => onToggle(id)}>
        <span className="chev" aria-hidden>▸</span>
        <span className="st">{title}</span>
        {!open && hint && <span className="sh">{hint}</span>}
      </button>
      {open && <div className="sect-body">{children}</div>}
    </div>
  );
}

function PersonCard() {
  const p = useHud((s) => s.selected);
  const followId = useHud((s) => s.followId);
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {}
  }, [open]);
  if (!p) return null;
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const job = p.role || (p.age < 16 ? "아직 어려요" : "맡은 일 없음");
  const alerts = [p.illName && `🤒 ${p.illName}`, p.wound && "🩹 다침", p.preg && "🤰"].filter(Boolean).join(" · ");
  return (
    <div className="card person">
      <div className="phead">
        <span className="big">{p.emoji}</span>
        <div className="pbasic">
          <div className="pn">
            {p.name} <span className="sub">{p.sex === "M" ? "♂ 남자" : "♀ 여자"} · {p.age}세</span>
          </div>
          <div className="prow"><span className="pk">직업</span> {job}</div>
          <div className="prow"><span className="pk">지금</span> {p.alive ? p.action : "영원히 잠들었어요"}</div>
        </div>
        <button className="x" aria-label="닫기" onClick={() => useHud.setState({ selectedId: null, followId: null })}>✕</button>
      </div>
      {!p.away && p.alive && (
        <button className="follow-btn" onClick={() => useHud.setState({ followId: followId === p.id ? null : p.id })}>
          {followId === p.id ? "따라가기 멈추기" : "따라가기"}
        </button>
      )}
      <div className="sects">
        {p.alive && (
          <Section id="state" title="상태" hint={alerts || `${p.mainEmotion} · 건강 ${Math.round(p.health)}`} open={!!open.state} onToggle={toggle}>
            {(p.illName || p.wound) && (
              <div className="alerts">
                {p.illName && <div className={`ill lv${p.ill}`}>🤒 {p.illName} ({p.ill}단계)</div>}
                {p.wound && <div className="ill lv3">{p.wound}</div>}
              </div>
            )}
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
            {p.preg && <div className="meta">🤰 아기를 가졌어요</div>}
          </Section>
        )}
        <Section id="mind" title="마음" hint={p.thought ? `“${p.thought}”` : p.traits.slice(0, 2).join(" · ")} open={!!open.mind} onToggle={toggle}>
          {p.thought && <div className="thought">“{p.thought}”</div>}
          <div className="meta">
            {p.traits.length > 0 && <div>🧭 {p.traits.join(" · ")}</div>}
            <div>💭 뜻: {p.view}</div>
            <div>💗 {p.likes}</div>
          </div>
        </Section>
        <Section id="family" title="가족과 집" hint={p.home} open={!!open.family} onToggle={toggle}>
          <div className="meta">
            <div>🏠 {p.home}{p.carry && ` · 🎒 ${p.carry}`}</div>
            {p.family.length > 0 ? <div>👪 {p.family.join(" · ")}</div> : <div className="sub">아직 가족이 없어요</div>}
          </div>
        </Section>
        {(p.groupName || p.faith || p.wallet || p.gamble) && (
          <Section id="society" title="소속과 살림" hint={p.groupName.split(" · ")[0]} open={!!open.society} onToggle={toggle}>
            <div className="meta">
              {p.groupName && <div>🏳️ {p.groupName}</div>}
              {p.faith && <div>🙏 {p.faith}</div>}
              {p.wallet && <div>{p.wallet}</div>}
              {p.gamble && <div>{p.gamble}</div>}
            </div>
          </Section>
        )}
        {p.skills.length > 0 && (
          <Section id="skills" title="재주" hint={p.skills[0]} open={!!open.skills} onToggle={toggle}>
            <div className="meta">🛠 {p.skills.join(" · ")}</div>
          </Section>
        )}
      </div>
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

/** 사람들 패널: 사람 · 나라 · 창고를 칸으로 나눠 한 번에 하나씩 */
function PeopleDrawer() {
  const tab = useHud((s) => s.peopleTab);
  const hasNation = useHud((s) => !!(s.nation || s.faiths.length || s.economy || s.civic || s.casino));
  const cur: PeopleTab = tab === "nation" && !hasNation ? "people" : tab;
  const tabs: [PeopleTab, string][] = [["people", "👥 사람"], ...(hasNation ? ([["nation", "👑 나라"]] as [PeopleTab, string][]) : []), ["stock", "📦 창고"]];
  return (
    <div className="card drawer people-drawer">
      <button className="x" onClick={() => useHud.setState({ panel: "none" })}>✕</button>
      <nav className="ptabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? "on" : ""} onClick={() => useHud.setState({ peopleTab: k })}>
            {label}
          </button>
        ))}
      </nav>
      {cur === "people" && <PeopleTabView />}
      {cur === "nation" && <NationTabView />}
      {cur === "stock" && <StockTabView />}
    </div>
  );
}

function PeopleTabView() {
  const people = useHud((s) => s.people);
  const pop = useHud((s) => s.pop);
  const abroad = useHud((s) => s.abroad);
  const robots = useHud((s) => s.robots);
  const openGroup = useHud((s) => s.openGroup);
  const rows = useGroupRows();
  const [showGone, setShowGone] = useState(false);
  const gone = people.filter((p) => !p.alive);
  const alive = people.filter((p) => p.alive);
  return (
    <>
      <div className="psum">
        섬에 <b>{pop}명</b>
        {robots > 0 && <> · 🤖 {robots}</>}
        {abroad > 0 && <> · ⛵ 섬 밖 {abroad}</>}
      </div>
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
        </div>
      ) : (
        <ul className="plist">
          {alive.map((p) => <PersonItem key={p.id} p={p} />)}
        </ul>
      )}
      {gone.length > 0 && (
        <>
          <button className="gone-toggle" aria-expanded={showGone} onClick={() => setShowGone((v) => !v)}>
            🕯️ 얼마 전 떠난 사람 {gone.length}명 {showGone ? "▾" : "▸"}
          </button>
          {showGone && (
            <ul className="plist">
              {gone.map((p) => <PersonItem key={p.id} p={p} />)}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** 나라 · 종교 · 살림 · 도박장: 한 줄씩만 (자세한 숫자는 마우스를 올리면) */
function NationTabView() {
  const nation = useHud((s) => s.nation);
  const faiths = useHud((s) => s.faiths);
  const eco = useHud((s) => s.economy);
  const civic = useHud((s) => s.civic);
  const casino = useHud((s) => s.casino);
  return (
    <div className="ntab">
      {nation && (
        <section>
          <div className="nhead">👑 {nation.name} <span className="sub">{nation.gov}</span></div>
          <div className="nrow">왕 {nation.king}</div>
          {nation.ministers && <div className="nrow sub">{nation.ministers}</div>}
          {nation.foreign.length > 0 && (
            <div className="chips">
              {nation.foreign.map((n) => (
                <span key={n.name} className={`chip ${n.war ? "alert" : ""}`}>{n.war ? "⚔️" : "🤝"} {n.name} {n.war ? "전쟁 중" : n.mood}</span>
              ))}
            </div>
          )}
        </section>
      )}
      {faiths.length > 0 && (
        <section>
          <div className="nhead">🙏 종교</div>
          <div className="chips">
            {faiths.map((f) => (
              <span key={f.name} className="chip" title={`${f.wish} · 의식 ${f.rites}번`}>{f.icon} {f.name} {f.count}명</span>
            ))}
          </div>
        </section>
      )}
      {(eco || civic) && (
        <section>
          <div className="nhead">💰 살림</div>
          {eco && <div className="nrow" title={`거래 ${eco.trades.toLocaleString()}번`}>{eco.currency} · 곳간 {eco.treasury}</div>}
          {civic && <div className="nrow" title={`거둔 세금 ${civic.taxed} · 쓴 돈 ${civic.spent}`}>나라 살림 {civic.fund}{civic.done && ` · 고친 것 ${civic.done}`}</div>}
          {civic?.voice && <div className="nrow sub">🗣️ {civic.voice}</div>}
        </section>
      )}
      {casino && (
        <section>
          <div className="nhead">🎲 도박장</div>
          <div className="nrow" title={`판 ${casino.plays.toLocaleString()}번 · 나라 살림에 보탠 돈 ${casino.net}`}>
            {casino.open ? `열림 · 한 번에 ${casino.cap}까지` : "⛔ 왕이 문을 닫음"}{casino.addicts > 0 && ` · 🎰 중독 ${casino.addicts}명`}
          </div>
        </section>
      )}
    </div>
  );
}

function StockTabView() {
  const stock = useHud((s) => s.stock);
  const list = [...stock].sort((a, b) => b[1] - a[1]);
  return (
    <div className="stock">
      {list.length === 0 && <span className="sub">아직 모아둔 것이 없어요</span>}
      {list.map(([k, v]) => (
        <span key={k} className="chip">
          {k} <b>{v}</b>
        </span>
      ))}
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
  // 엔딩 연출 중에는 위쪽 안내 아래로
  const below = useHud((s) => !!s.ending && !s.ending.done);
  return (
    <div className={`toasts ${below ? "below" : ""}`}>
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

/** 누르고 있는 동안만 2배 · 3배로 빠르게 흐른다 (함께 보는 사람 모두에게) */
function SpeedButtons({ rt }: { rt: GameRuntime }) {
  const speed = useHud((s) => s.speed);
  const [held, setHeld] = useState(0);
  useEffect(() => {
    if (!held) return;
    const up = () => {
      setHeld(0);
      rt.holdSpeed(1);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
  }, [held, rt]);
  const press = (n: number) => {
    setHeld(n);
    rt.holdSpeed(n);
  };
  return (
    <div className="speed" role="group" aria-label="배속">
      {[2, 3].map((n) => (
        <button
          key={n}
          className={held === n || (!held && speed === n) ? "on" : ""}
          onPointerDown={(e) => {
            e.preventDefault();
            press(n);
          }}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && press(n)}
          onKeyUp={(e) => {
            if (e.key !== " " && e.key !== "Enter") return;
            setHeld(0);
            rt.holdSpeed(1);
          }}
          onContextMenu={(e) => e.preventDefault()}
          title={`누르고 있는 동안 ${n}배속`}
          aria-pressed={held === n}
        >
          ⏩<b>{n}배</b>
        </button>
      ))}
    </div>
  );
}

/** 엔딩 연출 중: 화면 위쪽에 지금 일어나는 일. 핵폭발 순간에는 화면이 하얗게 번쩍인다 */
function EndingBanner() {
  const e = useHud((s) => s.ending);
  if (!e || e.done) return null;
  const count = e.kind === "space" && e.ph === 2 ? Math.max(1, 3 - Math.floor(e.prog * 3)) : 0;
  return (
    <>
      {e.kind === "nuke" && e.ph === 2 && <div className="nuke-flash" key={e.key} />}
      <div className={`card ending-banner k-${e.kind}`} role="status">
        <div className="eb-title">{e.icon} 엔딩 · {e.title}</div>
        <div className="eb-cap">{e.caption}{count ? ` · ${count}…` : ""}</div>
        <span className="btrack wide">
          <span className="bfill" style={{ width: `${Math.round(e.prog * 100)}%` }} />
        </span>
      </div>
    </>
  );
}

function CreditsModal({ rt }: { rt: GameRuntime }) {
  const open = useHud((s) => s.creditsOpen);
  const c = useHud((s) => s.credits);
  if (!open || !c) return null;
  return <CreditsRoll c={c} rt={rt} />;
}

/** 크레딧: 천천히 저절로 올라가고, 직접 굴리면 잠시 멈춘다 */
function CreditsRoll({ c, rt }: { c: Credits; rt: GameRuntime }) {
  const box = useRef<HTMLDivElement>(null);
  const pause = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let pos = 0;
    const tick = (now: number) => {
      const el = box.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (el) {
        if (now < pause.current) pos = el.scrollTop;
        else if (el.scrollTop < el.scrollHeight - el.clientHeight - 1) {
          pos += dt * 34;
          el.scrollTop = pos;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const hold = () => (pause.current = performance.now() + 4000);
  return (
    <div className="credits-back" role="dialog" aria-label="엔딩 크레딧">
      <div className="credits" ref={box} onWheel={hold} onPointerDown={hold} onTouchStart={hold}>
        <div className="roll">
          <div className="c-icon">{c.icon}</div>
          <h2>{c.title}</h2>
          {c.story.map((t) => <p key={t} className="c-story">{t}</p>)}
          {c.annals.length > 0 && (
            <>
              <h3>섬의 연대기</h3>
              <ul className="c-annals">
                {c.annals.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </>
          )}
          <h3>섬의 기록</h3>
          <dl className="c-stats">
            {c.stats.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {c.cast.length > 0 && (
            <>
              <h3>마지막 날 섬에 있던 사람들</h3>
              <p className="c-cast">{c.cast.join(" · ")}</p>
            </>
          )}
          <p className="c-end">— 끝 —</p>
        </div>
      </div>
      <div className="credits-actions">
        <button className="primary" onClick={() => rt.closeCredits()}>계속 이어가기</button>
        <button className="ghost" onClick={() => useHud.setState({ confirmRestart: true })}>새로 시작하기</button>
      </div>
    </div>
  );
}

function RestartConfirm({ rt }: { rt: GameRuntime }) {
  const open = useHud((s) => s.confirmRestart);
  if (!open) return null;
  const close = () => useHud.setState({ confirmRestart: false });
  return (
    <div className="modal-back confirm-back" onClick={close}>
      <div className="card modal confirm" role="alertdialog" aria-label="새로 시작하기" onClick={(e) => e.stopPropagation()}>
        <h3>🌱 처음부터 다시 시작할까요?</h3>
        <p>이 섬의 사람과 마을, 깨친 지식이 모두 사라지고 표류자 한 명이 해변에서 눈을 뜨는 것부터 다시 시작해요. 되돌릴 수 없어요.</p>
        <div className="row-btns">
          <button className="ghost" onClick={close}>그만두기</button>
          <button
            className="primary danger"
            onClick={() => {
              useHud.setState({ confirmRestart: false, creditsOpen: false });
              rt.restart();
            }}
          >
            새로 시작하기
          </button>
        </div>
      </div>
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
