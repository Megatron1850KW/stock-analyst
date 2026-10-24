import type { FilingColumns } from "@/data/sec-edgar/schemas";

/**
 * Elección de informes (CLAUDE.md §1.2 y §4.1): los 3 últimos anuales
 * (10-K, o 20-F/40-F para emisores extranjeros) y los 3 últimos intermedios
 * (10-Q). Las enmiendas (/A) se ignoran: se usa el informe original.
 */

export const ANNUAL_FORMS = ["10-K", "20-F", "40-F"] as const;
export const INTERIM_FORMS = ["10-Q"] as const;
export const WANTED_PER_TYPE = 3;

export interface FilingRef {
  accession: string;
  form: string;
  periodType: "annual" | "interim";
  reportDate: string;
  filingDate: string;
  primaryDocument: string;
  /** ESEF: ruta del informe XHTML en filings.xbrl.org (lo que se enlaza y se lee para la IA). */
  reportUrl?: string;
}

export interface FilingSelection {
  annual: FilingRef[];
  interim: FilingRef[];
  filerType: "domestic" | "foreign";
  /** Explicaciones para la UI cuando no hay suficientes informes. */
  notes: string[];
}

export function toRows(cols: FilingColumns): FilingRef[] {
  const rows: FilingRef[] = [];
  for (let k = 0; k < cols.accessionNumber.length; k++) {
    const form = cols.form[k] ?? "";
    const isAnnual = (ANNUAL_FORMS as readonly string[]).includes(form);
    const isInterim = (INTERIM_FORMS as readonly string[]).includes(form);
    if (!isAnnual && !isInterim) continue;
    const reportDate = cols.reportDate[k] ?? "";
    if (!reportDate) continue;
    rows.push({
      accession: cols.accessionNumber[k]!,
      form,
      periodType: isAnnual ? "annual" : "interim",
      reportDate,
      filingDate: cols.filingDate[k] ?? "",
      primaryDocument: cols.primaryDocument[k] ?? "",
    });
  }
  return rows;
}

/** Los N más recientes por fecha de cierre; si hay dos del mismo periodo, el último presentado. */
function latest(rows: FilingRef[], n: number): FilingRef[] {
  const byPeriod = new Map<string, FilingRef>();
  for (const r of rows) {
    const prev = byPeriod.get(r.reportDate);
    if (!prev || r.filingDate > prev.filingDate) byPeriod.set(r.reportDate, r);
  }
  return [...byPeriod.values()].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).slice(0, n);
}

export function selectFilings(rows: FilingRef[]): FilingSelection {
  const annual = latest(rows.filter((r) => r.periodType === "annual"), WANTED_PER_TYPE);
  const interim = latest(rows.filter((r) => r.periodType === "interim"), WANTED_PER_TYPE);
  const filerType = annual.some((r) => r.form === "20-F" || r.form === "40-F") ? "foreign" : "domestic";
  const notes: string[] = [];
  if (annual.length < WANTED_PER_TYPE) {
    notes.push(`Solo hay ${annual.length} de ${WANTED_PER_TYPE} informes anuales en EDGAR.`);
  }
  if (filerType === "foreign" && interim.length === 0) {
    notes.push(
      "Es un emisor extranjero: presenta sus resultados intermedios como 6-K, sin datos estructurados. Se pedirán como documento en la fase 6.",
    );
  } else if (interim.length < WANTED_PER_TYPE) {
    notes.push(`Solo hay ${interim.length} de ${WANTED_PER_TYPE} informes trimestrales en EDGAR.`);
  }
  return { annual, interim, filerType, notes };
}

/** true si con las presentaciones recientes no basta y hay que pedir páginas antiguas. */
export function needsOlderPages(rows: FilingRef[]): boolean {
  const s = selectFilings(rows);
  return s.annual.length < WANTED_PER_TYPE || (s.filerType === "domestic" && s.interim.length < WANTED_PER_TYPE);
}
