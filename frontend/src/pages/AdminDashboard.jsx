import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Package, Tag, Sliders, Users as UsersIcon, BarChart3, Wallet } from "lucide-react";
import Reports from "@/pages/Reports";

export default function AdminDashboard() {
  const [tab, setTab] = useState("reports");
  return (
    <AppShell title="Administración">
      <div className="h-full overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          <div className="mb-6">
            <h1 className="heading text-3xl font-bold">Back Office</h1>
            <p className="text-[#5E5E5E]">Gestiona la carta, modificadores, combos y usuarios. Los cambios se aplican en tiempo real.</p>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <div className="overflow-x-auto pb-1">
            <TabsList className="bg-[#F3E8E0] p-1 h-12 rounded-xl flex w-max min-w-full">
              <TabsTrigger value="reports" className="h-10 px-3 rounded-lg data-[state=active]:bg-white flex-shrink-0" data-testid="tab-reports"><BarChart3 className="h-4 w-4 mr-1.5"/><span className="text-sm">Reportes</span></TabsTrigger>
              <TabsTrigger value="liquidacion" className="h-10 px-3 rounded-lg data-[state=active]:bg-white flex-shrink-0"><Wallet className="h-4 w-4 mr-1.5"/><span className="text-sm">Liquidación</span></TabsTrigger>
              <TabsTrigger value="products" className="h-10 px-3 rounded-lg data-[state=active]:bg-white flex-shrink-0" data-testid="tab-products"><Package className="h-4 w-4 mr-1.5"/><span className="text-sm">Productos</span></TabsTrigger>
              <TabsTrigger value="categories" className="h-10 px-3 rounded-lg data-[state=active]:bg-white flex-shrink-0" data-testid="tab-categories"><Tag className="h-4 w-4 mr-1.5"/><span className="text-sm">Categorías</span></TabsTrigger>
              <TabsTrigger value="modifiers" className="h-10 px-3 rounded-lg data-[state=active]:bg-white flex-shrink-0" data-testid="tab-modifiers"><Sliders className="h-4 w-4 mr-1.5"/><span className="text-sm">Modificadores</span></TabsTrigger>
              <TabsTrigger value="users" className="h-10 px-3 rounded-lg data-[state=active]:bg-white flex-shrink-0" data-testid="tab-users"><UsersIcon className="h-4 w-4 mr-1.5"/><span className="text-sm">Usuarios</span></TabsTrigger>
            </TabsList>
            </div>
            <TabsContent value="reports"><Reports/></TabsContent>
            <TabsContent value="liquidacion"><Liquidacion/></TabsContent>
            <TabsContent value="products"><Products/></TabsContent>
            <TabsContent value="categories"><Categories/></TabsContent>
            <TabsContent value="modifiers"><Modifiers/></TabsContent>
            <TabsContent value="users"><Users/></TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}

// ---------- LIQUIDACIÓN ----------
function Liquidacion() {
  const [socios, setSocios] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const [frm, setFrm] = useState(fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(fmt(today));
  const [period, setPeriod] = useState("month");

  const setPeriodRange = (p) => {
    setPeriod(p);
    const now = new Date();
    if (p === "today") { setFrm(fmt(now)); setTo(fmt(now)); }
    else if (p === "week") {
      const d = new Date(now); d.setDate(now.getDate() - now.getDay());
      setFrm(fmt(d)); setTo(fmt(now));
    } else if (p === "month") {
      setFrm(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(fmt(now));
    } else if (p === "year") {
      setFrm(fmt(new Date(now.getFullYear(), 0, 1))); setTo(fmt(now));
    }
  };

  const load = async () => {
    const [s, p] = await Promise.all([api.get("/socios"), api.get("/products")]);
    setSocios(s.data); setProducts(p.data);
  };
  useEffect(() => { load(); }, []);

  const runReport = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/socios/report?frm=${frm}T00:00:00&to=${to}T23:59:59`);
      setReport(r.data);
    } catch (e) { toast.error("Error al generar reporte"); }
    setLoading(false);
  };

  const openNew = () => { setEdit({ name: "", color: "#D45D3C", product_ids: [] }); setOpen(true); };
  const openEdit = (s) => { setEdit({ ...s }); setOpen(true); };

  const save = async () => {
    try {
      if (!edit.name) return toast.error("El nombre es obligatorio");
      if (edit.id) await api.patch(`/socios/${edit.id}`, edit);
      else await api.post("/socios", edit);
      toast.success("Socio guardado");
      setOpen(false); load(); setReport(null);
    } catch (e) { toast.error("Error al guardar"); }
  };

  const del = async (id) => {
    if (!window.confirm("¿Eliminar socio?")) return;
    await api.delete(`/socios/${id}`);
    toast.success("Eliminado"); load(); setReport(null);
  };

  const toggleProduct = (pid) => {
    const ids = edit.product_ids.includes(pid)
      ? edit.product_ids.filter(x => x !== pid)
      : [...edit.product_ids, pid];
    setEdit({ ...edit, product_ids: ids });
  };

  const COLORS = ["#D45D3C","#2563EB","#16A34A","#9333EA","#D97706","#DB2777","#0891B2","#65A30D"];

  return (
    <div className="mt-6">
      {/* Socios configurados */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Socios</h2>
        <Button onClick={openNew} className="bg-[#D45D3C] hover:bg-[#C04F30] rounded-xl h-10">
          <Plus className="h-4 w-4 mr-2"/>Nuevo Socio
        </Button>
      </div>

      {socios.length === 0 && (
        <div className="text-center py-8 text-[#8A8A8A] border-2 border-dashed rounded-xl mb-6">
          No hay socios configurados. Crea uno para empezar.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {socios.map(s => (
          <div key={s.id} className="card-surface p-4 fade-up">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full flex-shrink-0" style={{ background: s.color }}/>
              <div className="font-semibold text-lg">{s.name}</div>
              <div className="ml-auto flex gap-2">
                <button onClick={() => openEdit(s)} className="h-8 w-8 rounded-lg border border-[#E5E0D8] hover:bg-[#F3E8E0] flex items-center justify-center"><Pencil className="h-3.5 w-3.5"/></button>
                <button onClick={() => del(s.id)} className="h-8 w-8 rounded-lg border border-[#E5E0D8] hover:bg-red-50 text-red-600 flex items-center justify-center"><Trash2 className="h-3.5 w-3.5"/></button>
              </div>
            </div>
            <div className="text-sm text-[#5E5E5E]">
              {s.product_ids.length === 0
                ? "Sin productos asignados"
                : `${s.product_ids.length} producto(s) asignado(s)`}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {s.product_ids.slice(0, 4).map(pid => {
                const p = products.find(x => x.id === pid);
                return p ? <span key={pid} className="text-xs bg-[#F3E8E0] px-2 py-0.5 rounded-full">{p.name}</span> : null;
              })}
              {s.product_ids.length > 4 && <span className="text-xs text-[#8A8A8A]">+{s.product_ids.length - 4} más</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Filtros de período */}
      {socios.length > 0 && (
        <div className="card-surface p-5 mb-6">
          <h2 className="text-lg font-bold mb-4">Generar Reporte de Liquidación</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {[["today","Hoy"],["week","Esta semana"],["month","Este mes"],["year","Este año"],["custom","Personalizado"]].map(([v,l]) => (
              <button key={v} onClick={() => setPeriodRange(v)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${period===v ? "bg-[#D45D3C] text-white border-[#D45D3C]" : "border-[#E5E0D8] hover:bg-[#F3E8E0]"}`}>
                {l}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex gap-3 items-center mb-4">
              <div><Label>Desde</Label><Input type="date" value={frm} onChange={e=>setFrm(e.target.value)}/></div>
              <div><Label>Hasta</Label><Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
            </div>
          )}
          <Button onClick={runReport} disabled={loading} className="bg-[#D45D3C] hover:bg-[#C04F30] rounded-xl h-11 px-6">
            {loading ? "Calculando..." : "Calcular Liquidación"}
          </Button>
        </div>
      )}

      {/* Resultados */}
      {report && (
        <div>
          <h2 className="text-lg font-bold mb-4">Resultados — {frm} al {to}</h2>

          {/* Resumen total */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card-surface p-4 text-center">
              <div className="text-sm text-[#8A8A8A] mb-1">Total General</div>
              <div className="text-3xl font-bold text-[#D45D3C]">
                S/ {report.reduce((a,s) => a + s.total, 0).toFixed(2)}
              </div>
            </div>
            <div className="card-surface p-4 text-center">
              <div className="text-sm text-[#8A8A8A] mb-1">Total Unidades</div>
              <div className="text-3xl font-bold">
                {report.reduce((a,s) => a + s.units, 0)}
              </div>
            </div>
            <div className="card-surface p-4 text-center">
              <div className="text-sm text-[#8A8A8A] mb-1">Socios</div>
              <div className="text-3xl font-bold">{report.length}</div>
            </div>
          </div>

          {/* Por socio */}
          <div className="space-y-4">
            {report.map(s => (
              <div key={s.id} className="card-surface overflow-hidden">
                <div className="p-4 flex items-center gap-4" style={{ borderLeft: `4px solid ${s.color}` }}>
                  <div className="h-10 w-10 rounded-full flex-shrink-0" style={{ background: s.color }}/>
                  <div className="flex-1">
                    <div className="font-bold text-lg">{s.name}</div>
                    <div className="text-sm text-[#5E5E5E]">{s.units} unidades vendidas</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold" style={{ color: s.color }}>S/ {(s.net_total ?? s.total).toFixed(2)}</div>
                    {s.discount > 0 && (
                      <div className="text-xs text-[#8A8A8A]">S/ {s.total.toFixed(2)} − S/ {s.discount.toFixed(2)} desc.</div>
                    )}
                  </div>
                </div>

                {s.breakdown.length > 0 && (
                  <div className="border-t border-[#E5E0D8]">
                    <table className="w-full text-sm">
                      <thead className="bg-[#F3E8E0]">
                        <tr>
                          <th className="text-left p-3 font-medium">Producto</th>
                          <th className="text-right p-3 font-medium">Unidades</th>
                          <th className="text-right p-3 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.breakdown.sort((a,b) => b.total - a.total).map((item, i) => (
                          <tr key={i} className="border-t border-[#E5E0D8] hover:bg-[#F3E8E0]/50">
                            <td className="p-3">{item.name}</td>
                            <td className="p-3 text-right">{item.qty}</td>
                            <td className="p-3 text-right font-medium">S/ {item.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {s.breakdown.length === 0 && (
                  <div className="p-4 text-center text-[#8A8A8A] text-sm border-t border-[#E5E0D8]">
                    Sin ventas en este período
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dialog editar/crear socio */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar Socio" : "Nuevo Socio"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div><Label>Nombre del socio</Label><Input value={edit.name} onChange={e=>setEdit({...edit, name:e.target.value})} placeholder="Ej: Juan, María..."/></div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setEdit({...edit, color: c})}
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${edit.color === c ? "border-gray-800 scale-110" : "border-transparent"}`}
                      style={{ background: c }}/>
                  ))}
                </div>
              </div>
              <div>
                <Label>Productos asignados</Label>
                <div className="mt-2 max-h-60 overflow-y-auto border rounded-xl p-2 space-y-1">
                  {products.map(p => (
                    <label key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F3E8E0] cursor-pointer">
                      <Checkbox
                        checked={edit.product_ids.includes(p.id)}
                        onCheckedChange={() => toggleProduct(p.id)}
                      />
                      <span className="flex-1">{p.name}</span>
                      <span className="text-sm text-[#8A8A8A]">S/ {p.price?.toFixed(2)}</span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-[#8A8A8A] mt-1">{edit.product_ids.length} producto(s) seleccionado(s)</div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} className="bg-[#D45D3C] hover:bg-[#C04F30]">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- PRODUCTS ----------
function Products() {
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState([]);
  const [mods, setMods] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = async () => {
    const [p, c, m] = await Promise.all([api.get("/products"), api.get("/categories"), api.get("/modifiers")]);
    setProducts(p.data); setCats(c.data); setMods(m.data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEdit({ name:"", price:0, category_id: cats[0]?.id || "", image:"", available:true, modifier_ids:[], is_combo:false, combo_items:[] }); setOpen(true); };
  const openEdit = (p) => { setEdit({ ...p, modifier_ids: p.modifier_ids || [], combo_items: p.combo_items || [] }); setOpen(true); };
  const save = async () => {
    try {
      if (!edit.name || !edit.category_id) return toast.error("Nombre y categoría obligatorios");
      const body = { ...edit, price: Number(edit.price) };
      if (edit.id) await api.patch(`/products/${edit.id}`, body);
      else await api.post("/products", body);
      toast.success("Producto guardado");
      setOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Error al guardar"); }
  };
  const del = async (id) => { if(!window.confirm("¿Eliminar producto?"))return; await api.delete(`/products/${id}`); toast.success("Eliminado"); load(); };

  const catName = (id) => cats.find(c=>c.id===id)?.name || "-";

  return (
    <div className="mt-6">
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-[#5E5E5E]">{products.length} productos</div>
        <Button data-testid="add-product-btn" onClick={openNew} className="bg-[#D45D3C] hover:bg-[#C04F30] rounded-xl h-11"><Plus className="h-4 w-4 mr-2"/>Nuevo Producto</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map(p => (
          <div key={p.id} className="card-surface p-4 flex gap-4 fade-up">
            <div className="h-20 w-20 rounded-xl bg-[#F3E8E0] overflow-hidden flex-shrink-0">
              {p.image ? <img src={p.image} alt={p.name} className="h-full w-full object-cover"/> : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-xs uppercase tracking-wider text-[#8A8A8A]">{catName(p.category_id)}{p.is_combo?" · Combo":""}</div>
                </div>
                <div className="font-bold text-[#D45D3C]">S/ {p.price.toFixed(2)}</div>
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs">
                <span className={`px-2 py-1 rounded-full ${p.available?"bg-[#D4EDDA] text-[#155724]":"bg-[#F3E8E0] text-[#8A8A8A]"}`}>{p.available?"Disponible":"No disponible"}</span>
                <button onClick={()=>openEdit(p)} data-testid={`edit-product-${p.id}`} className="ml-auto h-8 w-8 rounded-lg border border-[#E5E0D8] hover:bg-[#F3E8E0] flex items-center justify-center"><Pencil className="h-3.5 w-3.5"/></button>
                <button onClick={()=>del(p.id)} data-testid={`delete-product-${p.id}`} className="h-8 w-8 rounded-lg border border-[#E5E0D8] hover:bg-red-50 text-red-600 flex items-center justify-center"><Trash2 className="h-3.5 w-3.5"/></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar Producto" : "Nuevo Producto"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div><Label>Nombre</Label><Input data-testid="product-name" value={edit.name} onChange={e=>setEdit({...edit, name:e.target.value})}/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Precio (S/)</Label><Input data-testid="product-price" type="number" step="0.1" value={edit.price} onChange={e=>setEdit({...edit, price:e.target.value})}/></div>
                <div>
                  <Label>Categoría</Label>
                  <Select value={edit.category_id} onValueChange={v=>setEdit({...edit, category_id:v})}>
                    <SelectTrigger data-testid="product-category"><SelectValue/></SelectTrigger>
                    <SelectContent>{cats.map(c=>(<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>URL Imagen</Label><Input value={edit.image||""} onChange={e=>setEdit({...edit, image:e.target.value})} placeholder="https://..."/></div>
              <div className="flex items-center justify-between border rounded-xl p-3">
                <div><div className="font-semibold">Disponible</div><div className="text-xs text-[#8A8A8A]">Visible para meseros</div></div>
                <Switch checked={edit.available} onCheckedChange={v=>setEdit({...edit, available:v})}/>
              </div>
              <div className="flex items-center justify-between border rounded-xl p-3">
                <div><div className="font-semibold">Es combo</div><div className="text-xs text-[#8A8A8A]">Marca como combo</div></div>
                <Switch checked={edit.is_combo} onCheckedChange={v=>setEdit({...edit, is_combo:v})}/>
              </div>
              <div>
                <Label>Modificadores disponibles</Label>
                <div className="grid grid-cols-2 gap-2 mt-1 max-h-40 overflow-auto p-2 border rounded-xl">
                  {mods.map(m => (
                    <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={edit.modifier_ids.includes(m.id)} onCheckedChange={(v)=>{
                        setEdit({...edit, modifier_ids: v ? [...edit.modifier_ids, m.id] : edit.modifier_ids.filter(x=>x!==m.id)});
                      }}/>
                      <span>{m.name} {m.price_delta?`(+S/${m.price_delta})`:""}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancelar</Button><Button onClick={save} data-testid="save-product-btn" className="bg-[#D45D3C] hover:bg-[#C04F30]">Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- CATEGORIES ----------
function Categories() {
  const [list, setList] = useState([]);
  const [name, setName] = useState("");
  const load = async () => setList((await api.get("/categories")).data);
  useEffect(()=>{load();},[]);
  const add = async () => { if(!name) return; await api.post("/categories",{name, sort:list.length+1}); setName(""); load(); };
  const del = async (id) => { await api.delete(`/categories/${id}`); load(); };
  return (
    <div className="mt-6 max-w-xl">
      <div className="flex gap-2 mb-4">
        <Input data-testid="category-name" placeholder="Nueva categoría" value={name} onChange={e=>setName(e.target.value)}/>
        <Button onClick={add} data-testid="add-category-btn" className="bg-[#D45D3C] hover:bg-[#C04F30]"><Plus className="h-4 w-4"/></Button>
      </div>
      <div className="space-y-2">
        {list.map(c => (
          <div key={c.id} className="card-surface p-3 flex justify-between items-center">
            <div className="font-medium">{c.name}</div>
            <button onClick={()=>del(c.id)} data-testid={`del-cat-${c.id}`} className="text-red-600 hover:bg-red-50 h-8 w-8 rounded-lg flex items-center justify-center"><Trash2 className="h-4 w-4"/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- MODIFIERS ----------
function Modifiers() {
  const [list, setList] = useState([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const load = async () => setList((await api.get("/modifiers")).data);
  useEffect(()=>{load();},[]);
  const add = async () => { if(!name) return; await api.post("/modifiers",{name, price_delta:Number(price)||0}); setName(""); setPrice(0); load(); };
  const del = async (id) => { await api.delete(`/modifiers/${id}`); load(); };
  return (
    <div className="mt-6 max-w-xl">
      <div className="flex gap-2 mb-4">
        <Input placeholder="Nombre (ej: Extra queso)" value={name} onChange={e=>setName(e.target.value)} data-testid="mod-name"/>
        <Input type="number" step="0.1" placeholder="Costo +" value={price} onChange={e=>setPrice(e.target.value)} data-testid="mod-price" className="w-32"/>
        <Button onClick={add} data-testid="add-mod-btn" className="bg-[#D45D3C] hover:bg-[#C04F30]"><Plus className="h-4 w-4"/></Button>
      </div>
      <div className="space-y-2">
        {list.map(m => (
          <div key={m.id} className="card-surface p-3 flex justify-between items-center">
            <div className="font-medium">{m.name} <span className="text-[#8A8A8A] text-sm">{m.price_delta?`+ S/ ${m.price_delta.toFixed(2)}`:""}</span></div>
            <button onClick={()=>del(m.id)} className="text-red-600 hover:bg-red-50 h-8 w-8 rounded-lg flex items-center justify-center"><Trash2 className="h-4 w-4"/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- USERS ----------
function Users() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name:"", email:"", password:"", role:"waiter" });
  const load = async () => setList((await api.get("/users")).data);
  useEffect(()=>{load();},[]);
  const save = async () => {
    try {
      await api.post("/users", form);
      toast.success("Usuario creado");
      setForm({ name:"", email:"", password:"", role:"waiter" }); setOpen(false); load();
    } catch(e){ toast.error(e?.response?.data?.detail || "Error"); }
  };
  const del = async (id) => { if(!window.confirm("¿Eliminar?")) return; await api.delete(`/users/${id}`); load(); };

  const roleBadge = { admin:"bg-[#F3E8E0] text-[#D45D3C]", waiter:"bg-blue-50 text-blue-700", cashier:"bg-emerald-50 text-emerald-700", kitchen:"bg-amber-50 text-amber-700" };

  return (
    <div className="mt-6">
      <div className="flex justify-end mb-4">
        <Button onClick={()=>setOpen(true)} data-testid="add-user-btn" className="bg-[#D45D3C] hover:bg-[#C04F30]"><Plus className="h-4 w-4 mr-2"/>Nuevo Usuario</Button>
      </div>
      <div className="space-y-2">
        {list.map(u => (
          <div key={u.id} className="card-surface p-4 flex justify-between items-center">
            <div>
              <div className="font-semibold">{u.name}</div>
              <div className="text-sm text-[#5E5E5E]">{u.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${roleBadge[u.role]||""}`}>{u.role}</span>
              <button onClick={()=>del(u.id)} className="text-red-600 hover:bg-red-50 h-9 w-9 rounded-lg flex items-center justify-center"><Trash2 className="h-4 w-4"/></button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuevo Usuario</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} data-testid="user-name"/></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} data-testid="user-email"/></div>
            <div><Label>Contraseña</Label><Input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} data-testid="user-password"/></div>
            <div>
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={v=>setForm({...form, role:v})}>
                <SelectTrigger data-testid="user-role"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="waiter">Mesero</SelectItem>
                  <SelectItem value="cashier">Caja</SelectItem>
                  <SelectItem value="kitchen">Cocina</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancelar</Button><Button onClick={save} data-testid="save-user-btn" className="bg-[#D45D3C] hover:bg-[#C04F30]">Crear</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
