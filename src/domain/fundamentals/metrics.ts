import { CONCEPT_BY_ID } from "./concepts";
import { annualStatements, latestInstant, ttmFlow, type AnnualStatement, type FactInfo, type FilingInfo, type Sourced } from "./statements";

/**
 * Métricas deterministas (CLAUDE.md §2.4): márgenes, caja libre, deuda neta…
 * Cada métrica guarda su fórmula y las cifras oficiales de las que sale, para
 * poder enseñar el cálculo al pasar el ratón.
 */

export type MetricKind = "money" | "percent" | "multiple" | "years" | "shares";

/** Una pieza del cálculo: cifra oficial (o suma de varias) con su origen. */
export interface Input {
  label: string;
  value: number;
  unit: string;
  sources: Sourced[];
  note?: string;
}

export interface Metric {
  label: string;
  kind: MetricKind;
  value: number | null;
  /** Fórmula en llano: «Caja de las operaciones − Inversión (capex)». */
  formula: string;
  inputs: Input[];
  /** Por qué no hay valor, o una aclaración del cálculo. */
  note?: string;
}

export type Getter = (concept: string) => Input | null;

const label = (concept: string) => CONCEPT_BY_ID.get(concept)?.label ?? concept;

export const FLOW_CONCEPTS = [
  "revenue", "cost_of_revenue", "gross_profit", "operating_income", "net_income",
  "operating_cash_flow", "capex", "shares_diluted", "eps_diluted", "eps_basic",
] as const;
export const INSTANT_CONCEPTS = [
  "cash", "short_term_investments", "debt_total", "debt_noncurrent", "debt_current", "bonds_noncurrent",
  "short_term_borrowings", "commercial_paper", "equity",
] as const;
export const STATEMENT_CONCEPTS: string[] = [...FLOW_CONCEPTS, ...INSTANT_CONCEPTS];

export function annualGetter(st: AnnualStatement): Getter {
  return (concept) => {
    const s = st.values[concept];
    return s ? { label: label(concept), value: s.value, unit: s.unit, sources: [s] } : null;
  };
}

const TTM_NOTE = "Últimos doce meses: último anual + lo que va de año − lo mismo del año anterior.";

/** Cifras actuales: flujos de los últimos doce meses y balance más reciente. */
export function currentGetter(filings: FilingInfo[], facts: FactInfo[]): Getter {
  const cache = new Map<string, Input | null>();
  // Todo el balance sale del mismo informe (el más reciente con caja), para no mezclar fechas
  const balanceFiling = latestInstant(filings, facts, "cash")?.filing;
  const balanceFacts = balanceFiling ? facts.filter((f) => f.filing_id === balanceFiling.id) : [];
  return (concept) => {
    if (cache.has(concept)) return cache.get(concept)!;
    let out: Input | null = null;
    if (concept === "shares_diluted") {
      // Acciones: la media del último periodo publicado, no una suma de periodos
      const s = latestInstant(filings, facts, concept);
      if (s) out = { label: label(concept), value: s.value, unit: s.unit, sources: [s] };
    } else if (CONCEPT_BY_ID.get(concept)?.period === "duration") {
      const t = ttmFlow(filings, facts, concept);
      if (t) {
        out = {
          label: label(concept),
          value: t.value,
          unit: t.unit,
          sources: t.parts.map((p) => p.source),
          note: t.basis === "ttm" ? TTM_NOTE : "Último ejercicio completo (no hay trimestre posterior comparable).",
        };
      }
    } else if (balanceFiling) {
      const s = latestInstant([balanceFiling], balanceFacts, concept);
      if (s) out = { label: label(concept), value: s.value, unit: s.unit, sources: [s] };
    }
    cache.set(concept, out);
    return out;
  };
}

const missing = (lbl: string, kind: MetricKind, formula: string, note: string, inputs: Input[] = []): Metric => ({
  label: lbl, kind, value: null, formula, inputs, note,
});

export function grossProfit(get: Getter): Metric {
  const formula = "Ventas − Coste de las ventas";
  const gp = get("gross_profit");
  if (gp) return { label: "Beneficio bruto", kind: "money", value: gp.value, formula: "Cifra publicada", inputs: [gp] };
  const rev = get("revenue");
  const cost = get("cost_of_revenue");
  if (!rev || !cost) return missing("Beneficio bruto", "money", formula, "La empresa no publica beneficio bruto ni coste de las ventas.", [rev, cost].filter((x): x is Input => !!x));
  return {
    label: "Beneficio bruto",
    kind: "money",
    value: rev.value - cost.value,
    formula,
    inputs: [rev, cost],
    note: "La empresa no publica el beneficio bruto: calculado como ventas menos coste de las ventas.",
  };
}

export function freeCashFlow(get: Getter): Metric {
  const formula = "Caja de las operaciones − Inversión (capex)";
  const ocf = get("operating_cash_flow");
  const capex = get("capex");
  if (!ocf || !capex) return missing("Caja libre", "money", formula, "Falta la caja de las operaciones o el capex.", [ocf, capex].filter((x): x is Input => !!x));
  return { label: "Caja libre", kind: "money", value: ocf.value - capex.value, formula, inputs: [ocf, capex] };
}

/** Caja + inversiones a corto. Si no hay inversiones a corto publicadas, cuentan como 0 y se dice. */
export function cashAndInvestments(get: Getter): Metric {
  const formula = "Caja y equivalentes + Inversiones a corto plazo";
  const cash = get("cash");
  if (!cash) return missing("Caja e inversiones a corto", "money", formula, "No hay dato de caja.");
  const sti = get("short_term_investments");
  return {
    label: "Caja e inversiones a corto",
    kind: "money",
    value: cash.value + (sti?.value ?? 0),
    formula,
    inputs: sti ? [cash, sti] : [cash],
    note: sti ? undefined : "No publica inversiones a corto plazo: cuentan como 0.",
  };
}

/** Etiquetas de deuda (total o a corto) que ya incluyen los préstamos a corto y el papel comercial. */
const TOTAL_INCLUDES_SHORT_TERM = [
  "us-gaap:DebtLongtermAndShorttermCombinedAmount",
  "ifrs-full:Borrowings",
  "ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
];

/**
 * Deuda financiera bruta (ver notas de mapeo en concepts.ts): total con
 * vencimientos corrientes, o largo + corto si no hay total, más préstamos a
 * corto y papel comercial cuando no están ya dentro del total.
 */
export function grossDebt(get: Getter): Metric {
  const total = get("debt_total");
  const parts: Input[] = [];
  let formula: string;
  if (total) {
    parts.push(total);
    formula = "Deuda financiera total";
  } else {
    const nc = get("debt_noncurrent");
    const cur = get("debt_current");
    const bonds = get("bonds_noncurrent");
    if (nc) parts.push(nc);
    formula = "Deuda a largo";
    // Si los bonos son más que toda la deuda a largo, no están dentro: van aparte (TSMC)
    if (bonds && (!nc || bonds.value > nc.value)) {
      parts.push(bonds);
      formula += " + Bonos a largo";
    }
    if (cur) parts.push(cur);
    formula += " + Deuda que vence en 12 meses";
  }
  const includesShort = parts.some((p) => p.sources.some((s) => s.tag && TOTAL_INCLUDES_SHORT_TERM.includes(s.tag.split(" ")[0]!)));
  if (!includesShort) {
    for (const c of ["short_term_borrowings", "commercial_paper"]) {
      const x = get(c);
      if (x) {
        parts.push(x);
        formula += ` + ${x.label}`;
      }
    }
  }
  if (parts.length === 0) return missing("Deuda financiera", "money", formula, "El informe no recoge deuda financiera.");
  return { label: "Deuda financiera", kind: "money", value: parts.reduce((s, p) => s + p.value, 0), formula, inputs: parts };
}

const asInput = (m: Metric, unit: string): Input | null =>
  m.value === null ? null : { label: m.label, value: m.value, unit, sources: m.inputs.flatMap((i) => i.sources), note: m.note };

export function netDebt(get: Getter): Metric {
  const formula = "Deuda financiera − Caja e inversiones a corto";
  const debt = grossDebt(get);
  const cash = cashAndInvestments(get);
  const unit = get("cash")?.unit ?? "USD";
  // Sin deuda publicada pero con caja: deuda neta = −caja (la empresa tiene caja neta)
  if (cash.value === null) return missing("Deuda neta", "money", formula, "No hay dato de caja.");
  const debtValue = debt.value ?? 0;
  const inputs = [asInput(debt, unit), asInput(cash, unit)].filter((x): x is Input => !!x);
  return {
    label: "Deuda neta",
    kind: "money",
    value: debtValue - cash.value,
    formula,
    inputs,
    note: debt.value === null ? "No publica deuda financiera: cuenta como 0." : undefined,
  };
}

/** Años que tardaría en pagar la deuda neta con su caja libre. */
export function debtYears(get: Getter): Metric {
  const formula = "Deuda neta ÷ Caja libre anual";
  const nd = netDebt(get);
  const fcf = freeCashFlow(get);
  const unit = get("cash")?.unit ?? "USD";
  const inputs = [asInput(nd, unit), asInput(fcf, unit)].filter((x): x is Input => !!x);
  if (nd.value === null) return missing("Años para pagar la deuda", "years", formula, nd.note ?? "Sin dato de deuda.", inputs);
  if (nd.value <= 0) return { label: "Años para pagar la deuda", kind: "years", value: 0, formula, inputs, note: "Tiene más caja que deuda (caja neta)." };
  if (fcf.value === null) return missing("Años para pagar la deuda", "years", formula, fcf.note ?? "Sin dato de caja libre.", inputs);
  if (fcf.value <= 0) return missing("Años para pagar la deuda", "years", formula, "No genera caja libre, así que no podría pagarla con lo que genera.", inputs);
  return { label: "Años para pagar la deuda", kind: "years", value: nd.value / fcf.value, formula, inputs };
}

function ratio(lbl: string, num: Metric | Input | null, den: Input | null, formula: string, unit: string): Metric {
  const numInput = num && "kind" in num ? asInput(num, unit) : (num as Input | null);
  const inputs = [numInput, den].filter((x): x is Input => !!x);
  if (!numInput || !den) return missing(lbl, "percent", formula, "Falta alguna cifra.", inputs);
  if (den.value <= 0) return missing(lbl, "percent", formula, `${den.label} no es positivo.`, inputs);
  return { label: lbl, kind: "percent", value: numInput.value / den.value, formula, inputs };
}

/**
 * Acciones diluidas. Si el informe no da el total (p. ej. Alphabet antes de
 * 2022, que lo desglosa por clases), se deducen como beneficio neto ÷ BPA
 * diluido y se dice.
 */
export function dilutedShares(get: Getter): Input | null {
  const direct = get("shares_diluted");
  if (direct) return direct;
  const ni = get("net_income");
  const diluted = get("eps_diluted");
  // Sin BPA diluido (empresas sin instrumentos dilutivos), el básico
  const eps = diluted ?? get("eps_basic");
  if (!ni || !eps || eps.value <= 0 || ni.value <= 0) return null;
  return {
    label: "Acciones diluidas (deducidas)",
    value: ni.value / eps.value,
    unit: "shares",
    sources: [...ni.sources, ...eps.sources],
    note: diluted
      ? "El informe no da el total de acciones diluidas: calculadas como beneficio neto ÷ beneficio por acción diluido."
      : "El informe no da acciones diluidas ni BPA diluido: calculadas como beneficio neto ÷ beneficio por acción básico.",
  };
}

export interface Fundamentals {
  revenue: Input | null;
  netIncome: Input | null;
  operatingIncome: Input | null;
  operatingCashFlow: Input | null;
  capex: Input | null;
  grossProfit: Metric;
  freeCashFlow: Metric;
  netDebt: Metric;
  grossDebt: Metric;
  cash: Metric;
  debtYears: Metric;
  grossMargin: Metric;
  operatingMargin: Metric;
  netMargin: Metric;
  fcfMargin: Metric;
  /** Caja libre ÷ beneficio neto. */
  cashConversion: Metric;
  shares: Input | null;
}

export function fundamentals(get: Getter): Fundamentals {
  const unit = get("revenue")?.unit ?? "USD";
  const revenue = get("revenue");
  const netIncome = get("net_income");
  const operatingIncome = get("operating_income");
  const gp = grossProfit(get);
  const fcf = freeCashFlow(get);
  return {
    revenue,
    netIncome,
    operatingIncome,
    operatingCashFlow: get("operating_cash_flow"),
    capex: get("capex"),
    grossProfit: gp,
    freeCashFlow: fcf,
    netDebt: netDebt(get),
    grossDebt: grossDebt(get),
    cash: cashAndInvestments(get),
    debtYears: debtYears(get),
    grossMargin: ratio("Margen bruto", gp, revenue, "Beneficio bruto ÷ Ventas", unit),
    operatingMargin: ratio("Margen operativo", operatingIncome, revenue, "Beneficio operativo ÷ Ventas", unit),
    netMargin: ratio("Margen neto", netIncome, revenue, "Beneficio neto ÷ Ventas", unit),
    fcfMargin: ratio("Margen de caja libre", fcf, revenue, "Caja libre ÷ Ventas", unit),
    cashConversion: ratio("Conversión en caja", fcf, netIncome, "Caja libre ÷ Beneficio neto", unit),
    shares: dilutedShares(get),
  };
}

export interface YearFundamentals extends Fundamentals {
  periodEnd: string;
  statement: AnnualStatement;
  revenueGrowth: Metric;
  netIncomeGrowth: Metric;
}

function growth(lbl: string, cur: Input | null, prev: Input | null): Metric {
  const formula = "Cifra del año ÷ Cifra del año anterior − 1";
  const inputs = [cur, prev].filter((x): x is Input => !!x);
  if (!cur || !prev) return missing(lbl, "percent", formula, "Falta el año anterior.", inputs);
  if (prev.value <= 0) return missing(lbl, "percent", formula, "El año anterior no fue positivo: el porcentaje no tiene sentido.", inputs);
  return { label: lbl, kind: "percent", value: cur.value / prev.value - 1, formula, inputs };
}

/** Fundamentales de cada ejercicio, del más antiguo al más reciente. */
export function yearlyFundamentals(filings: FilingInfo[], facts: FactInfo[]): YearFundamentals[] {
  const statements = annualStatements(filings, facts, STATEMENT_CONCEPTS);
  return statements.map((st, k) => {
    const get = annualGetter(st);
    const before = statements[k - 1];
    // Solo si es justo el ejercicio anterior (puede faltar algún año en EDGAR)
    const gap = before ? (Date.parse(st.periodEnd) - Date.parse(before.periodEnd)) / 86_400_000 : 0;
    const prev: Getter = before && gap > 330 && gap < 400 ? annualGetter(before) : () => null;
    return {
      ...fundamentals(get),
      periodEnd: st.periodEnd,
      statement: st,
      revenueGrowth: growth("Crecimiento de ventas", get("revenue"), prev("revenue")),
      netIncomeGrowth: growth("Crecimiento del beneficio", get("net_income"), prev("net_income")),
    };
  });
}
