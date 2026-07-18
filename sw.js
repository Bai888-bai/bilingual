// 极简 service worker：缓存 app 壳资源，离线也能把 App 打开
// （书籍文件本身存在 IndexedDB 里，不需要 service worker 管）
//
// 缓存策略是"网络优先，失败了才退回缓存"（network-first），不是"缓存优先"。
// 之前用缓存优先，导致每次改代码重新部署后，用户浏览器里还是长期停留在
// 第一次访问时缓存下来的旧版本，感知不到任何更新，调试的时候被坑过一次。
// 网络优先虽然会牺牲一点点"离线秒开"的体验，但对一个还在频繁更新的应用
// 来说，"用户能看到最新版本"更重要，离线时依然能退回缓存正常使用。
//
// 修改这里之后记得把 CACHE_NAME 的版本号也改一下，方便区分。
const CACHE_NAME = "bilingual-reader-v3";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./book-store.js",
  "./supabase-web-client.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./reader.html",
  "./reader.css",
  "./reader.js",
  "./pdf-reader.js",
  "./reflow-reader.js",
  "./epub-reader.js",
  "./word-popup.js",
  "./word-interact.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // 跨域请求（Supabase/有道等）不缓存，直接走网络

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
