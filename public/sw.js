/* TAEKANG 현장 — 알림 + 오프라인 안내 서비스워커 (D-37 · D-77)
 * 화면·데이터는 저장(캐시)하지 않는다. 저장하는 것은 ‘인터넷 연결 없음’ 안내 한 장뿐이다.
 * 홈 화면 아이콘으로 지하에서 열었을 때 브라우저 오류 화면 대신 한국어 안내가 뜨게 한다 (D-77 리허설).
 */
const OFFLINE_CACHE = "tk-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("tk-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

// 화면 이동(주소 열기)만 본다 — API·사진·스크립트 요청은 건드리지 않는다
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const pre = await event.preloadResponse;
        if (pre) return pre;
        return await fetch(event.request);
      } catch {
        const cached = await caches.match(OFFLINE_URL);
        return cached || new Response("인터넷이 연결되지 않았어요. 연결되면 다시 열어 주세요.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TAEKANG 현장", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TAEKANG 현장";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      lang: "ko",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
