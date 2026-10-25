import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createClaudeClient } from "@/data/claude/client";
import { fetchEsefReport } from "@/data/esef/client";
import { fetchSecDocument } from "@/data/sec-edgar/client";
import { getLatestAnalysis, latestEurUsd, monthSpend } from "@/db/ai-repo";
import { setFilingLocalPath } from "@/db/repo";
import { secUserAgent } from "@/features/settings/schema";
import { appDb } from "@/platform/database";
import { loadSettings } from "@/platform/settings-store";
import { AiAnalysisError, parseStored, prepareAnalysis, runEquityAnalysis, type PreparedAnalysis, type RunOptions } from "./equity-analysis";
import { buildManualPrompt, MANUAL_LIMITS, saveManualAnalysis } from "./manual";
import { apiReady, requireApi } from "./mode";

export const aiAnalysisKey = (securityId: number) => ["ai-analysis", securityId] as const;
export const aiSpendKey = ["ai-spend"] as const;

export function useAiAnalysis(securityId: number) {
  return useQuery({
    queryKey: aiAnalysisKey(securityId),
    queryFn: async () => {
      const row = await getLatestAnalysis(await appDb(), securityId);
      return row ? { row, stored: parseStored(row) } : null;
    },
  });
}

export function useAiSpend() {
  return useQuery({
    queryKey: aiSpendKey,
    queryFn: async () => {
      const db = await appDb();
      const [spend, rate, settings] = await Promise.all([monthSpend(db), latestEurUsd(db), loadSettings()]);
      return { ...spend, budgetEur: settings.aiMonthlyBudgetEur, approx: rate === null };
    },
  });
}

/** Descarga (o lee del Mac) el HTML de un informe para sacar sus extractos. */
async function documentFetcher() {
  const ua = secUserAgent(await loadSettings());
  const db = await appDb();
  return async (url: string) => {
    // Europa: informe ESEF de filings.xbrl.org (se guarda en el Mac la primera vez)
    if (url.startsWith("https://filings.xbrl.org/")) return fetchEsefReport(url);
    if (!ua) throw new AiAnalysisError("Falta tu nombre y email para la SEC. Añádelos en Ajustes.");
    const doc = await fetchSecDocument(url, ua);
    if (doc.path) await setFilingLocalPath(db, url, doc.path);
    return doc.html;
  };
}

/** Lanza (o reutiliza de la caché) el análisis con IA de un valor. Solo se llama por una acción del usuario o al dar de alta un valor. */
export async function analyzeSecurity(securityId: number, opts: RunOptions = {}) {
  const settings = await requireApi((mode) =>
    mode === "manual" ? "Para el análisis narrativo, abre su ficha y pulsa «Analizar con Claude.ai»." : "Las cifras e indicadores sí están al día.",
  );
  return runEquityAnalysis(
    {
      db: await appDb(),
      client: createClaudeClient(),
      fetchDocument: await documentFetcher(),
      model: settings.aiModelAnalysis,
      budgetEur: settings.aiMonthlyBudgetEur,
    },
    securityId,
    opts,
  );
}

/** Modo manual: prepara el texto para claude.ai (siempre nuevo, aunque haya uno guardado). */
export async function prepareManual(securityId: number): Promise<{ prepared: PreparedAnalysis; text: string }> {
  const ready = await prepareAnalysis({ db: await appDb(), fetchDocument: await documentFetcher() }, securityId, { force: true, limits: MANUAL_LIMITS });
  if ("cached" in ready) throw new AiAnalysisError("No se ha podido preparar el texto.");
  return { prepared: ready.prepared, text: buildManualPrompt(ready.prepared) };
}

export function usePrepareManual(securityId: number) {
  return useMutation({ mutationFn: () => prepareManual(securityId) });
}

export function useSaveManual(securityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ prepared, answer }: { prepared: PreparedAnalysis; answer: string }) => saveManualAnalysis(await appDb(), prepared, answer),
    onSuccess: () => invalidateAfterRun(qc, securityId),
  });
}

const runKey = (securityId: number) => ["ai-run", securityId] as const;

function invalidateAfterRun(qc: QueryClient, securityId: number) {
  void qc.invalidateQueries({ queryKey: aiAnalysisKey(securityId) });
  void qc.invalidateQueries({ queryKey: aiSpendKey });
  void qc.invalidateQueries({ queryKey: ["comparison"] });
  void qc.invalidateQueries({ queryKey: ["stars"] });
}

export function useRunAnalysis(securityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: runKey(securityId),
    mutationFn: (opts: RunOptions) => analyzeSecurity(securityId, opts),
    onSettled: () => invalidateAfterRun(qc, securityId),
  });
}

/** ¿Hay un análisis en marcha para este valor (lanzado aquí o al darlo de alta)? */
export function useAnalysisRunning(securityId: number): boolean {
  return useIsMutating({ mutationKey: runKey(securityId) }) > 0;
}

/**
 * Análisis inicial al dar de alta un valor (CLAUDE.md §7). Corre en segundo
 * plano; sin clave, sin presupuesto o con error, la ficha ofrece el botón.
 */
export function startInitialAnalysis(qc: QueryClient, securityId: number, then?: () => void): void {
  void (async () => {
    // Solo en modo API: en manual o sin IA, la ficha ofrece el botón
    if (!(await apiReady())) return;
    const mutation = qc.getMutationCache().build(qc, {
      mutationKey: runKey(securityId),
      mutationFn: () => analyzeSecurity(securityId),
      onSettled: () => invalidateAfterRun(qc, securityId),
    });
    await mutation.execute(undefined).catch((e: unknown) => console.warn("[ia] análisis inicial no realizado:", e instanceof Error ? e.message : e));
    // Después (con el modelo de negocio ya escrito), lo siguiente: p. ej. los competidores
    then?.();
  })();
}
