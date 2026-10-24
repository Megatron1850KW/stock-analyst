import type { CompanyFacts } from "@/data/sec-edgar/schemas";
import { ANNUAL_FORMS, type FilingRef } from "./select-filings";

/** Años de historia que se intentan cubrir para valorar frente a la propia historia (§5.1.4). */
export const HISTORY_YEARS = 11;

const DAY = 86_400_000;

/**
 * Informes anuales antiguos a partir de companyfacts (sin pedir más páginas
 * de presentaciones a la SEC). Cada valor XBRL lleva el nº de accession, el
 * formulario y la fecha de presentación, así que basta con agruparlos.
 * La fecha de cierre de cada informe es el final más reciente de sus cifras
 * anuales (duración de ~1 año). Se excluyen enmiendas y los ejercicios que ya
 * cubren los informes principales.
 */
export function historyFilingsFromFacts(facts: CompanyFacts, core: FilingRef[], years = HISTORY_YEARS): FilingRef[] {
  const byAccn = new Map<string, { form: string; filed: string; end: string }>();
  for (const concepts of Object.values(facts.facts)) {
    for (const concept of Object.values(concepts)) {
      for (const entries of Object.values(concept.units)) {
        for (const e of entries) {
          if (e.fp !== "FY" || !(ANNUAL_FORMS as readonly string[]).includes(e.form) || !e.start) continue;
          const len = (Date.parse(e.end) - Date.parse(e.start)) / DAY;
          if (len < 330 || len > 400) continue;
          const prev = byAccn.get(e.accn);
          if (!prev || e.end > prev.end) byAccn.set(e.accn, { form: e.form, filed: e.filed, end: e.end });
        }
      }
    }
  }
  const coreAnnual = core.filter((f) => f.periodType === "annual");
  const covered = new Set(coreAnnual.map((f) => f.reportDate.slice(0, 7)));
  const coreAccn = new Set(core.map((f) => f.accession));
  const byPeriod = new Map<string, FilingRef>();
  for (const [accession, v] of byAccn) {
    if (coreAccn.has(accession) || covered.has(v.end.slice(0, 7))) continue;
    const prev = byPeriod.get(v.end);
    if (prev && prev.filingDate >= v.filed) continue;
    byPeriod.set(v.end, { accession, form: v.form, periodType: "annual", reportDate: v.end, filingDate: v.filed, primaryDocument: "" });
  }
  return [...byPeriod.values()]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, Math.max(0, years - coreAnnual.length));
}
