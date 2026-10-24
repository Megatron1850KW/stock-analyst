import { SCENARIO_CONFIG } from "@/domain/scoring/config";

/**
 * Escenarios prudente / base / optimista de la cartera (CLAUDE.md §5.2).
 * Son escenarios, no predicciones: suponen que cada posición sigue creciendo al
 * ritmo de su historia (acotado) y que no añades ni retiras dinero.
 */

export interface GrowthInput {
  ticker: string;
  valueEur: number;
  /** Crecimiento anual histórico (null si no hay datos). */
  growth: number | null;
  basis: "ventas" | "precio";
}

export interface Scenario {
  id: "prudente" | "base" | "optimista";
  rate: number;
  valueEur: number;
}

export interface Scenarios {
  years: number;
  /** Fracción del valor de la cartera que tiene crecimiento histórico. */
  coverage: number;
  scenarios: Scenario[];
  /** Posiciones sin historia suficiente (se suponen planas en el escenario). */
  missing: string[];
}

/** Crecimiento anual compuesto del precio entre el primer y el último cierre mensual. */
export function priceCagr(closes: { date: string; close: number }[], minYears = SCENARIO_CONFIG.minPriceYears): number | null {
  if (closes.length < 2) return null;
  const first = closes[0]!;
  const last = closes.at(-1)!;
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86_400_000);
  if (years < minYears || first.close <= 0 || last.close <= 0) return null;
  return (last.close / first.close) ** (1 / years) - 1;
}

export function buildScenarios(items: GrowthInput[], cfg = SCENARIO_CONFIG): Scenarios | null {
  const total = items.reduce((s, i) => s + i.valueEur, 0);
  if (total <= 0) return null;
  const withData = items.filter((i) => i.growth !== null);
  const covered = withData.reduce((s, i) => s + i.valueEur, 0);
  if (covered === 0) return null;
  const clamp = (g: number) => Math.min(cfg.cap, Math.max(cfg.floor, g));
  // Tasa media ponderada por valor; las posiciones sin dato cuentan como 0 %
  const base = withData.reduce((s, i) => s + clamp(i.growth!) * i.valueEur, 0) / total;
  const rates = {
    prudente: base > 0 ? base * cfg.prudentFactor : base * (2 - cfg.prudentFactor),
    base,
    optimista: base > 0 ? base * cfg.optimisticFactor : base * (2 - cfg.optimisticFactor),
  };
  return {
    years: cfg.years,
    coverage: covered / total,
    scenarios: (["prudente", "base", "optimista"] as const).map((id) => ({ id, rate: rates[id], valueEur: total * (1 + rates[id]) ** cfg.years })),
    missing: items.filter((i) => i.growth === null).map((i) => i.ticker),
  };
}
