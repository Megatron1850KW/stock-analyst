import type { Db } from "./client";

/** Calendario de resultados, informes nuevos detectados y estado de la app (fase 10). */

export interface TrackedStock {
  id: number;
  ticker: string;
  name: string;
  isin: string | null;
  cik: string | null;
  lei: string | null;
  market: string | null;
  filer_type: "domestic" | "foreign" | null;
  in_watchlist: number;
  held: number;
}

/** Acciones que sigues o tienes (los ETFs/ETCs no publican resultados). */
export function listTrackedStocks(db: Db): Promise<TrackedStock[]> {
  return db.select(
    `SELECT id, COALESCE(ticker, isin) AS ticker, name, isin, cik, lei, market, filer_type, in_watchlist,
       (id IN (SELECT security_id FROM transactions)) AS held
     FROM securities
     WHERE kind = 'stock' AND (in_watchlist = 1 OR id IN (SELECT security_id FROM transactions))
     ORDER BY ticker`,
  );
}

export interface CalendarInput {
  securityId: number;
  expectedDate: string;
  label: string;
  basis: string;
}

/** Sustituye las fechas estimadas de un valor (las que pongas tú o el proveedor se respetan). */
export async function replaceInferredDate(db: Db, securityId: number, e: Omit<CalendarInput, "securityId"> | null): Promise<void> {
  await db.execute("DELETE FROM earnings_calendar WHERE security_id = ? AND source = 'inferred'", [securityId]);
  if (!e) return;
  await db.execute(
    `INSERT INTO earnings_calendar (security_id, expected_date, fiscal_period, source, confirmed, updated_at)
     VALUES (?, ?, ?, 'inferred', 0, ?)
     ON CONFLICT (security_id, expected_date) DO NOTHING`,
    [securityId, e.expectedDate, JSON.stringify({ label: e.label, basis: e.basis }), new Date().toISOString()],
  );
}

export interface CalendarRow {
  security_id: number;
  ticker: string;
  name: string;
  expected_date: string;
  fiscal_period: string | null;
  source: "provider" | "inferred" | "user";
  confirmed: number;
}

export function listCalendar(db: Db): Promise<CalendarRow[]> {
  return db.select(
    `SELECT c.security_id, COALESCE(s.ticker, s.isin) AS ticker, s.name, c.expected_date, c.fiscal_period, c.source, c.confirmed
     FROM earnings_calendar c JOIN securities s ON s.id = c.security_id
     WHERE s.kind = 'stock' AND (s.in_watchlist = 1 OR s.id IN (SELECT security_id FROM transactions))
     ORDER BY c.expected_date, ticker`,
  );
}

export interface NewReportInput {
  securityId: number;
  formType: string;
  periodType: "annual" | "interim";
  periodEnd: string;
  filedAt: string | null;
  accession: string;
  label: string;
  source: string;
  url: string | null;
}

/** Guarda un informe nuevo; devuelve false si ya estaba detectado. */
export async function insertNewReport(db: Db, r: NewReportInput): Promise<boolean> {
  const res = await db.execute(
    `INSERT INTO new_reports (security_id, form_type, period_type, period_end, filed_at, accession_no, label, source, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (security_id, accession_no) DO NOTHING`,
    [r.securityId, r.formType, r.periodType, r.periodEnd, r.filedAt, r.accession, r.label, r.source, r.url],
  );
  return res.rowsAffected > 0;
}

export interface NewReportRow {
  id: number;
  security_id: number;
  ticker: string;
  name: string;
  form_type: string;
  period_type: "annual" | "interim";
  period_end: string;
  filed_at: string | null;
  label: string;
  source: string;
  url: string | null;
  detected_at: string;
  status: "new" | "analyzed" | "dismissed";
}

export function listNewReports(db: Db, onlyNew = false): Promise<NewReportRow[]> {
  return db.select(
    `SELECT r.id, r.security_id, COALESCE(s.ticker, s.isin) AS ticker, s.name, r.form_type, r.period_type, r.period_end, r.filed_at,
       r.label, r.source, r.url, r.detected_at, r.status
     FROM new_reports r JOIN securities s ON s.id = r.security_id
     ${onlyNew ? "WHERE r.status = 'new'" : ""}
     ORDER BY r.detected_at DESC, r.id DESC LIMIT 50`,
  );
}

export async function getNewReport(db: Db, id: number): Promise<NewReportRow | null> {
  return (await listNewReports(db)).find((r) => r.id === id) ?? null;
}

export async function setNewReportStatus(db: Db, id: number, status: NewReportRow["status"]): Promise<void> {
  await db.execute("UPDATE new_reports SET status = ? WHERE id = ?", [status, id]);
}

export async function getAppState(db: Db, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }>("SELECT value FROM app_state WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}

export async function setAppState(db: Db, key: string, value: string): Promise<void> {
  await db.execute(
    "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, new Date().toISOString()],
  );
}
