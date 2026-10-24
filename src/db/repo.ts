import type { NormalizedFact, ConceptGap } from "@/domain/fundamentals/normalize";
import type { FilingRef } from "@/domain/fundamentals/select-filings";
import type { Db } from "./client";

export interface UsSecurityInput {
  ticker: string;
  cik: string;
  name: string;
  exchange: string | null;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  filerType: "domestic" | "foreign";
  currency: string;
  reportingCurrency: string | null;
}

const now = () => new Date().toISOString();

/** Alta o actualización de un valor de EE. UU. (identificado por su CIK). Lo añade a la watchlist. */
export async function upsertUsSecurity(db: Db, s: UsSecurityInput): Promise<number> {
  const existing = await db.select<{ id: number }>("SELECT id FROM securities WHERE cik = ?", [s.cik]);
  const values = [s.ticker, s.name, s.exchange, s.currency, s.sic, s.sicDescription, s.fiscalYearEnd, s.filerType, s.reportingCurrency];
  if (existing[0]) {
    await db.execute(
      `UPDATE securities SET ticker = ?, name = ?, exchange = ?, currency = ?, sic = ?, sic_description = ?,
         fiscal_year_end = ?, filer_type = ?, reporting_currency = ?, market = 'US', in_watchlist = 1, updated_at = ?
       WHERE id = ?`,
      [...values, now(), existing[0].id],
    );
    return existing[0].id;
  }
  await db.execute(
    `INSERT INTO securities (ticker, name, exchange, currency, sic, sic_description, fiscal_year_end, filer_type,
       reporting_currency, cik, kind, market, in_watchlist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stock', 'US', 1)`,
    [...values, s.cik],
  );
  const rows = await db.select<{ id: number }>("SELECT id FROM securities WHERE cik = ?", [s.cik]);
  return rows[0]!.id;
}

export async function upsertFiling(db: Db, securityId: number, f: FilingRef, url: string): Promise<number> {
  const fiscalPeriod = f.periodType === "annual" ? "FY" : null;
  await db.execute(
    `INSERT INTO filings (security_id, form_type, period_type, period_end, fiscal_period, filed_at, source, accession_no, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, 'sec-edgar', ?, ?, ?)
     ON CONFLICT (security_id, source, accession_no) DO UPDATE SET
       form_type = excluded.form_type, period_type = excluded.period_type, period_end = excluded.period_end,
       filed_at = excluded.filed_at, url = excluded.url, fetched_at = excluded.fetched_at`,
    [securityId, f.form, f.periodType, f.reportDate, fiscalPeriod, f.filingDate, f.accession, url, now()],
  );
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM filings WHERE security_id = ? AND source = 'sec-edgar' AND accession_no = ?",
    [securityId, f.accession],
  );
  return rows[0]!.id;
}

const FACT_COLUMNS = 9;
const FACTS_PER_INSERT = 100; // 900 parámetros por sentencia, por debajo del límite de SQLite

/** Sustituye las cifras de un informe (re-importar no duplica). */
export async function replaceFilingFacts(
  db: Db,
  securityId: number,
  filingId: number,
  facts: NormalizedFact[],
  gaps: ConceptGap[],
): Promise<void> {
  await db.execute("DELETE FROM financial_facts WHERE filing_id = ?", [filingId]);
  await db.execute("DELETE FROM concept_gaps WHERE filing_id = ?", [filingId]);
  const fetchedAt = now();
  for (let k = 0; k < facts.length; k += FACTS_PER_INSERT) {
    const chunk = facts.slice(k, k + FACTS_PER_INSERT);
    const placeholders = chunk.map(() => `(${Array(FACT_COLUMNS).fill("?").join(", ")}, 'xbrl')`).join(", ");
    const params = chunk.flatMap((f) => [
      securityId, filingId, f.concept, f.sourceTag, f.value, f.unit, f.periodStart, f.periodEnd, fetchedAt,
    ]);
    await db.execute(
      `INSERT INTO financial_facts (security_id, filing_id, concept, source_tag, value, unit, period_start, period_end, fetched_at, origin)
       VALUES ${placeholders}`,
      params,
    );
  }
  for (const gap of gaps) {
    await db.execute("INSERT OR IGNORE INTO concept_gaps (security_id, filing_id, concept) VALUES (?, ?, ?)", [
      securityId, filingId, gap.concept,
    ]);
  }
}

/** Borra los informes de la SEC de un valor que ya no están entre los elegidos. */
export async function pruneFilings(db: Db, securityId: number, keepAccessions: string[]): Promise<void> {
  const placeholders = keepAccessions.map(() => "?").join(", ") || "''";
  await db.execute(
    `DELETE FROM filings WHERE security_id = ? AND source = 'sec-edgar' AND accession_no NOT IN (${placeholders})`,
    [securityId, ...keepAccessions],
  );
}

export interface WatchlistRow {
  id: number;
  ticker: string;
  name: string;
  exchange: string | null;
  currency: string;
  filer_type: string | null;
  annual_count: number;
  interim_count: number;
  gap_count: number;
  price: number | null;
  price_date: string | null;
  price_source: string | null;
  price_fetched_at: string | null;
  updated_at: string;
}

export function listWatchlist(db: Db): Promise<WatchlistRow[]> {
  return db.select<WatchlistRow>(
    `SELECT s.id, s.ticker, s.name, s.exchange, s.currency, s.filer_type, s.updated_at,
       (SELECT COUNT(*) FROM filings f WHERE f.security_id = s.id AND f.period_type = 'annual') AS annual_count,
       (SELECT COUNT(*) FROM filings f WHERE f.security_id = s.id AND f.period_type = 'interim') AS interim_count,
       (SELECT COUNT(DISTINCT g.concept) FROM concept_gaps g
          JOIN filings f ON f.id = g.filing_id
          WHERE g.security_id = s.id AND f.period_end = (SELECT MAX(period_end) FROM filings WHERE security_id = s.id AND period_type = 'annual')) AS gap_count,
       p.close AS price, p.date AS price_date, p.source AS price_source, p.fetched_at AS price_fetched_at
     FROM securities s
     LEFT JOIN prices p ON p.security_id = s.id AND p.interval = '1d'
       AND p.date = (SELECT MAX(date) FROM prices WHERE security_id = s.id AND interval = '1d')
     WHERE s.in_watchlist = 1
     ORDER BY s.ticker`,
  );
}

export interface SecurityRow {
  id: number;
  ticker: string;
  name: string;
  cik: string | null;
  exchange: string | null;
  currency: string;
  reporting_currency: string | null;
  sic: string | null;
  sic_description: string | null;
  fiscal_year_end: string | null;
  filer_type: string | null;
  updated_at: string;
}

export async function getSecurity(db: Db, id: number): Promise<SecurityRow | null> {
  const rows = await db.select<SecurityRow>(
    `SELECT id, ticker, name, cik, exchange, currency, reporting_currency, sic, sic_description, fiscal_year_end, filer_type, updated_at
     FROM securities WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

export interface FilingRow {
  id: number;
  form_type: string;
  period_type: "annual" | "interim";
  period_end: string;
  filed_at: string | null;
  accession_no: string;
  url: string | null;
  fetched_at: string;
}

export function getFilings(db: Db, securityId: number): Promise<FilingRow[]> {
  return db.select<FilingRow>(
    `SELECT id, form_type, period_type, period_end, filed_at, accession_no, url, fetched_at
     FROM filings WHERE security_id = ? ORDER BY period_type, period_end DESC`,
    [securityId],
  );
}

export interface FactRow {
  filing_id: number;
  concept: string;
  source_tag: string | null;
  value: number;
  unit: string;
  period_start: string | null;
  period_end: string;
  origin: string;
  fetched_at: string;
}

export function getFacts(db: Db, securityId: number): Promise<FactRow[]> {
  return db.select<FactRow>(
    `SELECT filing_id, concept, source_tag, value, unit, period_start, period_end, origin, fetched_at
     FROM financial_facts WHERE security_id = ?`,
    [securityId],
  );
}

export function getGaps(db: Db, securityId: number): Promise<{ filing_id: number; concept: string }[]> {
  return db.select("SELECT filing_id, concept FROM concept_gaps WHERE security_id = ?", [securityId]);
}

/** Quita un valor de la watchlist. Si no está en la cartera, se borran también sus datos. */
export async function removeFromWatchlist(db: Db, id: number): Promise<void> {
  const tx = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE security_id = ?", [id]);
  if ((tx[0]?.n ?? 0) > 0) await db.execute("UPDATE securities SET in_watchlist = 0 WHERE id = ?", [id]);
  else await db.execute("DELETE FROM securities WHERE id = ?", [id]);
}

export interface QuoteInput {
  securityId: number;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  currency: string;
  source: string;
}

export async function saveQuote(db: Db, q: QuoteInput): Promise<void> {
  await db.execute(
    `INSERT INTO prices (security_id, date, interval, open, high, low, close, volume, currency, source, fetched_at)
     VALUES (?, ?, '1d', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (security_id, interval, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
       volume = excluded.volume, source = excluded.source, fetched_at = excluded.fetched_at`,
    [q.securityId, q.date, q.open, q.high, q.low, q.close, q.volume, q.currency, q.source, now()],
  );
}

export function listPriceTargets(db: Db): Promise<{ id: number; ticker: string; currency: string }[]> {
  return db.select("SELECT id, ticker, currency FROM securities WHERE ticker IS NOT NULL AND market = 'US' ORDER BY ticker");
}
