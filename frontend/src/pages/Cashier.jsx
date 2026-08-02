import React, { useEffect, useMemo, useState } from "react";
import { api, API } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { useOrdersWS } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Banknote, Printer, Trash2, Split, CreditCard, CheckCircle2, PlusCircle, Search, Plus } from "lucide-react";

export default function Cashier() {
  const [orders, setOrders] = useState([]);
  const [sel, setSel] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [extra, setExtra] = useState(0);
  const [selectedQty, setSelectedQty] = useState({}); // { idx: unitsSelected } for split-by-quantity
  const [qtyDlg, setQtyDlg] = useState(null); // { idx, value } mini dialog to type an exact quantity
  const [payments, setPayments] = useState([{ uid: crypto.randomUUID(), method: "efectivo", amount: 0, tip: 0 }]);
  const [payDlgOpen, setPayDlgOpen] = useState(false);
  const [payMode, setPayMode] = useState("full"); // "full" or "partial"
  const [tipPercent, setTipPercent] = useState(0); // 0 = no tip, or 10/15/20 preset, or -1 = custom
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false); // panel de mozo: agregar producto/cargo al pedido
  const [catalog, setCatalog] = useState({ cats: [], products: [] });
  const [addItemCat, setAddItemCat] = useState(null);
  const [addItemSearch, setAddItemSearch] = useState("");
  const [addingProductId, setAddingProductId] = useState(null);

  const load = async () => {
    const { data } = await api.get("/orders?paid=false");
    setOrders(data);
  };
  useEffect(() => { load(); }, []);

  useOrdersWS((e) => {
    if (["order.new", "order.status", "order.update"].includes(e.event)) {
      setOrders(prev => {
        const ex = prev.find(o => o.id === e.payload.id);
        if (ex) return prev.map(o => o.id === e.payload.id ? e.payload : o);
        return [e.payload, ...prev];
      });
      // Refresh selected order if it changed
      if (sel?.id === e.payload.id) setSel(e.payload);
      if (e.event === "order.status" && e.payload.status === "ready") toast.success(`${e.payload.code} listo en cocina`);
    }
    if (e.event === "order.closed") { setOrders(p => p.filter(o => o.id !== e.payload.id)); if (sel?.id === e.payload.id) setSel(null); }
    if (e.event === "order.cancel") setOrders(p => p.filter(o => o.id !== e.payload.id));
  });

  const open = (o) => {
    setSel(o);
    setDiscount(0); setExtra(0);
    setSelectedQty({});
    setPayments([{ uid: crypto.randomUUID(), method: "efectivo", amount: 0, tip: 0 }]);
  };

  // Items pendientes (con unidades por cobrar > 0) y ya cobrados (con unidades pagadas > 0).
  // Un mismo plato puede aparecer en ambas listas si solo parte de sus unidades fue pagada.
  const pendingItems = useMemo(() => sel ? sel.items
    .map((it, i) => ({ ...it, _idx: i, _pendingQty: it.qty - (it.paid_qty || 0) }))
    .filter(it => it._pendingQty > 0) : [], [sel]);
  const paidItems = useMemo(() => sel ? sel.items
    .map((it, i) => ({ ...it, _idx: i }))
    .filter(it => (it.paid_qty || 0) > 0) : [], [sel]);
  const unitPrice = (it) => it.qty ? it.line_total / it.qty : 0;
  const pendingSubtotal = pendingItems.reduce((s, it) => s + unitPrice(it) * it._pendingQty, 0);
  const selectedCount = Object.values(selectedQty).reduce((s, q) => s + (q || 0), 0);
  const selectedSubtotal = pendingItems.reduce((s, it) => s + unitPrice(it) * (selectedQty[it._idx] || 0), 0);

  const totalFull = Math.max(0, pendingSubtotal - Number(discount || 0) + Number(extra || 0));
  const totalToPay = payMode === "partial" ? selectedSubtotal : totalFull;
  const tipSum = payments.reduce((s, p) => s + Number(p.tip || 0), 0);
  const grandTotal = totalToPay + tipSum;
  const paidSum = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = Math.max(0, grandTotal - paidSum);

  // Sync the single payment row to current total when discount/extra/mode change
  useEffect(() => {
    if (!sel) return;
    if (payments.length === 1) {
      setPayments([{ ...payments[0], amount: totalToPay }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discount, extra, payMode, selectedQty]);

  const setQty = (idx, qty, max) => setSelectedQty(prev => {
    const clamped = Math.max(0, Math.min(max, qty));
    const n = { ...prev, [idx]: clamped };
    if (!clamped) delete n[idx];
    return n;
  });
  const stepQty = (idx, delta, max) => setQty(idx, (selectedQty[idx] || 0) + delta, max);
  const selectAll = () => setSelectedQty(Object.fromEntries(pendingItems.map(it => [it._idx, it._pendingQty])));
  const clearSel = () => setSelectedQty({});

  const addPay = () => setPayments(p => [...p, { uid: crypto.randomUUID(), method: "efectivo", amount: remaining, tip: 0 }]);
  const delPay = (i) => setPayments(p => p.filter((_, x) => x !== i));
  const upd = (i, k, v) => setPayments(p => p.map((x, xi) => xi === i ? { ...x, [k]: v } : x));

  const openFullPay = () => { setPayMode("full"); setTipPercent(0); setPayments([{ uid: crypto.randomUUID(), method: "efectivo", amount: totalFull, tip: 0 }]); setPayDlgOpen(true); };
  const openPartialPay = () => {
    if (!selectedCount) return toast.error("Selecciona al menos una unidad para cobrar");
    setPayMode("partial");
    setTipPercent(0);
    setPayments([{ uid: crypto.randomUUID(), method: "efectivo", amount: selectedSubtotal, tip: 0 }]);
    setPayDlgOpen(true);
  };

  const applyTipPreset = (pct) => {
    setTipPercent(pct);
    const tipAmt = pct > 0 ? +(totalToPay * pct / 100).toFixed(2) : 0;
    setPayments(prev => prev.map((p, i) => i === 0
      ? { ...p, tip: tipAmt, amount: +(totalToPay + tipAmt).toFixed(2) }
      : p));
  };

  const confirmPay = async () => {
    try {
      if (paidSum + 0.01 < grandTotal) return toast.error("El monto pagado es menor al total");
      if (payMode === "partial") {
        const items = Object.entries(selectedQty)
          .filter(([, qty]) => qty > 0)
          .map(([idx, qty]) => ({ index: Number(idx), qty }));
        const consolidated = {
          method: payments[0].method,
          amount: paidSum,
          tip: payments.reduce((s, p) => s + Number(p.tip || 0), 0),
        };
        const { data: updated } = await api.post(`/orders/${sel.id}/partial-payment`, { items, payment: consolidated });
        toast.success(`Pago parcial registrado · ${selectedCount} unidad${selectedCount > 1 ? "es" : ""} cobrada${selectedCount > 1 ? "s" : ""}`);
        // Update right-panel state immediately (WS may be delayed)
        if (updated.paid) {
          window.open(`${API}/orders/${sel.id}/ticket`, "_blank");
          setSel(null);
          setMobileView("orders");
        } else {
          setSel(updated);
        }
      } else {
        await api.post(`/orders/${sel.id}/close`, {
          discount: Number(discount || 0),
          extra_charge: Number(extra || 0),
          payments: payments.map(p => ({ method: p.method, amount: Number(p.amount || 0), tip: Number(p.tip || 0) })),
        });
        toast.success("Pago registrado. Pedido cerrado.");
        window.open(`${API}/orders/${sel.id}/ticket`, "_blank");
        setSel(null);
        setMobileView("orders");
      }
      setPayDlgOpen(false);
      setSelectedQty({});
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Error al cobrar"); }
  };

  useEffect(() => {
    if (!addItemOpen || catalog.products.length) return;
    (async () => {
      const [c, p] = await Promise.all([api.get("/categories"), api.get("/products")]);
      setCatalog({ cats: c.data, products: p.data });
      if (c.data[0]) setAddItemCat(c.data[0].id);
    })();
  }, [addItemOpen, catalog.products.length]);

  const addProductToOrder = async (product) => {
    if (!sel) return;
    setAddingProductId(product.id);
    try {
      const { data: updated } = await api.post(`/orders/${sel.id}/items`, {
        product_id: product.id, qty: 1, modifier_ids: [], notes: "", added: true,
      });
      setSel(updated);
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
      toast.success(`${product.name} agregado al pedido`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo agregar el producto");
    } finally {
      setAddingProductId(null);
    }
  };

  const cancelOrder = async () => {
    if (!sel) return;
    try {
      await api.delete(`/orders/${sel.id}`);
      toast.success("Pedido anulado");
      setCancelConfirm(false);
      setSel(null);
      setMobileView("orders");
      setOrders(prev => prev.filter(o => o.id !== sel.id));
    } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo anular el pedido"); }
  };

  const statusBadge = (s) => ({
    pending: { bg: "bg-[#FFF3CD]", text: "text-[#856404]", label: "Pendiente" },
    preparing: { bg: "bg-[#FFE5D0]", text: "text-[#C85A17]", label: "Preparación" },
    ready: { bg: "bg-[#D4EDDA]", text: "text-[#155724]", label: "Listo" },
  }[s] || { bg: "bg-[#F3E8E0]", text: "text-[#2C2C2C]", label: s });

  const [mobileView, setMobileView] = useState("orders"); // "orders" | "detail"

  const handleOpen = (o) => {
    open(o);
    setMobileView("detail");
  };

  return (
    <AppShell title="Caja">
      <div className="h-full flex flex-col md:grid md:grid-cols-12 gap-4 p-4 overflow-hidden">
        <section className={`md:col-span-5 card-surface flex flex-col overflow-hidden ${mobileView === "orders" ? "flex" : "hidden md:flex"}`}>
          <div className="p-4 border-b border-[#E5E0D8]">
            <div className="heading font-bold text-lg">Pedidos abiertos</div>
            <div className="text-xs text-[#8A8A8A]">{orders.length} sin cobrar</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="cashier-orders">
            {orders.map(o => {
              const b = statusBadge(o.status);
              const pendCount = o.items.filter(it => (it.paid_qty || 0) < it.qty).length;
              const partialPaid = o.items.some(it => (it.paid_qty || 0) > 0);
              const pendAmount = o.items.reduce((s, it) => {
                const up = it.qty ? it.line_total / it.qty : 0;
                return s + up * (it.qty - (it.paid_qty || 0));
              }, 0);
              return (
                <button key={o.id} onClick={() => handleOpen(o)} data-testid={`cashier-order-${o.id}`}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${sel?.id === o.id ? "border-[#D45D3C] bg-[#F3E8E0]" : "border-[#E5E0D8] bg-white hover:border-[#D45D3C]"}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="heading font-bold text-lg">{o.table_number ? `Mesa ${o.table_number}` : "Para llevar"}</div>
                      <div className="text-xs text-[#8A8A8A] uppercase tracking-wider">{o.code} · {pendCount}/{o.items.length} pendiente{pendCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-[#D45D3C]">S/ {pendAmount.toFixed(2)}</div>
                      <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${b.bg} ${b.text}`}>{b.label}</span>
                      {partialPaid && <div className="text-[10px] text-emerald-700 font-bold mt-1">PAGO PARCIAL</div>}
                    </div>
                  </div>
                </button>
              );
            })}
            {orders.length === 0 && <div className="text-center text-[#8A8A8A] py-12 text-sm">Sin pedidos por cobrar</div>}
          </div>
        </section>

        <section className={`md:col-span-7 card-surface flex flex-col overflow-hidden ${mobileView === "detail" ? "flex" : "hidden md:flex"}`}>
          {sel ? (
            <>
              <div className="p-3 sm:p-4 border-b border-[#E5E0D8] flex justify-between items-center gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setMobileView("orders")}
                    className="md:hidden h-9 w-9 shrink-0 rounded-xl border border-[#E5E0D8] flex items-center justify-center text-[#5E5E5E] hover:border-[#D45D3C]"
                    aria-label="Volver"
                  >
                    ‹
                  </button>
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold">{sel.code}</div>
                    <div className="heading font-bold text-lg sm:text-2xl truncate">{sel.table_number ? `Mesa ${sel.table_number}` : "Para llevar"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <Button variant="outline" onClick={() => window.open(`${API}/orders/${sel.id}/ticket`, "_blank")} data-testid="print-pre-ticket"
                    className="rounded-xl h-10 w-10 sm:h-11 sm:w-auto p-0 sm:px-4" aria-label="Pre-cuenta">
                    <Printer className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Pre-cuenta</span>
                  </Button>
                  <Button variant="outline" onClick={() => setCancelConfirm(true)} data-testid="cancel-order-btn"
                    className="rounded-xl h-10 w-10 sm:h-11 sm:w-auto p-0 sm:px-4 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" aria-label="Anular">
                    <Trash2 className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Anular</span>
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {/* Pending items with checkboxes (split bill) */}
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold">Por cobrar</div>
                  {pendingItems.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <button onClick={selectAll} data-testid="select-all-items" className="text-[#D45D3C] hover:underline font-semibold">Todos</button>
                      <span className="text-[#E5E0D8]">|</span>
                      <button onClick={clearSel} className="text-[#8A8A8A] hover:underline">Limpiar</button>
                    </div>
                  )}
                </div>
                <div className="space-y-1 mb-4" data-testid="cashier-pending-items">
                  {pendingItems.map(it => {
                    const qtySel = selectedQty[it._idx] || 0;
                    const up = unitPrice(it);
                    return (
                      <div key={`p-${it._idx}`} data-testid={`cashier-item-${it._idx}`}
                        className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${qtySel > 0 ? "bg-[#F3E8E0]" : "hover:bg-[#F9F8F6]"}`}>
                        <div className="flex-1">
                          <div className="font-semibold">{it._pendingQty}x {it.name}{it._pendingQty !== it.qty ? <span className="text-xs text-[#8A8A8A] font-normal"> (de {it.qty})</span> : null}</div>
                          {it.modifiers.map((m, j) => (<div key={`${m.id}-${j}`} className="text-xs text-[#8A8A8A] ml-1">+ {m.name}{m.price_delta ? ` (S/ ${m.price_delta.toFixed(2)})` : ""}</div>))}
                          {it.notes && <div className="text-xs italic text-[#8A8A8A] ml-1">"{it.notes}"</div>}
                          <div className="text-xs text-[#8A8A8A] mt-1">S/ {up.toFixed(2)} c/u</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1 border-2 border-[#E5E0D8] rounded-xl overflow-hidden">
                            <button type="button" onClick={() => stepQty(it._idx, -1, it._pendingQty)} disabled={qtySel <= 0}
                              data-testid={`item-qty-minus-${it._idx}`}
                              className="h-9 w-9 flex items-center justify-center text-[#5E5E5E] disabled:opacity-30 hover:bg-[#F3E8E0]">−</button>
                            <button type="button" onClick={() => setQtyDlg({ idx: it._idx, value: String(qtySel), max: it._pendingQty })}
                              data-testid={`item-qty-value-${it._idx}`}
                              className="min-w-[2.25rem] h-9 px-1 font-semibold text-center">{qtySel}</button>
                            <button type="button" onClick={() => stepQty(it._idx, 1, it._pendingQty)} disabled={qtySel >= it._pendingQty}
                              data-testid={`item-qty-plus-${it._idx}`}
                              className="h-9 w-9 flex items-center justify-center text-[#5E5E5E] disabled:opacity-30 hover:bg-[#F3E8E0]">+</button>
                          </div>
                          <div className="font-semibold text-[#2C2C2C] text-sm">S/ {(up * it._pendingQty).toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {pendingItems.length === 0 && <div className="text-center text-[#8A8A8A] py-6 text-sm">Todos los platos están pagados</div>}
                </div>

                {/* Already paid items (visual receipt) */}
                {paidItems.length > 0 && (
                  <>
                    <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold mt-4 mb-2">Ya cobrados</div>
                    <div className="space-y-1 mb-4" data-testid="cashier-paid-items">
                      {paidItems.map(it => (
                        <div key={`x-${it._idx}`} className="flex items-center gap-3 p-2 rounded-lg bg-emerald-50/60 opacity-70">
                          <CheckCircle2 className="h-4 w-4 text-emerald-700"/>
                          <div className="flex-1 line-through text-sm text-[#5E5E5E]">{it.paid_qty}x {it.name}</div>
                          <div className="text-xs text-emerald-700 font-semibold">S/ {(unitPrice(it) * it.paid_qty).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="mt-4 space-y-3">
                  <div>
                    <Label>Descuento (S/)</Label>
                    <Input type="number" step="0.1" value={discount} onChange={e => setDiscount(e.target.value)} data-testid="discount-input" className="h-11 rounded-xl" />
                  </div>
                  <Button type="button" variant="outline" onClick={() => setAddItemOpen(true)} data-testid="open-waiter-panel-btn" className="w-full h-12 rounded-xl border-2 border-dashed justify-center">
                    <PlusCircle className="h-4 w-4 mr-2" />Agregar cargo / plato
                  </Button>
                </div>
                <div className="text-[10px] text-[#8A8A8A] mt-1">El descuento solo aplica al cierre total. Para un cargo extra, agrégalo como plato para que quede en Liquidación.</div>
              </div>

              <div className="p-4 border-t border-[#E5E0D8] bg-[#F9F8F6] space-y-2">
                {selectedCount > 0 && (
                  <div className="flex justify-between items-baseline bg-[#F3E8E0] rounded-xl p-3">
                    <span className="text-sm font-semibold">{selectedCount} unidad{selectedCount > 1 ? "es" : ""} seleccionada{selectedCount > 1 ? "s" : ""}</span>
                    <span className="heading font-bold text-xl text-[#D45D3C]" data-testid="selected-subtotal">S/ {selectedSubtotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm"><span className="text-[#5E5E5E]">Subtotal pendiente</span><span>S/ {pendingSubtotal.toFixed(2)}</span></div>
                <div className="flex justify-between items-baseline border-t border-[#E5E0D8] pt-2">
                  <span className="heading font-bold">Total restante</span>
                  <span className="heading font-bold text-2xl text-[#D45D3C]" data-testid="cashier-total">S/ {totalFull.toFixed(2)}</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={openPartialPay} data-testid="charge-selected-btn"
                    disabled={!selectedCount}
                    variant="outline"
                    className="w-full h-12 rounded-xl border-2">
                    <Split className="h-4 w-4 mr-2" />Cobrar seleccionados
                  </Button>
                  <Button onClick={openFullPay} data-testid="charge-btn"
                    disabled={pendingItems.length === 0}
                    className="w-full h-12 bg-[#D45D3C] hover:bg-[#C04F30] rounded-xl">
                    <Banknote className="h-4 w-4 mr-2" />Cobrar todo
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#8A8A8A] flex-col gap-2">
              <CreditCard className="h-12 w-12 opacity-40" />
              <div>Selecciona un pedido para cobrar</div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={payDlgOpen} onOpenChange={setPayDlgOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {payMode === "partial" ? `Cobrar ${selectedCount} unidad${selectedCount > 1 ? "es" : ""}` : "Cerrar pedido"} · S/ {grandTotal.toFixed(2)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {tipSum > 0 && (
              <div className="text-xs text-[#5E5E5E] flex justify-between px-1">
                <span>Subtotal: <b>S/ {totalToPay.toFixed(2)}</b></span>
                <span>Propina: <b className="text-[#D45D3C]">S/ {tipSum.toFixed(2)}</b></span>
              </div>
            )}
            <div className="border-t border-[#E5E0D8] pt-1" />
            {payments.map((p, i) => (
              <div key={p.uid} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <Label>Método</Label>
                  <Select value={p.method} onValueChange={v => upd(i, "method", v)}>
                    <SelectTrigger data-testid={`pay-method-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="efectivo">Efectivo</SelectItem>
                      <SelectItem value="transferencia">Transferencia</SelectItem>
                      <SelectItem value="otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4"><Label>Monto</Label><Input type="number" step="0.1" value={p.amount} onChange={e => upd(i, "amount", e.target.value)} data-testid={`pay-amount-${i}`} /></div>
                <div className="col-span-2"><Label>Propina</Label><Input type="number" step="0.1" value={p.tip} onChange={e => { upd(i, "tip", e.target.value); if (i === 0) setTipPercent(-1); }} data-testid={`pay-tip-${i}`} /></div>
                <div className="col-span-1">{payments.length > 1 && <button onClick={() => delPay(i)} className="h-10 w-10 rounded-lg border text-red-600"><Trash2 className="h-4 w-4 mx-auto" /></button>}</div>
              </div>
            ))}
            {payMode === "full" && (
              <button onClick={addPay} data-testid="split-btn" className="h-11 w-full rounded-xl border-2 border-dashed border-[#E5E0D8] hover:border-[#D45D3C] font-semibold text-[#5E5E5E] flex items-center justify-center gap-2">
                <Split className="h-4 w-4" /> Dividir cuenta (más métodos de pago)
              </button>
            )}
            <div className="flex justify-between text-sm px-1">
              <span>Pagado: <b>S/ {paidSum.toFixed(2)}</b></span>
              <span className={remaining > 0.01 ? "text-[#D45D3C]" : "text-emerald-700"}>Restante: S/ {remaining.toFixed(2)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDlgOpen(false)}>Cancelar</Button>
            <Button onClick={confirmPay} data-testid="confirm-pay-btn" className="bg-[#D45D3C] hover:bg-[#C04F30]">Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Panel de mozo: agregar un producto (o "cargo extra" como plato) al pedido abierto */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Agregar al pedido {sel?.code}</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8A8A]" />
            <Input placeholder="Buscar producto..." value={addItemSearch} onChange={e => setAddItemSearch(e.target.value)}
              data-testid="add-item-search" className="h-11 rounded-xl pl-9" />
          </div>
          {!addItemSearch && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {catalog.cats.map(c => (
                <button key={c.id} onClick={() => setAddItemCat(c.id)} data-testid={`add-item-cat-${c.id}`}
                  className={`px-3.5 h-9 rounded-full text-sm font-semibold whitespace-nowrap border-2 shrink-0 transition-colors ${addItemCat === c.id ? "border-[#D45D3C] bg-[#F3E8E0] text-[#D45D3C]" : "border-[#E5E0D8] text-[#5E5E5E]"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1" data-testid="add-item-product-list">
            {catalog.products
              .filter(p => p.available !== false)
              .filter(p => addItemSearch ? p.name.toLowerCase().includes(addItemSearch.toLowerCase()) : p.category_id === addItemCat)
              .map(p => (
                <button key={p.id} onClick={() => addProductToOrder(p)} disabled={addingProductId === p.id}
                  data-testid={`add-item-product-${p.id}`}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-[#E5E0D8] hover:border-[#D45D3C] active:bg-[#F9F8F6] text-left disabled:opacity-50 transition-colors">
                  <span className="flex-1 font-semibold truncate">{p.name}</span>
                  <span className="text-[#D45D3C] font-bold whitespace-nowrap">S/ {p.price.toFixed(2)}</span>
                  <span className="h-8 w-8 shrink-0 rounded-full bg-[#F3E8E0] text-[#D45D3C] flex items-center justify-center">
                    {addingProductId === p.id ? <span className="h-3.5 w-3.5 rounded-full border-2 border-[#D45D3C] border-t-transparent animate-spin" /> : <Plus className="h-4 w-4" />}
                  </span>
                </button>
              ))}
            {catalog.products.length === 0 && <div className="text-center text-[#8A8A8A] py-8 text-sm">Cargando productos...</div>}
            {catalog.products.length > 0 && catalog.products
              .filter(p => p.available !== false)
              .filter(p => addItemSearch ? p.name.toLowerCase().includes(addItemSearch.toLowerCase()) : p.category_id === addItemCat).length === 0 && (
              <div className="text-center text-[#8A8A8A] py-8 text-sm">Sin resultados</div>
            )}
          </div>
          <div className="text-[10px] text-[#8A8A8A]">Cada producto agregado se une al pedido de inmediato y queda ligado a su socio en Liquidación.</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)} className="rounded-xl h-11 w-full sm:w-auto">Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mini diálogo: escribir directamente cuántas unidades de un plato cobrar */}
      <Dialog open={!!qtyDlg} onOpenChange={(o) => !o && setQtyDlg(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>¿Cuántas unidades cobrar?</DialogTitle>
          </DialogHeader>
          {qtyDlg && (
            <div className="space-y-2">
              <Input
                type="number" min={0} max={qtyDlg.max} step={1}
                value={qtyDlg.value}
                onChange={e => setQtyDlg({ ...qtyDlg, value: e.target.value })}
                data-testid="item-qty-dialog-input"
                className="h-12 rounded-xl text-center text-lg"
                autoFocus
              />
              <div className="text-xs text-[#8A8A8A] text-center">Máximo {qtyDlg.max} por cobrar</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQtyDlg(null)}>Cancelar</Button>
            <Button
              data-testid="item-qty-dialog-confirm"
              className="bg-[#D45D3C] hover:bg-[#C04F30]"
              onClick={() => { setQty(qtyDlg.idx, Number(qtyDlg.value) || 0, qtyDlg.max); setQtyDlg(null); }}
            >
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación anular pedido completo */}
      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular este pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará por completo <strong>{sel?.code}</strong> ({sel?.table_number ? `Mesa ${sel.table_number}` : "Para llevar"}) y no se podrá recuperar. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, mantener pedido</AlertDialogCancel>
            <AlertDialogAction onClick={cancelOrder} data-testid="confirm-cancel-order-btn" className="bg-red-600 hover:bg-red-700">Sí, anular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
