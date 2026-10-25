import type { Db } from "@/db/client";
import { insertTransaction } from "@/db/portfolio-repo";
import { formatNumber } from "@/lib/format";
import { findOrImportHolding, type HoldingDeps } from "./add-holding";
import type { NewTransaction } from "./queries";

/**
 * Alta en bloque de operaciones ya revisadas (import-csv.ts), en orden de
 * fecha y por el mismo camino que «Nueva operación». Una operación idéntica
 * ya guardada se salta, así que repetir la importación no duplica nada. Una
 * venta de más acciones de las que tienes a esa fecha no se guarda.
 */

export interface ImportOutcome {
  line: number;
  tx: NewTransaction;
  status: "added" | "skipped" | "failed";
  message: string | null;
  securityId: number | null;
  /** El valor se dio de alta en esta importación. */
  newSecurity: boolean;
}

const EPS = 1e-9;

async function sharesAt(db: Db, securityId: number, date: string): Promise<number> {
  const [r] = await db.select<{ n: number | null }>(
    "SELECT SUM(CASE type WHEN 'buy' THEN quantity WHEN 'sell' THEN -quantity ELSE 0 END) AS n FROM transactions WHERE security_id = ? AND trade_date <= ?",
    [securityId, date],
  );
  return r?.n ?? 0;
}

async function isDuplicate(db: Db, securityId: number, t: NewTransaction): Promise<boolean> {
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM transactions WHERE security_id = ? AND trade_date = ? AND type = ? AND ABS(quantity - ?) < 1e-6 AND ABS(price - ?) < 1e-6 LIMIT 1",
    [securityId, t.date, t.type, t.quantity, t.price],
  );
  return rows.length > 0;
}

export async function importTransactions(
  deps: HoldingDeps,
  lines: { line: number; tx: NewTransaction }[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome[]> {
  const { db } = deps;
  // Compras antes que ventas el mismo día, para no rechazar una venta válida
  const order = { buy: 0, dividend: 1, sell: 2 } as const;
  const sorted = [...lines].sort((a, b) => a.tx.date.localeCompare(b.tx.date) || order[a.tx.type] - order[b.tx.type] || a.line - b.line);
  const out: ImportOutcome[] = [];
  for (const [i, { line, tx }] of sorted.entries()) {
    onProgress?.(i, sorted.length);
    const result = (status: ImportOutcome["status"], message: string | null, securityId: number | null = null, newSecurity = false) =>
      out.push({ line, tx, status, message, securityId, newSecurity });
    try {
      const holding = await findOrImportHolding(deps, tx.input, tx.kind);
      const newSecurity = !holding.existing;
      if (!newSecurity && holding.kind !== tx.kind) {
        result("failed", `Ya lo tienes guardado como ${holding.kind === "stock" ? "acción" : holding.kind.toUpperCase()}, no como ${tx.kind === "stock" ? "acción" : tx.kind.toUpperCase()}.`, holding.securityId);
        continue;
      }
      if (await isDuplicate(db, holding.securityId, tx)) {
        result("skipped", "Ya estaba guardada.", holding.securityId, newSecurity);
        continue;
      }
      if (tx.type !== "buy") {
        const shares = await sharesAt(db, holding.securityId, tx.date);
        if (shares <= EPS) {
          result("failed", tx.type === "sell" ? "Venta sin compras anteriores de este valor." : "Dividendo sin acciones de este valor a esa fecha.", holding.securityId, newSecurity);
          continue;
        }
        if (tx.type === "sell" && tx.quantity > shares + EPS) {
          result("failed", `Vende ${formatNumber(tx.quantity, 4).replace(/,?0+$/, "")} acciones, pero a esa fecha solo tenías ${formatNumber(shares, 4).replace(/,?0+$/, "")}.`, holding.securityId, newSecurity);
          continue;
        }
      }
      const { input: _input, kind: _kind, ...rest } = tx;
      await insertTransaction(db, { ...rest, securityId: holding.securityId });
      result("added", null, holding.securityId, newSecurity);
    } catch (e) {
      result("failed", e instanceof Error ? e.message : String(e));
    }
  }
  onProgress?.(sorted.length, sorted.length);
  return out.sort((a, b) => a.line - b.line);
}
