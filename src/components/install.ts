"use client";
import { useSyncExternalStore } from "react";
import { INSTALL_CHANGE as CHANGE } from "./install-boot";

// 앱 설치(PWA). 브라우저가 주는 설치 창은 layout 의 부트 스크립트가 일찍 붙잡아 window 에 둔다.
// 이미 설치한 앱으로 열었거나 설치를 마치면 다운로드 버튼을 감춘다.

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __installPrompt?: InstallPrompt | null;
  }
}

/** prompt: 브라우저 설치 창 · ios/mac: 직접 추가하는 방법 안내 · none: 버튼 없음 */
export type InstallMode = "none" | "prompt" | "ios" | "mac";

const ADDED = "island:app-added";

const emit = () => window.dispatchEvent(new Event(CHANGE));

function standalone() {
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true;
  return ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some((m) => matchMedia(`(display-mode: ${m})`).matches);
}

function saidAdded() {
  try {
    return localStorage.getItem(ADDED) === "1";
  } catch {
    return false;
  }
}

function modeNow(): InstallMode {
  if (standalone()) return "none";
  if (window.__installPrompt) return "prompt";
  if (saidAdded()) return "none";
  const ua = navigator.userAgent;
  // iPadOS 는 맥처럼 보이지만 터치가 된다
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  // 맥 Safari 17부터 'Dock에 추가'
  const safari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  if (safari && Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0) >= 17) return "mac";
  return "none";
}

function subscribe(cb: () => void) {
  const mq = matchMedia("(display-mode: standalone)");
  window.addEventListener(CHANGE, cb);
  mq.addEventListener("change", cb);
  return () => {
    window.removeEventListener(CHANGE, cb);
    mq.removeEventListener("change", cb);
  };
}

export const useInstallMode = () => useSyncExternalStore(subscribe, modeNow, () => "none" as InstallMode);

let guide = false;
export const useInstallGuide = () =>
  useSyncExternalStore(
    subscribe,
    () => guide,
    () => false,
  );

export function setInstallGuide(open: boolean) {
  guide = open;
  emit();
}

/** 다운로드 버튼: 설치 창을 띄우거나, 그럴 수 없는 브라우저면 방법을 알려 준다 */
export async function startInstall() {
  const p = window.__installPrompt;
  if (!p) return setInstallGuide(true);
  // 설치 창은 한 번만 띄울 수 있다
  window.__installPrompt = null;
  emit();
  try {
    await p.prompt();
    await p.userChoice;
  } catch {
    // 창을 띄우지 못했으면 다음에 다시 누를 수 있게 돌려 둔다
    window.__installPrompt = p;
    emit();
  }
}

/** iOS·맥 Safari 는 설치했는지 알 수 없어서 사람이 알려 준다 */
export function markAdded() {
  try {
    localStorage.setItem(ADDED, "1");
  } catch {}
  setInstallGuide(false);
}
