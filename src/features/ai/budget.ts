import { latestEurUsd, monthSpend } from "@/db/ai-repo";
import type { Db } from "@/db/client";
import { usdToEur } from "./cost";

export class BudgetExceededError extends Error {
  constructor(
    readonly spentEur: number,
    readonly budgetEur: number,
    readonly estimateEur: number,
  ) {
    super("Este análisis superaría tu presupuesto mensual de IA.");
    this.name = "BudgetExceededError";
  }
}

/**
 * Comprueba el presupuesto mensual antes de gastar (CLAUDE.md §7). Devuelve el
 * tipo EUR→USD para convertir luego el coste real.
 */
export async function checkBudget(
  db: Db,
  opts: { budgetEur: number; estimateUsd: number; now?: Date; allowOverBudget?: boolean },
): Promise<number | null> {
  const rate = await latestEurUsd(db);
  const spent = await monthSpend(db, opts.now);
  const estimate = usdToEur(opts.estimateUsd, rate).eur;
  if (opts.budgetEur > 0 && spent.eur + estimate > opts.budgetEur && !opts.allowOverBudget) {
    throw new BudgetExceededError(spent.eur, opts.budgetEur, estimate);
  }
  return rate;
}
