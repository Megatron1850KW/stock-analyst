import { CONCEPT_BY_ID } from "./concepts";
import { ownPeriodFact } from "./period-value";

/**
 * Cifras por ejercicio y últimos doce meses (TTM) a partir de lo guardado en
 * SQLite, sin perder el origen de cada número (CLAUDE.md §2.2).
 */

export interface FilingInfo {
  id: number;
  form_type: string;
  period_type: "annual" | "interim";
  period_end: string;
  filed_at: string | null;
  accession_no: string;
  url: string | null;
  /** sec-edgar, filings.xbrl.org o user-upload. */
  source?: string;
}

export interface FactInfo {
  filing_id: number;
  concept: string;
  source_tag: string | null;
  value: number;
  unit: string;
  period_start: string | null;
  period_end: string;
  fetched_at: string;
  /** Página del PDF si la cifra la extrajo la IA. */
  page?: number | null;
}

/** Una cifra oficial con su documento de origen. */
export interface Sourced {
  concept: string;
  value: number;
  unit: string;
  tag: string | null;
  periodStart: string | null;
  periodEnd: string;
  fetchedAt: string;
  filing: FilingInfo;
  /** Sale de las cifras comparativas de un informe posterior (el propio no la traía). */
  fromComparative: boolean;
  /** Página del PDF (cifra extraída por la IA de un informe que subiste). */
  page?: number | null;
}

export interface AnnualStatement {
  periodEnd: string;
  filing: FilingInfo;
  values: Partial<Record<string, Sourced>>;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const shiftYear = (iso: string, years: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

function sourced(f: FactInfo, filing: FilingInfo, fromComparative = false): Sourced {
  return {
    concept: f.concept,
    value: f.value,
    unit: f.unit,
    tag: f.source_tag,
    periodStart: f.period_start,
    periodEnd: f.period_end,
    fetchedAt: f.fetched_at,
    filing,
    fromComparative,
    page: f.page ?? null,
  };
}

function groupFacts(facts: FactInfo[]): Map<number, FactInfo[]> {
  const map = new Map<number, FactInfo[]>();
  for (const f of facts) {
    const list = map.get(f.filing_id);
    if (list) list.push(f);
    else map.set(f.filing_id, [f]);
  }
  return map;
}

/** Cifra anual (≈1 año) o de balance al cierre `end` dentro de las cifras de un informe. */
function yearFact(list: FactInfo[], concept: string, end: string): FactInfo | null {
  const def = CONCEPT_BY_ID.get(concept);
  if (!def || concept === "shares_outstanding") return null;
  return (
    list.find((f) => {
      if (f.concept !== concept || days(f.period_end, end) > 10) return false;
      if (def.period === "instant") return true;
      return f.period_start !== null && days(f.period_start, f.period_end) > 300 && days(f.period_start, f.period_end) < 400;
    }) ?? null
  );
}

/**
 * Un estado por ejercicio (del más antiguo al más reciente). Cada cifra es la
 * del propio informe anual; si no la trae, se busca entre las comparativas de
 * los anuales posteriores (que a veces la reexpresan) y se marca como tal.
 */
export function annualStatements(filings: FilingInfo[], facts: FactInfo[], concepts: string[]): AnnualStatement[] {
  const byFiling = groupFacts(facts);
  const annual = filings.filter((f) => f.period_type === "annual").sort((a, b) => a.period_end.localeCompare(b.period_end));
  return annual.map((filing, k) => {
    const list = byFiling.get(filing.id) ?? [];
    const values: Partial<Record<string, Sourced>> = {};
    for (const concept of concepts) {
      const own = ownPeriodFact(list, filing, concept);
      if (own) {
        values[concept] = sourced(own.fact, filing);
        continue;
      }
      for (const later of annual.slice(k + 1)) {
        const f = yearFact(byFiling.get(later.id) ?? [], concept, filing.period_end);
        if (f) {
          values[concept] = sourced(f, later, true);
          break;
        }
      }
    }
    return { periodEnd: filing.period_end, filing, values };
  });
}

/** Cifra de flujo de los últimos doce meses, con las piezas que la forman. */
export interface FlowValue {
  value: number;
  unit: string;
  /** "ttm": anual + acumulado del año − acumulado del año anterior; "annual": último anual. */
  basis: "ttm" | "annual";
  periodEnd: string;
  parts: { role: "annual" | "ytd" | "prior-ytd"; source: Sourced }[];
}

export interface LatestReports {
  annual: FilingInfo | null;
  /** Intermedio posterior al último anual, si lo hay. */
  interim: FilingInfo | null;
}

export function latestReports(filings: FilingInfo[]): LatestReports {
  const latest = (t: "annual" | "interim") =>
    filings.filter((f) => f.period_type === t).sort((a, b) => b.period_end.localeCompare(a.period_end))[0] ?? null;
  const annual = latest("annual");
  const interim = latest("interim");
  return { annual, interim: interim && (!annual || interim.period_end > annual.period_end) ? interim : null };
}

/**
 * TTM de un concepto de flujo (ventas, beneficio, caja…): último anual más lo
 * acumulado del ejercicio en curso menos lo mismo del ejercicio anterior,
 * ambos sacados del último informe intermedio. Si falta alguna pieza, se usa
 * el último anual y se indica en `basis`.
 */
export function ttmFlow(filings: FilingInfo[], facts: FactInfo[], concept: string): FlowValue | null {
  const { annual, interim } = latestReports(filings);
  if (!annual) return null;
  const byFiling = groupFacts(facts);
  const annualFact = ownPeriodFact(byFiling.get(annual.id) ?? [], annual, concept);
  if (!annualFact) return null;
  const a = sourced(annualFact.fact, annual);
  const fallback: FlowValue = { value: a.value, unit: a.unit, basis: "annual", periodEnd: annual.period_end, parts: [{ role: "annual", source: a }] };
  if (!interim) return fallback;

  const list = (byFiling.get(interim.id) ?? []).filter((f) => f.concept === concept && f.period_start && f.unit === a.unit);
  const ytd = list.find((f) => days(f.period_end, interim.period_end) <= 10 && days(f.period_start!, annual.period_end) <= 20);
  if (!ytd) return fallback;
  const len = days(ytd.period_start!, ytd.period_end);
  const prior = list.find(
    (f) => days(f.period_end, shiftYear(interim.period_end, -1)) <= 10 && Math.abs(days(f.period_start!, f.period_end) - len) <= 10,
  );
  if (!prior) return fallback;
  return {
    value: a.value + ytd.value - prior.value,
    unit: a.unit,
    basis: "ttm",
    periodEnd: interim.period_end,
    parts: [
      { role: "annual", source: a },
      { role: "ytd", source: sourced(ytd, interim) },
      { role: "prior-ytd", source: sourced(prior, interim) },
    ],
  };
}

/** Cifra de balance (o de acciones) del informe más reciente que la tenga. */
export function latestInstant(filings: FilingInfo[], facts: FactInfo[], concept: string): Sourced | null {
  const byFiling = groupFacts(facts);
  const sorted = [...filings].sort((a, b) => b.period_end.localeCompare(a.period_end));
  for (const filing of sorted) {
    const own = ownPeriodFact(byFiling.get(filing.id) ?? [], filing, concept);
    if (own) return sourced(own.fact, filing);
  }
  return null;
}

/**
 * Crecimiento del último trimestre frente al mismo trimestre del año
 * anterior, con las dos cifras del mismo informe intermedio.
 */
export function lastQuarterGrowth(
  filings: FilingInfo[],
  facts: FactInfo[],
  concept: string,
): { current: Sourced; previous: Sourced; growth: number } | null {
  const interim = filings.filter((f) => f.period_type === "interim").sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!interim) return null;
  const list = groupFacts(facts).get(interim.id) ?? [];
  const own = ownPeriodFact(list, interim, concept);
  if (!own || own.cumulative || !own.fact.period_start) return null;
  const len = days(own.fact.period_start, own.fact.period_end);
  const prev = list.find(
    (f) =>
      f.concept === concept &&
      f.period_start !== null &&
      days(f.period_end, shiftYear(interim.period_end, -1)) <= 10 &&
      Math.abs(days(f.period_start, f.period_end) - len) <= 10,
  );
  if (!prev || prev.value <= 0) return null;
  return { current: sourced(own.fact, interim), previous: sourced(prev, interim), growth: own.fact.value / prev.value - 1 };
}
