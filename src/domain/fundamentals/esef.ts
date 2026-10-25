import type { EsefFiling, XbrlJson } from "@/data/esef/schemas";
import type { CompanyFacts, FactEntry } from "@/data/sec-edgar/schemas";
import type { FilingRef } from "./select-filings";

/**
 * Informes europeos ESEF (CLAUDE.md §4.2) en el mismo formato que el
 * companyfacts de la SEC, para reutilizar la normalización (normalize.ts) y
 * todos los cálculos sin duplicarlos.
 *
 * Reglas al leer el xBRL-JSON (formato OIM de XBRL International):
 * - Solo cifras sin dimensiones extra: las que llevan un eje (segmento,
 *   componente de patrimonio…) son desgloses, no el total del grupo.
 * - Fechas: en xBRL-JSON el final de un periodo es el instante siguiente
 *   («2026-02-01T00:00:00» = cierre del 31-01-2026); se pasa a la fecha de cierre.
 * - Unidades: iso4217:EUR → EUR, xbrli:shares → shares, EUR/shares para el BPA.
 * - Las etiquetas propias de la empresa (p. ej. itx:…) se guardan con el
 *   prefijo común «ext», sea cual sea el que use cada año, para que los pocos
 *   mapeos documentados en concepts.ts (UniCredit) valgan para todos sus informes.
 */

export const ESEF_FORM = "ESEF";
/** Dimensiones que tiene cualquier hecho; cualquier otra es un desglose. */
const CORE_DIMENSIONS = new Set(["concept", "entity", "period", "unit", "language"]);
const DAY = 86_400_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Fecha de cierre a partir de un instante de xBRL-JSON. */
export function closingDate(instant: string): string {
  const [date, time] = instant.split("T");
  if (!date) return instant;
  if (!time || /^0{2}:0{2}:0{2}(\.0+)?Z?$/.test(time)) {
    return time ? isoDay(Date.parse(`${date}T00:00:00Z`) - DAY) : date;
  }
  return date;
}

/** Fecha de inicio: un inicio a medianoche ya es el primer día del periodo. */
const openingDate = (instant: string) => instant.split("T")[0] ?? instant;

export function unitOf(unit: string | undefined): string | null {
  if (!unit) return null;
  const part = (u: string) => {
    const [ns, name] = u.split(":");
    if (!name) return u;
    if (ns === "iso4217") return name;
    if (name === "shares") return "shares";
    return name;
  };
  const [num, den] = unit.split("/");
  return den ? `${part(num!)}/${part(den)}` : part(num!);
}

export interface EsefFilingInfo {
  accession: string;
  filed: string;
}

/**
 * Añade las cifras de un informe ESEF a `target` (con forma de companyfacts),
 * cada una marcada con el id del informe como «accession».
 */
/** Espacios de nombres de taxonomías estándar (NIIF, US-GAAP, SEC, XBRL, divisas, unidades). */
const STANDARD_NS = /xbrl\.ifrs\.org|fasb\.org|xbrl\.sec\.gov|xbrl\.org\/|iso4217|utr/i;

export function addXbrlJson(target: CompanyFacts, doc: XbrlJson, filing: EsefFilingInfo): number {
  let added = 0;
  const namespaces: Record<string, string> = doc.documentInfo?.namespaces ?? {};
  const prefixOf = (p: string) => (namespaces[p] && !STANDARD_NS.test(namespaces[p]) ? "ext" : p);
  for (const fact of Object.values(doc.facts)) {
    const dims = fact.dimensions;
    if (Object.keys(dims).some((k) => !CORE_DIMENSIONS.has(k))) continue;
    const [prefix, name] = (dims.concept ?? "").split(":");
    const unit = unitOf(dims.unit);
    const period = dims.period;
    if (!prefix || !name || !unit || !period || fact.value === null) continue;
    const val = Number(fact.value);
    if (!Number.isFinite(val)) continue;
    const [a, b] = period.split("/");
    const entry: FactEntry = b
      ? { start: openingDate(a!), end: closingDate(b), val, accn: filing.accession, form: ESEF_FORM, filed: filing.filed }
      : { end: closingDate(a!), val, accn: filing.accession, form: ESEF_FORM, filed: filing.filed };
    if (entry.start) {
      const len = (Date.parse(entry.end) - Date.parse(entry.start)) / DAY;
      entry.fp = len >= 330 && len <= 400 ? "FY" : null;
    }
    const concepts = (target.facts[prefixOf(prefix)] ??= {});
    const concept = (concepts[name] ??= { units: {} });
    (concept.units[unit] ??= []).push(entry);
    added++;
  }
  return added;
}

export function emptyFacts(lei: string, name: string): CompanyFacts {
  return { cik: lei, entityName: name, facts: {} };
}

/**
 * Tipo de periodo de un informe según la duración de su cuenta de resultados:
 * un año → anual; menos → intermedio. Null si no trae ventas ni beneficio.
 */
export function periodTypeOf(facts: CompanyFacts, accession: string, periodEnd: string): "annual" | "interim" | null {
  const ifrs = facts.facts["ifrs-full"] ?? {};
  for (const tag of ["Revenue", "ProfitLoss", "ProfitLossAttributableToOwnersOfParent"]) {
    for (const entries of Object.values(ifrs[tag]?.units ?? {})) {
      const e = entries.find((x) => x.accn === accession && x.start && x.end === periodEnd);
      if (e) return e.fp === "FY" ? "annual" : "interim";
    }
  }
  return null;
}

/**
 * Un informe por fecha de cierre. filings.xbrl.org guarda a veces varias
 * versiones del mismo informe (reediciones, otro idioma): se usa la más
 * reciente con xBRL-JSON, y como fecha de publicación la de la primera versión.
 */
export function pickEsefFilings(list: EsefFiling[]): FilingRef[] {
  const byPeriod = new Map<string, EsefFiling[]>();
  for (const f of list) {
    if (!f.attributes.json_url) continue;
    const k = f.attributes.period_end;
    byPeriod.set(k, [...(byPeriod.get(k) ?? []), f]);
  }
  const out: FilingRef[] = [];
  for (const [periodEnd, versions] of byPeriod) {
    const latest = [...versions].sort((a, b) => b.attributes.fxo_id.localeCompare(a.attributes.fxo_id))[0]!;
    const dates = versions.map((v) => (v.attributes.published ?? v.attributes.date_added ?? "").slice(0, 10)).filter(Boolean).sort();
    out.push({
      accession: latest.attributes.fxo_id,
      form: ESEF_FORM,
      periodType: "annual",
      reportDate: periodEnd,
      filingDate: dates[0] ?? "",
      primaryDocument: latest.attributes.json_url!,
      reportUrl: latest.attributes.report_url ?? undefined,
    });
  }
  return out.sort((a, b) => b.reportDate.localeCompare(a.reportDate));
}
