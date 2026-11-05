import { FUND_VALUATION_CONFIG } from "@/domain/scoring/config";
import type { Verdict } from "@/domain/scoring/valuation-score";

/**
 * «¿Cara o barata?» de un ETF o ETC (CLAUDE.md §5.5), determinista. Un fondo no
 * tiene beneficios propios con historia, así que se compara su precio con su
 * tendencia de largo plazo: la recta que mejor encaja con el logaritmo de sus
 * cierres mensuales (hasta 10 años). Por encima de la tendencia = más cara que
 * de costumbre; por debajo = más barata. Una ficha sin historia suficiente
 * queda «Sin dato».
 */

export interface FundValuation {
  verdict: Verdict | null;
  /** Precio ÷ tendencia − 1 (0,2 = un 20 % por encima). */
  deviation: number | null;
  /** 0–100: 100 = muy por debajo de su tendencia (barata). */
  score: number | null;
  /** Meses de historia usados. */
  months: number;
  /** Precio que marcaría hoy su tendencia. */
  trendPrice: number | null;
  /** Lo que sube de media al año su tendencia (0,1 = un 10 %). */
  trendAnnual: number | null;
  /** Explicación en llano. */
  sentence: string;
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const pct = (x: number) => `${Math.round(Math.abs(x) * 100).toLocaleString("es-ES")} %`;

export function fundVerdict(deviation: number, cfg = FUND_VALUATION_CONFIG): Verdict {
  if (deviation < cfg.cheapBelow) return "Barata";
  if (deviation > cfg.expensiveAbove) return "Cara";
  return "Justa";
}

/** Valoración por tendencia a partir de los cierres mensuales en orden cronológico. */
export function fundTrendValuation(closes: number[], cfg = FUND_VALUATION_CONFIG): FundValuation {
  const ys = closes.filter((c) => Number.isFinite(c) && c > 0).slice(-cfg.maxMonths);
  const years = (m: number) => `${Math.floor(m / 12)} años`;
  if (ys.length < cfg.minMonths) {
    return {
      verdict: null, deviation: null, score: null, months: ys.length, trendPrice: null, trendAnnual: null,
      sentence: `Hacen falta al menos ${years(cfg.minMonths)} de precios mensuales para ver su tendencia (hay ${ys.length} meses).`,
    };
  }
  // Mínimos cuadrados sobre ln(precio) = a + b·t
  const n = ys.length;
  const ls = ys.map(Math.log);
  const tMean = (n - 1) / 2;
  const lMean = ls.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t++) {
    num += (t - tMean) * (ls[t]! - lMean);
    den += (t - tMean) ** 2;
  }
  const b = num / den;
  const a = lMean - b * tMean;
  const trendPrice = Math.exp(a + b * (n - 1));
  const deviation = ys[n - 1]! / trendPrice - 1;
  const verdict = fundVerdict(deviation, cfg);
  const trendAnnual = Math.exp(12 * b) - 1;
  const where = Math.abs(deviation) < 0.005 ? "justo en su tendencia" : `un ${pct(deviation)} ${deviation > 0 ? "por encima" : "por debajo"} de su tendencia`;
  const pace = trendAnnual >= 0 ? `sube de media un ${pct(trendAnnual)} al año` : `baja de media un ${pct(trendAnnual)} al año`;
  const tail = verdict === "Barata" ? "Está más barata que de costumbre." : verdict === "Cara" ? "Está más cara que de costumbre." : "Está en su precio habitual.";
  return {
    verdict,
    deviation,
    score: Math.round(clamp(50 - (deviation / cfg.fullScaleDeviation) * 50)),
    months: n,
    trendPrice,
    trendAnnual,
    sentence: `Cotiza ${where} de ${years(n)} (${pace}). ${tail}`,
  };
}
