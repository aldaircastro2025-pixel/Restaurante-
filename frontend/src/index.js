import "@/lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import ErrorBoundary from "@/components/ErrorBoundary";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Service Worker para PWA / instalación. Se actualiza solo: el HTML siempre se pide
// primero a la red, así que un celular nunca queda "pegado" a una versión vieja.	
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => { try { reg.update(); } catch (e) { /* nada */ } })
      .catch((err) => console.warn("SW registration failed:", err));
  });
}
