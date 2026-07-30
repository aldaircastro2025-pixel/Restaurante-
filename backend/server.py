from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')


import os
import uuid
import json
import logging
import bcrypt
import jwt as pyjwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

# -------- Setup --------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(
    mongo_url,
    serverSelectionTimeoutMS=30000,
    connectTimeoutMS=30000,
)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# -------- Auth Helpers --------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())

def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user

def require_roles(*roles):
    async def _dep(user=Depends(get_current_user)):
        if user["role"] not in roles and user["role"] != "admin":
            raise HTTPException(403, "Forbidden")
        return user
    return _dep

# -------- Models --------
class LoginIn(BaseModel):
    email: str
    password: str

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: Literal["admin", "waiter", "cashier", "kitchen"]

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

class Category(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    sort: int = 0

class CategoryIn(BaseModel):
    name: str
    sort: int = 0

class Modifier(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    price_delta: float = 0.0

class ModifierIn(BaseModel):
    name: str
    price_delta: float = 0.0

class Product(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    price: float
    category_id: str
    image: Optional[str] = None
    available: bool = True
    modifier_ids: List[str] = []
    is_combo: bool = False
    combo_items: List[str] = []  # product ids included in combo

class ProductIn(BaseModel):
    name: str
    price: float
    category_id: str
    image: Optional[str] = None
    available: bool = True
    modifier_ids: List[str] = []
    is_combo: bool = False
    combo_items: List[str] = []

class OrderItem(BaseModel):
    product_id: str
    name: str
    qty: int
    unit_price: float
    modifiers: List[Dict[str, Any]] = []  # [{id,name,price_delta}]
    notes: str = ""
    line_total: float
    done: bool = False   # KDS marked as prepared
    paid: bool = False   # Cashier marked as paid (split bill)

class OrderItemIn(BaseModel):
    product_id: str
    qty: int
    modifier_ids: List[str] = []
    notes: str = ""
    added: bool = False  # True = item añadido a pedido ya enviado a cocina

class OrderCreate(BaseModel):
    table_number: Optional[int] = None
    items: List[OrderItemIn]
    note: str = ""

class OrderUpdate(BaseModel):
    items: Optional[List[OrderItemIn]] = None
    note: Optional[str] = None

class PaymentIn(BaseModel):
    method: Literal["efectivo", "transferencia", "otro"]
    amount: float
    tip: float = 0.0

class CloseIn(BaseModel):
    discount: float = 0.0
    extra_charge: float = 0.0
    payments: List[PaymentIn]

# -------- WebSocket Manager --------
class WSManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, event: str, payload: dict):
        dead = []
        msg = json.dumps({"event": event, "payload": payload})
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.disconnect(d)

manager = WSManager()

# -------- Utility --------
def clean(doc: dict) -> dict:
    if doc is None:
        return doc
    doc.pop("_id", None)
    return doc

async def compute_order_totals(items: List[OrderItemIn]) -> (List[dict], float):
    product_ids = list({i.product_id for i in items})
    prods = await db.products.find({"id": {"$in": product_ids}}, {"_id": 0}).to_list(1000)
    prod_map = {p["id"]: p for p in prods}

    all_mod_ids = list({m for i in items for m in i.modifier_ids})
    mods = await db.modifiers.find({"id": {"$in": all_mod_ids}}, {"_id": 0}).to_list(1000) if all_mod_ids else []
    mod_map = {m["id"]: m for m in mods}

    out_items = []
    total = 0.0
    for it in items:
        p = prod_map.get(it.product_id)
        if not p:
            raise HTTPException(400, f"Producto no encontrado: {it.product_id}")
        chosen_mods = [mod_map[mid] for mid in it.modifier_ids if mid in mod_map]
        mod_sum = sum(m["price_delta"] for m in chosen_mods)
        unit = p["price"] + mod_sum
        line = unit * it.qty
        out_items.append({
            "product_id": p["id"],
            "name": p["name"],
            "qty": it.qty,
            "unit_price": p["price"],
            "modifiers": [{"id": m["id"], "name": m["name"], "price_delta": m["price_delta"]} for m in chosen_mods],
            "notes": it.notes,
            "line_total": round(line, 2),
            "done": False,
            "paid": False,
            "added": it.added,
        })
        total += line
    return out_items, round(total, 2)

# ================= AUTH =================
@api.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower().strip()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Credenciales inválidas")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]},
    }

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(**user)

# ================= USERS (admin) =================
@api.get("/users")
async def list_users(user=Depends(require_roles("admin"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

@api.post("/users")
async def create_user(body: UserCreate, user=Depends(require_roles("admin"))):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email ya registrado")
    u = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(u)
    u.pop("password_hash")
    u.pop("_id", None)
    return u

@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(400, "No puedes eliminarte a ti mismo")
    r = await db.users.delete_one({"id": user_id})
    if not r.deleted_count:
        raise HTTPException(404, "Usuario no encontrado")
    return {"ok": True}

# ================= CATEGORIES =================
@api.get("/categories")
async def list_categories(user=Depends(get_current_user)):
    return await db.categories.find({}, {"_id": 0}).sort("sort", 1).to_list(1000)

@api.post("/categories")
async def create_category(body: CategoryIn, user=Depends(require_roles("admin"))):
    c = Category(**body.model_dump()).model_dump()
    await db.categories.insert_one(c)
    return clean(c)

@api.delete("/categories/{cid}")
async def delete_category(cid: str, user=Depends(require_roles("admin"))):
    await db.categories.delete_one({"id": cid})
    return {"ok": True}

# ================= MODIFIERS =================
@api.get("/modifiers")
async def list_modifiers(user=Depends(get_current_user)):
    return await db.modifiers.find({}, {"_id": 0}).to_list(1000)

@api.post("/modifiers")
async def create_modifier(body: ModifierIn, user=Depends(require_roles("admin"))):
    m = Modifier(**body.model_dump()).model_dump()
    await db.modifiers.insert_one(m)
    return clean(m)

@api.delete("/modifiers/{mid}")
async def delete_modifier(mid: str, user=Depends(require_roles("admin"))):
    await db.modifiers.delete_one({"id": mid})
    return {"ok": True}

# ================= PRODUCTS =================
@api.get("/products")
async def list_products(user=Depends(get_current_user)):
    return await db.products.find({}, {"_id": 0}).to_list(1000)

@api.post("/products")
async def create_product(body: ProductIn, user=Depends(require_roles("admin"))):
    p = Product(**body.model_dump()).model_dump()
    await db.products.insert_one(p)
    return clean(p)

@api.patch("/products/{pid}")
async def update_product(pid: str, body: ProductIn, user=Depends(require_roles("admin"))):
    await db.products.update_one({"id": pid}, {"$set": body.model_dump()})
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    return p

@api.delete("/products/{pid}")
async def delete_product(pid: str, user=Depends(require_roles("admin"))):
    await db.products.delete_one({"id": pid})
    return {"ok": True}

# ================= TABLES =================
@api.get("/tables")
async def list_tables(user=Depends(get_current_user)):
    # Tables are 1..12 (configurable) plus virtual "Para Llevar"
    tables = []
    for i in range(1, 13):
        order = await db.orders.find_one(
            {"table_number": i, "status": {"$in": ["pending", "preparing", "ready"]}, "paid": False},
            {"_id": 0}
        )
        tables.append({"number": i, "status": "occupied" if order else "free", "order_id": order["id"] if order else None})
    return tables

# ================= ORDERS =================
@api.post("/orders")
async def create_order(body: OrderCreate, user=Depends(require_roles("waiter", "cashier"))):
    items, total = await compute_order_totals(body.items)
    order = {
        "id": str(uuid.uuid4()),
        "code": f"#{datetime.now().strftime('%H%M%S')}",
        "table_number": body.table_number,
        "items": items,
        "note": body.note,
        "subtotal": total,
        "discount": 0.0,
        "extra_charge": 0.0,
        "total": total,
        "status": "pending",
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "payments": [],
        "paid": False,
        "closed_at": None,
    }
    await db.orders.insert_one(order)
    clean(order)
    await manager.broadcast("order.new", order)
    return order

@api.get("/orders")
async def list_orders(
    status: Optional[str] = Query(None),
    paid: Optional[bool] = Query(None),
    user=Depends(get_current_user),
):
    q: Dict[str, Any] = {}
    if status:
        if "," in status:
            q["status"] = {"$in": status.split(",")}
        else:
            q["status"] = status
    if paid is not None:
        q["paid"] = paid
    orders = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return orders

@api.get("/orders/{oid}")
async def get_order(oid: str, user=Depends(get_current_user)):
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    return o

@api.patch("/orders/{oid}")
async def update_order(oid: str, body: OrderUpdate, user=Depends(require_roles("waiter", "cashier"))):
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    if o["paid"]:
        raise HTTPException(400, "Pedido ya pagado")
    upd = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.items is not None:
        items, total = await compute_order_totals(body.items)
        upd["items"] = items
        upd["subtotal"] = total
        upd["total"] = round(total - o.get("discount", 0.0) + o.get("extra_charge", 0.0), 2)
    if body.note is not None:
        upd["note"] = body.note
    await db.orders.update_one({"id": oid}, {"$set": upd})
    o2 = await db.orders.find_one({"id": oid}, {"_id": 0})
    await manager.broadcast("order.update", o2)
    return o2

@api.patch("/orders/{oid}/status")
async def set_status(oid: str, status: str = Query(...), user=Depends(require_roles("kitchen", "cashier", "waiter"))):
    if status not in ("pending", "preparing", "ready"):
        raise HTTPException(400, "Estado inválido")
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    await db.orders.update_one({"id": oid}, {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    o2 = await db.orders.find_one({"id": oid}, {"_id": 0})
    await manager.broadcast("order.status", o2)
    return o2

@api.post("/orders/{oid}/close")
async def close_order(oid: str, body: CloseIn, user=Depends(require_roles("cashier"))):
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    if o.get("paid"):
        raise HTTPException(400, "Pedido ya pagado")
    total = round(o["subtotal"] - body.discount + body.extra_charge, 2)
    paid_sum = round(sum(p.amount for p in body.payments), 2)
    if paid_sum + 0.01 < total:
        raise HTTPException(400, f"Monto pagado ({paid_sum}) menor al total ({total})")
    upd = {
        "discount": body.discount,
        "extra_charge": body.extra_charge,
        "total": total,
        "payments": [p.model_dump() for p in body.payments],
        "paid": True,
        "status": "closed",
        "closed_at": datetime.now(timezone.utc).isoformat(),
        "closed_by": user["name"],
    }
    await db.orders.update_one({"id": oid}, {"$set": upd})
    o2 = await db.orders.find_one({"id": oid}, {"_id": 0})
    await manager.broadcast("order.closed", o2)
    return o2

@api.delete("/orders/{oid}")
async def cancel_order(oid: str, user=Depends(require_roles("cashier"))):
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    if o.get("paid"):
        raise HTTPException(400, "No se puede cancelar un pedido pagado")
    await db.orders.delete_one({"id": oid})
    await manager.broadcast("order.cancel", {"id": oid})
    return {"ok": True}

# ---- Item-level toggle (KDS done / Cashier paid) ----
class ItemToggleIn(BaseModel):
    field: Literal["done", "paid"]
    value: bool

@api.patch("/orders/{oid}/items/{idx}")
async def toggle_item(oid: str, idx: int, body: ItemToggleIn, user=Depends(get_current_user)):
    if body.field == "done" and user["role"] not in ("kitchen", "admin"):
        raise HTTPException(403, "Solo cocina puede marcar preparado")
    if body.field == "paid" and user["role"] not in ("cashier", "admin"):
        raise HTTPException(403, "Solo caja puede marcar pagado")
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    if idx < 0 or idx >= len(o["items"]):
        raise HTTPException(400, "Índice inválido")
    o["items"][idx][body.field] = body.value
    update = {"items": o["items"], "updated_at": datetime.now(timezone.utc).isoformat()}
    # Auto-advance order status
    if body.field == "done" and all(it.get("done") for it in o["items"]):
        update["status"] = "ready"
    elif body.field == "done" and any(it.get("done") for it in o["items"]) and o["status"] == "pending":
        update["status"] = "preparing"
    # Auto-close if all items paid
    if body.field == "paid" and all(it.get("paid") for it in o["items"]) and not o.get("paid"):
        update["paid"] = True
        update["status"] = "closed"
        update["closed_at"] = datetime.now(timezone.utc).isoformat()
        update["closed_by"] = user["name"]
        # Sum existing partial payments for total
        total_partial = sum(p.get("amount", 0) for p in o.get("payments", []))
        update["total"] = round(total_partial, 2)
    await db.orders.update_one({"id": oid}, {"$set": update})
    o2 = await db.orders.find_one({"id": oid}, {"_id": 0})
    await manager.broadcast("order.update", o2)
    if update.get("paid"):
        await manager.broadcast("order.closed", o2)
    return o2

# ---- Partial payment (split bill by items) ----
class PartialPaymentIn(BaseModel):
    item_indexes: List[int]
    payment: PaymentIn

@api.post("/orders/{oid}/partial-payment")
async def partial_payment(oid: str, body: PartialPaymentIn, user=Depends(require_roles("cashier"))):
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    if o.get("paid"):
        raise HTTPException(400, "Pedido ya pagado")
    if not body.item_indexes:
        raise HTTPException(400, "Debe seleccionar al menos un item")
    items = o["items"]
    selected_total = 0.0
    for idx in body.item_indexes:
        if idx < 0 or idx >= len(items):
            raise HTTPException(400, f"Índice inválido: {idx}")
        if items[idx].get("paid"):
            raise HTTPException(400, f"Item {idx} ya está pagado")
        items[idx]["paid"] = True
        selected_total += items[idx]["line_total"]
    selected_total = round(selected_total, 2)
    if body.payment.amount + 0.01 < selected_total:
        raise HTTPException(400, f"Pago ({body.payment.amount}) menor al total seleccionado ({selected_total})")
    payments = o.get("payments", []) + [body.payment.model_dump()]
    update = {
        "items": items,
        "payments": payments,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if all(it.get("paid") for it in items):
        update["paid"] = True
        update["status"] = "closed"
        update["closed_at"] = datetime.now(timezone.utc).isoformat()
        update["closed_by"] = user["name"]
        update["total"] = round(sum(p["amount"] for p in payments), 2)
    await db.orders.update_one({"id": oid}, {"$set": update})
    o2 = await db.orders.find_one({"id": oid}, {"_id": 0})
    await manager.broadcast("order.update", o2)
    if update.get("paid"):
        await manager.broadcast("order.closed", o2)
    return o2

# ================= REPORTS =================
def _parse_dt(s: str) -> datetime:
    # Accept ISO strings with or without timezone
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

async def _closed_orders_in_range(frm: datetime, to: datetime, projection: dict | None = None):
    q = {"paid": True, "closed_at": {"$gte": frm.isoformat(), "$lt": to.isoformat()}}
    proj = projection or {"_id": 0}
    return await db.orders.find(q, proj).to_list(50000)

@api.get("/reports/kpis")
async def report_kpis(user=Depends(require_roles("admin"))):
    now = datetime.now(timezone.utc)
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    yest = today - timedelta(days=1)
    week = today - timedelta(days=now.weekday())
    prev_week = week - timedelta(days=7)
    month = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    prev_month = datetime(now.year - 1, 12, 1, tzinfo=timezone.utc) if now.month == 1 else datetime(now.year, now.month - 1, 1, tzinfo=timezone.utc)
    year = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    prev_year = datetime(now.year - 1, 1, 1, tzinfo=timezone.utc)
    tomorrow = today + timedelta(days=1)

    async def agg(ds, de):
        docs = await _closed_orders_in_range(ds, de, {"_id": 0, "total": 1})
        sales = sum(d["total"] for d in docs)
        count = len(docs)
        avg = sales / count if count else 0
        return {"sales": round(sales, 2), "orders": count, "avg_ticket": round(avg, 2)}

    return {
        "today": await agg(today, tomorrow),
        "yesterday": await agg(yest, today),
        "week": await agg(week, tomorrow),
        "prev_week": await agg(prev_week, week),
        "month": await agg(month, tomorrow),
        "prev_month": await agg(prev_month, month),
        "year": await agg(year, tomorrow),
        "prev_year": await agg(prev_year, year),
    }

@api.get("/reports/timeseries")
async def report_timeseries(
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    bucket: str = Query("day"),
    user=Depends(require_roles("admin")),
):
    f, t = _parse_dt(frm), _parse_dt(to)
    docs = await _closed_orders_in_range(f, t, {"_id": 0, "closed_at": 1, "total": 1})
    buckets: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        dt = datetime.fromisoformat(d["closed_at"])
        key = dt.strftime("%Y-%m-%d %H:00") if bucket == "hour" else dt.strftime("%Y-%m-%d")
        b = buckets.setdefault(key, {"date": key, "sales": 0.0, "orders": 0})
        b["sales"] += d["total"]
        b["orders"] += 1
    out = sorted(buckets.values(), key=lambda x: x["date"])
    for r in out:
        r["sales"] = round(r["sales"], 2)
    return out

@api.get("/reports/products")
async def report_products(
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    limit: int = Query(10),
    user=Depends(require_roles("admin")),
):
    f, t = _parse_dt(frm), _parse_dt(to)
    orders = await _closed_orders_in_range(f, t, {"_id": 0, "items": 1})
    agg: Dict[str, Dict[str, Any]] = {}
    for o in orders:
        for it in o["items"]:
            pid = it["product_id"]
            a = agg.setdefault(pid, {"product_id": pid, "name": it["name"], "qty": 0, "revenue": 0.0})
            a["qty"] += it["qty"]
            a["revenue"] += it["line_total"]
    for a in agg.values():
        a["revenue"] = round(a["revenue"], 2)
    values = list(agg.values())
    top = sorted(values, key=lambda x: x["revenue"], reverse=True)[:limit]
    bottom = sorted(values, key=lambda x: x["revenue"])[:limit]

    # Include catalog items with zero sales in bottom
    all_prods = await db.products.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    zero = [{"product_id": p["id"], "name": p["name"], "qty": 0, "revenue": 0.0} for p in all_prods if p["id"] not in agg]
    bottom = (zero + bottom)[:limit]
    return {"top": top, "bottom": bottom, "total_products": len(values)}

@api.get("/reports/hourly")
async def report_hourly(
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    user=Depends(require_roles("admin")),
):
    f, t = _parse_dt(frm), _parse_dt(to)
    orders = await _closed_orders_in_range(f, t, {"_id": 0, "closed_at": 1, "total": 1})
    hours = {h: {"hour": h, "sales": 0.0, "orders": 0} for h in range(24)}
    for o in orders:
        h = datetime.fromisoformat(o["closed_at"]).hour
        hours[h]["sales"] += o["total"]
        hours[h]["orders"] += 1
    out = list(hours.values())
    for r in out:
        r["sales"] = round(r["sales"], 2)
    return out

@api.get("/reports/weekday")
async def report_weekday(
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    user=Depends(require_roles("admin")),
):
    f, t = _parse_dt(frm), _parse_dt(to)
    orders = await _closed_orders_in_range(f, t, {"_id": 0, "closed_at": 1, "total": 1})
    labels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
    days = {i: {"weekday": i, "label": labels[i], "sales": 0.0, "orders": 0} for i in range(7)}
    for o in orders:
        wd = datetime.fromisoformat(o["closed_at"]).weekday()
        days[wd]["sales"] += o["total"]
        days[wd]["orders"] += 1
    out = list(days.values())
    for r in out:
        r["sales"] = round(r["sales"], 2)
    return out

@api.get("/reports/payment-methods")
async def report_payments(
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    user=Depends(require_roles("admin")),
):
    f, t = _parse_dt(frm), _parse_dt(to)
    orders = await _closed_orders_in_range(f, t, {"_id": 0, "payments": 1})
    methods: Dict[str, Dict[str, Any]] = {}
    for o in orders:
        for p in o.get("payments", []):
            m = p["method"]
            a = methods.setdefault(m, {"method": m, "amount": 0.0, "count": 0})
            a["amount"] += p["amount"]
            a["count"] += 1
    for mm in methods.values():
        mm["amount"] = round(mm["amount"], 2)
    return list(methods.values())

@api.get("/reports/orders")
async def report_orders(
    frm: str = Query(..., alias="from"),
    to: str = Query(...),
    limit: int = Query(200),
    user=Depends(require_roles("admin")),
):
    f, t = _parse_dt(frm), _parse_dt(to)
    q = {"paid": True, "closed_at": {"$gte": f.isoformat(), "$lt": t.isoformat()}}
    return await db.orders.find(q, {"_id": 0}).sort("closed_at", -1).to_list(limit)

# ================= TICKET =================
@api.get("/orders/{oid}/ticket", response_class=HTMLResponse)
async def ticket(oid: str):
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Pedido no encontrado")
    rows = ""
    for it in o["items"]:
        mods = "".join(f"<div class='mod'>+ {m['name']}{(' (S/ '+str(m['price_delta'])+')') if m['price_delta'] else ''}</div>" for m in it["modifiers"])
        rows += f"""
        <tr>
          <td>{it['qty']}x {it['name']}{mods}{('<div class=mod>'+it['notes']+'</div>') if it.get('notes') else ''}</td>
          <td class='right'>S/ {it['line_total']:.2f}</td>
        </tr>"""
    pay_rows = "".join(
        f"<div>Pago ({p['method']}): S/ {p['amount']:.2f}{' · propina S/ ' + format(p.get('tip', 0) or 0, '.2f') if (p.get('tip') or 0) > 0 else ''}</div>"
        for p in o.get("payments", [])
    )
    tip_total = sum((p.get("tip") or 0) for p in o.get("payments", []))
    html = f"""
<!doctype html>
<html><head><meta charset='utf-8'><title>Ticket {o['code']}</title>
<style>
body{{font-family:'Courier New',monospace;max-width:320px;margin:20px auto;color:#000;}}
h1{{text-align:center;font-size:18px;margin:0 0 6px;}}
.center{{text-align:center}} .right{{text-align:right}}
hr{{border:0;border-top:1px dashed #000;margin:8px 0}}
table{{width:100%;border-collapse:collapse;font-size:12px}}
td{{padding:4px 0;vertical-align:top}}
.mod{{font-size:11px;color:#444;margin-left:10px}}
.totals div{{display:flex;justify-content:space-between;font-size:13px}}
.totals .t{{font-weight:700;font-size:15px;margin-top:6px}}
@media print{{body{{margin:0}}.noprint{{display:none}}}}
</style></head><body>
<h1>{os.environ.get('BUSINESS_NAME', 'Rich-Coffee')}</h1>
<div class='center'>Ticket {o['code']}</div>
<div class='center'>{datetime.fromisoformat(o['created_at']).strftime('%d/%m/%Y %H:%M')}</div>
<div class='center'>Mesa: {o['table_number'] or 'Para llevar'}</div>
<div class='center'>Atendió: {o.get('created_by_name','')}</div>
<hr/>
<table>{rows}</table>
<hr/>
<div class='totals'>
  <div><span>Subtotal</span><span>S/ {o['subtotal']:.2f}</span></div>
  <div><span>Descuento</span><span>- S/ {o.get('discount',0):.2f}</span></div>
  <div><span>Cargo extra</span><span>+ S/ {o.get('extra_charge',0):.2f}</span></div>
  {"<div><span>Propina</span><span>+ S/ " + format(tip_total, '.2f') + "</span></div>" if tip_total > 0 else ""}
  <div class='t'><span>TOTAL</span><span>S/ {o['total']:.2f}</span></div>
</div>
<hr/>
{pay_rows}
<div class='center' style='margin-top:10px;'>¡Gracias por su visita!</div>
<div class='center noprint' style='margin-top:14px'>
  <button onclick='window.print()' style='padding:10px 16px;background:#D45D3C;color:#fff;border:0;border-radius:8px;cursor:pointer;font-size:14px'>Imprimir</button>
</div>
</body></html>"""
    return HTMLResponse(html)

# ================= WS =================
@app.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive / ignore
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)

# ================= STARTUP / SEED =================
async def seed_data():
    # Users — only admin is auto-seeded. New users are created by admin from Back Office.
    seed_users = [
        {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"], "name": "Admin", "role": "admin"},
    ]
    for u in seed_users:
        ex = await db.users.find_one({"email": u["email"]})
        if not ex:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": u["email"].lower(),
                "name": u["name"],
                "role": u["role"],
                "password_hash": hash_password(u["password"]),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        elif not verify_password(u["password"], ex["password_hash"]):
            await db.users.update_one({"email": u["email"]}, {"$set": {"password_hash": hash_password(u["password"])}})

    # Cleanup: remove old demo users from previous seed (one-time migration)
    await db.users.delete_many({"email": {"$in": ["admin@pos.com", "mesero@pos.com", "caja@pos.com", "cocina@pos.com"]}})

    # Categories
    if await db.categories.count_documents({}) == 0:
        cats = [
            {"id": str(uuid.uuid4()), "name": "Sánguches", "sort": 1},
            {"id": str(uuid.uuid4()), "name": "Acompañamientos", "sort": 2},
            {"id": str(uuid.uuid4()), "name": "Bebidas", "sort": 3},
            {"id": str(uuid.uuid4()), "name": "Combos", "sort": 4},
        ]
        await db.categories.insert_many(cats)
    cats = await db.categories.find({}, {"_id": 0}).to_list(100)
    cat_by_name = {c["name"]: c["id"] for c in cats}

    # Modifiers
    if await db.modifiers.count_documents({}) == 0:
        mods = [
            {"id": str(uuid.uuid4()), "name": "Sin cebolla", "price_delta": 0.0},
            {"id": str(uuid.uuid4()), "name": "Sin tomate", "price_delta": 0.0},
            {"id": str(uuid.uuid4()), "name": "Extra queso", "price_delta": 3.0},
            {"id": str(uuid.uuid4()), "name": "Extra tocino", "price_delta": 4.0},
            {"id": str(uuid.uuid4()), "name": "Palta", "price_delta": 2.5},
            {"id": str(uuid.uuid4()), "name": "Picante", "price_delta": 0.0},
        ]
        await db.modifiers.insert_many(mods)
    mods = await db.modifiers.find({}, {"_id": 0}).to_list(100)
    all_mod_ids = [m["id"] for m in mods]

    # Products
    IMG_BEEF = "https://static.prod-images.emergentagent.com/jobs/e2a7792c-50bd-435b-b799-85085d415e26/images/ff2f8d162feb9d4781c630f72cd3483b24b645a081e4f0f640b93e2b5a452e60.png"
    IMG_CHICKEN = "https://static.prod-images.emergentagent.com/jobs/e2a7792c-50bd-435b-b799-85085d415e26/images/d0da6e2bcbb28482c0834c06295bbd45c4e252473674abc6e4607bb99698f26f.png"
    IMG_SIDES = "https://static.prod-images.emergentagent.com/jobs/e2a7792c-50bd-435b-b799-85085d415e26/images/99971115974fa25948bfea9f498f457bb3c77827c0aaa8b4b2c1ca806b9c9f96.png"
    IMG_DRINKS = "https://static.prod-images.emergentagent.com/jobs/e2a7792c-50bd-435b-b799-85085d415e26/images/68eba858e5bb7163176da2f4a33bbea805fa0a6d98a1b5625aec57f83243058b.png"

    if await db.products.count_documents({}) == 0:
        prods = [
            {"id": str(uuid.uuid4()), "name": "Chicharrón Clásico", "price": 18.0, "category_id": cat_by_name["Sánguches"], "image": IMG_BEEF, "available": True, "modifier_ids": all_mod_ids, "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Lomo Saltado", "price": 22.0, "category_id": cat_by_name["Sánguches"], "image": IMG_BEEF, "available": True, "modifier_ids": all_mod_ids, "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Pollo a la Brasa", "price": 17.0, "category_id": cat_by_name["Sánguches"], "image": IMG_CHICKEN, "available": True, "modifier_ids": all_mod_ids, "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Club Sandwich", "price": 20.0, "category_id": cat_by_name["Sánguches"], "image": IMG_CHICKEN, "available": True, "modifier_ids": all_mod_ids, "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Papas Fritas", "price": 8.0, "category_id": cat_by_name["Acompañamientos"], "image": IMG_SIDES, "available": True, "modifier_ids": [], "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Yuquitas Fritas", "price": 9.0, "category_id": cat_by_name["Acompañamientos"], "image": IMG_SIDES, "available": True, "modifier_ids": [], "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Chicha Morada", "price": 6.0, "category_id": cat_by_name["Bebidas"], "image": IMG_DRINKS, "available": True, "modifier_ids": [], "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Inca Kola", "price": 5.0, "category_id": cat_by_name["Bebidas"], "image": IMG_DRINKS, "available": True, "modifier_ids": [], "is_combo": False, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Combo Chicharrón", "price": 25.0, "category_id": cat_by_name["Combos"], "image": IMG_BEEF, "available": True, "modifier_ids": all_mod_ids, "is_combo": True, "combo_items": []},
            {"id": str(uuid.uuid4()), "name": "Combo Pollo", "price": 24.0, "category_id": cat_by_name["Combos"], "image": IMG_CHICKEN, "available": True, "modifier_ids": all_mod_ids, "is_combo": True, "combo_items": []},
        ]
        await db.products.insert_many(prods)

    await db.users.create_index("email", unique=True)
    await db.products.create_index("id", unique=True)
    await db.orders.create_index("id", unique=True)

    # Historical demo orders removed


# ================= SOCIOS / LIQUIDACIÓN =================
class SocioIn(BaseModel):
    name: str
    color: str = "#D45D3C"
    product_ids: List[str] = []

@api.get("/socios")
async def list_socios(user=Depends(require_roles("admin"))):
    return await db.socios.find({}, {"_id": 0}).to_list(100)

@api.post("/socios")
async def create_socio(body: SocioIn, user=Depends(require_roles("admin"))):
    s = {"id": str(uuid.uuid4()), "name": body.name, "color": body.color, "product_ids": body.product_ids}
    await db.socios.insert_one(s)
    return {k: v for k, v in s.items() if k != "_id"}

@api.patch("/socios/{sid}")
async def update_socio(sid: str, body: SocioIn, user=Depends(require_roles("admin"))):
    await db.socios.update_one({"id": sid}, {"$set": {"name": body.name, "color": body.color, "product_ids": body.product_ids}})
    return await db.socios.find_one({"id": sid}, {"_id": 0})

@api.delete("/socios/{sid}")
async def delete_socio(sid: str, user=Depends(require_roles("admin"))):
    await db.socios.delete_one({"id": sid})
    return {"ok": True}

@api.get("/socios/report")
async def socios_report(frm: str = Query(...), to: str = Query(...), user=Depends(require_roles("admin"))):
    frm_dt = _parse_dt(frm)
    to_dt = _parse_dt(to)
    orders = await _closed_orders_in_range(frm_dt, to_dt)
    socios = await db.socios.find({}, {"_id": 0}).to_list(100)
    products = await db.products.find({}, {"_id": 0}).to_list(1000)
    prod_map = {p["id"]: p for p in products}
    
    result = []
    for socio in socios:
        pid_set = set(socio.get("product_ids", []))
        total = 0.0
        units = 0
        breakdown = {}
        for order in orders:
            for item in order.get("items", []):
                if item.get("product_id") in pid_set:
                    qty = item.get("qty", 1)
                    line = item.get("line_total", 0)
                    units += qty
                    total += line
                    pid = item["product_id"]
                    if pid not in breakdown:
                        breakdown[pid] = {"name": item.get("name", ""), "qty": 0, "total": 0.0}
                    breakdown[pid]["qty"] += qty
                    breakdown[pid]["total"] = round(breakdown[pid]["total"] + line, 2)
        result.append({
            "id": socio["id"],
            "name": socio["name"],
            "color": socio["color"],
            "total": round(total, 2),
            "units": units,
            "breakdown": list(breakdown.values()),
        })
    return result

@app.on_event("startup")
async def on_start():
    await seed_data()
    logger.info("POS backend started. Seed complete.")

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown():
    client.close()
