import type { EuClient } from "@/data/esef/client";
import type { SecClient } from "@/data/sec-edgar/client";
import type { Db } from "@/db/client";
import { importEuIsin } from "./import-eu";
import { fundKindOf, importFundToWatchlist, type FundAddResult } from "./import-fund";
import { importUsTicker, ImportError, type ImportResult, type ImportStep } from "./import-us";
import { parseWatchlistEntry, splitWatchlistInput, type WatchlistEntry } from "./parse-input";

/**
 * Alta en la watchlist de uno o varios valores escritos de golpe. Cada uno se
 * procesa por separado: si uno falla, los demás siguen y el fallo se explica.
 */

export interface AddDeps {
  db: Db;
  eu: EuClient;
  /** Null si falta el User-Agent de la SEC (solo hace falta para EE. UU.). */
  sec: SecClient | null;
  /** Precio e histórico del valor recién añadido; devuelve los avisos. Un fallo aquí no anula el alta. */
  refreshPrices: (securityId: number) => Promise<string[]>;
  onEntry?: (entry: WatchlistEntry) => void;
  onStep?: (step: ImportStep) => void;
  onMarket?: (market: "US" | "EU") => void;
}

export type AddOutcome =
  | { input: string; ok: true; type: "stock"; market: "US" | "EU"; result: ImportResult; priceErrors: string[] }
  | { input: string; ok: true; type: "fund"; result: FundAddResult; priceErrors: string[] }
  | { input: string; ok: false; message: string };

const NEEDS_UA = "Antes de consultar la SEC, añade tu nombre y email en Ajustes (la SEC lo exige).";

async function addEntry(deps: AddDeps, entry: WatchlistEntry): Promise<AddOutcome> {
  const { db, eu } = deps;
  const prices = async (id: number) => deps.refreshPrices(id).catch((e: unknown) => [e instanceof Error ? e.message : String(e)]);

  if (entry.kind === "eu-ticker") {
    throw new ImportError(
      `${entry.ticker} (${entry.exchange}): las acciones europeas las identifico por su ISIN, que no deja dudas sobre la empresa. Búscalo en tu bróker o en la web de la bolsa y escríbelo aquí.`,
    );
  }
  let ticker = entry.kind === "us" ? entry.ticker : null;
  if (entry.kind === "isin") {
    deps.onMarket?.(entry.isin.startsWith("US") ? "US" : "EU");
    deps.onStep?.("ticker");
    const rows = await eu.figi(entry.isin);
    const fund = fundKindOf(rows);
    if (fund) {
      const result = await importFundToWatchlist(db, entry.isin, rows, fund);
      return { input: entry.raw, ok: true, type: "fund", result, priceErrors: await prices(result.securityId) };
    }
    if (!entry.isin.startsWith("US")) {
      const result = await importEuIsin(eu, db, entry.isin, deps.onStep);
      return { input: entry.raw, ok: true, type: "stock", market: "EU", result, priceErrors: await prices(result.securityId) };
    }
    const us = rows.find((r) => r.exchCode === "US" && r.ticker);
    if (!us?.ticker) throw new ImportError(`No encuentro qué ticker de EE. UU. corresponde al ISIN ${entry.isin}.`);
    ticker = us.ticker.replace(/\//g, ".");
  }
  deps.onMarket?.("US");
  if (!deps.sec) throw new ImportError(NEEDS_UA);
  const result = await importUsTicker(deps.sec, db, ticker!, deps.onStep);
  return { input: entry.raw, ok: true, type: "stock", market: "US", result, priceErrors: await prices(result.securityId) };
}

/** Procesa la lista en orden, uno a uno (la SEC y OpenFIGI limitan las peticiones por segundo). */
export async function addToWatchlist(deps: AddDeps, text: string, onDone?: (o: AddOutcome) => void): Promise<AddOutcome[]> {
  const out: AddOutcome[] = [];
  for (const raw of splitWatchlistInput(text)) {
    const entry = parseWatchlistEntry(raw);
    deps.onEntry?.(entry);
    let outcome: AddOutcome;
    try {
      outcome = await addEntry(deps, entry);
    } catch (e) {
      outcome = { input: raw, ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    out.push(outcome);
    onDone?.(outcome);
  }
  return out;
}
