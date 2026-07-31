import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Receipt, ShoppingCart, DollarSign,
  Award, Clock, Calendar, Flame, Minus,
} from "lucide-react";

import { cn, peruDateInput, peruISO, shiftYMD, peruYMD } from "@/lib/utils";

const COLORS = ["#D45D3C", "#E67E22", "#2C2C2C", "#8A8A8A", "#5E5E5E"];

// ---------- Helpers ----------
const fmt = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const fmtInt = (n) => Number(n || 0).toLocaleString("es-PE");
const pad = (n) => String(n).padStart(2, "0");

function rangeFromPreset(preset) {
  const today = peruDateInput(); // "YYYY-MM-DD" del día actual en Perú
  const mondayOf = (ymd) => {
    const { year, month, day } = peruYMD(new Date(peruISO(ymd)));
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Dom
    const diff = (dow + 6) % 7; // días desde el lunes
    return shiftYMD(ymd, -diff);
  };
  switch (preset) {
    case "today":     return [today, today];
    case "yesterday": { const y = shiftYMD(today, -1); return [y, y]; }
    case "week":      return [mondayOf(today), today];
    case "month":     return [`${today.slice(0, 7)}-01`, today];
    case "year":      return [`${today.slice(0, 4)}-01-01`, today];
    default:          return [today, today];
  }
}
const toInput = (ymd) => ymd; // rangeFromPreset ya devuelve "YYYY-MM-DD"

function deltaPct(cur, prev) {
  if (!prev) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}

// ---------- KPI card ----------
function KpiCard({ icon: Icon, label, sales, orders, avg, compare, tone = "primary", testid }) {
  const up = compare >= 0;
  return (
    <div data-testid={testid} className="card-surface p-5 fade-up">
      <div className="flex items-start justify-between">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${tone==="primary"?"bg-[#F3E8E0] text-[#D45D3C]":"bg-[#FFF3CD] text-[#856404]"}`}>
          <Icon className="h-5 w-5"/>
        </div>
        {compare !== null && compare !== undefined && (
          <span className={`flex items-center text-xs font-bold px-2 py-0.5 rounded-full ${up ? "bg-emerald-50 text-emerald-700":"bg-red-50 text-red-700"}`}>
            {up ? <TrendingUp className="h-3 w-3 mr-1"/> : <TrendingDown className="h-3 w-3 mr-1"/>}
            {Math.abs(compare).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold">{label}</div>
        <div className="heading text-3xl font-bold mt-1">{fmt(sales)}</div>
        <div className="text-xs text-[#5E5E5E] mt-1">{fmtInt(orders)} pedidos · ticket prom. {fmt(avg)}</div>
      </div>
    </div>
  );
}

// ---------- Main Reports ----------
export default function Reports() {
  const [kpis, setKpis] = useState(null);
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(() => toInput(rangeFromPreset("month")[0]));
  const [to, setTo] = useState(() => toInput(rangeFromPreset("month")[1]));
  const [series, setSeries] = useState([]);
  const [products, setProducts] = useState({ top: [], bottom: [], total_products: 0 });
  const [hourly, setHourly] = useState([]);
  const [weekday, setWeekday] = useState([]);
  const [methods, setMethods] = useState([]);
  const [orders, setOrders] = useState([]);
  const [openOrder, setOpenOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyPreset = (p) => {
    setPreset(p);
    const [f, t] = rangeFromPreset(p);
    setFrom(toInput(f));
    setTo(toInput(t));
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const fromISO = peruISO(from, "00:00:00");
      const toISOv = peruISO(to, "23:59:59");
      const qs = `from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISOv)}`;
      const spanDays = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
      const bucket = spanDays <= 2 ? "hour" : "day";

      const [k, ts, pr, h, wd, pm, od] = await Promise.all([
        api.get(`/reports/kpis?to=${encodeURIComponent(toISOv)}`),
        api.get(`/reports/timeseries?${qs}&bucket=${bucket}`),
        api.get(`/reports/products?${qs}&limit=10`),
        api.get(`/reports/hourly?${qs}`),
        api.get(`/reports/weekday?${qs}`),
        api.get(`/reports/payment-methods?${qs}`),
        api.get(`/reports/orders?${qs}&limit=100`),
      ]);
      setKpis(k.data); setSeries(ts.data); setProducts(pr.data);
      setHourly(h.data); setWeekday(wd.data); setMethods(pm.data); setOrders(od.data);
    } catch (e) { console.error("Error cargando reportes:", e); }
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [from, to]);
  // Auto-refresh every 60s
  useEffect(() => { const i = setInterval(loadAll, 60000); return () => clearInterval(i); /* eslint-disable-next-line */ }, [from, to]);

  const peakHour = useMemo(() => {
    if (!hourly.length) return null;
    return hourly.reduce((a, b) => (b.sales > a.sales ? b : a), hourly[0]);
  }, [hourly]);
  const bestDay = useMemo(() => {
    if (!weekday.length) return null;
    return weekday.reduce((a, b) => (b.sales > a.sales ? b : a), weekday[0]);
  }, [weekday]);

  return (
    <div className="mt-6 space-y-6" data-testid="reports-view">
      {/* Filters */}
      <div className="card-surface p-4 flex flex-wrap gap-3 items-end">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold mb-2">Filtros rápidos</div>
          <div className="flex flex-wrap gap-2">
            {[
              ["today","Hoy"],["yesterday","Ayer"],["week","Esta semana"],["month","Este mes"],["year","Este año"],
            ].map(([k,l]) => (
              <button key={k} data-testid={`preset-${k}`} onClick={()=>applyPreset(k)}
                className={`h-10 px-4 rounded-xl font-semibold transition-all ${preset===k?"bg-[#D45D3C] text-white":"bg-white border-2 border-[#E5E0D8] hover:border-[#D45D3C]"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="h-10 w-px bg-[#E5E0D8] mx-2 hidden md:block"/>
        <div className="w-full">
          <div className="text-xs uppercase tracking-[0.2em] text-[#8A8A8A] font-bold mb-2">Rango personalizado</div>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <div className="flex gap-2 items-center flex-1">
              <Input type="date" value={from} onChange={(e)=>{setPreset("custom"); setFrom(e.target.value);}} data-testid="date-from" className="h-10 flex-1"/>
              <span className="text-[#8A8A8A] shrink-0">→</span>
              <Input type="date" value={to} onChange={(e)=>{setPreset("custom"); setTo(e.target.value);}} data-testid="date-to" className="h-10 flex-1"/>
            </div>
            <Button onClick={loadAll} data-testid="apply-range" className="bg-[#2C2C2C] hover:bg-black h-10 rounded-xl w-full sm:w-auto">Aplicar</Button>
          </div>
        </div>
      </div>

      {/* KPIs (always global — today/week/month/year) */}
      <div>
        <h3 className="heading text-lg font-bold mb-3">Resumen general</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-grid">
          {kpis && (
            <>
              <KpiCard icon={DollarSign} label="Hoy" sales={kpis.today.sales} orders={kpis.today.orders} avg={kpis.today.avg_ticket} compare={deltaPct(kpis.today.sales, kpis.yesterday.sales)} testid="kpi-today"/>
              <KpiCard icon={Calendar} label="Esta semana" sales={kpis.week.sales} orders={kpis.week.orders} avg={kpis.week.avg_ticket} compare={deltaPct(kpis.week.sales, kpis.prev_week.sales)} testid="kpi-week"/>
              <KpiCard icon={ShoppingCart} label="Este mes" sales={kpis.month.sales} orders={kpis.month.orders} avg={kpis.month.avg_ticket} compare={deltaPct(kpis.month.sales, kpis.prev_month.sales)} testid="kpi-month"/>
              <KpiCard icon={Receipt} label="Este año" sales={kpis.year.sales} orders={kpis.year.orders} avg={kpis.year.avg_ticket} compare={deltaPct(kpis.year.sales, kpis.prev_year.sales)} tone="amber" testid="kpi-year"/>
            </>
          )}
        </div>
      </div>

      {/* Line chart: evolution */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="heading text-lg font-bold">Evolución de ventas</h3>
            <p className="text-sm text-[#8A8A8A]">Ingresos y pedidos por día en el rango seleccionado</p>
          </div>
        </div>
        <div className="h-72" data-testid="chart-evolution">
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E0D8"/>
                <XAxis dataKey="date" stroke="#8A8A8A" fontSize={12} tickFormatter={(v)=>v.slice(5)}/>
                <YAxis yAxisId="left" stroke="#D45D3C" fontSize={12}/>
                <YAxis yAxisId="right" orientation="right" stroke="#2C2C2C" fontSize={12}/>
                <Tooltip formatter={(v, name)=> name==="sales" ? fmt(v) : fmtInt(v)} contentStyle={{ borderRadius: 12, border:"1px solid #E5E0D8" }}/>
                <Legend wrapperStyle={{ fontSize: 12 }}/>
                <Line yAxisId="left" type="monotone" dataKey="sales" name="Ventas (S/)" stroke="#D45D3C" strokeWidth={3} dot={{ r:3 }}/>
                <Line yAxisId="right" type="monotone" dataKey="orders" name="Pedidos" stroke="#2C2C2C" strokeWidth={2} dot={{ r:2 }}/>
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState loading={loading}/>}
        </div>
      </div>

      {/* Two-col: Top products + Payment methods */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="heading text-lg font-bold flex items-center gap-2"><Award className="h-5 w-5 text-[#D45D3C]"/>Productos más vendidos</h3>
              <p className="text-sm text-[#8A8A8A]">Top 10 por ingresos en el rango</p>
            </div>
          </div>
          <div className="h-72" data-testid="chart-top-products">
            {products.top.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={products.top} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E0D8"/>
                  <XAxis type="number" stroke="#8A8A8A" fontSize={12}/>
                  <YAxis dataKey="name" type="category" stroke="#2C2C2C" fontSize={12} width={140}/>
                  <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ borderRadius: 12, border:"1px solid #E5E0D8" }}/>
                  <Bar dataKey="revenue" name="Ingresos (S/)" fill="#D45D3C" radius={[0,8,8,0]}/>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState loading={loading}/>}
          </div>
        </div>

        <div className="card-surface p-5">
          <h3 className="heading text-lg font-bold mb-1">Método de pago</h3>
          <p className="text-sm text-[#8A8A8A] mb-4">Distribución de ingresos</p>
          <div className="h-72" data-testid="chart-methods">
            {methods.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={methods} dataKey="amount" nameKey="method" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                    {methods.map((_, i) => <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]}/>)}
                  </Pie>
                  <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ borderRadius: 12, border:"1px solid #E5E0D8" }}/>
                  <Legend wrapperStyle={{ fontSize: 12 }}/>
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState loading={loading}/>}
          </div>
        </div>
      </div>

      {/* Business rhythm: hourly + weekday */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="heading text-lg font-bold flex items-center gap-2"><Flame className="h-5 w-5 text-[#E67E22]"/>Horas pico</h3>
              <p className="text-sm text-[#8A8A8A]">Ventas por hora del día</p>
            </div>
            {peakHour && <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-[#8A8A8A]">Pico</div>
              <div className="heading font-bold text-lg text-[#D45D3C]">{pad(peakHour.hour)}:00 · {fmt(peakHour.sales)}</div>
            </div>}
          </div>
          <div className="h-64" data-testid="chart-hourly">
            {hourly.some(h=>h.sales>0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E0D8"/>
                  <XAxis dataKey="hour" tickFormatter={(v)=>`${pad(v)}h`} stroke="#8A8A8A" fontSize={11}/>
                  <YAxis stroke="#8A8A8A" fontSize={11}/>
                  <Tooltip formatter={(v)=>fmt(v)} labelFormatter={(v)=>`${pad(v)}:00`} contentStyle={{ borderRadius: 12, border:"1px solid #E5E0D8" }}/>
                  <Bar dataKey="sales" fill="#E67E22" radius={[6,6,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState loading={loading}/>}
          </div>
        </div>

        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="heading text-lg font-bold flex items-center gap-2"><Clock className="h-5 w-5 text-[#2C2C2C]"/>Día de la semana</h3>
              <p className="text-sm text-[#8A8A8A]">Desempeño por día</p>
            </div>
            {bestDay && <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-[#8A8A8A]">Mejor día</div>
              <div className="heading font-bold text-lg text-[#D45D3C]">{bestDay.label} · {fmt(bestDay.sales)}</div>
            </div>}
          </div>
          <div className="h-64" data-testid="chart-weekday">
            {weekday.some(d=>d.sales>0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekday}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E0D8"/>
                  <XAxis dataKey="label" stroke="#8A8A8A" fontSize={11}/>
                  <YAxis stroke="#8A8A8A" fontSize={11}/>
                  <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ borderRadius: 12, border:"1px solid #E5E0D8" }}/>
                  <Bar dataKey="sales" fill="#D45D3C" radius={[6,6,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState loading={loading}/>}
          </div>
        </div>
      </div>

      {/* Least sold */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="heading text-lg font-bold flex items-center gap-2"><Minus className="h-5 w-5 text-[#8A8A8A]"/>Menos vendidos</h3>
            <p className="text-sm text-[#8A8A8A]">Candidatos a revisar, promocionar o retirar</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="bottom-products">
          {products.bottom.map((p) => (
            <div key={p.product_id} className="flex justify-between items-center p-3 rounded-xl border border-[#E5E0D8] bg-[#F9F8F6]">
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-[#5E5E5E]">{fmtInt(p.qty)} vendidos · {fmt(p.revenue)}</div>
            </div>
          ))}
          {products.bottom.length === 0 && <div className="text-sm text-[#8A8A8A]">Sin datos</div>}
        </div>
      </div>

      {/* Orders detail */}
      <div className="card-surface overflow-hidden">
        <div className="p-5 border-b border-[#E5E0D8] flex items-center justify-between">
          <div>
            <h3 className="heading text-lg font-bold">Detalle de ventas</h3>
            <p className="text-sm text-[#8A8A8A]">{orders.length} pedidos cerrados en el rango</p>
          </div>
        </div>
        <div className="overflow-x-auto" data-testid="orders-table">
          <table className="w-full text-sm">
            <thead className="bg-[#F9F8F6] text-[#5E5E5E] text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left p-3">Código</th>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Mesa</th>
                <th className="text-left p-3">Items</th>
                <th className="text-right p-3">Total</th>
                <th className="text-left p-3">Método</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-[#E5E0D8] hover:bg-[#F3E8E0] cursor-pointer"
                    onClick={() => setOpenOrder(openOrder?.id === o.id ? null : o)}
                    data-testid={`order-row-${o.id}`}>
                  <td className="p-3 font-semibold">{o.code}</td>
                  <td className="p-3">{new Date(o.closed_at).toLocaleString("es-PE", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })}</td>
                  <td className="p-3">{o.table_number ? `Mesa ${o.table_number}` : "Para llevar"}</td>
                  <td className="p-3">{o.items.reduce((s,i)=>s+i.qty,0)} items</td>
                  <td className="p-3 text-right font-bold text-[#D45D3C]">{fmt(o.total)}</td>
                  <td className="p-3">{(o.payments||[]).map(p=>p.method).join(", ")}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan="6" className="text-center text-[#8A8A8A] py-12">Sin pedidos en el rango</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {openOrder && (
          <div className="p-5 border-t border-[#E5E0D8] bg-[#F9F8F6]" data-testid="order-detail">
            <div className="heading font-bold mb-2">Detalle {openOrder.code}</div>
            <div className="space-y-1">
              {openOrder.items.map((it) => (
                <div key={`${openOrder.id}-${it.product_id}-${it.qty}`} className="flex justify-between text-sm">
                  <span>{it.qty}x {it.name}</span>
                  <span>{fmt(it.line_total)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-3 pt-3 border-t border-[#E5E0D8] font-bold">
              <span>Total</span><span className="text-[#D45D3C]">{fmt(openOrder.total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ loading }) {
  return <div className="h-full flex items-center justify-center text-[#8A8A8A] text-sm">{loading ? "Cargando..." : "Sin datos en el rango seleccionado"}</div>;
}
