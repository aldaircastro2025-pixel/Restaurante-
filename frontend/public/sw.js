/* Rich-Coffee POS — Service Worker
 * - HTML (navegación): primero la red, así nunca se queda una versión vieja; la copia
 *   guardada solo se usa si no hay internet.
 * - /static/ (archivos con hash): primero caché, pero NUNCA se guarda una respuesta que
 *   no sea del tipo esperado (antes se podía guardar un HTML como si fuera JS y la
 *   pantalla quedaba en blanco para siempre en ese celular).
 * - API y WebSocket: siempre a la red.
 */
const CACHE_VERSION = "pos-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const PRECACHE = ["/manifest.json", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ¿La respuesta es del tipo que se pidió? (evita guardar un HTML en lugar de un .js/.css)
function isValidFor(req, resp) {
  if (!resp || resp.status !== 200 || resp.type !== "basic") return false;
  const type = (resp.headers.get("content-type") || "").toLowerCase();
  if (req.destination === "script") return type.includes("javascript") || type.includes("ecmascript");
  if (req.destination === "style") return type.includes("css");
  return !type.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // 1) Navegación (HTML): red primero
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/", clone)).catch(() => null);
          }
          return resp;
        })
        .catch(() => caches.match("/").then((c) => c || Response.error()))
    );
    return;
  }

  // 2) Archivos con hash: caché primero (si es válido), si no, red
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((resp) => {
          if (isValidFor(req, resp)) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, clone)).catch(() => null);
          }
          return resp;
        });
      })
    );
    return;
  }

  // 3) Resto (iconos, manifest...): red primero, caché de respaldo
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (isValidFor(req, resp)) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone)).catch(() => null);
        }
        return resp;
      })
      .catch(() => caches.match(req).then((c) => c || Response.error()))
  );
});
