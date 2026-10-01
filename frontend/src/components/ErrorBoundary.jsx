import React from "react";

// Si algo falla al dibujar una pantalla, en vez de dejar todo en blanco se muestra
// un mensaje claro con botón para recargar (y limpiar la caché de la app).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Error de pantalla:", error, info);
  }

  hardReload = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
    } catch (e) { /* seguimos con la recarga igual */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String((this.state.error && this.state.error.message) || this.state.error || "");
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F9F8F6", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, width: "100%", background: "#fff", border: "1px solid #E5E0D8", borderRadius: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Algo salió mal</div>
          <p style={{ color: "#5E5E5E", fontSize: 14, margin: "0 0 16px" }}>
            Esta pantalla no pudo cargarse. Toca el botón para recargar. Si sigue pasando, actualiza el navegador del celular.
          </p>
          <button onClick={this.hardReload} style={{ width: "100%", height: 48, borderRadius: 12, border: 0, background: "#D45D3C", color: "#fff", fontWeight: 700, fontSize: 16 }}>
            Recargar
          </button>
          {msg ? <div style={{ marginTop: 14, fontSize: 11, color: "#8A8A8A", wordBreak: "break-word" }}>{msg.slice(0, 200)}</div> : null}
        </div>
      </div>
    );
  }
}
