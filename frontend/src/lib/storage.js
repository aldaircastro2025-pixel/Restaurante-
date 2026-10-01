// localStorage "a prueba de fallos".
// En algunos celulares (modo privado, "bloquear cookies", navegadores de Samsung
// con restricciones) acceder a localStorage lanza un error y la app quedaba en
// blanco. Aquí se captura el error y se usa memoria como respaldo.
const memory = {};

export const safeStorage = {
  get(key) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null || v === undefined ? (memory[key] ?? null) : v;
    } catch (e) {
      return memory[key] ?? null;
    }
  },
  set(key, value) {
    memory[key] = String(value);
    try { window.localStorage.setItem(key, String(value)); } catch (e) { /* solo memoria */ }
  },
  remove(key) {
    delete memory[key];
    try { window.localStorage.removeItem(key); } catch (e) { /* nada */ }
  },
};
