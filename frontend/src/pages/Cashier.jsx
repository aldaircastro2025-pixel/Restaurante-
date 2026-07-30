import React, { useEffect, useMemo, useState } from "react";
import { api, API } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { useOrdersWS } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Banknote, Printer, Trash2, Split, CreditCard, CheckCircle2 } from "lucide-react";

export default function Cashier() {
  const [orders, setOrders] = useState([]);
  const [sel, setSel] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [extra, setExtra] = useState(0);
  const [selectedItems, setSelectedItems] = useState(new Set());  // indexes selected for split bill
  const [payments, setPayments] = useState([{ uid: crypto.randomUUID(), method: "efectivo", amount: 0, tip: 0 }]);
  const [payDlgOpen, setPayDlgOpen] = useState(false);
  const [payMode, setPayMode] = useState("full"); // "full" or "partial"
  const [tipPercent, setTipPercent] = useState(0); // 0 = no tip, or 10/15/20 preset, or -1 = custom
  const [cancelConfirm, setCancelConfirm] = useState(false);

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
    setSelectedItems(new Set());
    setPayments([{ uid: crypto.randomUUID(), method: "efectivo", amount: 0, tip: 0 }]);
  };

  // Items split into pending vs paid
  const pendingItems = useMemo(() => sel ? sel.items.map((it, i) => ({ ...it, _idx: i })).filter(it => !it.paid) : [], [sel]);
  const paidItems    = useMemo(() => sel ? sel.items.map((it, i) => ({ ...it, _idx: i })).filter(it => it.paid)  : [], [sel]);
  const pendingSubtotal = pendingItems.reduce((s, it) => s + it.line_total, 0);
  const selectedSubtotal = pendingItems.filter(it => selectedItems.has(it._idx)).reduce((s, it) => s + it.line_total, 0);

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
  }, [discount, extra, payMode, selectedItems]);

  const toggleSelect = (idx) => setSelectedItems(prev => {
    const n = new Set(prev);
    if (n.has(idx)) n.delete(idx); else n.add(idx);
    return n;
  });
  const selectAll = () => setSelectedItems(new Set(pendingItems.map(it => it._idx)));
  const clearSel = () => setSelectedItems(new Set());

  const addPay = () => setPayments(p => [...p, { uid: crypto.randomUUID(), method: "efectivo", amount: remaining, tip: 0 }]);
  const delPay = (i) => setPayments(p => p.filter((_, x) => x !== i));
  const upd = (i, k, v) => setPayments(p => p.map((x, xi) => xi === i ? { ...x, [k]: v } : x));

  const openFullPay = () => { setPayMode("full"); setTipPercent(0); setPayments([{ uid: crypto.randomUUID(), method: "efectivo", amount: totalFull, tip: 0 }]); setPayDlgOpen(true); };
  const openPartialPay = () => {
    if (!selectedItems.size) return toast.error("Selecciona al menos un plato para cobrar");
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
        const indexes = [...selectedItems];
        const consolidated = {
          method: payments[0].method,
          amount: paidSum,
          tip: payments.reduce((s, p) => s + Number(p.tip || 0), 0),
        };
        const { data: updated } = await api.post(`/orders/${sel.id}/partial-payment`, { item_indexes: indexes, payment: consolidated });
        toast.success(`Pago parcial registrado · ${indexes.length} plato${indexes.length > 1 ? "s" : ""} cobrados`);
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
      setSelectedItems(new Set());
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Error al cobrar"); }
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
              const pendCount = o.items.filter(it => !it.paid).length;
              const partialPaid = o.items.some(it => it.paid);
              return (
                <button key={o.id} onClick={() => handleOpen(o)} data-testid={`cashier-order-${o.id}`}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${sel?.id === o.id ? "border-[#D45D3C] bg-[#F3E8E0]" : "border-[#E5E0D8] bg-white hover:border-[#D45D3C]"}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="heading font-bold text-lg">{o.table_number ? `Mesa ${o.table_number}` : "Para llevar"}</div>
                      <div className="text-xs text-[#8A8A8A] uppercase tracking-wider">{o.code} · {pendCount}/{o.items.length} pendiente{pendCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-[#D45D3C]">S/ {o.items.filter(it => !it.paid).reduce((s, it) => s + it.line_total, 0).toFixed(2)}</div>
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
              <div className="p-4 border-b border-[#E5E0D8] flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMobileView("orders")}
                    className="md:hidden h-9 w-9 rounded-xl border border-[#E5E0D8] flex items-center justify-center text-[#5E5E5E] hover:border-[#D45D3C] mr-1"
                    aria-label="Volver"
                  >
                    ‹
                  </button>
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold">{sel.code}</div>
                    <div className="heading font-bold text-2xl">{sel.table_number ? `Mesa ${sel.table_number}` : "Para llevar"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => window.open(`${API}/orders/${sel.id}/ticket`, "_blank")} data-testid="print-pre-ticket" className="rounded-xl h-11"><Printer className="h-4 w-4 mr-2" />Pre-cuenta</Button>
                  <Button variant="outline" onClick={() => setCancelConfirm(true)} data-testid="cancel-order-btn" className="rounded-xl h-11 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4 mr-2" />Anular</Button>
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
                    const checked = selectedItems.has(it._idx);
                    return (
                      <label key={`p-${it._idx}`} data-testid={`cashier-item-${it._idx}`}
                        className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors ${checked ? "bg-[#F3E8E0]" : "hover:bg-[#F9F8F6]"}`}>
                        <Checkbox checked={checked} onCheckedChange={() => toggleSelect(it._idx)} className="mt-1" data-testid={`cashier-item-check-${it._idx}`} />
                        <div className="flex-1">
                          <div className="font-semibold">{it.qty}x {it.name}</div>
                          {it.modifiers.map((m, j) => (<div key={`${m.id}-${j}`} className="text-xs text-[#8A8A8A] ml-1">+ {m.name}{m.price_delta ? ` (S/ ${m.price_delta.toFixed(2)})` : ""}</div>))}
                          {it.notes && <div className="text-xs italic text-[#8A8A8A] ml-1">"{it.notes}"</div>}
                        </div>
                        <div className="font-semibold text-[#2C2C2C]">S/ {it.line_total.toFixed(2)}</div>
                      </label>
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
                          <div className="flex-1 line-through text-sm text-[#5E5E5E]">{it.qty}x {it.name}</div>
                          <div className="text-xs text-emerald-700 font-semibold">S/ {it.line_total.toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <Label>Descuento (S/)</Label>
                    <Input type="number" step="0.1" value={discount} onChange={e => setDiscount(e.target.value)} data-testid="discount-input" className="h-11 rounded-xl" />
                  </div>
                  <div>
                    <Label>Cargo extra (S/)</Label>
                    <Input type="number" step="0.1" value={extra} onChange={e => setExtra(e.target.value)} data-testid="extra-input" className="h-11 rounded-xl" />
                  </div>
                </div>
                <div className="text-[10px] text-[#8A8A8A] mt-1">El descuento y cargo extra solo aplican al cierre total.</div>
              </div>

              <div className="p-4 border-t border-[#E5E0D8] bg-[#F9F8F6] space-y-2">
                {selectedItems.size > 0 && (
                  <div className="flex justify-between items-baseline bg-[#F3E8E0] rounded-xl p-3">
                    <span className="text-sm font-semibold">{selectedItems.size} plato{selectedItems.size > 1 ? "s" : ""} seleccionado{selectedItems.size > 1 ? "s" : ""}</span>
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
                    disabled={!selectedItems.size}
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
              {payMode === "partial" ? `Cobrar ${selectedItems.size} plato${selectedItems.size > 1 ? "s" : ""}` : "Cerrar pedido"} · S/ {grandTotal.toFixed(2)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Tip presets */}
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold mb-2">Propina sugerida</div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { v: 0,  label: "Sin propina" },
                  { v: 10, label: "10%" },
                  { v: 15, label: "15%" },
                  { v: 20, label: "20%" },
                  { v: -1, label: "Otra" },
                ].map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => opt.v === -1 ? setTipPercent(-1) : applyTipPreset(opt.v)}
                    data-testid={`tip-preset-${opt.v}`}
                    className={`h-11 rounded-xl font-semibold text-sm transition-all border-2 ${tipPercent === opt.v ? "border-[#D45D3C] bg-[#F3E8E0] text-[#D45D3C]" : "border-[#E5E0D8] hover:border-[#D45D3C]"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {tipSum > 0 && (
                <div className="text-xs text-[#5E5E5E] mt-2 flex justify-between px-1">
                  <span>Subtotal: <b>S/ {totalToPay.toFixed(2)}</b></span>
                  <span>Propina: <b className="text-[#D45D3C]">S/ {tipSum.toFixed(2)}</b></span>
                </div>
              )}
            </div>

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
