// 무인도 서비스 워커: 한 번 받은 화면과 파일을 기기에 담아 두어 앱처럼 빨리 열리게 한다.
// 섬 상태(/api)와 실시간 동기화는 언제나 서버와 직접 주고받는다.
const CACHE = "island-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
const MAX_FILES = 160;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function keep(req, res) {
  if (!res.ok || res.type !== "basic") return;
  const c = await caches.open(CACHE);
  await c.put(req, res);
  // 배포가 거듭되면 예전 파일이 쌓이니 오래된 것부터 버린다 (화면 뼈대는 남긴다)
  const keys = await c.keys();
  const old = keys.filter((k) => !SHELL.includes(new URL(k.url).pathname));
  for (let i = 0; i < old.length - MAX_FILES; i++) await c.delete(old[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // 화면: 새 배포를 바로 받도록 네트워크 먼저, 끊겼으면 담아 둔 화면
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          e.waitUntil(keep(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
    return;
  }

  // 이름에 해시가 붙은 빌드 파일·아이콘: 담아 둔 것 먼저
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            e.waitUntil(keep(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
