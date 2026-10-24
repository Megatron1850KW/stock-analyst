import type { Outcome } from "@/domain/scoring/peer-verdict";
import { PORTFOLIO_CONFIG, QUALITY_CONFIG } from "@/domain/scoring/config";
import type { DebtLevel } from "@/domain/scoring/debt-level";
import type { Verdict } from "@/domain/scoring/valuation-score";

/**
 * Recomendación por posición (CLAUDE.md §8.4): Comprar más o Mantener. Si hay
 * alertas serias, «Mantener — vigilar» con el motivo; nunca se oculta un riesgo.
 * Para ETFs y ETCs no hay estados financieros: solo cuentan el equilibrio de la
 * cartera y la tendencia de largo plazo, y se dice explícitamente.
 */

export type Action = "Comprar más" | "Mantener" | "Mantener — vigilar";

export interface Recommendation {
  action: Action;
  /** Por qué, en llano, de lo más a lo menos importante. */
  reasons: string[];
  /** Riesgos que hay que vigilar (también se muestran si la acción es otra). */
  alerts: string[];
  /** ETF/ETC: la recomendación no mira estados financieros. */
  noFinancials: boolean;
}

export interface Trend {
  price: number;
  /** Media de los últimos `PORTFOLIO_CONFIG.trendMonths` cierres mensuales. */
  average: number;
}

export interface RecommendationInput {
  kind: "stock" | "etf" | "etc";
  /** Peso de la posición en la cartera (null si no tiene precio). */
  weight: number | null;
  sector: { name: string; weight: number } | null;
  /** Acciones: veredicto frente a su historia (§8.1). */
  valuation: Verdict | null;
  /** Acciones: veredicto frente a la competencia (§8.3). */
  outcome: Outcome | null;
  quality: number | null;
  activeSignals: string[];
  debt: DebtLevel | null;
  /** ETF/ETC: tendencia de fondo. */
  trend: Trend | null;
}

const pct = (x: number) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })} %`;
const lower = (xs: string[]) => xs.map((x) => x.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " y $1");

/** Media de los últimos `months` cierres mensuales (orden cronológico); null si no hay bastantes. */
export function trendFromCloses(closes: number[], months = PORTFOLIO_CONFIG.trendMonths): Trend | null {
  if (closes.length < months) return null;
  const last = closes.slice(-months);
  return { price: closes.at(-1)!, average: last.reduce((a, b) => a + b, 0) / months };
}

export function recommend(input: RecommendationInput, cfg = PORTFOLIO_CONFIG): Recommendation {
  const alerts: string[] = [];
  const noFinancials = input.kind !== "stock";

  if (!noFinancials) {
    if (input.outcome === "Trampa de valor") alerts.push(`Posible trampa de valor: ${lower(input.activeSignals)}.`);
    else if (input.activeSignals.length >= QUALITY_CONFIG.trap.minSignals) alerts.push(`El negocio muestra señales de deterioro: ${lower(input.activeSignals)}.`);
    if (input.debt === "Alta") alerts.push("Tiene mucha deuda para la caja que genera.");
    if (input.quality !== null && input.quality < cfg.watchQualityBelow) {
      alerts.push(`Su salud financiera es baja (${Math.round(input.quality)} de 100).`);
    }
  }

  // Equilibrio de la cartera: no sobreconcentrar
  const balance: string[] = [];
  if (input.weight !== null && input.weight > cfg.maxPosition) {
    balance.push(`Ya pesa un ${pct(input.weight)} de tu cartera (máximo recomendado ${pct(cfg.maxPosition)}).`);
  }
  if (input.sector && input.sector.weight > cfg.maxSector) {
    balance.push(`El sector ${input.sector.name} ya pesa un ${pct(input.sector.weight)} (máximo ${pct(cfg.maxSector)}).`);
  }

  const done = (action: Action, reasons: string[]): Recommendation => ({ action, reasons, alerts, noFinancials });

  if (alerts.length > 0) return done("Mantener — vigilar", [...alerts, ...balance]);
  if (balance.length > 0) return done("Mantener", balance);

  if (noFinancials) {
    const note = "Es un " + (input.kind === "etf" ? "ETF" : "ETC") + ": no hay estados financieros que analizar; se mira el equilibrio de tu cartera y su tendencia de fondo.";
    if (!input.trend) return done("Mantener", ["Sin historial de precios suficiente para ver su tendencia de fondo.", note]);
    const { price, average } = input.trend;
    return price >= average
      ? done("Comprar más", [`Su precio está por encima de su media de ${cfg.trendMonths} meses: la tendencia de fondo es alcista.`, "Tu cartera no está sobreconcentrada en ella.", note])
      : done("Mantener", [`Su precio está por debajo de su media de ${cfg.trendMonths} meses: la tendencia de fondo es bajista.`, note]);
  }

  if (input.valuation === null && input.outcome === null) return done("Mantener", ["Sin precio o sin historia suficiente no se puede saber si está barata."]);
  if (input.outcome === "Oportunidad") return done("Comprar más", ["Está barata frente a su historia y a la competencia, con buena calidad.", "Tu cartera no está sobreconcentrada en ella."]);
  if (input.outcome === "Cara" || input.valuation === "Cara") return done("Mantener", ["Hoy está cara: mejor esperar a un precio más bajo para ampliar."]);
  if (input.valuation === "Barata") return done("Comprar más", ["Está más barata que de costumbre.", "Tu cartera no está sobreconcentrada en ella."]);
  if (input.quality !== null && input.quality >= cfg.buyFairQualityFrom) {
    return done("Comprar más", [`Precio justo y buena calidad (${Math.round(input.quality)} de 100).`, "Tu cartera no está sobreconcentrada en ella."]);
  }
  return done("Mantener", [
    input.quality === null
      ? "Precio justo, pero faltan datos para medir su calidad."
      : `Precio justo con calidad media (${Math.round(input.quality)} de 100): no hay prisa por ampliar.`,
  ]);
}
