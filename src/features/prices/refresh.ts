import { ProviderLimitError } from "@/data/prices/alphavantage";
import { providerFor, type PriceProvider } from "@/data/prices/provider";
import type { Db } from "@/db/client";
import { listPriceTargets, savePriceSymbol, saveQuote, type PriceTarget } from "@/db/repo";
import { providerSymbol, syncPriceHistory } from "./history";

export interface RefreshResult {
  updated: number;
  /** Valores cuyo histórico mensual se ha renovado (al añadirlos o cada 30 días). */
  histories: number;
  failed: { ticker: string; message: string }[];
}

/** Proveedor por mercado: Tiingo no cubre las bolsas europeas (CLAUDE.md §4.3). */
export interface PriceProviders {
  US: PriceProvider | null;
  EU: PriceProvider | null;
}

export function providersFor(settings: { priceProvider: string | null; priceProviderEu: string | null }): PriceProviders {
  return { US: providerFor(settings.priceProvider), EU: providerFor(settings.priceProviderEu) };
}

export const providersLabel = (p: PriceProviders) => [p.US?.label, p.EU?.label].filter(Boolean).join(" y ");

/** Días que vale la cotización de un competidor: para compararlo no hace falta el precio de cada día, y así se ahorran consultas del plan gratuito. */
export const PEER_QUOTE_MAX_AGE_DAYS = 7;
/** Si un proveedor no cubre un valor, no se vuelve a buscar hasta pasado este tiempo. */
export const SYMBOL_RETRY_DAYS = 30;

function peerQuoteFresh(t: PriceTarget, now: Date): boolean {
  if (!t.peer_only || !t.quote_fetched_at) return false;
  return now.getTime() - Date.parse(t.quote_fetched_at) < PEER_QUOTE_MAX_AGE_DAYS * 86_400_000;
}

const isProviders = (p: PriceProvider | PriceProviders): p is PriceProviders => !("quote" in p);

/**
 * Símbolo del valor en el proveedor: el ticker, o el que el proveedor encontró
 * (y se guardó) para las bolsas europeas. Null si no lo cubre.
 */
async function symbolFor(db: Db, provider: PriceProvider, t: PriceTarget, now: Date): Promise<string | null> {
  if (!provider.resolveSymbol) return providerSymbol(t.ticker);
  const [savedProvider, saved] = (t.price_symbol ?? "").split(/:(.*)/s);
  if (savedProvider === provider.id && saved) {
    if (!saved.startsWith("!")) return saved;
    if (now.getTime() - Date.parse(saved.slice(1)) < SYMBOL_RETRY_DAYS * 86_400_000) return null;
  }
  const found = await provider.resolveSymbol({ ticker: t.ticker, name: t.name, exchange: t.exchange, currency: t.currency });
  await savePriceSymbol(db, t.id, `${provider.id}:${found ?? `!${now.toISOString().slice(0, 10)}`}`);
  return found;
}

/**
 * Actualiza la cotización de todos los valores guardados. Se llama una vez
 * al abrir la app y con «Actualizar precios» (⌘R); nunca en bucle. De paso
 * renueva el histórico de los que lo tengan caducado (más de 30 días).
 * Cada valor va a su proveedor según su mercado (EE. UU. o Europa).
 */
export async function refreshPrices(
  db: Db,
  providers: PriceProvider | PriceProviders,
  only?: number,
  now = new Date(),
): Promise<RefreshResult> {
  const byMarket: PriceProviders = isProviders(providers) ? providers : { US: providers, EU: null };
  const result: RefreshResult = { updated: 0, histories: 0, failed: [] };
  const targets = (await listPriceTargets(db)).filter((t) => (only === undefined ? !peerQuoteFresh(t, now) : t.id === only));
  /** Mercados en los que ya no se sigue: sin clave o sin consultas para hoy. */
  const stopped = new Set<string>();
  for (const target of targets) {
    const provider = byMarket[target.market];
    if (!provider) {
      if (target.market === "EU" && !target.peer_only) {
        result.failed.push({ ticker: target.ticker, message: "Elige un proveedor de precios europeos en Ajustes." });
      }
      continue;
    }
    if (stopped.has(target.market)) continue;
    const reason = provider.unsupported?.({ ticker: target.ticker, name: target.name, exchange: target.exchange, currency: target.currency });
    if (reason) {
      if (!target.peer_only) result.failed.push({ ticker: target.ticker, message: reason });
      continue;
    }
    let symbol: string | null;
    try {
      symbol = await symbolFor(db, provider, target, now);
      if (!symbol) {
        result.failed.push({ ticker: target.ticker, message: `${provider.label} no tiene la cotización de ${target.ticker} (${target.name}).` });
        continue;
      }
      const q = await provider.quote(symbol);
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
      // Sin clave o sin consultas para hoy no tiene sentido seguir con el resto de ese mercado
      if (String(e).includes("Falta la clave") || e instanceof ProviderLimitError) stopped.add(target.market);
      continue;
    }
    try {
      if ((await syncPriceHistory(db, provider, { ...target, symbol })).status === "updated") result.histories++;
    } catch (e) {
      result.failed.push({ ticker: target.ticker, message: `Histórico: ${e instanceof Error ? e.message : String(e)}` });
      if (e instanceof ProviderLimitError) stopped.add(target.market);
    }
  }
  return result;
}
