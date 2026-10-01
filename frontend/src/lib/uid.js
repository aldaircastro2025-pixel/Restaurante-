// Generador de ids que funciona en cualquier navegador.
// crypto.randomUUID() solo existe en Chrome/WebView 92+ y Samsung Internet 16+;
// en un Samsung con navegador viejo la pantalla de caja quedaba en blanco.

// UUID v4 sin depender de randomUUID (usa getRandomValues o, si no existe, Math.random).
export function fallbackUuid() {
  try {
    const c = typeof window !== "undefined" ? window.crypto : null;
    if (c && typeof c.getRandomValues === "function") {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.prototype.map.call(b, (x) => (x + 0x100).toString(16).slice(1));
      return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
    }
  } catch (e) { /* cae al respaldo */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function uid() {
  try {
    const c = typeof window !== "undefined" ? window.crypto : null;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch (e) { /* cae al respaldo */ }
  return fallbackUuid();
}
