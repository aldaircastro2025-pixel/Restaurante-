import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ---------- Peru (UTC-5) date helpers ----------
// El restaurante siempre opera en hora de Perú, sin importar la zona horaria
// configurada en el navegador/dispositivo del que se conecte el admin/cajero.
// Estos helpers calculan el "día calendario" en Perú de forma explícita, y
// arman fechas ISO con el offset -05:00 para que el backend nunca tenga que
// adivinar la zona horaria.
export const PERU_OFFSET_MIN = -5 * 60; // UTC-5, sin horario de verano

const pad = (n) => String(n).padStart(2, "0");

// Devuelve { year, month (1-12), day } del "ahora" o de un Date dado, en hora de Perú.
export function peruYMD(date = new Date()) {
  const shifted = new Date(date.getTime() + PERU_OFFSET_MIN * 60000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// "YYYY-MM-DD" del día calendario en Perú (para <input type="date">).
export function peruDateInput(date = new Date()) {
  const { year, month, day } = peruYMD(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// A partir de "YYYY-MM-DD" y una hora del día, arma un ISO string con el
// offset explícito de Perú (-05:00), listo para enviar al backend.
export function peruISO(ymdStr, time = "00:00:00") {
  return `${ymdStr}T${time}-05:00`;
}

// Suma/resta días a un "YYYY-MM-DD" tratándolo como fecha calendario (no Date local).
export function shiftYMD(ymdStr, days) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  // Usamos mediodía UTC como ancla para evitar saltos de día por DST/redondeo.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
