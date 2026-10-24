import type { DebtLevel } from "@/domain/scoring/debt-level";
import type { Outcome } from "@/domain/scoring/peer-verdict";
import type { Verdict } from "@/domain/scoring/valuation-score";
import type { StoredAnalysis } from "@/features/ai/equity-analysis";
import type { EquityAnalysis } from "@/features/ai/schema";
import type { SecurityDetail } from "@/features/watchlist/load";

/**
 * Fila de la comparativa de la portada: las mismas 4 preguntas de la ficha
 * (§6), ya calculadas, para ver todos los valores de un vistazo.
 */
export interface ComparisonRow {
  id: number;
  ticker: string;
  name: string;
  sector: string | null;
  kind: "stock";
  price: { value: number; currency: string; date: string } | null;
  valuation: { verdict: Verdict | null; score: number | null; deviation: number | null };
  /** Caja libre ÷ capitalización. */
  fcfYield: number | null;
  debt: {
    level: DebtLevel | null;
    years: number | null;
    netCash: boolean;
    /** Deuda neta ÷ caja libre (negativo = caja neta); null sin caja libre positiva. Sirve para ordenar. */
    ratio: number | null;
  };
  growth: { value: number | null; basis: "quarter" | "year" };
  operatingMargin: number | null;
  /** Ventas de los últimos ejercicios (hasta 6), para la mini línea. */
  revenue: number[];
  ai: { postura: EquityAnalysis["veredicto"]["postura"]; date: string } | null;
  /** Nota de calidad 0–100 (§8.2). */
  quality: number | null;
  /** ¿Oportunidad o trampa? (§8.3) y cómo está frente a sus competidores. */
  verdict: PeerSummary;
}

export interface PeerSummary {
  outcome: Outcome | null;
  reason: string;
  caution?: string;
  vsPeers: Verdict | null;
  peers: number;
}

export function comparisonRow(
  detail: SecurityDetail,
  ai: { stored: StoredAnalysis | null; createdAt: string } | null,
  peers: PeerSummary = { outcome: null, reason: "", vsPeers: null, peers: 0 },
): ComparisonRow | null {
  const s = detail.security;
  const a = detail.analysis;
  if (!s || !a) return null;
  const netDebt = a.current.netDebt.value;
  const fcf = a.current.freeCashFlow.value;
  return {
    id: s.id,
    ticker: s.ticker,
    name: s.name,
    sector: s.sic_description,
    kind: "stock",
    price: a.price ? { value: a.price.value, currency: a.price.currency, date: a.price.date } : null,
    valuation: { verdict: a.valuation?.verdict ?? null, score: a.valuation?.score ?? null, deviation: a.valuation?.deviation ?? null },
    fcfYield: a.multiples?.fcfYield.value ?? null,
    debt: { level: a.debt, years: netDebt !== null && netDebt > 0 ? a.current.debtYears.value : null, netCash: netDebt !== null && netDebt <= 0, ratio: netDebt !== null && fcf !== null && fcf > 0 ? netDebt / fcf : null },
    growth: { value: a.growth.revenue.value, basis: a.growth.basis },
    operatingMargin: a.current.operatingMargin.value,
    revenue: a.years.slice(-6).map((y) => y.revenue?.value).filter((v): v is number => typeof v === "number"),
    ai: ai?.stored ? { postura: ai.stored.analysis.veredicto.postura, date: ai.createdAt } : null,
    quality: a.quality.score,
    verdict: peers,
  };
}

export type SortKey = "cheapest" | "quality" | "cash" | "debt" | "growth" | "ticker";

export const SORT_LABELS: Record<SortKey, string> = {
  cheapest: "Más barata frente a su historia",
  quality: "Mejor negocio (calidad)",
  cash: "Más caja libre",
  debt: "Menos deuda",
  growth: "Más crecimiento",
  ticker: "Ticker (A-Z)",
};

/** Deuda comparable: años de caja libre para pagarla (negativo = caja neta, cuanta más mejor); sin caja libre, al final. */
const debtRank = (r: ComparisonRow) => r.debt.ratio ?? (r.debt.netCash ? 0 : Infinity);

/** Ordena sin perder filas: las que no tienen dato van al final. */
export function sortRows(rows: ComparisonRow[], key: SortKey): ComparisonRow[] {
  const value = (r: ComparisonRow): number | null => {
    switch (key) {
      case "cheapest": return r.valuation.deviation;
      case "quality": return r.quality === null ? null : -r.quality;
      case "cash": return r.fcfYield === null ? null : -r.fcfYield;
      case "debt": return r.debt.level === null ? null : debtRank(r);
      case "growth": return r.growth.value === null ? null : -r.growth.value;
      case "ticker": return null;
    }
  };
  return [...rows].sort((a, b) => {
    if (key === "ticker") return a.ticker.localeCompare(b.ticker);
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.ticker.localeCompare(b.ticker);
    if (va === null) return 1;
    if (vb === null) return -1;
    return va - vb || a.ticker.localeCompare(b.ticker);
  });
}

export interface Highlight {
  key: Exclude<SortKey, "ticker">;
  row: ComparisonRow;
}

/** La mejor de la lista en cada pregunta (solo si hay al menos dos con dato). */
export function highlights(rows: ComparisonRow[]): Highlight[] {
  const out: Highlight[] = [];
  for (const key of ["cheapest", "quality", "cash", "debt", "growth"] as const) {
    const sorted = sortRows(rows, key);
    const withData = sorted.filter((r) =>
      key === "cheapest" ? r.valuation.deviation !== null : key === "quality" ? r.quality !== null : key === "cash" ? r.fcfYield !== null : key === "debt" ? r.debt.level !== null : r.growth.value !== null,
    );
    if (withData.length >= 2) out.push({ key, row: withData[0]! });
  }
  return out;
}
