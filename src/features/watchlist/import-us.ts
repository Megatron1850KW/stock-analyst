import { filingUrl, findTicker, type SecClient } from "@/data/sec-edgar/client";
import type { Db } from "@/db/client";
import { pruneFilings, replaceFilingFacts, syncDocumentRequests, upsertFiling, upsertUsSecurity } from "@/db/repo";
import { missingReportRequests } from "@/features/document-requests/missing";
import { historyFilingsFromFacts } from "@/domain/fundamentals/history-filings";
import { normalizeCompanyFacts } from "@/domain/fundamentals/normalize";
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
export async function importUsTicker(
  sec: SecClient,
  db: Db,
  rawTicker: string,
  onStep: (step: ImportStep) => void = () => {},
  today: Date = new Date(),
): Promise<ImportResult> {
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
  const facts = await sec.companyFacts(match.cik);
  const history = historyFilingsFromFacts(facts, chosen);
  const normalized = normalizeCompanyFacts(facts, [...chosen, ...history]);

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
  });
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
  const requests = missingReportRequests({
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
