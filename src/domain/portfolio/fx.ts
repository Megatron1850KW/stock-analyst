/**
 * Divisas de la cartera (CLAUDE.md §4.3): todo se consolida en euros con los
 * tipos de referencia del BCE. Un tipo «EUR→USD = 1,08» significa que 1 € son
 * 1,08 $, así que 1 $ son 1 / 1,08 €.
 */

export interface FxRate {
  date: string;
  /** Divisa (USD, GBP…); la base siempre es EUR. */
  quote: string;
  rate: number;
}

/** Peniques de Londres (GBp/GBX) → libras: la cotización viene en centésimas. */
export function majorUnit(currency: string): { currency: string; factor: number } {
  if (currency === "GBp" || currency.toUpperCase() === "GBX") return { currency: "GBP", factor: 0.01 };
  return { currency: currency.toUpperCase(), factor: 1 };
}

/** Días que se acepta un tipo anterior a la fecha pedida (fines de semana y festivos). */
const MAX_STALE_DAYS = 7;
const DAY = 86_400_000;

export class FxTable {
  private readonly byQuote = new Map<string, FxRate[]>();

  constructor(rates: FxRate[]) {
    for (const r of rates) {
      const list = this.byQuote.get(r.quote) ?? [];
      list.push(r);
      this.byQuote.set(r.quote, list);
    }
    for (const list of this.byQuote.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Euros por cada unidad de `currency` en `date` (el último tipo publicado
   * hasta esa fecha, como mucho de 7 días antes). Null si no hay tipo: nunca se inventa.
   */
  eurPer(currency: string, date: string): { value: number; date: string } | null {
    const { currency: cur, factor } = majorUnit(currency);
    if (cur === "EUR") return { value: factor, date };
    const list = this.byQuote.get(cur);
    if (!list?.length) return null;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.date <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const r = list[found]!;
    if (Date.parse(date) - Date.parse(r.date) > MAX_STALE_DAYS * DAY) return null;
    return { value: factor / r.rate, date: r.date };
  }
}
