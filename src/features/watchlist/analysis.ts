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
import {
  currentMultiples,
  historicalMultiples,
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
  /** "quarter": último trimestre vs. el mismo del año anterior; "year": último ejercicio. */
  basis: "quarter" | "year";
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
  growth: GrowthHeadline;
  /** Avisos que la UI debe mostrar (nunca se ocultan). */
  warnings: string[];
}

function quarterMetric(label: string, g: ReturnType<typeof lastQuarterGrowth>): Metric | null {
  if (!g) return null;
  const input = (s: Sourced, l: string) => ({ label: l, value: s.value, unit: s.unit, sources: [s] });
  return {
    label,
    kind: "percent",
    value: g.growth,
    formula: "Último trimestre ÷ Mismo trimestre del año anterior − 1",
    inputs: [input(g.current, "Último trimestre"), input(g.previous, "Mismo trimestre del año anterior")],
  };
}

const priceSourceLabel = (s: string) => (s === "fmp" ? "Financial Modeling Prep" : s);

export function buildAnalysis(input: {
  security: SecurityRow;
  filings: FilingRow[];
  facts: FactRow[];
  monthly: BarRow[];
  splits: SplitRow[];
  quote: LatestQuoteRow | null;
  priceMeta: PriceHistoryMeta | null;
}): Analysis {
  const sec = input.filings.filter((f) => f.role !== "upload");
  const core = sec.filter((f) => f.role === "core");
  const current = fundamentals(currentGetter(core, input.facts));
  const years = yearlyFundamentals(sec, input.facts);
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

  const multiples = price ? currentMultiples(current, price, input.splits, input.security.reporting_currency) : null;
  const history = historicalMultiples(years, monthly, input.splits);
  const valuation = multiples ? valuationScore(multiples, history, monthly) : null;

  const { annual, interim } = latestReports(core);
  const qRev = interim ? quarterMetric("Ventas del último trimestre", lastQuarterGrowth(core, input.facts, "revenue")) : null;
  const qNi = interim ? quarterMetric("Beneficio del último trimestre", lastQuarterGrowth(core, input.facts, "net_income")) : null;
  const lastYear = years.filter((y) => !annual || y.periodEnd <= annual.period_end).at(-1);
  const growth: GrowthHeadline =
    qRev && qNi
      ? { basis: "quarter", revenue: qRev, netIncome: qNi }
      : {
          basis: "year",
          revenue: lastYear?.revenueGrowth ?? { label: "Crecimiento de ventas", kind: "percent", value: null, formula: "", inputs: [], note: "Sin dato" },
          netIncome: lastYear?.netIncomeGrowth ?? { label: "Crecimiento del beneficio", kind: "percent", value: null, formula: "", inputs: [], note: "Sin dato" },
        };

  return {
    current,
    years,
    price,
    multiples,
    history,
    monthly,
    valuation,
    debt: debtLevel(current.debtYears, current.netDebt, current.freeCashFlow),
    growth,
    warnings,
  };
}
