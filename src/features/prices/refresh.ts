import type { PriceProvider } from "@/data/prices/provider";
import type { Db } from "@/db/client";
import { listPriceTargets, saveQuote, type PriceTarget } from "@/db/repo";
import { providerSymbol, syncPriceHistory } from "./history";

export interface RefreshResult {
  updated: number;
  /** Valores cuyo histórico mensual se ha renovado (al añadirlos o cada 30 días). */
  histories: number;
  failed: { ticker: string; message: string }[];
}

/** Días que vale la cotización de un competidor: para compararlo no hace falta el precio de cada día, y así se ahorran consultas del plan gratuito. */
export const PEER_QUOTE_MAX_AGE_DAYS = 7;

function peerQuoteFresh(t: PriceTarget, now: Date): boolean {
  if (!t.peer_only || !t.quote_fetched_at) return false;
  return now.getTime() - Date.parse(t.quote_fetched_at) < PEER_QUOTE_MAX_AGE_DAYS * 86_400_000;
}

/**
 * Actualiza la cotización de todos los valores guardados. Se llama una vez
 * al abrir la app y con «Actualizar precios» (⌘R); nunca en bucle. De paso
 * renueva el histórico de los que lo tengan caducado (más de 30 días).
 */
export async function refreshPrices(db: Db, provider: PriceProvider, only?: number, now = new Date()): Promise<RefreshResult> {
  const result: RefreshResult = { updated: 0, histories: 0, failed: [] };
  const targets = (await listPriceTargets(db)).filter((t) => (only === undefined ? !peerQuoteFresh(t, now) : t.id === only));
  for (const target of targets) {
    try {
      const q = await provider.quote(providerSymbol(target.ticker));
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
      continue;
    }
    try {
      if ((await syncPriceHistory(db, provider, target)).status === "updated") result.histories++;
    } catch (e) {
      result.failed.push({ ticker: target.ticker, message: `Histórico: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return result;
}
