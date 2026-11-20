/**
 * Dónde está el precio de hoy dentro de su rango de 52 semanas y cuánto ha
 * subido o bajado en el año, con las velas semanales guardadas y la última
 * cotización. Sin red ni IA.
 */

export interface WeeklyBar {
  date: string;
  high: number | null;
  low: number | null;
  close: number;
}

export interface PriceRange52 {
  low: number;
  high: number;
  /** 0 = en el mínimo de 52 semanas, 1 = en el máximo. */
  position: number;
  /** Distancia al máximo (−0,12 = un 12 % por debajo). */
  fromHigh: number;
  /** Media de los cierres semanales de las últimas 52 semanas. */
  average: number;
  /** Precio de hoy frente a esa media (0,06 = un 6 % por encima). */
  vsAverage: number;
}

export interface PriceStats {
  range52: PriceRange52 | null;
  /** En lo que va de año: precio de hoy frente al último cierre del año anterior. */
  ytd: number | null;
  /** Cierre del año anterior usado para el cálculo. */
  ytdBase: { date: string; close: number } | null;
  /** Hace 6 meses: precio de hoy frente al cierre de la semana de hace 6 meses (mapa de calor). */
  sixMonths: number | null;
  /** Cierre semanal usado para el cálculo de 6 meses. */
  sixMonthsBase: { date: string; close: number } | null;
}

const DAY = 86_400_000;
/** Hacen falta velas que cubran al menos 40 de las 52 semanas para dar el rango. */
const MIN_WEEKS = 40;
/** El cierre del año anterior debe ser de la última semana de diciembre (como mucho 10 días antes del 1 de enero). */
const MAX_YEAR_END_GAP_DAYS = 10;

export function priceStats(weekly: WeeklyBar[], price: { value: number; date: string } | null): PriceStats {
  if (!price || price.value <= 0) return { range52: null, ytd: null, ytdBase: null, sixMonths: null, sixMonthsBase: null };
  const asOf = Date.parse(price.date);
  const from = asOf - 364 * DAY;
  const year = weekly.filter((b) => Date.parse(b.date) > from && Date.parse(b.date) <= asOf);

  let range52: PriceRange52 | null = null;
  if (year.length >= MIN_WEEKS) {
    const low = Math.min(price.value, ...year.map((b) => b.low ?? b.close));
    const high = Math.max(price.value, ...year.map((b) => b.high ?? b.close));
    const average = year.reduce((a, b) => a + b.close, 0) / year.length;
    range52 = {
      low,
      high,
      position: high > low ? (price.value - low) / (high - low) : 1,
      fromHigh: price.value / high - 1,
      average,
      vsAverage: price.value / average - 1,
    };
  }

  const jan1 = `${price.date.slice(0, 4)}-01-01`;
  const prev = weekly.filter((b) => b.date < jan1).at(-1);
  const ytdBase = prev && prev.close > 0 && Date.parse(jan1) - Date.parse(prev.date) <= MAX_YEAR_END_GAP_DAYS * DAY ? { date: prev.date, close: prev.close } : null;
  const sixMonthsBase = closeMonthsAgo(weekly, price.date, 6);
  return {
    range52,
    ytd: ytdBase ? price.value / ytdBase.close - 1 : null,
    ytdBase,
    sixMonths: sixMonthsBase ? price.value / sixMonthsBase.close - 1 : null,
    sixMonthsBase,
  };
}

/** Misma fecha N meses antes (el 31 de agosto menos 6 meses es el 28 o 29 de febrero). */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Cierre de la semana que contenía la fecha de hace N meses. Las velas
 * semanales llevan la fecha de inicio de semana: se toma la última que empieza
 * ese día o antes, y solo si de verdad cubre esa fecha (sin huecos de más de 10 días).
 */
export function closeMonthsAgo(weekly: WeeklyBar[], asOf: string, months: number): { date: string; close: number } | null {
  const target = monthsBefore(asOf, months);
  const bar = weekly.filter((b) => b.date.slice(0, 10) <= target).at(-1);
  if (!bar || bar.close <= 0) return null;
  if (Date.parse(target) - Date.parse(bar.date.slice(0, 10)) > MAX_YEAR_END_GAP_DAYS * DAY) return null;
  return { date: bar.date.slice(0, 10), close: bar.close };
}
