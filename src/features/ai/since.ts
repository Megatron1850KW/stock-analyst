import type { Verdict } from "@/domain/scoring/valuation-score";
import { SINCE_ANALYSIS_CONFIG } from "@/domain/scoring/config";
import type { PricePoint } from "@/domain/valuation/multiples";
import type { Analysis } from "@/features/watchlist/analysis";

/**
 * Cuánto ha cambiado el precio y la valoración desde el último análisis IA,
 * sin volver a llamar a la IA: se compara la foto guardada con el análisis
 * determinista de hoy. Así el texto de la IA no se repite cada día.
 */

export interface AnalysisSnapshot {
  price: { value: number; currency: string; date: string } | null;
  verdict: Verdict | null;
  score: number | null;
  deviation: number | null;
  /** La foto se reconstruyó con el cierre mensual (análisis antiguos sin foto). */
  approx?: boolean;
}

export function snapshotOf(a: Analysis): AnalysisSnapshot {
  const v = a.valuation;
  return {
    price: a.price ? { value: a.price.value, currency: a.price.currency, date: a.price.date } : null,
    verdict: v?.verdict ?? null,
    score: v?.score ?? null,
    deviation: v?.deviation ?? null,
  };
}

/** Para análisis guardados antes de existir la foto: el cierre del mes del análisis. */
export function approxSnapshot(monthly: PricePoint[], createdAt: string, currency: string): AnalysisSnapshot | null {
  const month = createdAt.slice(0, 7);
  const bar = [...monthly].reverse().find((p) => p.date.slice(0, 7) <= month);
  return bar ? { price: { value: bar.close, currency, date: bar.date }, verdict: null, score: null, deviation: null, approx: true } : null;
}

export interface SinceAnalysis {
  then: AnalysisSnapshot;
  now: AnalysisSnapshot;
  /** Variación del precio (0,08 = +8 %); null si falta alguno o cambió la divisa. */
  priceChange: number | null;
  verdictChanged: boolean;
  bigMove: boolean;
  /** Merece la pena que el usuario valore pulsar «Re-analizar». */
  suggestRefresh: boolean;
}

export function sinceAnalysis(then: AnalysisSnapshot, now: AnalysisSnapshot, cfg = SINCE_ANALYSIS_CONFIG): SinceAnalysis {
  const p0 = then.price;
  const p1 = now.price;
  const priceChange = p0 && p1 && p0.currency === p1.currency && p0.value > 0 ? p1.value / p0.value - 1 : null;
  const verdictChanged = !!then.verdict && !!now.verdict && then.verdict !== now.verdict;
  const bigMove = priceChange !== null && Math.abs(priceChange) >= cfg.bigPriceMove;
  return { then, now, priceChange, verdictChanged, bigMove, suggestRefresh: bigMove || verdictChanged };
}
