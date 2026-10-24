import { CONCEPT_BY_ID } from "./concepts";

export interface PeriodFact {
  filing_id: number;
  concept: string;
  value: number;
  period_start: string | null;
  period_end: string;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / DAY;

/**
 * La cifra "propia" de un informe para un concepto: la del periodo que cierra
 * el informe (no los comparativos). En flujos, la del año completo en un
 * anual y la del trimestre (si existe) en un trimestral. Si no hay cifra
 * trimestral (p. ej. flujos de caja, que solo vienen acumulados), devuelve la
 * acumulada y lo indica.
 */
export function ownPeriodFact<T extends PeriodFact>(
  facts: T[],
  filing: { id: number; period_end: string; period_type: "annual" | "interim" },
  concept: string,
): { fact: T; cumulative: boolean } | null {
  const def = CONCEPT_BY_ID.get(concept);
  const candidates = facts.filter((f) => f.filing_id === filing.id && f.concept === concept);
  if (candidates.length === 0) return null;
  // La portada (acciones en circulación) lleva su propia fecha
  const isCover = concept === "shares_outstanding";
  const inPeriod = isCover ? candidates : candidates.filter((f) => days(f.period_end, filing.period_end) <= 10);
  if (inPeriod.length === 0) return null;
  if (def?.period === "instant" || isCover) {
    return { fact: inPeriod.reduce((a, b) => (b.period_end > a.period_end ? b : a)), cumulative: false };
  }
  const withLength = inPeriod
    .filter((f) => f.period_start)
    .map((f) => ({ f, len: days(f.period_start!, f.period_end) }));
  if (filing.period_type === "annual") {
    const year = withLength.filter((x) => x.len > 300).sort((a, b) => b.len - a.len)[0];
    return year ? { fact: year.f, cumulative: false } : null;
  }
  const sorted = withLength.sort((a, b) => a.len - b.len);
  const quarter = sorted.find((x) => x.len >= 75 && x.len <= 105);
  if (quarter) return { fact: quarter.f, cumulative: false };
  const ytd = sorted[sorted.length - 1];
  return ytd ? { fact: ytd.f, cumulative: true } : null;
}
