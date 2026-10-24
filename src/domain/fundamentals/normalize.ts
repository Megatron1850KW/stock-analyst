import type { CompanyFacts, FactEntry } from "@/data/sec-edgar/schemas";
import { CONCEPTS, type ConceptDef, type ConceptKind, type TagRef } from "./concepts";
import type { FilingRef } from "./select-filings";

/** Una cifra del modelo común con todo lo necesario para trazar su origen. */
export interface NormalizedFact {
  accession: string;
  concept: string;
  sourceTag: string;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
}

export interface ConceptGap {
  accession: string;
  concept: string;
}

export interface NormalizeResult {
  facts: NormalizedFact[];
  gaps: ConceptGap[];
  /** Divisa de los estados financieros (la de las cifras monetarias). */
  currency: string | null;
}

/** Margen para aceptar que una cifra es del periodo del informe (cierres de 52/53 semanas). */
const PERIOD_TOLERANCE_DAYS = 10;

const UNIT_MATCHERS: Record<ConceptKind, (unit: string) => boolean> = {
  money: (u) => /^[A-Z]{3}$/.test(u),
  perShare: (u) => /^[A-Z]{3}\/shares$/.test(u),
  shares: (u) => u === "shares",
};

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function entriesFor(
  facts: CompanyFacts,
  ref: TagRef,
  kind: ConceptKind,
  accession: string,
): { unit: string; entries: FactEntry[] } | null {
  const concept = facts.facts[ref.taxonomy]?.[ref.tag];
  if (!concept) return null;
  // Preferimos USD si hay varias divisas; si no, la primera que tenga datos del informe
  const units = Object.keys(concept.units)
    .filter(UNIT_MATCHERS[kind])
    .sort((a, b) => Number(b.startsWith("USD")) - Number(a.startsWith("USD")));
  for (const unit of units) {
    const entries = concept.units[unit]!.filter((e) => e.accn === accession);
    if (entries.length > 0) return { unit, entries };
  }
  return null;
}

function dedupe(entries: FactEntry[]): FactEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.start ?? ""}|${e.end}|${e.val}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeConcept(facts: CompanyFacts, filing: FilingRef, def: ConceptDef): NormalizedFact[] | null {
  for (const ref of def.tags) {
    const found = entriesFor(facts, ref, def.kind, filing.accession);
    if (!found) continue;
    // La portada (dei) lleva su propia fecha; el resto debe incluir el periodo del informe
    const coversPeriod =
      ref.taxonomy === "dei" || found.entries.some((e) => daysBetween(e.end, filing.reportDate) <= PERIOD_TOLERANCE_DAYS);
    if (!coversPeriod) continue;
    return dedupe(found.entries).map((e) => ({
      accession: filing.accession,
      concept: def.id,
      sourceTag: `${ref.taxonomy}:${ref.tag}`,
      value: e.val,
      unit: found.unit,
      periodStart: e.start ?? null,
      periodEnd: e.end,
    }));
  }
  return null;
}

/**
 * Extrae del companyfacts las cifras de los informes elegidos, ya en el modelo
 * común. Incluye las cifras comparativas que trae cada informe (p. ej. el año
 * anterior en un 10-K), cada una con sus fechas.
 */
export function normalizeCompanyFacts(facts: CompanyFacts, filings: FilingRef[]): NormalizeResult {
  const out: NormalizedFact[] = [];
  const gaps: ConceptGap[] = [];
  for (const filing of filings) {
    for (const def of CONCEPTS) {
      const rows = normalizeConcept(facts, filing, def);
      if (rows) out.push(...rows);
      else gaps.push({ accession: filing.accession, concept: def.id });
    }
  }
  const currency = out.find((f) => CONCEPTS.find((c) => c.id === f.concept)?.kind === "money")?.unit ?? null;
  return { facts: out, gaps, currency };
}
