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
  /** Respaldo europeo (Yahoo Finance): si el principal no tiene el valor o se agota su cupo. */
  EUBackup?: PriceProvider | null;
}

export function providersFor(settings: { priceProvider: string | null; priceProviderEu: string | null; priceProviderEuBackup?: string | null }): PriceProviders {
  return { US: providerFor(settings.priceProvider), EU: providerFor(settings.priceProviderEu), EUBackup: providerFor(settings.priceProviderEuBackup ?? null) };
}

export const providersLabel = (p: PriceProviders) => [p.US?.label, p.EU?.label, p.EUBackup?.label].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " y $1");

/** Días que vale la cotización de un competidor: para compararlo no hace falta el precio de cada día, y así se ahorran consultas del plan gratuito. */
export const PEER_QUOTE_MAX_AGE_DAYS = 7;
/** Si un proveedor no cubre un valor, no se vuelve a buscar hasta pasado este tiempo. */
export const SYMBOL_RETRY_DAYS = 7;

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
  /** Proveedores con los que ya no se sigue: sin clave o sin consultas para hoy. */
  const stopped = new Set<string>();

  /** Intenta un proveedor: «ok», «skip» (no lo cubre, sin gastar más) o el error en llano. */
  async function tryProvider(provider: PriceProvider, target: PriceTarget): Promise<{ status: "ok" } | { status: "skip" | "error" | "stopped"; message: string }> {
    // Ya se avisó una vez de que se acabaron sus consultas: no se repite por cada valor
    if (stopped.has(provider.id)) return { status: "stopped", message: "" };
    const reason = provider.unsupported?.({ ticker: target.ticker, name: target.name, exchange: target.exchange, currency: target.currency });
    if (reason) return { status: "skip", message: reason };
    let symbol: string | null;
    try {
      symbol = await symbolFor(db, provider, target, now);
      if (!symbol) return { status: "skip", message: `${provider.label} no tiene la cotización de ${target.ticker} (${target.name}).` };
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
      // Sin clave o sin consultas para hoy no tiene sentido seguir con ese proveedor
      if (String(e).includes("Falta la clave") || e instanceof ProviderLimitError) stopped.add(provider.id);
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
    try {
      if ((await syncPriceHistory(db, provider, { ...target, symbol })).status === "updated") result.histories++;
    } catch (e) {
      result.failed.push({ ticker: target.ticker, message: `Histórico: ${e instanceof Error ? e.message : String(e)}` });
      if (e instanceof ProviderLimitError) stopped.add(provider.id);
    }
    return { status: "ok" };
  }

  for (const target of targets) {
    const primary = byMarket[target.market];
    const backup = target.market === "EU" ? (byMarket.EUBackup ?? null) : null;
    if (!primary && !backup) {
      if (target.market === "EU" && !target.peer_only) {
        result.failed.push({ ticker: target.ticker, message: "Elige un proveedor de precios europeos en Ajustes." });
      }
      continue;
    }
    // Un valor que ya va por el respaldo se queda en él: así no gasta consultas del principal
    const onBackup = !!backup && (target.price_symbol ?? "").startsWith(`${backup.id}:`) && !(target.price_symbol ?? "").startsWith(`${backup.id}:!`);
    const order = [onBackup ? backup : primary, onBackup ? null : backup].filter((p): p is PriceProvider => !!p);
    const messages: { status: "skip" | "error" | "stopped"; message: string }[] = [];
    let done = false;
    for (const provider of order) {
      const r = await tryProvider(provider, target);
      if (r.status === "ok") {
        done = true;
        break;
      }
      messages.push(r);
    }
    const told = messages.filter((m) => m.status !== "stopped");
    if (!done && told.length > 0 && !(target.peer_only && told.every((m) => m.status === "skip"))) {
      // Lo más útil: el error real si lo hubo; si no, por qué no lo cubre el principal
      const m = told.find((x) => x.status === "error") ?? told[0];
      if (m) result.failed.push({ ticker: target.ticker, message: m.message });
    }
  }
  return result;
}
