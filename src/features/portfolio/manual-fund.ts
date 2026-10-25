import type { Db } from "@/db/client";
import { getSecurity } from "@/db/repo";
import { AiAnalysisError } from "@/features/ai/equity-analysis";
import { jsonFormatBlock, MANUAL_MODEL, parsePastedJson } from "@/features/ai/manual";
import { ETF_EXTRACTION_PROMPT } from "@/features/ai/prompts";
import { countPdfPages } from "@/features/document-requests/extract-pdf";
import { etfExtractionSchema, fundUserText, saveFundExtraction, type FundDoc, type FundProfile } from "./fund-profile";

/**
 * Ficha de un ETF/ETC en el modo «Claude.ai manual» (sin API): mismas
 * instrucciones y esquema que la lectura automática; tú adjuntas el PDF en
 * claude.ai y pegas su respuesta, que pasa por las mismas comprobaciones.
 */

async function fund(db: Db, securityId: number) {
  const security = await getSecurity(db, securityId);
  const [kindRow] = await db.select<{ kind: string }>("SELECT kind FROM securities WHERE id = ?", [securityId]);
  if (!security || !kindRow) throw new AiAnalysisError("Este valor ya no está guardado.");
  return { security, kind: kindRow.kind };
}

export async function buildManualFundPrompt(db: Db, securityId: number): Promise<string> {
  const { security, kind } = await fund(db, securityId);
  return [
    `Te adjunto la ficha (factsheet) o el KID en PDF de ${security.name}. Copia sus datos siguiendo estas instrucciones.`,
    "",
    ETF_EXTRACTION_PROMPT.text,
    "",
    jsonFormatBlock(etfExtractionSchema),
    "",
    "## Datos",
    "",
    fundUserText(security, kind),
  ].join("\n");
}

export async function saveManualFund(
  deps: { db: Db; readPdf: (path: string) => Promise<Uint8Array> },
  securityId: number,
  doc: FundDoc,
  answer: string,
): Promise<FundProfile> {
  const data = parsePastedJson(answer, etfExtractionSchema);
  const { security } = await fund(deps.db, securityId);
  // Las páginas se cuentan aquí, sin IA, para descartar citas a páginas que no existen
  const pages = await countPdfPages(await deps.readPdf(doc.path));
  return saveFundExtraction(deps.db, securityId, doc, data, pages, {
    model: MANUAL_MODEL,
    promptKey: ETF_EXTRACTION_PROMPT.key,
    costEur: 0,
    name: security.name,
  });
}
