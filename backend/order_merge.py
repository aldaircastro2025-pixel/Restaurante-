"""Fusión de los platos editados por el mozo con los platos ya guardados.

Problema que resuelve: cuando el mozo añadía un plato a un pedido que ya tenía
cobros parciales, el backend reconstruía TODA la lista de platos desde cero y
ponía `paid_qty = 0`, `paid = False` y `done = False` en todos. Resultado: lo que
ya se había cobrado (y lo que cocina ya había marcado como listo) se reiniciaba.

Aquí se conserva el estado de cobro/cocina de cada plato que ya existía y solo
los platos realmente nuevos empiezan en cero. No usa base de datos, así se puede
probar por separado (ver tests/test_order_merge.py).
"""
from typing import Any, Dict, List, Optional


class MergeError(Exception):
    """Error de negocio al fusionar (se convierte en HTTP 400 en server.py)."""


def _signature(item: Dict[str, Any]) -> tuple:
    mods = tuple(sorted(m.get("id", "") for m in item.get("modifiers", [])))
    return (item.get("product_id"), mods, (item.get("notes") or "").strip())


def merge_order_items(
    old_items: List[Dict[str, Any]],
    new_items: List[Dict[str, Any]],
    source_indexes: List[Optional[int]],
    known_count: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Devuelve la lista final de platos del pedido.

    old_items       platos guardados actualmente en la base de datos.
    new_items       platos recién calculados (precios actuales) en el mismo orden
                    en que los envió el cliente; todos vienen con paid_qty = 0.
    source_indexes  por cada plato enviado, el índice que tenía en el pedido
                    guardado cuando el cliente lo cargó (None = plato nuevo).
    known_count     cuántos platos conocía el cliente al cargar el pedido. Los
                    platos guardados con índice >= known_count los añadió otra
                    persona (p. ej. caja) mientras el mozo editaba, así que se
                    conservan en vez de borrarse. None = cliente antiguo.
    """
    if len(new_items) != len(source_indexes):
        raise MergeError("Datos de pedido inconsistentes")

    used: set = set()
    sources: List[Optional[int]] = [None] * len(new_items)

    # 1) Emparejar por índice de origen (cliente actual). Se valida que el plato
    #    siga siendo el mismo producto para no mezclar estados por error.
    for pos, src in enumerate(source_indexes):
        if src is None or not isinstance(src, int):
            continue
        if 0 <= src < len(old_items) and src not in used:
            if old_items[src].get("product_id") == new_items[pos].get("product_id"):
                sources[pos] = src
                used.add(src)

    # 2) Cliente antiguo (sin índices, p. ej. app guardada en caché del celular):
    #    emparejar por producto + modificadores + nota, en orden.
    if all(s is None for s in source_indexes):
        for pos, it in enumerate(new_items):
            sig = _signature(it)
            for j, old in enumerate(old_items):
                if j not in used and _signature(old) == sig:
                    sources[pos] = j
                    used.add(j)
                    break

    merged: List[Dict[str, Any]] = []
    for pos, new in enumerate(new_items):
        j = sources[pos]
        if j is None:
            merged.append(new)
            continue
        old = old_items[j]
        old_qty = int(old.get("qty", 1) or 1)
        old_paid = min(int(old.get("paid_qty", 0) or 0), old_qty)
        new_qty = int(new["qty"])
        if new_qty < old_paid:
            raise MergeError(
                f"No se puede dejar '{old.get('name', 'plato')}' en {new_qty}: "
                f"ya se cobraron {old_paid} unidad(es)."
            )
        item = dict(new)
        # Se conserva el precio con el que se vendió/cobró (aunque el catálogo cambie).
        unit_total = (old.get("line_total", 0) / old_qty) if old_qty else 0
        item["unit_price"] = old.get("unit_price", new.get("unit_price"))
        item["modifiers"] = old.get("modifiers", new.get("modifiers", []))
        item["line_total"] = round(unit_total * new_qty, 2)
        item["paid_qty"] = old_paid
        item["paid"] = old_paid >= new_qty
        # Cocina: si solo bajó o igualó la cantidad, sigue "listo"; si subió, hay
        # unidades nuevas por preparar.
        item["done"] = bool(old.get("done")) and new_qty <= old_qty
        item["added"] = bool(old.get("added")) or bool(new.get("added"))
        merged.append(item)

    # 3) Platos guardados que el cliente no devolvió.
    for j, old in enumerate(old_items):
        if j in used:
            continue
        unseen = known_count is not None and j >= known_count
        if unseen:
            merged.append(old)  # lo añadió otra persona: se respeta tal cual
            continue
        if int(old.get("paid_qty", 0) or 0) > 0:
            raise MergeError(
                f"No se puede eliminar '{old.get('name', 'plato')}': "
                "ya tiene unidades cobradas."
            )
        # sin cobros: el mozo lo quitó a propósito -> se elimina

    return merged
