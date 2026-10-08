// 정적 파일을 변경할 때마다 버전을 올립니다. API 응답은 저장하지 않습니다.
const CACHE_PREFIX = "busan-parking-static-";
const CACHE_NAME = `${CACHE_PREFIX}v5-1`;
const STATIC_FILES = [
    "/", "/index.html", "/style.css", "/script.js", "/pwa.js",
    "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(STATIC_FILES.map(url => new Request(url, { cache: "reload" })));
    })());
    // 열린 화면의 파일이 서로 다른 버전으로 섞이지 않도록 강제 활성화하지 않습니다.
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
    // 실시간 API 및 외부 지도 링크는 Service Worker가 처리하지 않습니다.
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
    if (!STATIC_FILES.includes(url.pathname)) return;

    event.respondWith((async () => {
        // 온라인에서는 배포된 파일을 우선 조회합니다. 실패한 경우만 정적 캐시를 사용합니다.
        try {
            const response = await fetch(event.request, { cache: "no-cache" });
            if (response.ok) return response;
            // 서버 오류 시 캐시가 있다면 화면을 열 수 있도록 합니다.
            if (response.status < 500) return response;
            const cache = await caches.open(CACHE_NAME);
            return await cache.match(url.pathname) || response;
        } catch (error) {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(url.pathname);
            if (cached) return cached;
            throw error;
        }
    })());
});
