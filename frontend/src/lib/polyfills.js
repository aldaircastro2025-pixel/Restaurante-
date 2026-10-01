// Mini-polyfills para navegadores/WebViews antiguos (Android viejo, Samsung Internet
// desactualizado). Se importa lo primero en index.js. No instala dependencias.
import { fallbackUuid } from "@/lib/uid";

try {
  if (typeof window !== "undefined") {
    if (!window.crypto) window.crypto = {};
    if (typeof window.crypto.randomUUID !== "function") {
      try { window.crypto.randomUUID = fallbackUuid; } catch (e) { /* solo lectura: se usa uid() */ }
    }
  }
  if (typeof Object.fromEntries !== "function") {
    Object.fromEntries = function (entries) {
      const o = {};
      for (const [k, v] of entries) o[k] = v;
      return o;
    };
  }
  if (typeof Array.prototype.flat !== "function") {
    // eslint-disable-next-line no-extend-native
    Array.prototype.flat = function (depth = 1) {
      const walk = (arr, d) => arr.reduce((acc, v) => (Array.isArray(v) && d > 0 ? acc.concat(walk(v, d - 1)) : acc.concat(v)), []);
      return walk(this, depth);
    };
  }
  if (typeof String.prototype.replaceAll !== "function") {
    // eslint-disable-next-line no-extend-native
    String.prototype.replaceAll = function (a, b) {
      return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b);
    };
  }
  if (typeof Array.prototype.at !== "function") {
    // eslint-disable-next-line no-extend-native
    Array.prototype.at = function (i) { const n = Math.trunc(i) || 0; return this[n < 0 ? this.length + n : n]; };
  }
} catch (e) {
  // Nunca debe impedir que la app arranque.
}
