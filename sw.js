// Gerado por montar.py — guarda os arquivos para abrir sem internet.
const CACHE = "liga-fotos-20261125112528";
const ARQUIVOS = ["./", "index.html", "app.js", "video.js", "mediabunny.min.mjs", "app.css", "util.js", "zip.js", "config.js", "manifest.json", "icone-180.png", "icone-512.png"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS))); });
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// rede primeiro (pega atualizações); sem internet, usa o que está guardado
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
