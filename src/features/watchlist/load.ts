import type { Db } from "@/db/client";
import {
  getDocumentRequests,
  getFacts,
  getFilings,
  getFxRates,
  getGaps,
  getLatestQuote,
  getPriceBars,
  getPriceHistoryMeta,
  getSecurity,
  getSplits,
} from "@/db/repo";
import { buildAnalysis } from "./analysis";

/** Todo lo guardado de un valor y su análisis determinista. */
export async function loadSecurityDetail(db: Db, id: number) {
  const [security, filings, facts, gaps, monthly, splits, quote, priceMeta, requests, fx] = await Promise.all([
    getSecurity(db, id),
    getFilings(db, id),
    getFacts(db, id),
    getGaps(db, id),
    getPriceBars(db, id, "1mo"),
    getSplits(db, id),
    getLatestQuote(db, id),
    getPriceHistoryMeta(db, id),
    getDocumentRequests(db, id),
    getFxRates(db),
  ]);
  const analysis = security ? buildAnalysis({ security, filings, facts, monthly, splits, quote, priceMeta, fx }) : null;
  return { security, filings, facts, gaps, priceMeta, requests, analysis };
}

export type SecurityDetail = Awaited<ReturnType<typeof loadSecurityDetail>>;
