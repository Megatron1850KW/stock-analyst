import type { PriceProvider } from "@/data/prices/provider";
import type { Db } from "@/db/client";
import { listPriceTargets, saveQuote } from "@/db/repo";

export interface RefreshResult {
  updated: number;
  failed: { ticker: string; message: string }[];
}

/**
 * Actualiza la cotización de todos los valores guardados. Se llama una vez
 * al abrir la app y con «Actualizar precios» (⌘R); nunca en bucle.
 */
export async function refreshPrices(db: Db, provider: PriceProvider): Promise<RefreshResult> {
  const result: RefreshResult = { updated: 0, failed: [] };
  for (const target of await listPriceTargets(db)) {
    try {
      // EDGAR usa BRK-B; los proveedores de precios, también con guion
      const q = await provider.quote(target.ticker.replace(/\./g, "-"));
      await saveQuote(db, {
        securityId: target.id,
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.price,
        volume: q.volume,
        currency: target.currency,
        source: provider.id,
      });
      result.updated++;
    } catch (e) {
      result.failed.push({ ticker: target.ticker, message: e instanceof Error ? e.message : String(e) });
      // Sin clave no tiene sentido seguir con el resto
      if (String(e).includes("Falta la clave")) break;
    }
  }
  return result;
}
