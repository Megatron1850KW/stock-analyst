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

const WANTED = 3;

/** Dónde publica cada país la información regulada (CLAUDE.md §4.2). */
const EU_REGULATOR: Record<string, string> = {
  ES: "la CNMV (cnmv.es → Información financiera regulada)",
  FR: "la AMF (info-financiere.fr)",
  DE: "el Unternehmensregister (unternehmensregister.de)",
  NL: "la AFM (afm.nl → registro de informes financieros)",
  IT: "Consob / Borsa Italiana (eMarket Storage)",
  PT: "la CMVM (cmvm.pt)",
  BE: "la FSMA (STORI)",
  IE: "Euronext Dublin",
  LU: "la Bolsa de Luxemburgo (OAM)",
  AT: "la OeKB (issuer-info.at)",
  FI: "Nasdaq Helsinki",
};

export interface EuMissingInput {
  country: string | null;
  /** Cierres de ejercicio de los informes anuales encontrados (el más reciente primero). */
  annualEnds: string[];
  /** Cierres de los informes intermedios que ya hay (descargados o subidos por ti). */
  interimEnds: string[];
  today: Date;
}

const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 20 * 86_400_000;

/**
 * Europa: los informes intermedios no tienen formato estructurado obligatorio,
 * así que se piden los 3 últimos semestrales (H1) que ya deberían estar
 * publicados (unos 2 meses tras el cierre). Si faltan anuales (la empresa no
 * está en filings.xbrl.org), se piden también los 3 últimos anuales.
 */
export function euMissingRequests(input: EuMissingInput): DocumentRequestInput[] {
  const todayIso = input.today.toISOString().slice(0, 10);
  const where = `la web de inversores de la empresa${input.country && EU_REGULATOR[input.country] ? ` o ${EU_REGULATOR[input.country]}` : ""}`;
  const out: DocumentRequestInput[] = [];
  const published = (end: string, months: number) => addMonths(end, months) <= todayIso;

  // Cierre de ejercicio: el del último anual o, si no hay ninguno, el 31-dic.
  const fyEnd = input.annualEnds[0] ?? `${Number(todayIso.slice(0, 4)) - 1}-12-31`;
  if (input.annualEnds.length < WANTED) {
    for (const end of [0, -12, -24, -36].map((m) => addMonths(fyEnd, m)).filter((e) => published(e, 4))) {
      if (out.length >= WANTED - input.annualEnds.length) break;
      if (input.annualEnds.some((a) => near(a, end))) continue;
      out.push({
        documentType: `Informe financiero anual ${end.slice(0, 4)}`,
        period: end,
        expectedDate: addMonths(end, 3).slice(0, 7),
        preferredFormat: "ZIP ESEF o PDF",
        whereToFind: `${where}. Es el informe anual con las cuentas consolidadas auditadas.`,
      });
    }
  }

  // Plazo legal: 3 meses; la mayoría publica a los 2
  const halves = [6, -6, -18, -30].map((m) => addMonths(fyEnd, m)).filter((e) => published(e, 2)).slice(0, WANTED);
  for (const end of halves) {
    if (input.interimEnds.some((e) => near(e, end))) continue;
    out.push({
      documentType: `Informe semestral ${halfLabel(end)}`,
      period: end,
      expectedDate: addMonths(end, 2).slice(0, 7),
      preferredFormat: "PDF",
      whereToFind: `${where}. Suele llamarse «Informe financiero semestral» o «Resultados del primer semestre». Si la empresa publica resultados trimestrales, también puedes subirlos.`,
    });
  }
  return out;
}
