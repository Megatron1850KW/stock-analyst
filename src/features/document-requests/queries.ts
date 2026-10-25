import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClaudeClient } from "@/data/claude/client";
import { deleteUpload, resolveDocumentRequest } from "@/db/repo";
import { aiSpendKey } from "@/features/ai/queries";
import { apiReady, requireApi } from "@/features/ai/mode";
import { appDb } from "@/platform/database";
import { deleteDocumentFile, readEsefReport, readPdf, storeDocument } from "@/platform/documents";
import { extractPdfFacts, type ExtractResult } from "./extract-pdf";
import { buildManualPdfPrompt, saveManualPdf } from "./manual-pdf";
import { readUploadedEsef } from "./read-esef";
import { registerUpload, type UploadForm } from "./upload";

function useInvalidate(securityId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["security", securityId] });
    void qc.invalidateQueries({ queryKey: ["watchlist"] });
    void qc.invalidateQueries({ queryKey: ["comparison"] });
    void qc.invalidateQueries({ queryKey: ["stars"] });
    void qc.invalidateQueries({ queryKey: aiSpendKey });
  };
}

/** Lee con Claude las cifras de un PDF subido (una sola vez por archivo, salvo `force`). */
export async function extractUpload(securityId: number, filingId: number, opts: { force?: boolean; allowOverBudget?: boolean } = {}): Promise<ExtractResult> {
  const settings = await requireApi("Sin la API, el PDF queda guardado pero sus cifras no se leen solas: si puedes, sube el informe en ZIP ESEF, que se lee sin IA.");
  return extractPdfFacts(
    { db: await appDb(), client: createClaudeClient(), readPdf, model: settings.aiModelExtraction, budgetEur: settings.aiMonthlyBudgetEur },
    securityId,
    filingId,
    opts,
  );
}

/** Lee las cifras de un informe subido: ZIP ESEF sin IA; PDF con Claude. */
export async function readUpload(
  securityId: number,
  filing: { id: number; local_path: string | null },
  opts: { force?: boolean; allowOverBudget?: boolean } = {},
): Promise<ExtractResult> {
  if (filing.local_path?.toLowerCase().endsWith(".zip")) {
    const r = await readUploadedEsef(await appDb(), securityId, filing.id, readEsefReport);
    return { status: "created", facts: r.facts, discarded: 0, costEur: 0, notes: r.notes };
  }
  return extractUpload(securityId, filing.id, opts);
}

export interface UploadOutcome {
  filingId: number;
  extraction: ExtractResult | null;
  /** La subida funcionó pero la lectura no (sin clave, presupuesto…): se puede reintentar. */
  extractionError: string | null;
}

/**
 * Guarda el archivo en el Mac, lo registra (cerrando la solicitud si la hay) y,
 * si es un PDF y hay clave de Claude, lee sus cifras: es una de las cuatro
 * situaciones en que la app usa la IA (CLAUDE.md §7).
 */
export function useUploadDocument(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async ({ form, file }: { form: UploadForm; file: File }): Promise<UploadOutcome> => {
      const stored = await storeDocument(securityId, file);
      const filingId = await registerUpload(await appDb(), form, file, stored);
      // Un PDF solo se lee solo en el modo API con clave; si no, se lee desde la lista (claude.ai) o queda guardado
      if (stored.kind === "pdf" && !(await apiReady())) return { filingId, extraction: null, extractionError: null };
      try {
        return { filingId, extraction: await readUpload(securityId, { id: filingId, local_path: stored.path }), extractionError: null };
      } catch (e) {
        return { filingId, extraction: null, extractionError: e instanceof Error ? e.message : String(e) };
      }
    },
    onSuccess: invalidate,
  });
}

export function useReadUpload(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: ({ filing, ...opts }: { filing: { id: number; local_path: string | null }; force?: boolean; allowOverBudget?: boolean }) =>
      readUpload(securityId, filing, opts),
    onSettled: invalidate,
  });
}

/** Modo manual: texto para claude.ai con las instrucciones y el esquema de las cifras de un PDF. */
export function useManualPdfPrompt(securityId: number) {
  return useMutation({ mutationFn: async (filingId: number) => buildManualPdfPrompt(await appDb(), securityId, filingId) });
}

export function useSaveManualPdf(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async ({ filingId, answer }: { filingId: number; answer: string }) => saveManualPdf({ db: await appDb(), readPdf }, securityId, filingId, answer),
    onSuccess: invalidate,
  });
}

export function useDeleteUpload(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async (filingId: number) => {
      const path = await deleteUpload(await appDb(), filingId);
      // El registro ya no existe; si el archivo no se pudiera borrar, no bloquea
      if (path) await deleteDocumentFile(path).catch(() => undefined);
    },
    onSuccess: invalidate,
  });
}

export function useDismissRequest(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async (requestId: number) => resolveDocumentRequest(await appDb(), requestId, "dismissed"),
    onSuccess: invalidate,
  });
}
