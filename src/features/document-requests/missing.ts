import type { DocumentRequestInput } from "@/db/repo";
import type { FilingRef } from "@/domain/fundamentals/select-filings";

/**
 * Qué informes hay que pedir al usuario porque la app no los encuentra con
 * datos estructurados (CLAUDE.md §4.4). Cada solicitud dice exactamente qué
 * documento es, cuándo se publicó (aprox.) y dónde suele estar.
 */

/** Cifras sin las que no se puede analizar un informe. */
export const KEY_CONCEPTS = ["revenue", "net_income", "operating_cash_flow"] as const;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  // Fin de mes si el original lo era (31-dic + 6 meses → 30-jun)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

/** «septiembre 2026». */
export function monthText(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** «H1 2026» (semestre que cierra en esa fecha, por el año natural en que cierra). */
const halfLabel = (end: string) => `H1 ${end.slice(0, 4)}`;

export interface MissingInput {
  filerType: "domestic" | "foreign";
  annual: FilingRef[];
  interim: FilingRef[];
  /** Conceptos clave que faltan, por nº de accession de los informes elegidos. */
  gapsByAccession: Map<string, string[]>;
  secUrl: (f: FilingRef) => string;
  today: Date;
}

const SEC_PLACE = "EDGAR de la SEC (sec.gov) o la web de inversores de la empresa";

export function missingReportRequests(input: MissingInput): DocumentRequestInput[] {
  const out: DocumentRequestInput[] = [];
  const todayIso = input.today.toISOString().slice(0, 10);

  // Emisores extranjeros (20-F): sus intermedios van en 6-K sin datos XBRL
  const latestAnnual = input.annual[0];
  if (input.filerType === "foreign" && input.interim.length === 0 && latestAnnual) {
    const ends = [6, -6, -18].map((m) => addMonths(latestAnnual.reportDate, m));
    for (const end of ends.filter((e) => addMonths(e, 3) <= todayIso).slice(0, 3)) {
      out.push({
        documentType: `Informe semestral ${halfLabel(end)} (6-K)`,
        period: end,
        expectedDate: addMonths(end, 2).slice(0, 7),
        preferredFormat: "PDF",
        whereToFind: `${SEC_PLACE}. En EDGAR aparece como formulario 6-K con los resultados del semestre.`,
      });
    }
  }

  // Informes elegidos a los que les faltan cifras clave en XBRL
  for (const f of [...input.annual, ...input.interim]) {
    const missing = input.gapsByAccession.get(f.accession)?.filter((c) => (KEY_CONCEPTS as readonly string[]).includes(c)) ?? [];
    if (missing.length === 0) continue;
    out.push({
      documentType: `${f.form} con cierre ${f.reportDate}`,
      period: f.reportDate,
      expectedDate: f.filingDate.slice(0, 7),
      preferredFormat: "PDF",
      whereToFind: `Sus datos estructurados no traen ${missing.map((c) => CONCEPT_TEXT[c] ?? c).join(", ")}. Está en ${input.secUrl(f)}`,
    });
  }
  return out;
}

const CONCEPT_TEXT: Record<string, string> = {
  revenue: "las ventas",
  net_income: "el beneficio neto",
  operating_cash_flow: "la caja de las operaciones",
};
