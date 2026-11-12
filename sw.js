const CACHE_NAME = "kytarovy-klub-v21";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./sw.js",
  "./styles/base.css",
  "./styles/layout.css",
  "./styles/components.css",
  "./scripts/app.js",
  "./scripts/api.js",
  "./scripts/avatars.js",
  "./scripts/stats.js",
  "./scripts/ui.js",
  "./icons/guitar-192.png",
  "./icons/guitar-512.png",
  "./icons/guitar-photo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("kytarovy-klub-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const isAppShell = APP_SHELL.some((path) => new URL(path, self.location.href).pathname === requestUrl.pathname);
  if (!isAppShell) return;

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
