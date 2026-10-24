import type { CurrentMultiples, MultipleId, MultiplePoint, PricePoint, PriceRange, WindowStat } from "@/domain/valuation/multiples";
import { priceRange, windowMedian } from "@/domain/valuation/multiples";
import { VALUATION_CONFIG } from "./config";

/**
 * Puntuación de valoración frente a su propia historia (CLAUDE.md §8.1).
 * Determinista y con desglose: cada múltiplo actual se compara con su mediana
 * de 5 y 10 años y la media de esas desviaciones decide el veredicto.
 */

export type Verdict = "Barata" | "Justa" | "Cara";

export interface MultipleComparison {
  id: MultipleId;
  current: number | null;
  fiveYears: WindowStat;
  tenYears: WindowStat;
  /** current ÷ mediana − 1, por ventana. */
  deviation5: number | null;
  deviation10: number | null;
  /** Media de las desviaciones disponibles. */
  deviation: number | null;
}

export interface ValuationScore {
  verdict: Verdict | null;
  /** 0–100: 100 = mucho más barata que de costumbre. */
  score: number | null;
  /** Desviación media de los múltiplos frente a su historia (−0,2 = un 20 % por debajo). */
  deviation: number | null;
  comparisons: MultipleComparison[];
  range5: PriceRange | null;
  range10: PriceRange | null;
  /** Desglose de la puntuación para la UI. */
  parts: { multiples: number | null; priceRange: number | null };
  /** Por qué no hay veredicto, si no lo hay. */
  note?: string;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const dev = (cur: number | null, med: number | null) => (cur !== null && med !== null && med > 0 ? cur / med - 1 : null);

export function verdictFor(deviation: number, cfg = VALUATION_CONFIG): Verdict {
  if (deviation < cfg.cheapBelow) return "Barata";
  if (deviation > cfg.expensiveAbove) return "Cara";
  return "Justa";
}

export function valuationScore(
  current: CurrentMultiples,
  history: MultiplePoint[],
  monthly: PricePoint[],
  cfg = VALUATION_CONFIG,
): ValuationScore {
  const asOf = current.price.date;
  const comparisons: MultipleComparison[] = cfg.multiples.map((id) => {
    const cur = current[id].value;
    const fiveYears = windowMedian(history, id, asOf, cfg.windows.fiveYears.months, cfg.windows.fiveYears.minPoints);
    const tenYears = windowMedian(history, id, asOf, cfg.windows.tenYears.months, cfg.windows.tenYears.minPoints);
    const deviation5 = dev(cur, fiveYears.median);
    const deviation10 = dev(cur, tenYears.median);
    return { id, current: cur, fiveYears, tenYears, deviation5, deviation10, deviation: avg([deviation5, deviation10].filter((x): x is number => x !== null)) };
  });

  const range5 = priceRange(monthly, current.price.value, asOf, cfg.windows.fiveYears.months);
  const range10 = priceRange(monthly, current.price.value, asOf, cfg.windows.tenYears.months);
  const deviation = avg(comparisons.map((c) => c.deviation).filter((x): x is number => x !== null));
  const multiplesPart = deviation === null ? null : clamp(50 - (deviation / cfg.fullScaleDeviation) * 50);
  const range = range10 ?? range5;
  const rangePart = range ? clamp(100 * (1 - range.position)) : null;

  if (multiplesPart === null) {
    const anyCurrent = comparisons.some((c) => c.current !== null);
    return {
      verdict: null,
      score: null,
      deviation: null,
      comparisons,
      range5,
      range10,
      parts: { multiples: null, priceRange: rangePart },
      note: anyCurrent
        ? "No hay suficiente historia de precios y resultados para comparar (hacen falta al menos 2 años de datos mensuales)."
        : "La empresa no tiene beneficios ni caja libre positivos ahora mismo, así que los múltiplos no sirven para valorarla.",
    };
  }
  const score =
    rangePart === null
      ? multiplesPart
      : (multiplesPart * cfg.weights.multiples + rangePart * cfg.weights.priceRange) / (cfg.weights.multiples + cfg.weights.priceRange);
  return {
    verdict: verdictFor(deviation!, cfg),
    score: Math.round(score),
    deviation,
    comparisons,
    range5,
    range10,
    parts: { multiples: Math.round(multiplesPart), priceRange: rangePart === null ? null : Math.round(rangePart) },
  };
}
