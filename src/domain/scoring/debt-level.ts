import type { Metric } from "@/domain/fundamentals/metrics";
import { DEBT_CONFIG } from "./config";

export type DebtLevel = "Baja" | "Moderada" | "Alta";

/**
 * Nivel de deuda para el indicador «¿Tiene mucha deuda?» (§6), a partir de
 * los años que tardaría en pagar la deuda neta con su caja libre.
 */
export function debtLevel(years: Metric, netDebt: Metric, freeCashFlow: Metric, cfg = DEBT_CONFIG): DebtLevel | null {
  if (netDebt.value === null) return null;
  if (netDebt.value <= 0) return "Baja";
  // Deuda neta positiva y sin caja libre con la que pagarla
  if (freeCashFlow.value !== null && freeCashFlow.value <= 0) return "Alta";
  if (years.value === null) return null;
  if (years.value < cfg.lowBelowYears) return "Baja";
  if (years.value > cfg.highAboveYears) return "Alta";
  return "Moderada";
}
