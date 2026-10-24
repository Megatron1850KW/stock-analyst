import type { PriceProvider } from "@/data/prices/provider";
import type { Db } from "@/db/client";
import { getPriceHistoryMeta, replacePriceBars, replaceSplits, savePriceHistoryMeta } from "@/db/repo";
import { HISTORY_YEARS } from "@/domain/fundamentals/history-filings";
import { aggregateBars } from "@/domain/technical/candles";

/** El histórico mensual apenas cambia: se vuelve a pedir como mucho una vez cada 30 días. */
export const HISTORY_MAX_AGE_DAYS = 30;

export interface HistoryTarget {
  id: number;
  ticker: string;
  currency: string;
}

export type HistorySyncResult =
  | { status: "skipped" }
  | { status: "updated"; months: number; firstDate: string | null; splitsChecked: boolean; note: string | null };

/** EDGAR usa BRK-B; los proveedores de precios, también con guion. */
export const providerSymbol = (ticker: string) => ticker.replace(/\./g, "-");

export function historyIsFresh(fetchedAt: string | null | undefined, today: Date): boolean {
  if (!fetchedAt) return false;
  return today.getTime() - Date.parse(fetchedAt) < HISTORY_MAX_AGE_DAYS * 86_400_000;
}

/**
 * Descarga ~11 años de cierres diarios, los guarda como velas semanales y
 * mensuales (no hace falta guardar el diario) y el historial de splits.
 * Si el proveedor no da splits, se sigue adelante y se anota.
 */
export async function syncPriceHistory(
  db: Db,
  provider: PriceProvider,
  target: HistoryTarget,
  { force = false, today = new Date() }: { force?: boolean; today?: Date } = {},
): Promise<HistorySyncResult> {
  const meta = await getPriceHistoryMeta(db, target.id);
  if (!force && meta?.source === provider.id && historyIsFresh(meta.fetched_at, today)) return { status: "skipped" };

  const symbol = providerSymbol(target.ticker);
  const from = `${today.getUTCFullYear() - HISTORY_YEARS}-01-01`;
  const daily = await provider.history(symbol, from);
  if (daily.length === 0) throw new Error(`${provider.label} no tiene histórico de precios de ${target.ticker}`);
  const monthly = aggregateBars(daily, "1mo");
  await replacePriceBars(db, target.id, "1mo", monthly, target.currency, provider.id);
  await replacePriceBars(db, target.id, "1w", aggregateBars(daily, "1w"), target.currency, provider.id);

  let splitsChecked = false;
  let note: string | null = null;
  try {
    await replaceSplits(db, target.id, await provider.splits(symbol), provider.id);
    splitsChecked = true;
  } catch (e) {
    note = `No se pudo consultar el historial de splits (${e instanceof Error ? e.message : String(e)}).`;
  }
  const firstDate = daily[0]!.date;
  await savePriceHistoryMeta(db, target.id, {
    source: provider.id,
    first_date: firstDate,
    last_date: daily[daily.length - 1]!.date,
    splits_checked: splitsChecked ? 1 : 0,
    note,
  });
  return { status: "updated", months: monthly.length, firstDate, splitsChecked, note };
}
