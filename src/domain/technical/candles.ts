import type { PriceBar } from "@/data/prices/provider";

export type CandleInterval = "1w" | "1mo";

/** Inicio del periodo de una fecha: lunes de su semana o día 1 de su mes. */
export function periodStart(date: string, interval: CandleInterval): string {
  if (interval === "1mo") return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrupa velas diarias (ordenadas) en semanales o mensuales. Cada vela lleva
 * la fecha de inicio del periodo; el cierre es el del último día con datos.
 */
export function aggregateBars(daily: PriceBar[], interval: CandleInterval): PriceBar[] {
  const out: PriceBar[] = [];
  let current: PriceBar | null = null;
  for (const b of daily) {
    const key = periodStart(b.date, interval);
    if (!current || current.date !== key) {
      current = { date: key, open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close, volume: b.volume };
      out.push(current);
      continue;
    }
    current.high = Math.max(current.high ?? b.close, b.high ?? b.close);
    current.low = Math.min(current.low ?? b.close, b.low ?? b.close);
    current.close = b.close;
    current.volume = current.volume === null || b.volume === null ? null : current.volume + b.volume;
  }
  return out;
}
