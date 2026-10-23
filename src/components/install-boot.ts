// 서버(layout)에서도 쓰는 부분이라 "use client" 모듈과 나눠 둔다
export const INSTALL_CHANGE = "install-change";

/** 설치 창을 붙잡고 서비스 워커를 등록하는 부트 스크립트 (layout 의 <head> 에서 가장 먼저 실행) */
export const installBoot = (prod: boolean) => `(function () {
  var ping = function () { dispatchEvent(new Event("${INSTALL_CHANGE}")); };
  addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); window.__installPrompt = e; ping(); });
  addEventListener("appinstalled", function () { window.__installPrompt = null; ping(); });
  if (!("serviceWorker" in navigator)) return;
  ${
    prod
      ? `var reg = function () { navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(function () {}); };
  if (document.readyState === "complete") reg(); else addEventListener("load", reg);`
      : `navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });`
  }
})();`;
