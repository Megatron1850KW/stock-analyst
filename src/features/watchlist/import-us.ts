import { filingUrl, findTicker, type SecClient } from "@/data/sec-edgar/client";
import type { Db } from "@/db/client";
import { isTracked, pruneFilings, replaceFilingFacts, syncDocumentRequests, upsertFiling, upsertUsSecurity } from "@/db/repo";
import { missingReportRequests } from "@/features/document-requests/missing";
import { historyFilingsFromFacts } from "@/domain/fundamentals/history-filings";
import type { CompanyFacts } from "@/data/sec-edgar/schemas";
import { parseIxbrl } from "@/domain/fundamentals/ixbrl";
import { normalizeCompanyFacts, type NormalizeResult } from "@/domain/fundamentals/normalize";
import { factsFromInline, mergeFacts } from "@/domain/fundamentals/sec-inline";
import { needsOlderPages, selectFilings, toRows, type FilingRef } from "@/domain/fundamentals/select-filings";

export type ImportStep = "ticker" | "filings" | "facts" | "save";

export const IMPORT_STEP_LABELS: Record<ImportStep, string> = {
  ticker: "Buscando la empresa en la SEC",
  filings: "Localizando sus últimos informes",
  facts: "Descargando las cifras (XBRL)",
  save: "Guardando en tu Mac",
};

export interface ImportResult {
  securityId: number;
  ticker: string;
  name: string;
  annual: number;
  interim: number;
  /** Anuales antiguos añadidos solo para la valoración histórica. */
  historyYears: number;
  facts: number;
  gaps: number;
  notes: string[];
  /** Informes que hay que pedir al usuario (bandeja «Documentos pendientes»). */
  requests: number;
}

export class ImportError extends Error {
  name = "ImportError";
}

/** Páginas antiguas de presentaciones que se piden como mucho (cada una ~1.000 presentaciones). */
const MAX_OLDER_PAGES = 3;

/**
 * Alta de una acción de EE. UU.: ticker → CIK, presentaciones, 3 anuales + 3
 * trimestrales, cifras XBRL normalizadas y guardado con su origen.
 * Es idempotente: volver a ejecutarlo actualiza sin duplicar.
 */
/** Conceptos sin los que la ficha se queda sin valoración: si faltan, se mira el propio documento. */
const KEY_CONCEPTS = ["revenue", "net_income", "operating_cash_flow"];

/**
 * Lo que companyfacts no trae (un informe aún sin cargar, BPA solo por clase de
 * acción) se lee del Inline XBRL del propio informe, sin IA. Un fallo no impide
 * la importación: los huecos quedan como «Sin dato».
 */
async function inlineFallback(sec: SecClient, cik: string, chosen: FilingRef[], normalized: NormalizeResult): Promise<CompanyFacts | null> {
  if (!sec.document) return null;
  const gaps = new Map<string, Set<string>>();
  for (const g of normalized.gaps) gaps.set(g.accession, (gaps.get(g.accession) ?? new Set()).add(g.concept));
  let out: CompanyFacts | null = null;
  for (const f of chosen) {
    const missing = gaps.get(f.accession);
    if (!missing) continue;
    const lacksKey = KEY_CONCEPTS.some((c) => missing.has(c));
    const lacksEps = missing.has("eps_diluted") && missing.has("eps_basic");
    if (!lacksKey && !lacksEps) continue;
    try {
      const doc = parseIxbrl(await sec.document(filingUrl(cik, f.accession, f.primaryDocument)));
      const found = factsFromInline(doc, { accession: f.accession, filed: f.filingDate });
      out = out ? mergeFacts(out, found) : found;
    } catch (e) {
      console.warn(`[sec] no se pudo leer el documento ${f.accession}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

export async function importUsTicker(
  sec: SecClient,
  db: Db,
  rawTicker: string,
  onStep: (step: ImportStep) => void = () => {},
  today: Date = new Date(),
  /**
   * Competidor: se guardan sus datos sin añadirlo a la watchlist ni pedirte sus
   * informes. `held`: está (o va a estar) en tu cartera, así que sí se piden.
   */
  opts: { watchlist?: boolean; held?: boolean } = {},
): Promise<ImportResult> {
  const watchlist = opts.watchlist ?? true;
  onStep("ticker");
  const match = findTicker(await sec.tickers(), rawTicker);
  if (!match) {
    throw new ImportError(
      `No encuentro «${rawTicker.trim().toUpperCase()}» entre las empresas que presentan en la SEC. Revisa el ticker; si cotiza en Europa, podrás añadirla por ISIN en la fase 6.`,
    );
  }

  onStep("filings");
  const submissions = await sec.submissions(match.cik);
  let rows: FilingRef[] = toRows(submissions.filings.recent);
  for (const file of submissions.filings.files.slice(0, MAX_OLDER_PAGES)) {
    if (!needsOlderPages(rows)) break;
    rows = rows.concat(toRows(await sec.submissionsFile(file.name)));
  }
  const selection = selectFilings(rows);
  const chosen = [...selection.annual, ...selection.interim];
  if (chosen.length === 0) {
    throw new ImportError(`${match.name} no tiene informes 10-K, 10-Q ni 20-F en EDGAR, así que no hay datos que analizar.`);
  }

  onStep("facts");
  let facts = await sec.companyFacts(match.cik);
  const history = historyFilingsFromFacts(facts, chosen);
  let normalized = normalizeCompanyFacts(facts, [...chosen, ...history]);
  const inline = await inlineFallback(sec, match.cik, chosen, normalized);
  if (inline) {
    facts = mergeFacts(facts, inline);
    normalized = normalizeCompanyFacts(facts, [...chosen, ...history]);
  }

  onStep("save");
  const securityId = await upsertUsSecurity(db, {
    ticker: match.ticker,
    cik: match.cik,
    name: submissions.name || match.name,
    exchange: match.exchange,
    sic: submissions.sic ?? null,
    sicDescription: submissions.sicDescription ?? null,
    fiscalYearEnd: submissions.fiscalYearEnd ?? null,
    filerType: selection.filerType,
    // Cotiza en EE. UU.: el precio va en dólares aunque los estados vengan en otra divisa
    currency: "USD",
    reportingCurrency: normalized.currency,
  }, watchlist);
  const toSave = [
    ...chosen.map((f) => ({ f, role: "core" as const })),
    ...history.map((f) => ({ f, role: "history" as const })),
  ];
  for (const { f: filing, role } of toSave) {
    const url = filingUrl(match.cik, filing.accession, filing.primaryDocument);
    const filingId = await upsertFiling(db, securityId, filing, url, role);
    await replaceFilingFacts(
      db,
      securityId,
      filingId,
      normalized.facts.filter((f) => f.accession === filing.accession),
      normalized.gaps.filter((g) => g.accession === filing.accession),
    );
  }
  await pruneFilings(db, securityId, toSave.map(({ f }) => f.accession));

  const gapsByAccession = new Map<string, string[]>();
  for (const g of normalized.gaps) gapsByAccession.set(g.accession, [...(gapsByAccession.get(g.accession) ?? []), g.concept]);
  const requests = !(watchlist || opts.held || (await isTracked(db, securityId))) ? [] : missingReportRequests({
    filerType: selection.filerType,
    annual: selection.annual,
    interim: selection.interim,
    gapsByAccession,
    secUrl: (f) => filingUrl(match.cik, f.accession, f.primaryDocument),
    today,
  });
  await syncDocumentRequests(db, securityId, requests);

  return {
    securityId,
    ticker: match.ticker,
    name: submissions.name || match.name,
    annual: selection.annual.length,
    interim: selection.interim.length,
    historyYears: history.length,
    facts: normalized.facts.length,
    gaps: normalized.gaps.filter((g) => chosen.some((c) => c.accession === g.accession)).length,
    notes: selection.notes,
    requests: requests.length,
  };
}

/** ISIN: 2 letras de país, 9 alfanuméricos y un dígito de control. */
export function looksLikeIsin(input: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(input.trim().toUpperCase());
}

/** Dígito de control de un ISIN (Luhn sobre letras convertidas a números): descarta ISIN inventados o mal copiados. */
export function isinChecksumOk(input: string): boolean {
  const isin = input.trim().toUpperCase();
  if (!looksLikeIsin(isin)) return false;
  const digits = [...isin].map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join("");
  let sum = 0;
  for (let k = 0; k < digits.length; k++) {
    let d = Number(digits[digits.length - 1 - k]);
    if (k % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}
