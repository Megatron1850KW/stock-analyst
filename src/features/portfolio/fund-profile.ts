import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { recordAiUsage } from "@/db/ai-repo";
import type { Db } from "@/db/client";
import { getSecurity } from "@/db/repo";
import type { Share } from "@/domain/portfolio/positions";
import { SECTORS } from "@/domain/portfolio/sector";
import { checkBudget } from "@/features/ai/budget";
import { costUsd, usdToEur } from "@/features/ai/cost";
import { AiAnalysisError, describeApiError } from "@/features/ai/equity-analysis";
import { ETF_EXTRACTION_PROMPT, type Prompt } from "@/features/ai/prompts";
import { countPdfPages } from "@/features/document-requests/extract-pdf";

/**
 * Ficha de un ETF o ETC (CLAUDE.md §5.5). No tienen 10-K: sus datos salen de
 * la ficha comercial o del KID en PDF que subes. Haiku los copia a un esquema
 * estricto con la página de cada uno; el código valida rangos y páginas, y
 * puedes corregir cualquier dato a mano. Una sola llamada por archivo.
 */

const SECTOR_NAMES = [...SECTORS, "Otros"] as [string, ...string[]];
export const REPLICATION = ["física completa", "física optimizada (muestreo)", "sintética (swap)", "respaldado por la materia prima física", "otra"] as const;

const pct = z.object({ nombre: z.string(), peso: z.number() });

export const etfExtractionSchema = z.object({
  coincide: z.boolean(),
  ter: z.number().nullable(),
  indice: z.string().nullable(),
  replicacion: z.enum(REPLICATION).nullable(),
  domicilio: z.string().nullable(),
  patrimonio_millones: z.number().nullable(),
  divisa_patrimonio: z.string().nullable(),
  divisa_fondo: z.string().nullable(),
  dividendos: z.enum(["acumulación", "distribución"]).nullable(),
  colateral: z.string().nullable(),
  principales_posiciones: z.array(pct),
  sectores: z.array(z.object({ nombre: z.enum(SECTOR_NAMES), peso: z.number() })),
  paises: z.array(pct),
  fecha_datos: z.string().nullable(),
  paginas: z.array(z.object({ dato: z.string(), pagina: z.number().int() })),
  notas: z.string(),
});
export type EtfExtraction = z.infer<typeof etfExtractionSchema>;

/** Lo que se guarda en fund_profiles.profile_json (pesos de 0 a 1). */
export const fundProfileSchema = z.object({
  ter: z.number().min(0).max(0.05).nullable(),
  index: z.string().nullable(),
  replication: z.enum(REPLICATION).nullable(),
  domicile: z.string().regex(/^[A-Z]{2}$/).nullable(),
  aumMillions: z.number().positive().nullable(),
  aumCurrency: z.string().nullable(),
  fundCurrency: z.string().nullable(),
  distribution: z.enum(["acumulación", "distribución"]).nullable(),
  collateral: z.string().nullable(),
  holdings: z.array(z.object({ name: z.string(), weight: z.number() })),
  sectors: z.array(z.object({ key: z.string(), weight: z.number() })),
  countries: z.array(z.object({ key: z.string(), weight: z.number() })),
  asOf: z.string().nullable(),
  /** Página del PDF de cada dato (campo → página). */
  pages: z.record(z.string(), z.number().int().positive()),
  notes: z.array(z.string()),
});
export type FundProfile = z.infer<typeof fundProfileSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_OF: Record<string, string> = {
  ter: "ter", indice: "index", replicacion: "replication", domicilio: "domicile", patrimonio_millones: "aumMillions",
  divisa_fondo: "fundCurrency", dividendos: "distribution", colateral: "collateral", principales_posiciones: "holdings",
  sectores: "sectors", paises: "countries", fecha_datos: "asOf",
};

/** Pesos en % → fracción, descartando los imposibles; suma acotada a 100 %. */
function shares(xs: { nombre: string; peso: number }[], key: (n: string) => string | null): { list: Share[]; dropped: number } {
  const list: Share[] = [];
  let dropped = 0;
  for (const x of xs) {
    const k = key(x.nombre);
    if (!k || !Number.isFinite(x.peso) || x.peso <= 0 || x.peso > 100) {
      dropped++;
      continue;
    }
    const prev = list.find((s) => s.key === k);
    if (prev) prev.weight += x.peso / 100;
    else list.push({ key: k, weight: x.peso / 100 });
  }
  const total = list.reduce((t, s) => t + s.weight, 0);
  // Una ficha puede pasar del 100 % por redondeos; más de un 105 % es un error de lectura
  if (total > 1.05) return { list: [], dropped: dropped + list.length };
  // De mayor a menor peso, con «Otros» siempre al final
  return { list: list.sort((a, b) => Number(a.key === "Otros") - Number(b.key === "Otros") || b.weight - a.weight), dropped };
}

/** De la salida de la IA a la ficha guardada, con validación determinista. */
export function toFundProfile(out: EtfExtraction, pages: number): FundProfile {
  const notes = out.notas.trim() ? [out.notas.trim()] : [];
  const sectors = shares(out.sectores, (n) => n);
  const countries = shares(out.paises, (n) => (/^[A-Z]{2}$/.test(n.toUpperCase()) ? n.toUpperCase() : /otros|resto|other/i.test(n) ? "Otros" : null));
  const holdings = shares(out.principales_posiciones.slice(0, 10), (n) => n.trim() || null);
  const dropped = sectors.dropped + countries.dropped + holdings.dropped;
  if (dropped > 0) notes.push(`${dropped} pesos descartados por no ser coherentes.`);
  const ter = out.ter !== null && out.ter >= 0 && out.ter <= 5 ? out.ter / 100 : null;
  if (out.ter !== null && ter === null) notes.push(`Gasto anual leído no válido (${out.ter} %): descartado.`);
  const domicile = out.domicilio && /^[A-Z]{2}$/.test(out.domicilio.toUpperCase()) ? out.domicilio.toUpperCase() : null;
  const pageMap: Record<string, number> = {};
  for (const p of out.paginas) {
    const field = FIELD_OF[p.dato];
    if (field && p.pagina >= 1 && p.pagina <= pages) pageMap[field] = p.pagina;
  }
  return {
    ter,
    index: out.indice?.trim() || null,
    replication: out.replicacion,
    domicile,
    aumMillions: out.patrimonio_millones !== null && out.patrimonio_millones > 0 ? out.patrimonio_millones : null,
    aumCurrency: out.divisa_patrimonio?.toUpperCase() ?? null,
    fundCurrency: out.divisa_fondo?.toUpperCase() ?? null,
    distribution: out.dividendos,
    collateral: out.colateral?.trim() || null,
    holdings: holdings.list.map((h) => ({ name: h.key, weight: h.weight })),
    sectors: sectors.list,
    countries: countries.list,
    asOf: out.fecha_datos && ISO_DATE.test(out.fecha_datos) ? out.fecha_datos : null,
    pages: pageMap,
    notes,
  };
}

export interface FundProfileRow {
  security_id: number;
  profile: FundProfile;
  origin: "pdf-extraction" | "user";
  doc_path: string | null;
  doc_name: string | null;
  doc_sha256: string | null;
  model: string | null;
  prompt_version: string | null;
  cost_eur: number | null;
  extracted_at: string | null;
  edited_at: string | null;
}

export async function getFundProfiles(db: Db): Promise<Map<number, FundProfileRow>> {
  const rows = await db.select<Omit<FundProfileRow, "profile"> & { profile_json: string }>("SELECT * FROM fund_profiles");
  const out = new Map<number, FundProfileRow>();
  for (const { profile_json, ...r } of rows) {
    const parsed = fundProfileSchema.safeParse(JSON.parse(profile_json));
    if (parsed.success) out.set(r.security_id, { ...r, profile: parsed.data });
    else console.error(`[etf] ficha guardada no válida (${r.security_id}): ${parsed.error.message}`);
  }
  return out;
}

/** Solicitud de «Documentos pendientes» para un ETF/ETC de la watchlist sin ficha. */
export const FUND_SHEET_REQUEST = "Ficha del fondo (factsheet) o KID";

/** Con la ficha ya leída (o escrita a mano), su solicitud queda cerrada. */
async function resolveFundSheetRequests(db: Db, securityId: number, now: string): Promise<void> {
  await db.execute(
    "UPDATE document_requests SET status = 'fulfilled', resolved_at = ? WHERE security_id = ? AND status = 'pending' AND document_type = ?",
    [now, securityId, FUND_SHEET_REQUEST],
  );
}

/** Corrección manual de la ficha: queda marcada como editada por ti. */
export async function saveFundProfileEdit(db: Db, securityId: number, profile: FundProfile): Promise<void> {
  const p = fundProfileSchema.parse(profile);
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO fund_profiles (security_id, profile_json, origin, edited_at) VALUES (?, ?, 'user', ?)
     ON CONFLICT (security_id) DO UPDATE SET profile_json = excluded.profile_json, edited_at = excluded.edited_at`,
    [securityId, JSON.stringify(p), now],
  );
  await resolveFundSheetRequests(db, securityId, now);
}

export interface FundDoc {
  path: string;
  name: string;
  sha256: string;
}

export interface FundExtractDeps {
  db: Db;
  client: Anthropic;
  readPdf: (path: string) => Promise<Uint8Array>;
  model: string;
  budgetEur: number;
  prompt?: Prompt;
  now?: Date;
}

export type FundExtractResult = { status: "cached" | "created"; profile: FundProfile; costEur: number | null };

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let k = 0; k < bytes.length; k += 32_768) bin += String.fromCharCode(...bytes.subarray(k, k + 32_768));
  return btoa(bin);
}

const TOKENS_PER_PAGE = 3000;

export async function extractFundProfile(
  deps: FundExtractDeps,
  securityId: number,
  doc: FundDoc,
  opts: { allowOverBudget?: boolean } = {},
): Promise<FundExtractResult> {
  const { db, client, model } = deps;
  const prompt = deps.prompt ?? ETF_EXTRACTION_PROMPT;
  const [existing] = await db.select<{ profile_json: string; doc_sha256: string | null; prompt_version: string | null }>(
    "SELECT profile_json, doc_sha256, prompt_version FROM fund_profiles WHERE security_id = ?",
    [securityId],
  );
  // Mismo archivo y mismo prompt: no se vuelve a gastar
  if (existing && existing.doc_sha256 === doc.sha256 && existing.prompt_version === prompt.key) {
    return { status: "cached", profile: fundProfileSchema.parse(JSON.parse(existing.profile_json)), costEur: null };
  }
  const security = await getSecurity(db, securityId);
  const [kindRow] = await db.select<{ kind: string }>("SELECT kind FROM securities WHERE id = ?", [securityId]);
  if (!security || !kindRow) throw new AiAnalysisError("Este valor ya no está guardado.");

  const bytes = await deps.readPdf(doc.path);
  const pages = await countPdfPages(bytes);
  const userText = [
    "<fondo>",
    JSON.stringify({ nombre: security.name, isin: security.isin, tipo: kindRow.kind === "etc" ? "ETC" : "ETF", sectores_admitidos: SECTOR_NAMES }),
    "</fondo>",
    "Copia los datos siguiendo las instrucciones y el esquema de salida.",
  ].join("\n");

  const rate = await checkBudget(db, {
    budgetEur: deps.budgetEur,
    estimateUsd: costUsd({ input_tokens: pages * TOKENS_PER_PAGE + (prompt.text.length + userText.length) / 4, output_tokens: 2500 }, model),
    now: deps.now,
    allowOverBudget: opts.allowOverBudget,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 8000,
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
      output_config: { format: betaZodOutputFormat(etfExtractionSchema) },
    });
  } catch (e) {
    const status = typeof e === "object" && e && "status" in e ? Number((e as { status: unknown }).status) : null;
    throw new AiAnalysisError(
      status === 400 || status === 413 ? "Claude no ha podido leer este PDF (quizá tiene demasiadas páginas). Sube la ficha mensual o el KID, que son cortos." : describeApiError(e),
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
  const checked = etfExtractionSchema.safeParse(response.parsed_output);
  if (!checked.success || response.stop_reason === "max_tokens") {
    console.error("[ia] ficha de ETF no válida:", checked.error?.message ?? response.stop_reason);
    throw new AiAnalysisError("La IA devolvió la ficha con un formato inesperado. No se ha guardado nada.");
  }
  if (!checked.data.coincide) {
    throw new AiAnalysisError(`Este PDF no parece la ficha de ${security.name}. ${checked.data.notas}`.trim());
  }

  const profile = toFundProfile(checked.data, pages);
  const now = (deps.now ?? new Date()).toISOString();
  await db.execute(
    `INSERT INTO fund_profiles (security_id, profile_json, origin, doc_path, doc_name, doc_sha256, model, prompt_version, cost_eur, extracted_at, edited_at)
     VALUES (?, ?, 'pdf-extraction', ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (security_id) DO UPDATE SET profile_json = excluded.profile_json, origin = excluded.origin, doc_path = excluded.doc_path,
       doc_name = excluded.doc_name, doc_sha256 = excluded.doc_sha256, model = excluded.model, prompt_version = excluded.prompt_version,
       cost_eur = excluded.cost_eur, extracted_at = excluded.extracted_at, edited_at = NULL`,
    [securityId, JSON.stringify(profile), doc.path, doc.name, doc.sha256, response.model, prompt.key, cost.eur, now],
  );
  await resolveFundSheetRequests(db, securityId, now);
  return { status: "created", profile, costEur: cost.eur };
}
