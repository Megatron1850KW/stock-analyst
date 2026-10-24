import type { Db } from "@/db/client";
import { resolveDocumentRequest, saveUpload } from "@/db/repo";
import type { StoredDocument } from "@/platform/documents";

export type UploadKind = "annual" | "half" | "quarter" | "other";

export const UPLOAD_KINDS: { id: UploadKind; label: string; periodType: "annual" | "interim" }[] = [
  { id: "annual", label: "Informe anual (10-K, 20-F o equivalente)", periodType: "annual" },
  { id: "half", label: "Informe semestral", periodType: "interim" },
  { id: "quarter", label: "Informe trimestral (10-Q o equivalente)", periodType: "interim" },
  { id: "other", label: "Otro (presentación de resultados…)", periodType: "interim" },
];

export interface UploadForm {
  securityId: number;
  kind: UploadKind;
  /** Fecha de cierre del periodo que cubre el informe (AAAA-MM-DD). */
  periodEnd: string;
  /** Solicitud que atiende, si viene de la bandeja. */
  requestId?: number | null;
}

const KIND_TEXT: Record<UploadKind, string> = { annual: "Anual", half: "Semestral", quarter: "Trimestral", other: "Otro" };

/** Registra en SQLite un informe ya guardado en disco y cierra su solicitud. */
export async function registerUpload(db: Db, form: UploadForm, file: { name: string }, stored: StoredDocument): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.periodEnd)) throw new Error("Indica la fecha de cierre del periodo del informe.");
  const kind = UPLOAD_KINDS.find((k) => k.id === form.kind)!;
  const filingId = await saveUpload(db, {
    securityId: form.securityId,
    periodType: kind.periodType,
    periodEnd: form.periodEnd,
    label: `${KIND_TEXT[form.kind]} (${stored.kind === "pdf" ? "PDF" : "ZIP"})`,
    path: stored.path,
    sha256: stored.sha256,
    bytes: stored.bytes,
    originalName: file.name,
  });
  if (form.requestId) await resolveDocumentRequest(db, form.requestId, "fulfilled", filingId);
  return filingId;
}
