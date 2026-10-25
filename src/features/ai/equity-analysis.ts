import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  getAnalysisByKey,
  linkUsage,
  recordAiUsage,
  saveAnalysis,
  type AnalysisRow,
} from "@/db/ai-repo";
import type { Db } from "@/db/client";
import type { FilingRow } from "@/db/repo";
import { latestReports } from "@/domain/fundamentals/statements";
import { extractSections, SECTION_LABELS, type Excerpt, type SectionId } from "@/domain/reports/sections";
import { loadSecurityDetail } from "@/features/watchlist/load";
import { BudgetExceededError, checkBudget } from "./budget";
import { costUsd, estimateCostUsd, usdToEur } from "./cost";

export { BudgetExceededError };
import { EQUITY_ANALYSIS_PROMPT, type Prompt } from "./prompts";
import { analysisProblems, equityAnalysisSchema, type EquityAnalysis } from "./schema";
import { snapshotOf, type AnalysisSnapshot } from "./since";
import { numericSummary } from "./summary";

/**
 * Análisis narrativo de una acción con Claude (CLAUDE.md §7):
 * cifras ya calculadas + extractos de los últimos informes → JSON validado,
 * guardado con clave (ticker, informe, versión del prompt) para no repetir llamadas.
 */

export type AnalysisModel = "claude-sonnet-5-5" | "claude-haiku-5-5" | "claude-opus-5-5";

export interface AnalysisDocument {
  /** Nº de registro oficial (accession). */
  id: string;
  form: string;
  periodEnd: string;
  filedAt: string | null;
  url: string | null;
  sections: { section: SectionId; truncated: boolean; fullLength: number }[];
  /** Por qué no se pudo leer, si no se pudo. */
  error?: string;
}

/** Lo que se guarda en analyses.result_json. */
export interface StoredAnalysis {
  analysis: EquityAnalysis;
  documents: AnalysisDocument[];
  /** Modelo que respondió (puede ser el de respaldo si el principal declinó). */
  servedModel: string;
  costApprox: boolean;
  /** Precio y valoración del día del análisis, para compararlos después sin llamar a la IA. */
  snapshot?: AnalysisSnapshot;
}

export class AiAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAnalysisError";
  }
}

export interface RunOptions {
  /** «Re-analizar»: no usar la caché. */
  force?: boolean;
  /** El usuario ya confirmó que quiere pasarse del presupuesto. */
  allowOverBudget?: boolean;
}

export interface RunDeps extends PrepareDeps {
  client: Anthropic;
  model: AnalysisModel;
  budgetEur: number;
  now?: Date;
}

export type RunResult = { status: "cached" | "created"; row: AnalysisRow };

export function cacheKey(ticker: string, documentId: string, prompt: Prompt): string {
  return `${ticker}|${documentId}|${prompt.key}`;
}

/** Informes cuyos extractos se envían: el último anual y, si es posterior, el último intermedio. */
export function analysisFilings(filings: FilingRow[]): FilingRow[] {
  const core = filings.filter((f) => f.role === "core");
  const { annual, interim } = latestReports(core);
  return [annual, interim].filter((f): f is FilingRow => !!f);
}

export function buildUserMessage(summary: object, docs: AnalysisDocument[], excerpts: Map<string, Excerpt[]>): string {
  const lines = [
    "<resumen_numerico>",
    JSON.stringify(summary, null, 1),
    "</resumen_numerico>",
    "<documentos>",
    JSON.stringify(docs.map((d) => ({ id: d.id, tipo: d.form, periodo_hasta: d.periodEnd, presentado: d.filedAt, leido: !d.error }))),
    "</documentos>",
  ];
  for (const d of docs) {
    for (const e of excerpts.get(d.id) ?? []) {
      lines.push(
        `<extracto documento="${d.id}" seccion="${SECTION_LABELS[e.section]}" recortado="${e.truncated ? "sí" : "no"}">`,
        e.text,
        "</extracto>",
      );
    }
  }
  lines.push("Redacta el análisis siguiendo las instrucciones y el esquema de salida.");
  return lines.join("\n");
}

const supportsServerFallback = (model: AnalysisModel) => model !== "claude-haiku-5-5";

export interface PrepareDeps {
  db: Db;
  /** Descarga el HTML de un informe de la SEC. */
  fetchDocument: (url: string) => Promise<string>;
  prompt?: Prompt;
}

/** Todo lo que se le da a la IA, listo para la API o para copiarlo en claude.ai. */
export interface PreparedAnalysis {
  securityId: number;
  ticker: string;
  name: string;
  cacheKey: string;
  prompt: Prompt;
  filingIds: number[];
  documents: AnalysisDocument[];
  userMessage: string;
  snapshot: AnalysisSnapshot;
}

/**
 * Prepara el análisis: cifras calculadas + extractos de los informes. Si ya
 * hay uno guardado para el mismo informe y prompt (y no se fuerza), lo devuelve.
 */
export async function prepareAnalysis(
  deps: PrepareDeps,
  securityId: number,
  opts: { force?: boolean; limits?: Record<SectionId, number> } = {},
): Promise<{ cached: AnalysisRow } | { prepared: PreparedAnalysis }> {
  const { db } = deps;
  const prompt = deps.prompt ?? EQUITY_ANALYSIS_PROMPT;
  const detail = await loadSecurityDetail(db, securityId);
  if (!detail.security || !detail.analysis) throw new AiAnalysisError("Este valor ya no está guardado.");
  const security = detail.security;

  const filings = analysisFilings(detail.filings);
  const newest = [...filings].sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!newest) throw new AiAnalysisError("No hay informes guardados que analizar.");
  const key = cacheKey(security.ticker, newest.accession_no, prompt);
  if (!opts.force) {
    const cached = await getAnalysisByKey(db, key);
    if (cached) return { cached };
  }

  // Extractos de los informes (un fallo de descarga no impide el análisis: se indica)
  const docs: AnalysisDocument[] = [];
  const excerpts = new Map<string, Excerpt[]>();
  for (const f of filings) {
    const doc: AnalysisDocument = { id: f.accession_no, form: f.form_type, periodEnd: f.period_end, filedAt: f.filed_at, url: f.url, sections: [] };
    if (!f.url) doc.error = "Sin enlace al documento";
    else {
      try {
        const list = extractSections(f.form_type, await deps.fetchDocument(f.url), opts.limits);
        excerpts.set(f.accession_no, list);
        doc.sections = list.map((e) => ({ section: e.section, truncated: e.truncated, fullLength: e.fullLength }));
        if (list.length === 0) doc.error = "No se reconocieron sus secciones";
      } catch (e) {
        doc.error = e instanceof Error ? e.message : String(e);
      }
    }
    docs.push(doc);
  }
  if (docs.every((d) => d.sections.length === 0)) {
    throw new AiAnalysisError(
      `No se ha podido leer el texto de ningún informe (${docs.map((d) => `${d.form}: ${d.error}`).join("; ")}). Sin él, la IA solo repetiría las cifras.`,
    );
  }

  return {
    prepared: {
      securityId,
      ticker: security.ticker,
      name: security.name,
      cacheKey: key,
      prompt,
      filingIds: filings.map((f) => f.id),
      documents: docs,
      userMessage: buildUserMessage(numericSummary(security, detail.analysis), docs, excerpts),
      snapshot: snapshotOf(detail.analysis),
    },
  };
}

export async function runEquityAnalysis(deps: RunDeps, securityId: number, opts: RunOptions = {}): Promise<RunResult> {
  const { db, client, model } = deps;
  const ready = await prepareAnalysis(deps, securityId, { force: opts.force });
  if ("cached" in ready) return { status: "cached", row: ready.cached };
  const { prepared } = ready;
  const { prompt, userMessage, documents: docs } = prepared;
  const key = prepared.cacheKey;

  // Presupuesto: se avisa antes de gastar
  const rate = await checkBudget(db, {
    budgetEur: deps.budgetEur,
    estimateUsd: estimateCostUsd(prompt.text.length + userMessage.length, model),
    now: deps.now,
    allowOverBudget: opts.allowOverBudget,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: prompt.text, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
      output_config: { effort: "medium", format: betaZodOutputFormat(equityAnalysisSchema) },
      // Si el modelo declina la petición, Anthropic la repite con su modelo de respaldo
      ...(supportsServerFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (e) {
    throw new AiAnalysisError(describeApiError(e));
  }

  // El gasto se apunta siempre, aunque luego la respuesta no sirva
  const usd = Math.max(costUsd(response.usage, model), costUsd(response.usage, response.model));
  const cost = usdToEur(usd, rate);
  const usageId = await recordAiUsage(db, {
    analysisId: null,
    purpose: "analysis",
    model: response.model,
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    costEur: cost.eur,
  });

  if (response.stop_reason === "refusal") throw new AiAnalysisError("Claude ha declinado hacer este análisis. Prueba con otro modelo en Ajustes.");
  if (response.stop_reason === "max_tokens") throw new AiAnalysisError("La respuesta de la IA se cortó antes de terminar. No se ha guardado.");
  const checked = equityAnalysisSchema.safeParse(response.parsed_output);
  if (!checked.success) {
    console.error("[ia] respuesta no válida:", checked.error.message);
    throw new AiAnalysisError("La IA devolvió una respuesta con un formato inesperado. No se ha guardado.");
  }
  const problems = analysisProblems(checked.data);
  if (problems.length) {
    console.error("[ia] análisis incompleto:", problems.join(" "));
    throw new AiAnalysisError(`El análisis de la IA está incompleto (${problems.join(" ")}). No se ha guardado.`);
  }

  const stored: StoredAnalysis = { analysis: checked.data, documents: docs, servedModel: response.model, costApprox: cost.approx, snapshot: prepared.snapshot };
  const analysisId = await saveAnalysis(db, {
    securityId,
    filingIds: prepared.filingIds,
    cacheKey: key,
    model: response.model,
    promptVersion: prompt.key,
    resultJson: JSON.stringify(stored),
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
    costEur: cost.eur,
  });
  await linkUsage(db, usageId, analysisId);
  const row = await getAnalysisByKey(db, key);
  return { status: "created", row: row! };
}

/** Errores de la API en llano. */
export function describeApiError(e: unknown): string {
  const status = typeof e === "object" && e && "status" in e ? Number((e as { status: unknown }).status) : null;
  if (status === 401) return "La clave de Claude no es válida. Revísala en Ajustes.";
  if (status === 429) return "Claude ha limitado las consultas. Inténtalo de nuevo en unos minutos.";
  if (status === 529 || (status !== null && status >= 500)) return "El servicio de Claude no está disponible ahora mismo. Inténtalo más tarde.";
  if (status === 400) return "Claude ha rechazado la petición por un problema de formato. Se ha registrado el error.";
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("Failed to parse structured output")) {
    console.error("[ia] salida no válida:", msg.slice(0, 500));
    return "La IA devolvió una respuesta con un formato inesperado. No se ha guardado nada.";
  }
  // Errores de Rust (sin clave, sin conexión) ya vienen en llano
  return msg;
}

/** Lee lo guardado en analyses.result_json. */
export function parseStored(row: AnalysisRow): StoredAnalysis | null {
  try {
    const raw = JSON.parse(row.result_json) as StoredAnalysis;
    const analysis = equityAnalysisSchema.safeParse(raw.analysis);
    return analysis.success ? { ...raw, analysis: analysis.data } : null;
  } catch {
    return null;
  }
}

