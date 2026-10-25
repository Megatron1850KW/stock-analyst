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
  /** Página del PDF de donde se extrajo (solo cifras extraídas por la IA). */
  page?: number;
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
  currency: string | null,
): { unit: string; entries: FactEntry[] } | null {
  const concept = facts.facts[ref.taxonomy]?.[ref.tag];
  if (!concept) return null;
  // Primero la divisa de las cuentas del informe; después USD; después la que haya
  const rank = (u: string) => (currency && u.startsWith(currency) ? 2 : u.startsWith("USD") ? 1 : 0);
  const units = Object.keys(concept.units)
    .filter(UNIT_MATCHERS[kind])
    .sort((a, b) => rank(b) - rank(a));
  for (const unit of units) {
    const entries = concept.units[unit]!.filter((e) => e.accn === accession);
    if (entries.length > 0) return { unit, entries };
  }
  return null;
}

/**
 * Divisa de las cuentas de un informe: la que más cifras monetarias trae. Un
 * 20-F en otra divisa (p. ej. TSMC en NT$) añade una conversión «de
 * conveniencia» a USD solo del último año, a un cambio distinto en cada
 * informe; mezclarlas inflaría o desinflaría el crecimiento.
 */
export function statementCurrency(facts: CompanyFacts, accession: string): string | null {
  const count = new Map<string, number>();
  for (const taxonomy of Object.values(facts.facts)) {
    for (const concept of Object.values(taxonomy ?? {})) {
      for (const [unit, entries] of Object.entries(concept.units)) {
        if (!UNIT_MATCHERS.money(unit)) continue;
        const n = entries.filter((e) => e.accn === accession).length;
        if (n) count.set(unit, (count.get(unit) ?? 0) + n);
      }
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || Number(b[0] === "USD") - Number(a[0] === "USD"))[0]?.[0] ?? null;
}

/** Cambio de conveniencia del informe (unidades de `currency` por 1 USD), sacado de sus ventas del año en las dos divisas. */
export function convenienceRate(facts: CompanyFacts, accession: string, currency: string): number | null {
  const revenue = CONCEPTS.find((c) => c.id === "revenue")!;
  for (const ref of revenue.tags) {
    const units = facts.facts[ref.taxonomy]?.[ref.tag]?.units;
    const local = units?.[currency]?.filter((e) => e.accn === accession) ?? [];
    const usd = units?.USD?.filter((e) => e.accn === accession) ?? [];
    for (const u of usd) {
      const l = local.find((e) => e.end === u.end && (e.start ?? null) === (u.start ?? null));
      if (l && u.val > 0 && l.val > 0) return l.val / u.val;
    }
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

function normalizeConcept(facts: CompanyFacts, filing: FilingRef, def: ConceptDef, currency: string | null): NormalizedFact[] | null {
  for (const ref of def.tags) {
    const found = entriesFor(facts, ref, def.kind, filing.accession, currency);
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

const fmtRate = (r: number) => r.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");

/** Nota que acompaña a la etiqueta de origen de una cifra pasada a USD al cambio de conveniencia. */
export const convenienceNote = (local: string, rate: number, accession: string) =>
  ` (${local} a USD a ${fmtRate(rate)} ${local}/USD, el cambio de conveniencia del informe ${accession})`;

const NOTE_RE = / \(([A-Z]{3}) a USD a ([\d,]+) [A-Z]{3}\/USD, el cambio de conveniencia del informe ([^)]+)\)$/;

/** El cambio de conveniencia con el que se guardaron las cifras de un valor, leído de sus etiquetas de origen. */
export function convenienceFromTags(tags: (string | null)[]): { currency: string; rate: number; accession: string } | null {
  for (const t of tags) {
    const m = t ? NOTE_RE.exec(t) : null;
    if (m) return { currency: m[1]!, rate: Number(m[2]!.replace(",", ".")), accession: m[3]! };
  }
  return null;
}

/**
 * Extrae del companyfacts las cifras de los informes elegidos, ya en el modelo
 * común. Incluye las cifras comparativas que trae cada informe (p. ej. el año
 * anterior en un 10-K), cada una con sus fechas.
 *
 * Si las cuentas no están en USD pero el informe más reciente trae la
 * conversión de conveniencia a USD (20-F de emisores extranjeros), todas las
 * cifras se pasan a USD a ese único cambio: así los crecimientos son los de la
 * divisa original y la valoración se puede hacer con el precio en dólares.
 */
export function normalizeCompanyFacts(facts: CompanyFacts, filings: FilingRef[]): NormalizeResult {
  const out: NormalizedFact[] = [];
  const gaps: ConceptGap[] = [];
  const currencies = new Map(filings.map((f) => [f.accession, statementCurrency(facts, f.accession)]));
  for (const filing of filings) {
    for (const def of CONCEPTS) {
      const rows = normalizeConcept(facts, filing, def, currencies.get(filing.accession) ?? null);
      if (rows) out.push(...rows);
      else gaps.push({ accession: filing.accession, concept: def.id });
    }
  }
  // El cambio del informe más reciente que lo traiga
  let latest: FilingRef | null = null;
  let local: string | null = null;
  let rate: number | null = null;
  for (const f of [...filings].sort((a, b) => b.reportDate.localeCompare(a.reportDate))) {
    const c = currencies.get(f.accession);
    if (!c || c === "USD") continue;
    const r = convenienceRate(facts, f.accession, c);
    if (r) {
      [latest, local, rate] = [f, c, r];
      break;
    }
  }
  if (latest && local && rate) {
    const note = convenienceNote(local, rate, latest.accession);
    for (const f of out) {
      if (f.unit === local) Object.assign(f, { value: f.value / rate, unit: "USD", sourceTag: f.sourceTag + note });
      else if (f.unit === `${local}/shares`) Object.assign(f, { value: f.value / rate, unit: "USD/shares", sourceTag: f.sourceTag + note });
    }
  }
  const currency = out.find((f) => CONCEPTS.find((c) => c.id === f.concept)?.kind === "money")?.unit ?? null;
  return { facts: out, gaps, currency };
}
