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

/**
 * Alta o actualización de un valor de EE. UU. (identificado por su CIK). Lo añade
 * a la watchlist, salvo los competidores (`watchlist = false`), que se guardan
 * aparte; un valor que ya estaba en la watchlist no sale de ella.
 */
export async function upsertUsSecurity(db: Db, s: UsSecurityInput, watchlist = true): Promise<number> {
  const existing = await db.select<{ id: number }>("SELECT id FROM securities WHERE cik = ?", [s.cik]);
  const values = [s.ticker, s.name, s.exchange, s.currency, s.sic, s.sicDescription, s.fiscalYearEnd, s.filerType, s.reportingCurrency];
  if (existing[0]) {
    await db.execute(
      `UPDATE securities SET ticker = ?, name = ?, exchange = ?, currency = ?, sic = ?, sic_description = ?,
         fiscal_year_end = ?, filer_type = ?, reporting_currency = ?, market = 'US', in_watchlist = MAX(in_watchlist, ?), updated_at = ?
       WHERE id = ?`,
      [...values, watchlist ? 1 : 0, now(), existing[0].id],
    );
    return existing[0].id;
  }
  await db.execute(
    `INSERT INTO securities (ticker, name, exchange, currency, sic, sic_description, fiscal_year_end, filer_type,
       reporting_currency, cik, kind, market, in_watchlist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stock', 'US', ?)`,
    [...values, s.cik, watchlist ? 1 : 0],
  );
  const rows = await db.select<{ id: number }>("SELECT id FROM securities WHERE cik = ?", [s.cik]);
  return rows[0]!.id;
}

export async function upsertFiling(
  db: Db,
  securityId: number,
  f: FilingRef,
  url: string,
  role: "core" | "history" = "core",
): Promise<number> {
  const fiscalPeriod = f.periodType === "annual" ? "FY" : null;
  await db.execute(
    `INSERT INTO filings (security_id, form_type, period_type, period_end, fiscal_period, filed_at, source, accession_no, url, fetched_at, role)
     VALUES (?, ?, ?, ?, ?, ?, 'sec-edgar', ?, ?, ?, ?)
     ON CONFLICT (security_id, source, accession_no) DO UPDATE SET
       form_type = excluded.form_type, period_type = excluded.period_type, period_end = excluded.period_end,
       filed_at = excluded.filed_at, url = excluded.url, fetched_at = excluded.fetched_at, role = excluded.role`,
    [securityId, f.form, f.periodType, f.reportDate, fiscalPeriod, f.filingDate, f.accession, url, now(), role],
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
       (SELECT COUNT(*) FROM filings f WHERE f.security_id = s.id AND f.role = 'core' AND f.period_type = 'annual') AS annual_count,
       (SELECT COUNT(*) FROM filings f WHERE f.security_id = s.id AND f.role = 'core' AND f.period_type = 'interim') AS interim_count,
       (SELECT COUNT(DISTINCT g.concept) FROM concept_gaps g
          JOIN filings f ON f.id = g.filing_id
          WHERE g.security_id = s.id AND f.period_end = (SELECT MAX(period_end) FROM filings WHERE security_id = s.id AND role = 'core' AND period_type = 'annual')) AS gap_count,
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
  role: "core" | "history" | "upload";
  source: string;
  local_path: string | null;
  original_name: string | null;
  bytes: number | null;
}

export function getFilings(db: Db, securityId: number): Promise<FilingRow[]> {
  return db.select<FilingRow>(
    `SELECT id, form_type, period_type, period_end, filed_at, accession_no, url, fetched_at, role, source, local_path, original_name, bytes
     FROM filings WHERE security_id = ? ORDER BY role, period_type, period_end DESC`,
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

/**
 * Quita un valor de la watchlist. Si no está en la cartera ni es competidor de
 * otro valor guardado, se borran también sus datos (y los de sus competidores
 * que ya no hagan falta).
 */
export async function removeFromWatchlist(db: Db, id: number): Promise<void> {
  const peers = await db.select<{ peer_id: number }>("SELECT peer_id FROM peers WHERE security_id = ?", [id]);
  await db.execute("UPDATE securities SET in_watchlist = 0 WHERE id = ?", [id]);
  await db.execute("DELETE FROM peers WHERE security_id = ?", [id]);
  for (const sid of [id, ...peers.map((p) => p.peer_id)]) await deleteIfUnused(db, sid);
}

/** Borra un valor si ya no se usa (fuera de la watchlist, sin operaciones y sin ser competidor de nadie). */
export async function deleteIfUnused(db: Db, id: number): Promise<void> {
  await db.execute(
    `DELETE FROM securities WHERE id = ? AND in_watchlist = 0
       AND id NOT IN (SELECT security_id FROM transactions)
       AND id NOT IN (SELECT peer_id FROM peers)`,
    [id],
  );
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

export interface PriceTarget {
  id: number;
  ticker: string;
  currency: string;
  /** Solo es competidor de otro valor (ni watchlist ni cartera). */
  peer_only: number;
  /** Cuándo se pidió su última cotización. */
  quote_fetched_at: string | null;
}

export function listPriceTargets(db: Db): Promise<PriceTarget[]> {
  return db.select(
    `SELECT s.id, s.ticker, s.currency,
       (s.in_watchlist = 0 AND s.id NOT IN (SELECT security_id FROM transactions)) AS peer_only,
       (SELECT MAX(fetched_at) FROM prices p WHERE p.security_id = s.id AND p.interval = '1d') AS quote_fetched_at
     FROM securities s WHERE s.ticker IS NOT NULL AND s.market = 'US' ORDER BY s.ticker`,
  );
}

export interface BarRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

const BARS_PER_INSERT = 80; // 800 parámetros por sentencia

/** Sustituye las velas de un intervalo ('1w' o '1mo') de un valor. */
export async function replacePriceBars(
  db: Db,
  securityId: number,
  interval: "1w" | "1mo",
  bars: BarRow[],
  currency: string,
  source: string,
): Promise<void> {
  await db.execute("DELETE FROM prices WHERE security_id = ? AND interval = ?", [securityId, interval]);
  const fetchedAt = now();
  for (let k = 0; k < bars.length; k += BARS_PER_INSERT) {
    const chunk = bars.slice(k, k + BARS_PER_INSERT);
    await db.execute(
      `INSERT INTO prices (security_id, interval, date, open, high, low, close, volume, currency, source, fetched_at)
       VALUES ${chunk.map(() => `(?, '${interval}', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", ")}`,
      chunk.flatMap((b) => [securityId, b.date, b.open, b.high, b.low, b.close, b.volume, currency, source, fetchedAt]),
    );
  }
}

export function getPriceBars(db: Db, securityId: number, interval: "1d" | "1w" | "1mo"): Promise<BarRow[]> {
  return db.select<BarRow>(
    "SELECT date, open, high, low, close, volume FROM prices WHERE security_id = ? AND interval = ? ORDER BY date",
    [securityId, interval],
  );
}

export interface LatestQuoteRow {
  date: string;
  close: number;
  currency: string;
  source: string;
  fetched_at: string;
}

export async function getLatestQuote(db: Db, securityId: number): Promise<LatestQuoteRow | null> {
  const rows = await db.select<LatestQuoteRow>(
    `SELECT date, close, currency, source, fetched_at FROM prices
     WHERE security_id = ? AND interval = '1d' ORDER BY date DESC LIMIT 1`,
    [securityId],
  );
  return rows[0] ?? null;
}

export interface SplitRow {
  date: string;
  numerator: number;
  denominator: number;
}

export async function replaceSplits(db: Db, securityId: number, splits: SplitRow[], source: string): Promise<void> {
  await db.execute("DELETE FROM splits WHERE security_id = ?", [securityId]);
  for (const s of splits) {
    await db.execute(
      "INSERT OR REPLACE INTO splits (security_id, date, numerator, denominator, source) VALUES (?, ?, ?, ?, ?)",
      [securityId, s.date, s.numerator, s.denominator, source],
    );
  }
}

export function getSplits(db: Db, securityId: number): Promise<SplitRow[]> {
  return db.select<SplitRow>("SELECT date, numerator, denominator FROM splits WHERE security_id = ? ORDER BY date", [securityId]);
}

export interface PriceHistoryMeta {
  source: string;
  first_date: string | null;
  last_date: string | null;
  splits_checked: 0 | 1;
  note: string | null;
  fetched_at: string;
}

export async function getPriceHistoryMeta(db: Db, securityId: number): Promise<PriceHistoryMeta | null> {
  const rows = await db.select<PriceHistoryMeta>(
    "SELECT source, first_date, last_date, splits_checked, note, fetched_at FROM price_history_meta WHERE security_id = ?",
    [securityId],
  );
  return rows[0] ?? null;
}

export async function savePriceHistoryMeta(db: Db, securityId: number, m: Omit<PriceHistoryMeta, "fetched_at">): Promise<void> {
  await db.execute(
    `INSERT INTO price_history_meta (security_id, source, first_date, last_date, splits_checked, note, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (security_id) DO UPDATE SET source = excluded.source, first_date = excluded.first_date,
       last_date = excluded.last_date, splits_checked = excluded.splits_checked, note = excluded.note, fetched_at = excluded.fetched_at`,
    [securityId, m.source, m.first_date, m.last_date, m.splits_checked, m.note, now()],
  );
}

export interface UploadInput {
  securityId: number;
  periodType: "annual" | "interim";
  periodEnd: string;
  /** Cómo se muestra el informe: «Informe anual (PDF)», «Semestral (ZIP ESEF)»… */
  label: string;
  path: string;
  sha256: string;
  bytes: number;
  originalName: string;
}

/** Registra un informe subido por el usuario (el mismo archivo dos veces no se duplica). */
export async function saveUpload(db: Db, u: UploadInput): Promise<number> {
  const accession = `upload-${u.sha256.slice(0, 16)}`;
  await db.execute(
    `INSERT INTO filings (security_id, form_type, period_type, period_end, fiscal_period, filed_at, source, accession_no,
       local_path, content_hash, bytes, original_name, role, fetched_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'user-upload', ?, ?, ?, ?, ?, 'upload', ?)
     ON CONFLICT (security_id, source, accession_no) DO UPDATE SET
       form_type = excluded.form_type, period_type = excluded.period_type, period_end = excluded.period_end,
       fiscal_period = excluded.fiscal_period, original_name = excluded.original_name`,
    [u.securityId, u.label, u.periodType, u.periodEnd, u.periodType === "annual" ? "FY" : null, accession, u.path, u.sha256, u.bytes, u.originalName, now()],
  );
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM filings WHERE security_id = ? AND source = 'user-upload' AND accession_no = ?",
    [u.securityId, accession],
  );
  return rows[0]!.id;
}

/** Borra un informe subido y devuelve su ruta para quitar también el archivo. */
export async function deleteUpload(db: Db, filingId: number): Promise<string | null> {
  const rows = await db.select<{ local_path: string | null }>(
    "SELECT local_path FROM filings WHERE id = ? AND source = 'user-upload'",
    [filingId],
  );
  if (!rows[0]) return null;
  await db.execute(
    "UPDATE document_requests SET status = 'pending', filing_id = NULL, resolved_at = NULL WHERE filing_id = ?",
    [filingId],
  );
  await db.execute("DELETE FROM filings WHERE id = ?", [filingId]);
  return rows[0].local_path;
}

export interface DocumentRequestInput {
  documentType: string;
  period: string;
  expectedDate: string | null;
  preferredFormat: string;
  whereToFind: string;
}

export interface DocumentRequestRow {
  id: number;
  security_id: number;
  document_type: string;
  period: string;
  expected_date: string | null;
  preferred_format: string | null;
  where_to_find: string | null;
  status: "pending" | "fulfilled" | "dismissed";
  filing_id: number | null;
  created_at: string;
}

export function getDocumentRequests(db: Db, securityId?: number): Promise<DocumentRequestRow[]> {
  return db.select<DocumentRequestRow>(
    `SELECT id, security_id, document_type, period, expected_date, preferred_format, where_to_find, status, filing_id, created_at
     FROM document_requests ${securityId === undefined ? "" : "WHERE security_id = ?"}
     ORDER BY status = 'pending' DESC, period DESC`,
    securityId === undefined ? [] : [securityId],
  );
}

/**
 * Deja las solicitudes automáticas de un valor como dice la última
 * comprobación: añade las nuevas, conserva las atendidas o descartadas y
 * retira las pendientes que ya no hacen falta.
 */
export async function syncDocumentRequests(db: Db, securityId: number, wanted: DocumentRequestInput[]): Promise<void> {
  const existing = await getDocumentRequests(db, securityId);
  const key = (type: string, period: string) => `${type}|${period}`;
  const wantedKeys = new Set(wanted.map((w) => key(w.documentType, w.period)));
  for (const r of existing) {
    if (r.status === "pending" && !wantedKeys.has(key(r.document_type, r.period))) {
      await db.execute("DELETE FROM document_requests WHERE id = ?", [r.id]);
    }
  }
  const have = new Set(existing.map((r) => key(r.document_type, r.period)));
  for (const w of wanted) {
    if (have.has(key(w.documentType, w.period))) continue;
    await db.execute(
      `INSERT INTO document_requests (security_id, document_type, period, expected_date, preferred_format, where_to_find)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [securityId, w.documentType, w.period, w.expectedDate, w.preferredFormat, w.whereToFind],
    );
  }
}

export async function resolveDocumentRequest(db: Db, id: number, status: "fulfilled" | "dismissed", filingId: number | null = null): Promise<void> {
  await db.execute("UPDATE document_requests SET status = ?, filing_id = ?, resolved_at = ? WHERE id = ?", [status, filingId, now(), id]);
}

export function countPendingRequests(db: Db): Promise<{ security_id: number; n: number }[]> {
  return db.select("SELECT security_id, COUNT(*) AS n FROM document_requests WHERE status = 'pending' GROUP BY security_id");
}

/** Copia local de un informe de la SEC ya descargado (CLAUDE.md §7: no volver a pedirlo). */
export async function setFilingLocalPath(db: Db, url: string, path: string): Promise<void> {
  await db.execute("UPDATE filings SET local_path = ? WHERE url = ? AND source = 'sec-edgar'", [path, url]);
}
