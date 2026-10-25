import type { EuClient } from "@/data/esef/client";
import type { FigiRow } from "@/data/esef/schemas";
import type { SecClient } from "@/data/sec-edgar/client";
import type { Db } from "@/db/client";
import { upsertFundSecurity } from "@/db/portfolio-repo";
import { currencyOfExchange, EXCHANGE_NAMES, importEuIsin } from "@/features/watchlist/import-eu";
import { importUsTicker, ImportError, looksLikeIsin, type ImportResult, type ImportStep } from "@/features/watchlist/import-us";

/**
 * Valor de una operación nueva (CLAUDE.md §5.2). Si ya está guardado, se usa
 * tal cual. Una acción nueva pasa por el mismo análisis de informes que la
 * watchlist (sin añadirla a ella); un ETF o ETC se identifica por su ISIN en
 * OpenFIGI y no tiene informes que analizar.
 */

export type HoldingKind = "stock" | "etf" | "etc";

export interface HoldingDeps {
  db: Db;
  eu: EuClient;
  /** Null si falta el User-Agent de la SEC (solo hace falta para acciones de EE. UU.). */
  sec: SecClient | null;
  onStep?: (step: ImportStep) => void;
  onMarket?: (market: "US" | "EU") => void;
}

export interface HoldingResult {
  securityId: number;
  /** Ya estaba guardado: no se ha descargado nada. */
  existing: boolean;
  kind: HoldingKind;
  currency: string;
  imported: ImportResult | null;
}

/**
 * Bolsas preferidas para un ETF/ETC: las europeas en euros primero (Londres
 * cotiza en varias divisas). OpenFIGI a veces da Xetra solo con el código
 * compuesto de Alemania (GR), p. ej. el SXRS de iShares (IE00BDFL4P12).
 */
const FUND_EXCHANGES = ["GY", "GR", "NA", "IM", "FP", "SM", "BB", "SW", "LN"];

export function pickFundListing(rows: FigiRow[]): FigiRow | null {
  const listed = rows.filter((r) => r.ticker && r.exchCode);
  for (const code of FUND_EXCHANGES) {
    const hit = listed.find((r) => r.exchCode === code);
    if (hit) return hit;
  }
  return listed.find((r) => r.exchCode! in EXCHANGE_NAMES) ?? null;
}

async function findExisting(db: Db, input: string): Promise<{ id: number; kind: HoldingKind; currency: string } | null> {
  const rows = looksLikeIsin(input)
    ? await db.select<{ id: number; kind: HoldingKind; currency: string }>("SELECT id, kind, currency FROM securities WHERE isin = ?", [input])
    : await db.select<{ id: number; kind: HoldingKind; currency: string }>(
        "SELECT id, kind, currency FROM securities WHERE UPPER(ticker) = ? ORDER BY (market = 'US') DESC LIMIT 1",
        [input],
      );
  return rows[0] ?? null;
}

export async function findOrImportHolding(deps: HoldingDeps, rawInput: string, kind: HoldingKind, today = new Date()): Promise<HoldingResult> {
  const { db, eu } = deps;
  const input = rawInput.trim().toUpperCase();
  if (!input) throw new ImportError("Escribe el ticker o el ISIN.");
  const found = await findExisting(db, input);
  if (found) return { securityId: found.id, existing: true, kind: found.kind, currency: found.currency, imported: null };

  if (kind !== "stock") {
    if (!looksLikeIsin(input)) throw new ImportError(`Para un ${kind.toUpperCase()} escribe su ISIN (12 caracteres, p. ej. IE00B4L5Y983): es lo que lo identifica sin ambigüedad.`);
    deps.onMarket?.("EU");
    deps.onStep?.("ticker");
    const listing = pickFundListing(await eu.figi(input));
    if (!listing?.ticker) throw new ImportError(`No encuentro en qué bolsa europea cotiza el ISIN ${input}.`);
    const currency = currencyOfExchange(listing.exchCode);
    const securityId = await upsertFundSecurity(db, {
      isin: input,
      figi: listing.compositeFIGI ?? listing.figi,
      ticker: listing.ticker,
      name: listing.name ?? input,
      exchange: listing.exchCode ?? null,
      currency,
      kind,
    });
    return { securityId, existing: false, kind, currency, imported: null };
  }

  let ticker = input;
  if (looksLikeIsin(input)) {
    if (!input.startsWith("US")) {
      deps.onMarket?.("EU");
      const imported = await importEuIsin(eu, db, input, deps.onStep, today, { watchlist: false, held: true });
      const [row] = await db.select<{ currency: string }>("SELECT currency FROM securities WHERE id = ?", [imported.securityId]);
      return { securityId: imported.securityId, existing: false, kind, currency: row!.currency, imported };
    }
    deps.onStep?.("ticker");
    const us = (await eu.figi(input)).find((r) => r.exchCode === "US" && r.ticker);
    if (!us?.ticker) throw new ImportError(`No encuentro qué ticker de EE. UU. corresponde al ISIN ${input}.`);
    ticker = us.ticker.replace(/\//g, ".");
  }
  deps.onMarket?.("US");
  if (!deps.sec) throw new ImportError("Antes de consultar la SEC, añade tu nombre y email en Ajustes (la SEC lo exige).");
  const imported = await importUsTicker(deps.sec, db, ticker, deps.onStep, today, { watchlist: false, held: true });
  const [row] = await db.select<{ currency: string }>("SELECT currency FROM securities WHERE id = ?", [imported.securityId]);
  return { securityId: imported.securityId, existing: false, kind, currency: row!.currency, imported };
}
