"""Pruebas de la fusión de platos al editar un pedido (no necesitan base de datos).

Ejecutar:  cd backend && python -m pytest tests/test_order_merge.py
           (o simplemente: python tests/test_order_merge.py)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from order_merge import merge_order_items, MergeError  # noqa: E402


def item(pid, qty, price=10.0, paid_qty=0, done=False, notes="", mods=None, added=False):
    return {
        "product_id": pid, "name": f"P-{pid}", "qty": qty, "unit_price": price,
        "modifiers": mods or [], "notes": notes, "line_total": round(price * qty, 2),
        "done": done, "paid": paid_qty >= qty, "paid_qty": paid_qty, "added": added,
    }


def fresh(it):
    """Lo que devuelve compute_order_totals: todo en cero."""
    n = dict(it)
    n.update(paid=False, paid_qty=0, done=False)
    return n


def test_agregar_plato_conserva_lo_cobrado():
    old = [item("a", 2, paid_qty=1, done=True), item("b", 1, paid_qty=1, done=True)]
    new = [fresh(old[0]), fresh(old[1]), fresh(item("c", 1, added=True))]
    out = merge_order_items(old, new, [0, 1, None], known_count=2)
    assert out[0]["paid_qty"] == 1 and out[0]["paid"] is False and out[0]["done"] is True
    assert out[1]["paid_qty"] == 1 and out[1]["paid"] is True
    assert out[2]["paid_qty"] == 0 and out[2]["done"] is False and out[2]["added"] is True


def test_subir_cantidad_de_plato_cobrado():
    old = [item("a", 2, paid_qty=2, done=True)]
    out = merge_order_items(old, [fresh(item("a", 3))], [0], known_count=1)
    assert out[0]["paid_qty"] == 2 and out[0]["paid"] is False
    assert out[0]["done"] is False  # hay una unidad nueva por preparar
    assert out[0]["line_total"] == 30.0


def test_no_se_puede_bajar_de_lo_cobrado_ni_eliminarlo():
    old = [item("a", 3, paid_qty=2)]
    try:
        merge_order_items(old, [fresh(item("a", 1))], [0], known_count=1)
        assert False, "debió fallar"
    except MergeError:
        pass
    try:
        merge_order_items(old, [fresh(item("z", 1))], [None], known_count=1)
        assert False, "debió fallar"
    except MergeError:
        pass


def test_eliminar_plato_sin_cobros_funciona():
    old = [item("a", 1), item("b", 1)]
    out = merge_order_items(old, [fresh(old[1])], [1], known_count=2)
    assert [i["product_id"] for i in out] == ["b"]


def test_plato_agregado_por_caja_mientras_el_mozo_editaba_se_conserva():
    old = [item("a", 1), item("cargo", 1, added=True)]  # caja añadió "cargo" (índice 1)
    out = merge_order_items(old, [fresh(old[0])], [0], known_count=1)
    assert [i["product_id"] for i in out] == ["a", "cargo"]


def test_cliente_antiguo_sin_indices_conserva_cobros_por_firma():
    old = [item("a", 2, paid_qty=1), item("b", 1, paid_qty=1)]
    new = [fresh(old[0]), fresh(old[1]), fresh(item("c", 1))]
    out = merge_order_items(old, new, [None, None, None], known_count=None)
    assert out[0]["paid_qty"] == 1 and out[1]["paid_qty"] == 1 and out[2]["paid_qty"] == 0


def test_precio_cobrado_no_cambia_si_cambia_el_catalogo():
    old = [item("a", 1, price=10.0, paid_qty=1)]
    cambiado = fresh(item("a", 1, price=99.0))
    out = merge_order_items(old, [cambiado], [0], known_count=1)
    assert out[0]["line_total"] == 10.0 and out[0]["unit_price"] == 10.0


def test_indice_que_apunta_a_otro_producto_se_ignora():
    old = [item("a", 1, paid_qty=1)]
    try:
        merge_order_items(old, [fresh(item("x", 1))], [0], known_count=1)
        assert False, "el plato 'a' cobrado no puede desaparecer"
    except MergeError:
        pass


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("OK", name)
