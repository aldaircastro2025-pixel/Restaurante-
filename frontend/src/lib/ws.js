import { useEffect, useRef } from "react";
import { wsUrl } from "@/lib/api";

// Suscripción al websocket del POS. handler recibe {event, payload}.
// onResync (opcional) se llama cuando la conexión se recupera tras una caída o
// cuando el celular vuelve a primer plano: sirve para recargar los datos que se
// pudieron perder mientras el celular dormía la pantalla.
export function useOrdersWS(handler, onResync) {
  const handlerRef = useRef(handler);
  const resyncRef = useRef(onResync);
  // Siempre mantener la referencia al handler más reciente (evita stale closures)
  useEffect(() => { handlerRef.current = handler; resyncRef.current = onResync; });

  useEffect(() => {
    let stop = false;
    let retry = 0;
    let ws = null;
    let pingInterval = null;
    let retryTimer = null;
    let hadOpen = false;

    const resync = () => {
      try { resyncRef.current && resyncRef.current(); } catch (e) { console.warn("Resync falló:", e); }
    };

    const scheduleReconnect = () => {
      if (stop) return;
      clearTimeout(retryTimer);
      retry = Math.min(retry + 1, 10);
      retryTimer = setTimeout(connect, Math.min(500 * retry, 5000));
    };

    function connect() {
      if (stop) return;
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      clearTimeout(retryTimer);

      let sock;
      try {
        sock = new WebSocket(wsUrl());
      } catch (e) {
        console.warn("No se pudo abrir el WebSocket:", e);
        scheduleReconnect();
        return;
      }
      ws = sock;

      sock.onopen = () => {
        if (ws !== sock) return;
        retry = 0;
        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (sock.readyState === 1) {
            try { sock.send(JSON.stringify({ event: "ping" })); } catch (e) { /* se reconecta solo */ }
          }
        }, 20000);
        if (hadOpen) resync();
        hadOpen = true;
      };

      sock.onmessage = (e) => {
        if (ws !== sock) return;
        try {
          const data = JSON.parse(e.data);
          if (data.event === "pong") return;
          handlerRef.current(data);
        } catch (err) {
          console.error("WS payload inválido:", err);
        }
      };

      sock.onclose = () => {
        if (ws !== sock) return;
        clearInterval(pingInterval);
        scheduleReconnect();
      };

      sock.onerror = () => {
        try { sock.close(); } catch (e) { /* nada */ }
      };
    }

    // Los celulares cortan el WebSocket cuando la pantalla se apaga o la app queda
    // en segundo plano. Al volver, reconectar de inmediato y recargar datos.
    const onVisible = () => {
      if (stop || document.visibilityState !== "visible") return;
      if (!ws || ws.readyState !== 1) {
        retry = 0;
        if (ws) { try { ws.close(); } catch (e) { /* nada */ } }
        ws = null;
        connect();
      }
      resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    connect();
    return () => {
      stop = true;
      clearInterval(pingInterval);
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      try { ws && ws.close(); } catch (e) { /* nada */ }
    };
  }, []);
}
