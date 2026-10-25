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
}

const DAY = 86_400_000;
/** Hacen falta velas que cubran al menos 40 de las 52 semanas para dar el rango. */
const MIN_WEEKS = 40;
/** El cierre del año anterior debe ser de la última semana de diciembre (como mucho 10 días antes del 1 de enero). */
const MAX_YEAR_END_GAP_DAYS = 10;

export function priceStats(weekly: WeeklyBar[], price: { value: number; date: string } | null): PriceStats {
  if (!price || price.value <= 0) return { range52: null, ytd: null, ytdBase: null };
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
  return { range52, ytd: ytdBase ? price.value / ytdBase.close - 1 : null, ytdBase };
}
