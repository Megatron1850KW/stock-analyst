import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createClaudeClient } from "@/data/claude/client";
import { fetchSecDocument } from "@/data/sec-edgar/client";
import { getLatestAnalysis, latestEurUsd, monthSpend } from "@/db/ai-repo";
import { setFilingLocalPath } from "@/db/repo";
import { secUserAgent } from "@/features/settings/schema";
import { appDb } from "@/platform/database";
import { secrets } from "@/platform/secrets";
import { loadSettings } from "@/platform/settings-store";
import { AiAnalysisError, parseStored, runEquityAnalysis, type RunOptions } from "./equity-analysis";

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

/** Lanza (o reutiliza de la caché) el análisis con IA de un valor. Solo se llama por una acción del usuario o al dar de alta un valor. */
export async function analyzeSecurity(securityId: number, opts: RunOptions = {}) {
  const settings = await loadSettings();
  if (!(await secrets.has("anthropic_api_key"))) throw new AiAnalysisError("Falta la clave de Claude. Añádela en Ajustes.");
  const ua = secUserAgent(settings);
  if (!ua) throw new AiAnalysisError("Falta tu nombre y email para la SEC. Añádelos en Ajustes.");
  const db = await appDb();
  return runEquityAnalysis(
    {
      db,
      client: createClaudeClient(),
      fetchDocument: async (url) => {
        const doc = await fetchSecDocument(url, ua);
        if (doc.path) await setFilingLocalPath(db, url, doc.path);
        return doc.html;
      },
      model: settings.aiModelAnalysis,
      budgetEur: settings.aiMonthlyBudgetEur,
    },
    securityId,
    opts,
  );
}

const runKey = (securityId: number) => ["ai-run", securityId] as const;

function invalidateAfterRun(qc: QueryClient, securityId: number) {
  void qc.invalidateQueries({ queryKey: aiAnalysisKey(securityId) });
  void qc.invalidateQueries({ queryKey: aiSpendKey });
  void qc.invalidateQueries({ queryKey: ["comparison"] });
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
export function startInitialAnalysis(qc: QueryClient, securityId: number): void {
  void (async () => {
    if (!(await secrets.has("anthropic_api_key"))) return;
    const mutation = qc.getMutationCache().build(qc, {
      mutationKey: runKey(securityId),
      mutationFn: () => analyzeSecurity(securityId),
      onSettled: () => invalidateAfterRun(qc, securityId),
    });
    await mutation.execute(undefined).catch((e: unknown) => console.warn("[ia] análisis inicial no realizado:", e instanceof Error ? e.message : e));
  })();
}
