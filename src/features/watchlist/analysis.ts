import { adrRatio } from "@/domain/valuation/adr";
import { pricesInReportingCurrency } from "@/domain/valuation/currency";
import { FxTable, type FxRate } from "@/domain/portfolio/fx";
import { providerLabel } from "@/data/prices/provider";
import type { BarRow, FactRow, FilingRow, LatestQuoteRow, PriceHistoryMeta, SecurityRow, SplitRow } from "@/db/repo";
import {
  currentGetter,
  fundamentals,
  yearlyFundamentals,
  type Fundamentals,
  type Metric,
  type YearFundamentals,
} from "@/domain/fundamentals/metrics";
import { lastQuarterGrowth, latestReports, type Sourced } from "@/domain/fundamentals/statements";
import { debtLevel, type DebtLevel } from "@/domain/scoring/debt-level";
import { valuationScore, type ValuationScore } from "@/domain/scoring/valuation-score";
import { qualityScore, type QualityScore } from "@/domain/scoring/quality-score";
import { currencySymbol } from "./ficha/format";
import {
  currentMultiples,
  historicalMultiples,
  ANNUAL_PUBLICATION_MONTHS,
  type CurrentMultiples,
  type MultiplePoint,
  type PricePoint,
  type PriceInput,
} from "@/domain/valuation/multiples";

/**
 * Todo lo que necesita la ficha de una acción, calculado de forma
 * determinista a partir de lo guardado en SQLite (sin red ni IA).
 */

export interface GrowthHeadline {
  /**
   * "quarter": último trimestre vs. el mismo del año anterior; "ytd": lo que va
   * de ejercicio (p. ej. el semestre) vs. lo mismo del año anterior, cuando el
   * intermedio no da el trimestre suelto; "year": último ejercicio.
   */
  basis: "quarter" | "ytd" | "year";
  /** Periodo en llano: «último trimestre», «último semestre», «últimos 9 meses», «último año». */
  period: string;
  revenue: Metric;
  netIncome: Metric;
}

export interface Analysis {
  current: Fundamentals;
  /** Ejercicios del más antiguo al más reciente (hasta 11). */
  years: YearFundamentals[];
  price: PriceInput | null;
  multiples: CurrentMultiples | null;
  history: MultiplePoint[];
  monthly: PricePoint[];
  valuation: ValuationScore | null;
  debt: DebtLevel | null;
  /** Calidad / salud financiera (§8.2) y señales de trampa de valor (§8.3). */
  quality: QualityScore;
  growth: GrowthHeadline;
  /** Avisos que la UI debe mostrar (nunca se ocultan). */
  warnings: string[];
}

/** «último trimestre», «último semestre», «últimos 9 meses»… */
export function interimPeriodText(months: number): string {
  if (months <= 4) return "último trimestre";
  if (months === 6) return "último semestre";
  return `últimos ${months} meses`;
}

function quarterMetric(what: string, g: ReturnType<typeof lastQuarterGrowth>): Metric | null {
  if (!g) return null;
  const input = (s: Sourced, l: string) => ({ label: l, value: s.value, unit: s.unit, sources: [s] });
  const period = interimPeriodText(g.months);
  const Period = period.charAt(0).toUpperCase() + period.slice(1);
  const same = g.months <= 4 ? "Mismo trimestre del año anterior" : "Mismo periodo del año anterior";
  return {
    label: `${what} (${period})`,
    kind: "percent",
    value: g.growth,
    formula: `${Period} ÷ ${same} − 1`,
    inputs: [input(g.current, Period), input(g.previous, same)],
  };
}

const priceSourceLabel = (s: string) => providerLabel(s);

export function buildAnalysis(input: {
  security: SecurityRow;
  filings: FilingRow[];
  facts: FactRow[];
  monthly: BarRow[];
  splits: SplitRow[];
  quote: LatestQuoteRow | null;
  priceMeta: PriceHistoryMeta | null;
  /** Tipos del BCE, para valorar con el precio en la divisa de las cuentas. */
  fx?: FxRate[];
}): Analysis {
  // Los informes que subiste cuentan en cuanto tienen cifras (extraídas del PDF)
  const withFacts = new Set(input.facts.map((f) => f.filing_id));
  const sec = input.filings.filter((f) => f.role !== "upload" || withFacts.has(f.id));
  const core = sec.filter((f) => f.role === "core" || f.role === "upload");
  const years = yearlyFundamentals(sec, input.facts);
  const ttm = fundamentals(currentGetter(core, input.facts));
  // Sin acciones en los doce meses (p. ej. un semestral sin BPA), las del último anual
  const lastShares = [...years].reverse().find((y) => y.shares)?.shares ?? null;
  const current =
    ttm.shares || !lastShares
      ? ttm
      : { ...ttm, shares: { ...lastShares, note: `${lastShares.note ? `${lastShares.note} ` : ""}Del último informe anual: el intermedio no da el número de acciones.` } };
  const warnings: string[] = [];

  const monthly: PricePoint[] = input.monthly.map((b) => ({ date: b.date, close: b.close }));
  const last = input.monthly.at(-1);
  const price: PriceInput | null = input.quote
    ? { value: input.quote.close, date: input.quote.date, currency: input.quote.currency, source: priceSourceLabel(input.quote.source), fetchedAt: input.quote.fetched_at }
    : last && input.priceMeta
      ? { value: last.close, date: input.priceMeta.last_date ?? last.date, currency: input.security.currency, source: priceSourceLabel(input.priceMeta.source), fetchedAt: input.priceMeta.fetched_at }
      : null;

  if (input.priceMeta && !input.priceMeta.splits_checked) {
    warnings.push(
      "No se ha podido comprobar si la acción ha tenido splits. Si los tuvo, la valoración de años anteriores podría estar distorsionada.",
    );
  }
  // Sin lista de splits, un salto brusco en el nº de acciones delata uno no ajustado
  if (input.splits.length === 0) {
    for (let k = 1; k < years.length; k++) {
      const a = years[k - 1]!.shares?.value;
      const b = years[k]!.shares?.value;
      if (a && b && (b / a > 1.8 || a / b > 1.8)) {
        warnings.push(`El número de acciones cambia mucho entre ${years[k - 1]!.periodEnd.slice(0, 4)} y ${years[k]!.periodEnd.slice(0, 4)}: puede haber un split sin ajustar.`);
        break;
      }
    }
  }
  if (input.priceMeta?.first_date && monthly.length > 0 && monthly.length < 110) {
    warnings.push(`El proveedor de precios solo da datos desde ${input.priceMeta.first_date.slice(0, 7)}: la comparación a 10 años no es posible.`);
  }

  if (years.some((y) => y.shares && !y.statement.filing.filed_at)) {
    warnings.push(
      `Algunos ejercicios no traen fecha de publicación (salen de un informe que subiste o de las cifras comparativas de otro): para la valoración histórica se toma la más tardía que permite la ley (cierre + ${ANNUAL_PUBLICATION_MONTHS} meses).`,
    );
  }

  const adr = adrRatio(input.security.ticker, input.security.market);
  // Los múltiplos piden precio y cuentas en la misma divisa
  const reportingUnit = current.revenue?.unit ?? input.security.reporting_currency;
  const fx = input.fx?.length ? new FxTable(input.fx) : null;
  const inReporting = price ? pricesInReportingCurrency(price, monthly, reportingUnit, fx) : null;
  const multiples = inReporting ? currentMultiples(current, inReporting.price, input.splits, input.security.reporting_currency, adr) : null;
  const history = historicalMultiples(years, inReporting?.monthly ?? monthly, input.splits, adr);
  const valuation = multiples && inReporting ? valuationScore(multiples, history, inReporting.monthly) : null;

  const { annual, interim } = latestReports(core);
  // Trimestre suelto si lo hay; si no (semestral europeo), lo que va de ejercicio frente al año anterior
  const qGrowth = (concept: string) => {
    const quarter = lastQuarterGrowth(core, input.facts, concept);
    return quarter ?? lastQuarterGrowth(core, input.facts, concept, true);
  };
  const gRev = interim ? qGrowth("revenue") : null;
  const gNi = interim ? qGrowth("net_income") : null;
  const qRev = quarterMetric("Ventas", gRev);
  const qNi = quarterMetric("Beneficio", gNi);
  const lastYear = years.filter((y) => !annual || y.periodEnd <= annual.period_end).at(-1);
  const growth: GrowthHeadline =
    gRev && gNi && qRev && qNi && gRev.months === gNi.months
      ? { basis: gRev.months <= 4 ? "quarter" : "ytd", period: interimPeriodText(gRev.months), revenue: qRev, netIncome: qNi }
      : {
          basis: "year",
          period: "último año",
          revenue: lastYear?.revenueGrowth ?? { label: "Crecimiento de ventas", kind: "percent", value: null, formula: "", inputs: [], note: "Sin dato" },
          netIncome: lastYear?.netIncomeGrowth ?? { label: "Crecimiento del beneficio", kind: "percent", value: null, formula: "", inputs: [], note: "Sin dato" },
        };

  const debt = debtLevel(current.debtYears, current.netDebt, current.freeCashFlow);
  return {
    current,
    years,
    price,
    multiples,
    history,
    monthly,
    valuation,
    debt,
    quality: qualityScore(current, years, debt, currencySymbol(current.revenue?.unit ?? input.security.currency)),
    growth,
    warnings,
  };
}
