import type { FigiRow } from "@/data/esef/schemas";
import type { Db } from "@/db/client";
import { upsertFundSecurity } from "@/db/portfolio-repo";
import { syncDocumentRequests, type DocumentRequestInput } from "@/db/repo";
import { pickFundListing } from "@/features/portfolio/add-holding";
import { FUND_SHEET_REQUEST } from "@/features/portfolio/fund-profile";
import { currencyOfExchange } from "./import-eu";
import { ImportError } from "./import-us";

/**
 * Alta de un ETF o ETC en la watchlist (CLAUDE.md §5.5). No tiene informes
 * anuales ni trimestrales: su ficha (TER, índice, réplica, posiciones) sale de
 * la ficha mensual o el KID, que se pide en «Documentos pendientes» con un
 * enlace para descargarla. La app no lee justETF: solo enlaza a su página.
 */

/** ETF/ETC según OpenFIGI (tipo «ETP» o fondo); null si es una acción. */
export function fundKindOf(rows: FigiRow[]): "etf" | "etc" | null {
  const fund = rows.find((r) => /\b(ETP|ETF|ETC|ETN|FUND)\b/i.test(`${r.securityType ?? ""} ${r.securityType2 ?? ""}`));
  if (!fund) return null;
  const etc = rows.some((r) => r.marketSector === "Comdty" || /\b(ETC|ETN)\b|PHYSICAL|XETRA-GOLD/i.test(`${r.name ?? ""} ${r.securityType ?? ""}`));
  return etc ? "etc" : "etf";
}

export function justEtfUrl(isin: string): string {
  return `https://www.justetf.com/es/etf-profile.html?isin=${isin}`;
}

export function fundSheetRequest(isin: string, kind: "etf" | "etc"): DocumentRequestInput {
  return {
    documentType: FUND_SHEET_REQUEST,
    period: "última",
    expectedDate: null,
    preferredFormat: "PDF",
    whereToFind:
      kind === "etf"
        ? `Su página en justETF (${justEtfUrl(isin)}), apartado «Documentos», o la web de la gestora. Con ella sabré su coste (TER), qué índice sigue y en qué invierte.`
        : `La web del emisor del ETC (busca el ISIN ${isin}) o justETF (${justEtfUrl(isin)}). Con ella sabré su coste (TER), qué materia prima sigue y su colateral.`,
  };
}

export interface FundAddResult {
  securityId: number;
  ticker: string;
  name: string;
  kind: "etf" | "etc";
  exchange: string | null;
  requests: number;
}

/** `rows`: respuesta de OpenFIGI para el ISIN, ya pedida para saber si es un fondo. */
export async function importFundToWatchlist(db: Db, isin: string, rows: FigiRow[], kind: "etf" | "etc"): Promise<FundAddResult> {
  const listing = pickFundListing(rows);
  if (!listing?.ticker) throw new ImportError(`No encuentro en qué bolsa europea cotiza el ${kind.toUpperCase()} ${isin}.`);
  const securityId = await upsertFundSecurity(db, {
    isin,
    figi: listing.compositeFIGI ?? listing.figi,
    ticker: listing.ticker,
    name: listing.name ?? isin,
    exchange: listing.exchCode ?? null,
    currency: currencyOfExchange(listing.exchCode),
    kind,
    watchlist: true,
  });
  const [profile] = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM fund_profiles WHERE security_id = ?", [securityId]);
  const wanted = profile!.n > 0 ? [] : [fundSheetRequest(isin, kind)];
  await syncDocumentRequests(db, securityId, wanted);
  return { securityId, ticker: listing.ticker, name: listing.name ?? isin, kind, exchange: listing.exchCode ?? null, requests: wanted.length };
}
