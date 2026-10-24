import type { Db } from "./client";

/** Análisis de IA guardados (caché) y contador de gasto (CLAUDE.md §7). */

export interface AnalysisRow {
  id: number;
  security_id: number;
  filing_ids: string;
  cache_key: string;
  model: string;
  prompt_version: string;
  result_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_eur: number | null;
  created_at: string;
}

const COLS = "id, security_id, filing_ids, cache_key, model, prompt_version, result_json, input_tokens, output_tokens, cost_eur, created_at";

export async function getAnalysisByKey(db: Db, cacheKey: string): Promise<AnalysisRow | null> {
  const rows = await db.select<AnalysisRow>(`SELECT ${COLS} FROM analyses WHERE cache_key = ?`, [cacheKey]);
  return rows[0] ?? null;
}

export async function getLatestAnalysis(db: Db, securityId: number): Promise<AnalysisRow | null> {
  const rows = await db.select<AnalysisRow>(
    `SELECT ${COLS} FROM analyses WHERE security_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [securityId],
  );
  return rows[0] ?? null;
}

/** Último análisis de cada valor (para la portada). */
export function listLatestAnalyses(db: Db): Promise<AnalysisRow[]> {
  return db.select<AnalysisRow>(
    `SELECT ${COLS} FROM analyses a
     WHERE id = (SELECT b.id FROM analyses b WHERE b.security_id = a.security_id ORDER BY b.created_at DESC, b.id DESC LIMIT 1)`,
  );
}

export interface AnalysisInput {
  securityId: number;
  filingIds: number[];
  cacheKey: string;
  model: string;
  promptVersion: string;
  resultJson: string;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
}

/** Guarda un análisis. «Re-analizar» con los mismos informes sustituye al anterior. */
export async function saveAnalysis(db: Db, a: AnalysisInput): Promise<number> {
  await db.execute(
    `INSERT INTO analyses (security_id, filing_ids, cache_key, model, prompt_version, result_json, input_tokens, output_tokens, cost_eur, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET filing_ids = excluded.filing_ids, model = excluded.model,
       prompt_version = excluded.prompt_version, result_json = excluded.result_json, input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens, cost_eur = excluded.cost_eur, created_at = excluded.created_at`,
    [a.securityId, JSON.stringify(a.filingIds), a.cacheKey, a.model, a.promptVersion, a.resultJson, a.inputTokens, a.outputTokens, a.costEur, new Date().toISOString()],
  );
  const rows = await db.select<{ id: number }>("SELECT id FROM analyses WHERE cache_key = ?", [a.cacheKey]);
  return rows[0]!.id;
}

export interface UsageInput {
  analysisId: number | null;
  purpose: "analysis" | "pdf-extraction" | "peers" | "other";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costEur: number;
}

export async function recordAiUsage(db: Db, u: UsageInput): Promise<number> {
  const r = await db.execute(
    `INSERT INTO ai_usage (analysis_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_eur, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [u.analysisId, u.purpose, u.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.costEur, new Date().toISOString()],
  );
  return r.lastInsertId ?? 0;
}

export async function linkUsage(db: Db, usageId: number, analysisId: number): Promise<void> {
  await db.execute("UPDATE ai_usage SET analysis_id = ? WHERE id = ?", [analysisId, usageId]);
}

export interface MonthSpend {
  eur: number;
  calls: number;
}

/** Gasto del mes natural (UTC) que contiene `now`. */
export async function monthSpend(db: Db, now = new Date()): Promise<MonthSpend> {
  const month = now.toISOString().slice(0, 7);
  const rows = await db.select<{ eur: number | null; calls: number }>(
    "SELECT SUM(cost_eur) AS eur, COUNT(*) AS calls FROM ai_usage WHERE substr(created_at, 1, 7) = ?",
    [month],
  );
  return { eur: rows[0]?.eur ?? 0, calls: rows[0]?.calls ?? 0 };
}

/** Último tipo EUR→USD guardado (BCE), si lo hay. */
export async function latestEurUsd(db: Db): Promise<number | null> {
  const rows = await db.select<{ rate: number }>(
    "SELECT rate FROM fx_rates WHERE base = 'EUR' AND quote = 'USD' ORDER BY date DESC LIMIT 1",
  );
  return rows[0]?.rate ?? null;
}
