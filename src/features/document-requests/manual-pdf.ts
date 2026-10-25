import type { Db } from "@/db/client";
import { getFilings, getSecurity, type FilingRow } from "@/db/repo";
import { AiAnalysisError } from "@/features/ai/equity-analysis";
import { jsonFormatBlock, parsePastedJson } from "@/features/ai/manual";
import { PDF_EXTRACTION_PROMPT } from "@/features/ai/prompts";
import { countPdfPages, pdfExtractionSchema, pdfUserText, saveExtraction } from "./extract-pdf";

/**
 * Cifras de un PDF en el modo «Claude.ai manual» (sin API): mismas
 * instrucciones y esquema que la lectura automática; tú adjuntas el PDF en
 * claude.ai y pegas su respuesta, que pasa por las mismas comprobaciones
 * (fechas, páginas, periodo) antes de guardarse como «extraída de PDF».
 */

async function uploadedPdf(db: Db, securityId: number, filingId: number): Promise<FilingRow> {
  const filing = (await getFilings(db, securityId)).find((f) => f.id === filingId);
  if (!filing?.local_path || filing.role !== "upload") throw new AiAnalysisError("No encuentro el PDF subido.");
  return filing;
}

export async function buildManualPdfPrompt(db: Db, securityId: number, filingId: number): Promise<string> {
  const filing = await uploadedPdf(db, securityId, filingId);
  const security = await getSecurity(db, securityId);
  if (!security) throw new AiAnalysisError("Este valor ya no está guardado.");
  return [
    `Te adjunto un informe en PDF de ${security.name}. Copia sus cifras siguiendo estas instrucciones.`,
    "",
    PDF_EXTRACTION_PROMPT.text,
    "",
    jsonFormatBlock(pdfExtractionSchema),
    "",
    "## Datos",
    "",
    pdfUserText(security.name, filing),
  ].join("\n");
}

export async function saveManualPdf(
  deps: { db: Db; readPdf: (path: string) => Promise<Uint8Array> },
  securityId: number,
  filingId: number,
  answer: string,
): Promise<{ facts: number; discarded: number; notes: string[] }> {
  const data = parsePastedJson(answer, pdfExtractionSchema);
  const filing = await uploadedPdf(deps.db, securityId, filingId);
  // Las páginas se cuentan aquí, sin IA, para descartar citas a páginas que no existen
  const pages = await countPdfPages(await deps.readPdf(filing.local_path!));
  const saved = await saveExtraction(deps.db, securityId, filing, data, pages);
  if (saved.facts === 0) throw new AiAnalysisError("La respuesta no trae ninguna cifra válida. Revisa que Claude haya leído el PDF adjunto.");
  return saved;
}
