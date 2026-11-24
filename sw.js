/*
 * Network-first service worker.
 *
 * Online, every request goes to the network and the response refreshes the
 * cache, so a push is enough: there is no cache version to bump. Offline,
 * the last good copy is served instead. Images are cache-first so the map
 * does not re-download on every visit.
 */
const CACHE = "road-to-mount-doom-shell";

const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/journey.js",
  "./data/data.json",
  "./assets/map.webp",
  "./assets/map.jpg",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-180.png",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.destination === "image") {
    event.respondWith(imageResponse(req));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        return hit || caches.match("./index.html");
      })
  );
});

async function imageResponse(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  return hit || (await network) || Response.error();
}
