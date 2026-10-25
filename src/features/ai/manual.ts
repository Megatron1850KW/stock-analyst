import { z } from "zod";
import { getAnalysisByKey, saveAnalysis, type AnalysisRow } from "@/db/ai-repo";
import type { Db } from "@/db/client";
import type { SectionId } from "@/domain/reports/sections";
import { AiAnalysisError, type PreparedAnalysis, type StoredAnalysis } from "./equity-analysis";
import { analysisProblems, equityAnalysisSchema, type EquityAnalysis } from "./schema";

/**
 * Modo «Claude.ai manual» (sin API): la app prepara un texto con las
 * instrucciones, las cifras y extractos más cortos de los informes; tú lo
 * pegas en claude.ai (vale el plan gratuito) y pegas aquí su respuesta, que se
 * valida igual que la de la API. Ni coste ni clave.
 */

/** Modelo que se guarda para un análisis hecho en claude.ai. */
export const MANUAL_MODEL = "claude.ai (manual)";

/**
 * Extractos recortados para que todo quepa holgado en una conversación del
 * plan gratuito: ~60.000 caracteres (≈ 15.000 tokens) entre los dos informes.
 */
export const MANUAL_LIMITS: Record<SectionId, number> = {
  business: 8_000,
  risks: 10_000,
  mdna: 12_000,
};

/** Texto completo que se copia en claude.ai. */
export function buildManualPrompt(p: PreparedAnalysis): string {
  const schema = JSON.stringify(z.toJSONSchema(equityAnalysisSchema));
  return [
    `Analiza la acción ${p.name} (${p.ticker}) siguiendo estas instrucciones.`,
    "",
    p.prompt.text,
    "",
    "## Formato de la respuesta",
    "",
    "Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, que cumpla este esquema JSON:",
    schema,
    "",
    "## Datos",
    "",
    p.userMessage,
  ].join("\n");
}

/** Aproximación de tokens (≈ 4 caracteres por token), para mostrarla al usuario. */
export const approxTokens = (text: string) => Math.round(text.length / 4);

/** Saca el JSON de la respuesta pegada (con o sin bloque ```json) y lo valida. */
export function parseManualAnswer(text: string): EquityAnalysis {
  const trimmed = text.trim();
  if (!trimmed) throw new AiAnalysisError("Pega la respuesta de Claude en el recuadro.");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  const body = fenced ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiAnalysisError("No encuentro el JSON en lo que has pegado. Copia la respuesta entera de Claude (con el botón «Copiar» de su mensaje).");
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new AiAnalysisError("La respuesta pegada está incompleta o mal formada. Si Claude se cortó, pídele «continúa» o vuelve a copiar el texto.");
  }
  const checked = equityAnalysisSchema.safeParse(raw);
  if (!checked.success) {
    const fields = [...new Set(checked.error.issues.map((i) => i.path.join(".") || "(raíz)"))].slice(0, 4).join(", ");
    throw new AiAnalysisError(`La respuesta no sigue el formato pedido (revisa: ${fields}). Pídele a Claude que responda solo con el JSON del esquema.`);
  }
  const problems = analysisProblems(checked.data);
  if (problems.length) throw new AiAnalysisError(`El análisis pegado está incompleto (${problems.join(" ")}). No se ha guardado.`);
  return checked.data;
}

/** Guarda el análisis pegado, con las mismas fuentes y foto del día que uno hecho con la API. */
export async function saveManualAnalysis(db: Db, p: PreparedAnalysis, answer: string): Promise<AnalysisRow> {
  const analysis = parseManualAnswer(answer);
  const stored: StoredAnalysis = { analysis, documents: p.documents, servedModel: MANUAL_MODEL, costApprox: false, snapshot: p.snapshot };
  await saveAnalysis(db, {
    securityId: p.securityId,
    filingIds: p.filingIds,
    cacheKey: p.cacheKey,
    model: MANUAL_MODEL,
    promptVersion: p.prompt.key,
    resultJson: JSON.stringify(stored),
    inputTokens: 0,
    outputTokens: 0,
    costEur: 0,
  });
  return (await getAnalysisByKey(db, p.cacheKey))!;
}
