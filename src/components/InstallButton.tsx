"use client";
import { markAdded, setInstallGuide, startInstall, useInstallGuide, useInstallMode } from "./install";

/** 앱 다운로드 버튼. 설치할 수 없거나 이미 설치했으면 아무것도 그리지 않는다 */
export function InstallButton({ kind, onPick }: { kind: "gate" | "tool" | "menu"; onPick?: () => void }) {
  const mode = useInstallMode();
  if (mode === "none") return null;
  const go = () => {
    onPick?.();
    void startInstall();
  };
  if (kind === "tool")
    return (
      <button onClick={go} title="앱 다운로드">
        📥
      </button>
    );
  if (kind === "menu")
    return (
      <button onClick={go}>
        <span>📥</span>앱 다운로드
      </button>
    );
  return (
    <button type="button" className="gate-install" onClick={go}>
      📥 앱 다운로드
    </button>
  );
}

/** 설치 창이 없는 브라우저(iOS, 맥 Safari)에서 직접 추가하는 방법 */
export function InstallGuide() {
  const open = useInstallGuide();
  const mode = useInstallMode();
  if (!open || (mode !== "ios" && mode !== "mac")) return null;
  const close = () => setInstallGuide(false);
  return (
    <div className="install-back" onClick={close}>
      <div className="card install-guide" role="dialog" aria-label="앱 다운로드" onClick={(e) => e.stopPropagation()}>
        <h3>📥 무인도를 앱으로</h3>
        {mode === "ios" ? (
          <ol>
            <li>
              브라우저의 공유 버튼 <ShareIcon /> 을 누르고
            </li>
            <li>
              <b>홈 화면에 추가</b>를 고르세요.
            </li>
          </ol>
        ) : (
          <ol>
            <li>
              메뉴 막대에서 <b>파일</b>을 열고
            </li>
            <li>
              <b>Dock에 추가…</b>를 고르세요.
            </li>
          </ol>
        )}
        <p className="tiny">추가하고 나면 홈 화면{mode === "mac" ? "·Dock" : ""}의 아이콘으로 바로 섬에 갈 수 있어요.</p>
        <div className="install-actions">
          <button onClick={markAdded}>이미 추가했어요</button>
          <button className="primary" onClick={close}>
            알겠어요
          </button>
        </div>
      </div>
    </div>
  );
}

const ShareIcon = () => (
  <svg className="share-icon" viewBox="0 0 24 24" aria-label="공유" role="img">
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M7 11H5.5v9.5h13V11H17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
