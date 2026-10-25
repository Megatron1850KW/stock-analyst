import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { recordAiUsage } from "@/db/ai-repo";
import type { Db } from "@/db/client";
import { getFacts, getFilings, getSecurity, replaceFilingFacts, type FilingRow } from "@/db/repo";
import { CONCEPTS, CONCEPT_BY_ID } from "@/domain/fundamentals/concepts";
import type { ConceptGap, NormalizedFact } from "@/domain/fundamentals/normalize";
import { checkBudget } from "@/features/ai/budget";
import { costUsd, usdToEur } from "@/features/ai/cost";
import { AiAnalysisError, describeApiError } from "@/features/ai/equity-analysis";
import { PDF_EXTRACTION_PROMPT, type Prompt } from "@/features/ai/prompts";

/**
 * Cifras de un informe en PDF subido por ti (CLAUDE.md §4.4): Claude las
 * localiza y las copia a un esquema estricto con su página; el código aplica
 * la escala, valida fechas y conceptos y las guarda marcadas como «extraída
 * de PDF». Una sola llamada por archivo: si ya se extrajo, no se repite.
 */

const CONCEPT_IDS = CONCEPTS.map((c) => c.id) as [string, ...string[]];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const pdfExtractionSchema = z.object({
  moneda: z.string(),
  tipo: z.enum(["anual", "semestral", "trimestral", "otro"]),
  periodo: z.object({ inicio: z.string().nullable(), fin: z.string() }),
  cifras: z.array(
    z.object({
      concepto: z.enum(CONCEPT_IDS),
      valor: z.number(),
      escala: z.enum(["unidades", "miles", "millones"]),
      inicio: z.string().nullable(),
      fin: z.string(),
      pagina: z.number().int(),
      etiqueta: z.string(),
    }),
  ),
  notas: z.string(),
});
export type PdfExtraction = z.infer<typeof pdfExtractionSchema>;

const SCALE = { unidades: 1, miles: 1e3, millones: 1e6 } as const;
const DAY = 86_400_000;
const near = (a: string, b: string, days = 20) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY;

const PAGE_OBJECT = /\/Type\s*\/Page(?![s\w])/g;
const latin1 = (bytes: Uint8Array) => {
  let text = "";
  for (let k = 0; k < bytes.length; k += 65_536) text += String.fromCharCode(...bytes.subarray(k, k + 65_536));
  return text;
};

/** Descomprime un flujo /FlateDecode; null si no se puede (otro filtro, flujo dañado). */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Páginas de un PDF: cuenta los objetos /Type /Page, también los guardados
 * dentro de flujos de objetos comprimidos (/ObjStm, habituales en PDF 1.5+),
 * para estimar el coste y descartar citas a páginas que no existen.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const text = latin1(bytes);
  let pages = (text.match(PAGE_OBJECT) ?? []).length;
  const objStm = /<<((?:(?!>>\s*stream)[\s\S]){0,2000}?\/Type\s*\/ObjStm[\s\S]{0,2000}?)>>\s*stream\r?\n/g;
  for (let m = objStm.exec(text); m; m = objStm.exec(text)) {
    if (!/\/FlateDecode/.test(m[1]!)) continue;
    const start = m.index + m[0].length;
    let end = text.indexOf("endstream", start);
    if (end < 0) continue;
    // El salto de línea antes de «endstream» no forma parte del flujo
    while (end > start && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
    const inner = await inflate(bytes.subarray(start, end));
    if (inner) pages += (latin1(inner).match(PAGE_OBJECT) ?? []).length;
  }
  return pages || 1;
}

/** Tokens de entrada por página de PDF (texto + imagen de la página), según la documentación de Claude. */
const TOKENS_PER_PAGE = 3000;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let k = 0; k < bytes.length; k += 32_768) bin += String.fromCharCode(...bytes.subarray(k, k + 32_768));
  return btoa(bin);
}

export interface ExtractionOutcome {
  facts: NormalizedFact[];
  /** Cifras descartadas por fechas o páginas no válidas. */
  discarded: number;
  /** Cierre del periodo según el documento, si no coincide con el indicado al subirlo. */
  periodEnd: string;
  notes: string[];
}

/** De la salida de la IA a cifras del modelo común, con validación determinista. */
export function toFacts(out: PdfExtraction, accession: string, pages: number): ExtractionOutcome {
  const unitFor = (concept: string) => {
    const kind = CONCEPT_BY_ID.get(concept)?.kind;
    return kind === "shares" ? "shares" : kind === "perShare" ? `${out.moneda}/shares` : out.moneda;
  };
  const facts: NormalizedFact[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const c of out.cifras) {
    const def = CONCEPT_BY_ID.get(c.concepto);
    const datesOk = ISO_DATE.test(c.fin) && (c.inicio === null || (ISO_DATE.test(c.inicio) && c.inicio < c.fin));
    const shapeOk = def && (def.period === "instant" ? c.inicio === null : c.inicio !== null);
    if (!def || !datesOk || !shapeOk || c.pagina < 1 || c.pagina > pages || !Number.isFinite(c.valor)) {
      discarded++;
      continue;
    }
    const key = `${c.concepto}|${c.inicio}|${c.fin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // El BPA no se escala: siempre va en unidades monetarias por acción
    const value = def.kind === "perShare" ? c.valor : c.valor * SCALE[c.escala];
    facts.push({
      accession,
      concept: c.concepto,
      sourceTag: `pdf: «${c.etiqueta.slice(0, 120)}»`,
      value,
      unit: unitFor(c.concepto),
      periodStart: c.inicio,
      periodEnd: c.fin,
      page: c.pagina,
    });
  }
  const notes = out.notas.trim() ? [out.notas.trim()] : [];
  return { facts, discarded, periodEnd: out.periodo.fin, notes };
}

export interface ExtractDeps {
  db: Db;
  client: Anthropic;
  readPdf: (path: string) => Promise<Uint8Array>;
  model: string;
  budgetEur: number;
  prompt?: Prompt;
  now?: Date;
}

export type ExtractResult = { status: "cached" | "created"; facts: number; discarded: number; costEur: number | null; notes: string[] };

const KIND_TEXT: Record<FilingRow["period_type"], string> = { annual: "anual", interim: "intermedio (semestral o trimestral)" };

export async function extractPdfFacts(
  deps: ExtractDeps,
  securityId: number,
  filingId: number,
  opts: { force?: boolean; allowOverBudget?: boolean } = {},
): Promise<ExtractResult> {
  const { db, client, model } = deps;
  const prompt = deps.prompt ?? PDF_EXTRACTION_PROMPT;
  const filing = (await getFilings(db, securityId)).find((f) => f.id === filingId);
  if (!filing?.local_path || filing.role !== "upload") throw new AiAnalysisError("No encuentro el PDF subido.");
  if (!opts.force) {
    const done = (await getFacts(db, securityId)).filter((f) => f.filing_id === filingId && f.origin === "pdf-extraction");
    if (done.length > 0) return { status: "cached", facts: done.length, discarded: 0, costEur: null, notes: [] };
  }
  const security = await getSecurity(db, securityId);
  if (!security) throw new AiAnalysisError("Este valor ya no está guardado.");

  const bytes = await deps.readPdf(filing.local_path);
  const pages = await countPdfPages(bytes);
  const userText = pdfUserText(security.name, filing);

  const rate = await checkBudget(db, {
    budgetEur: deps.budgetEur,
    estimateUsd: costUsd({ input_tokens: pages * TOKENS_PER_PAGE + (prompt.text.length + userText.length) / 4, output_tokens: 6000 }, model),
    now: deps.now,
    allowOverBudget: opts.allowOverBudget,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: prompt.text }],
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } },
            { type: "text", text: userText },
          ],
        },
      ],
      output_config: { format: betaZodOutputFormat(pdfExtractionSchema) },
    });
  } catch (e) {
    const status = typeof e === "object" && e && "status" in e ? Number((e as { status: unknown }).status) : null;
    throw new AiAnalysisError(
      status === 400 || status === 413
        ? "Claude no ha podido leer este PDF (quizá tiene demasiadas páginas). Sube solo el informe semestral o las páginas de los estados financieros."
        : describeApiError(e),
    );
  }

  const cost = usdToEur(costUsd(response.usage, response.model), rate);
  await recordAiUsage(db, {
    analysisId: null,
    purpose: "pdf-extraction",
    model: response.model,
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    costEur: cost.eur,
  });
  if (response.stop_reason === "refusal") throw new AiAnalysisError("Claude ha declinado leer este PDF.");
  const checked = pdfExtractionSchema.safeParse(response.parsed_output);
  if (!checked.success || response.stop_reason === "max_tokens") {
    console.error("[ia] extracción de PDF no válida:", checked.error?.message ?? response.stop_reason);
    throw new AiAnalysisError("La IA devolvió las cifras del PDF con un formato inesperado. No se ha guardado nada.");
  }

  const saved = await saveExtraction(db, securityId, filing, checked.data, pages);
  return { status: "created", ...saved, costEur: cost.eur };
}

/** Qué documento es y qué conceptos se buscan: lo mismo para la API y para claude.ai. */
export function pdfUserText(company: string, filing: Pick<FilingRow, "period_type" | "period_end">): string {
  return [
    "<informe>",
    JSON.stringify({
      empresa: company,
      tipo_segun_usuario: KIND_TEXT[filing.period_type],
      cierre_segun_usuario: filing.period_end,
      conceptos: CONCEPTS.map((c) => ({ id: c.id, nombre: c.label, tipo: c.period === "instant" ? "balance (a una fecha)" : "del periodo" })),
    }),
    "</informe>",
    "Extrae las cifras siguiendo las instrucciones y el esquema de salida.",
  ].join("\n");
}

/**
 * Guarda las cifras ya validadas por el esquema: comprobaciones deterministas
 * (fechas, páginas), corrección del periodo si el documento dice otro y huecos.
 */
export async function saveExtraction(
  db: Db,
  securityId: number,
  filing: FilingRow,
  data: PdfExtraction,
  pages: number,
): Promise<{ facts: number; discarded: number; notes: string[] }> {
  const filingId = filing.id;
  const outcome = toFacts(data, filing.accession_no, pages);
  const notes = [...outcome.notes];
  // Si el documento es de otro periodo distinto del indicado, manda el documento
  if (ISO_DATE.test(outcome.periodEnd) && !near(outcome.periodEnd, filing.period_end) && outcome.facts.some((f) => f.periodEnd === outcome.periodEnd)) {
    await db.execute("UPDATE filings SET period_end = ? WHERE id = ?", [outcome.periodEnd, filingId]);
    notes.push(`El PDF es del periodo cerrado el ${outcome.periodEnd}, no del ${filing.period_end}: lo he corregido.`);
  }
  const mainEnd = notes.length > outcome.notes.length ? outcome.periodEnd : filing.period_end;
  const found = new Set(outcome.facts.filter((f) => near(f.periodEnd, mainEnd, 10)).map((f) => f.concept));
  const gaps: ConceptGap[] = CONCEPTS.filter((c) => !found.has(c.id)).map((c) => ({ accession: filing.accession_no, concept: c.id }));
  await replaceFilingFacts(db, securityId, filingId, outcome.facts, gaps, "pdf-extraction");
  if (outcome.discarded > 0) notes.push(`${outcome.discarded} cifras descartadas por fechas o páginas incoherentes.`);
  return { facts: outcome.facts.length, discarded: outcome.discarded, notes };
}
