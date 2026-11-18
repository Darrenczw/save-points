// Save Points service worker: app shell offline, covers cached, data always fresh from the network.
const VERSION = "sp-v1";                 // bump on every deploy so phones pick up changes
const SHELL = `${VERSION}-shell`, IMAGES = "sp-img";
const MAX_IMAGES = 300;
const FILES = [
  "./", "index.html", "app.css", "app.js", "store.js", "config.js", "manifest.webmanifest",
  "vendor/supabase-2.49.4.js", "vendor/591.supabase.js",
  "fonts/overpass-latin.woff2", "fonts/figtree-latin.woff2", "icon.svg", "icon-180.png", "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== IMAGES) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim() {
  const c = await caches.open(IMAGES), keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await c.delete(k); // oldest first
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;

  // Game art from Sony: cache first, refresh quietly.
  if (url.hostname === "image.api.playstation.com") {
    e.respondWith((async () => {
      const c = await caches.open(IMAGES), hit = await c.match(req);
      const net = fetch(req).then(async (res) => {
        try { await c.put(req, res.clone()); trim(); } catch { /* storage full: skip */ }
        return res;
      }).catch(() => hit);
      return hit ?? net;
    })());
    return;
  }

  // Our own files: page from the network when online (so updates land), everything from cache when offline.
  if (url.origin === location.origin) {
    if (req.mode === "navigate") {
      e.respondWith(fetch(req).catch(async () => (await caches.match("index.html")) ?? Response.error()));
      return;
    }
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then(async (res) => {
        if (res.ok && FILES.some((f) => url.pathname.endsWith(f.replace("./", "/")))) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit ?? net;
    })());
  }
  // Supabase and everything else: straight to the network (the app keeps its own offline copy).
});
