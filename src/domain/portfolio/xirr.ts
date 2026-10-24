/**
 * Rentabilidad anualizada de una serie de flujos (TIR por fechas, «XIRR»):
 * tiene en cuenta cuándo entró y salió cada euro. Aportaciones negativas,
 * cobros y valor actual positivos.
 */

export interface CashFlow {
  date: string;
  amount: number;
}

const YEAR = 365 * 86_400_000;

function npv(rate: number, flows: CashFlow[], t0: number): number {
  return flows.reduce((s, f) => s + f.amount / (1 + rate) ** ((Date.parse(f.date) - t0) / YEAR), 0);
}

/** Null si no tiene sentido (sin aportaciones, sin cobros o periodo menor de un mes). */
export function xirr(flows: CashFlow[]): number | null {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = Date.parse(sorted[0]!.date);
  const span = Date.parse(sorted.at(-1)!.date) - t0;
  if (span < 30 * 86_400_000) return null;
  // Bisección entre −99,9 % y +1.000 % anual: lenta pero siempre converge
  let lo = -0.999;
  let hi = 10;
  let fLo = npv(lo, sorted, t0);
  const fHi = npv(hi, sorted, t0);
  if (fLo * fHi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid, sorted, t0);
    if (Math.abs(f) < 1e-7 || hi - lo < 1e-9) return mid;
    if (f * fLo < 0) hi = mid;
    else {
      lo = mid;
      fLo = f;
    }
  }
  return (lo + hi) / 2;
}
