import type { NextBuyCandidate } from "@/domain/portfolio/next-buy";
import type { Holding, PortfolioView } from "./load";

/**
 * De una posición de «Mi cartera» a candidata de «Qué compro hoy». Solo usa lo
 * ya calculado al cargar la cartera: no hace peticiones ni llama a la IA.
 */
export function nextBuyCandidate(h: Holding, view: PortfolioView): NextBuyCandidate {
  const p = h.position;
  const a = h.analysis;
  const sector = h.row.kind === "stock" ? p.security.sector : null;
  const sectorValue = sector ? view.portfolio.bySector.find((e) => e.key === sector)?.valueEur ?? 0 : 0;
  // Fracciones: si alguna compra suya no fue de acciones enteras, su bróker las permite (N26 sí, ING no)
  const fractional = view.transactions.some((t) => t.security_id === h.row.id && t.type === "buy" && Math.abs(t.quantity - Math.round(t.quantity)) > 1e-6);
  return {
    id: h.row.id,
    ticker: h.row.ticker,
    name: h.row.name,
    kind: h.row.kind,
    valueEur: p.valueEur,
    priceEur: p.valueEur !== null && p.shares > 0 ? p.valueEur / p.shares : null,
    fractional,
    sector: sector ? { name: sector, valueEur: sectorValue } : null,
    action: h.recommendation.action,
    alerts: h.recommendation.alerts,
    technical: h.technical.level,
    valuation:
      h.row.kind === "stock"
        ? a?.valuation
          ? { source: "history", score: a.valuation.score, deviation: a.valuation.deviation, verdict: a.valuation.verdict }
          : null
        : h.trend && h.trend.average > 0
          ? { source: "trend", deviation: h.trend.price / h.trend.average - 1 }
          : null,
    cash: h.row.kind === "stock" ? { fcfYield: a?.multiples?.fcfYield.value ?? null, operatingMargin: a?.current.operatingMargin.value ?? null, netMargin: a?.current.netMargin.value ?? null } : null,
    growth: {
      multiYear: h.growthRate,
      recent: h.row.kind === "stock" ? a?.growth.revenue.value ?? null : null,
      recentPeriod: h.row.kind === "stock" ? a?.growth.period ?? null : null,
    },
    quality: a?.quality.score ?? null,
  };
}
