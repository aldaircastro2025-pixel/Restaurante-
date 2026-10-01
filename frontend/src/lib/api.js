import axios from "axios";
import { safeStorage } from "@/lib/storage";

// Si no hay REACT_APP_BACKEND_URL se usa el mismo dominio de la página
// (antes quedaba "undefined/api" y new URL(undefined) rompía el WebSocket).
const BASE = (process.env.REACT_APP_BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
export const API = `${BASE}/api`;

export const api = axios.create({ baseURL: API, timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const t = safeStorage.get("pos_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err?.response?.status;
    const cfg = err?.config;

    // 409 = otra persona modificó el pedido en el mismo instante. El servidor vuelve
    // a fusionar el estado, así que reintentar una vez es seguro.
    if (status === 409 && cfg && !cfg.__retried409) {
      cfg.__retried409 = true;
      await new Promise((res) => setTimeout(res, 250));
      return api(cfg);
    }

    // Sesión vencida (el token dura 7 días): volver al login en vez de dejar
    // la pantalla con errores sueltos.
    const url = String(cfg?.url || "");
    if (status === 401 && !url.includes("/auth/login") && typeof window !== "undefined") {
      safeStorage.remove("pos_token");
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    return Promise.reject(err);
  },
);

export function wsUrl() {
  const u = new URL(BASE || window.location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/ws";
  return u.toString();
}
