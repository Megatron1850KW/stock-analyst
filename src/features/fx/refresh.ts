import { FX_SOURCE, type FxClient } from "@/data/fx/frankfurter";
import type { Db } from "@/db/client";
import { getFxCoverage, saveFxRates } from "@/db/repo";
import { majorUnit } from "@/domain/portfolio/fx";

/**
 * Tipos de cambio que necesita tu cartera (CLAUDE.md §4.3): las divisas de tus
 * operaciones y de las cotizaciones de lo que tienes, desde la primera
 * operación. Se piden al abrir la app o al actualizar precios, y solo lo que
 * falta desde la última fecha guardada.
 */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const minus = (date: string, days: number) => iso(new Date(Date.parse(date) - days * DAY));

/** Divisas con tipo de referencia del BCE (las demás no se pueden pedir a Frankfurter). */
const ECB_CURRENCIES = new Set(
  "USD JPY BGN CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR".split(" "),
);
/** Historia de tipos para valorar contra 10 años de precios (con margen). */
const VALUATION_YEARS = 11;

export async function neededCurrencies(db: Db, today = new Date()): Promise<{ currency: string; since: string }[]> {
  const rows = await db.select<{ currency: string; since: string }>(
    `SELECT t.currency AS currency, MIN(t.trade_date) AS since FROM transactions t GROUP BY t.currency
     UNION ALL
     SELECT s.currency, MIN(t.trade_date) FROM transactions t JOIN securities s ON s.id = t.security_id GROUP BY s.currency`,
  );
  // Valores que publican en una divisa y cotizan en otra (p. ej. Rio Tinto: dólares y peniques)
  const mixed = await db.select<{ reporting: string; price: string }>(
    `SELECT DISTINCT f.unit AS reporting, s.currency AS price FROM financial_facts f JOIN securities s ON s.id = f.security_id
     WHERE f.concept = 'revenue' AND (s.in_watchlist = 1 OR s.id IN (SELECT security_id FROM transactions))`,
  );
  const valuationSince = minus(iso(today), VALUATION_YEARS * 366);
  for (const r of mixed) {
    const pair = [majorUnit(r.reporting).currency, majorUnit(r.price).currency];
    if (pair[0] === pair[1] || !pair.every((c) => c === "EUR" || ECB_CURRENCIES.has(c))) continue;
    for (const currency of pair) rows.push({ currency, since: valuationSince });
  }
  const m = new Map<string, string>();
  for (const r of rows) {
    const cur = majorUnit(r.currency).currency;
    if (cur === "EUR") continue;
    const prev = m.get(cur);
    if (!prev || r.since < prev) m.set(cur, r.since);
  }
  return [...m.entries()].map(([currency, since]) => ({ currency, since })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface FxRefreshResult {
  saved: number;
  currencies: string[];
}

export async function refreshFx(db: Db, client: FxClient, today = new Date()): Promise<FxRefreshResult> {
  const needed = await neededCurrencies(db, today);
  if (needed.length === 0) return { saved: 0, currencies: [] };
  const coverage = new Map((await getFxCoverage(db)).map((c) => [c.quote, c]));
  const todayIso = iso(today);
  // Agrupa por fecha de inicio: normalmente es una sola consulta
  const byFrom = new Map<string, string[]>();
  for (const { currency, since } of needed) {
    const c = coverage.get(currency);
    // Una semana antes de la primera operación, por si fue en fin de semana o festivo
    const wantFrom = minus(since, 7);
    const from = c && c.first <= since ? c.last : wantFrom;
    if (from >= todayIso) continue;
    byFrom.set(from, [...(byFrom.get(from) ?? []), currency]);
  }
  let saved = 0;
  for (const [from, currencies] of byFrom) {
    const rates = await client.series(from, currencies);
    await saveFxRates(db, rates, FX_SOURCE);
    saved += rates.length;
  }
  return { saved, currencies: needed.map((n) => n.currency) };
}
