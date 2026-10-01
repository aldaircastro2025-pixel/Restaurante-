import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { useOrdersWS } from "@/lib/ws";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, ChefHat, CircleCheck, PlusCircle } from "lucide-react";
import { toast } from "sonner";

const COLS = [
  { key: "pending",   label: "Pendientes",    icon: Clock,       bg: "bg-[#FFF3CD]", text: "text-[#856404]", border: "border-[#FFEEBA]" },
  { key: "preparing", label: "En preparación", icon: ChefHat,     bg: "bg-[#FFE5D0]", text: "text-[#C85A17]", border: "border-[#FFD1B0]" },
  { key: "ready",     label: "Listos",        icon: CircleCheck, bg: "bg-[#D4EDDA]", text: "text-[#155724]", border: "border-[#C3E6CB]" },
];

function elapsed(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "< 1m";
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff/60)}h ${diff%60}m`;
}

export default function KDS() {
  const [orders, setOrders] = useState([]);
  const [, tick] = useState(0);

  const load = async () => {
    try {
      const { data } = await api.get("/orders?status=pending,preparing,ready&paid=false");
      setOrders(data.filter(o => !o.paid));
    } catch (e) {
      console.warn("No se pudieron cargar los pedidos de cocina:", e);
    }
  };
  useEffect(()=>{ load(); const i = setInterval(()=>tick(t=>t+1), 30000); return ()=>clearInterval(i); }, []);

  useOrdersWS((e) => {
    if (e.event === "order.new") { setOrders(prev => [e.payload, ...prev.filter(o=>o.id!==e.payload.id)]); toast.success(`Nuevo pedido ${e.payload.code}`); }
    else if (e.event === "order.status" || e.event === "order.update" || e.event === "order.closed") {
      setOrders(prev => prev.map(o => o.id === e.payload.id ? e.payload : o).filter(o => ["pending","preparing","ready"].includes(o.status) && !o.paid));
    }
    else if (e.event === "order.cancel") setOrders(prev => prev.filter(o => o.id !== e.payload.id));
  }, () => load());

  const grouped = useMemo(() => {
    const g = { pending: [], preparing: [], ready: [] };
    orders.forEach(o => { if (g[o.status]) g[o.status].push(o); });
    return g;
  }, [orders]);

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/orders/${id}/status?status=${status}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo cambiar el estado del pedido");
    }
  };

  const toggleItemDone = async (oid, idx, value) => {
    try {
      await api.patch(`/orders/${oid}/items/${idx}`, { field: "done", value });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo actualizar el plato");
    }
  };

  return (
    <AppShell title="Cocina (KDS)">
      <div className="h-full overflow-hidden grid grid-cols-1 md:grid-cols-3 gap-4 p-4" data-testid="kds-board">
        {COLS.map(col => (
          <div key={col.key} className="flex flex-col overflow-hidden bg-white/60 rounded-2xl border border-[#E5E0D8] p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`h-9 w-9 rounded-xl ${col.bg} ${col.text} flex items-center justify-center`}>
                  <col.icon className="h-5 w-5"/>
                </div>
                <div>
                  <div className="heading font-bold">{col.label}</div>
                  <div className="text-xs text-[#8A8A8A]">{grouped[col.key].length} pedido{grouped[col.key].length!==1?"s":""}</div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3" data-testid={`kds-col-${col.key}`}>
              {grouped[col.key].map(o => (
                <div key={o.id} className={`rounded-2xl border-2 ${col.border} ${col.bg} p-4 fade-up`} data-testid={`kds-order-${o.id}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="heading font-bold text-lg">{o.table_number ? `Mesa ${o.table_number}` : "Para llevar"}</div>
                      <div className="text-xs font-semibold uppercase tracking-wider opacity-70">{o.code}</div>
                    </div>
                    <div className={`text-sm font-bold ${col.text}`}>{elapsed(o.created_at)}</div>
                  </div>
                  <div className="space-y-2 my-3">
                    {o.items.map((it, i) => {
                      const done = !!it.done;
                      return (
                        <label
                          key={`${it.product_id}-${i}`}
                          className={`flex items-start gap-3 p-2 -mx-1 rounded-lg cursor-pointer transition-colors hover:bg-white/60 ${done ? "opacity-60" : ""}`}
                          data-testid={`kds-item-${o.id}-${i}`}
                        >
                          <Checkbox
                            checked={done}
                            onCheckedChange={(v) => toggleItemDone(o.id, i, !!v)}
                            className="mt-0.5"
                            data-testid={`kds-item-check-${o.id}-${i}`}
                          />
                          <div className={`flex-1 text-sm ${done ? "line-through" : ""}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{it.qty}x {it.name}</span>
                            {it.added && (
                              <span className="flex-shrink-0 text-[9px] uppercase tracking-wider bg-[#27AE60] text-white px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <PlusCircle className="h-2.5 w-2.5"/> Añadido
                              </span>
                            )}
                          </div>
                            {it.modifiers.map((m,j)=>(<div key={`${m.id}-${j}`} className="text-xs opacity-80 ml-1">+ {m.name}</div>))}
                            {it.notes && <div className="text-xs italic opacity-80 ml-1">"{it.notes}"</div>}
                          </div>
                          {done && <span className="text-[10px] uppercase tracking-wider bg-[#D4EDDA] text-[#155724] px-2 py-0.5 rounded-full font-bold self-start">Listo</span>}
                        </label>
                      );
                    })}
                  </div>
                  {o.note && <div className="text-xs italic mb-2 opacity-80">Nota: {o.note}</div>}
                  <div className="flex gap-2">
                    {col.key === "pending" && (
                      <button onClick={()=>setStatus(o.id, "preparing")} data-testid={`start-${o.id}`}
                        className="flex-1 h-11 rounded-xl bg-[#E67E22] hover:bg-[#D35400] text-white font-semibold transition-colors active:scale-95">
                        Iniciar
                      </button>
                    )}
                    {col.key === "preparing" && (
                      <button onClick={()=>setStatus(o.id, "ready")} data-testid={`ready-${o.id}`}
                        className="flex-1 h-11 rounded-xl bg-[#27AE60] hover:bg-[#1F8B4C] text-white font-semibold transition-colors active:scale-95">
                        Marcar Listo
                      </button>
                    )}
                    {col.key === "ready" && (
                      <div className="flex-1 text-center font-semibold text-[#155724] py-2">Listo para caja</div>
                    )}
                  </div>
                </div>
              ))}
              {grouped[col.key].length === 0 && <div className="text-center text-[#8A8A8A] py-12 text-sm">Sin pedidos</div>}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
