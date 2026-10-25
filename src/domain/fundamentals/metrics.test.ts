// @vitest-environment node
import { describe, expect, it } from "vitest";
import { currentGetter, fundamentals, grossDebt, yearlyFundamentals } from "./metrics";
import { lastQuarterGrowth, ttmFlow, type FactInfo, type FilingInfo } from "./statements";

/*
 * Empresa FICTICIA, ejercicio = año natural. Importes en millones de USD.
 * 10-K 2024 y 2025 y 10-Q del 2T 2026 (primer semestre acumulado).
 */
const M = 1e6;
const filings: FilingInfo[] = [
  { id: 1, form_type: "10-K", period_type: "annual", period_end: "2024-12-31", filed_at: "2025-02-10", accession_no: "f-24", url: null },
  { id: 2, form_type: "10-K", period_type: "annual", period_end: "2025-12-31", filed_at: "2026-02-10", accession_no: "f-25", url: null },
  { id: 3, form_type: "10-Q", period_type: "interim", period_end: "2026-06-30", filed_at: "2026-08-01", accession_no: "f-q2", url: null },
];
let fetched = "2026-10-24T00:00:00Z";
const flow = (filing_id: number, concept: string, start: string, end: string, value: number): FactInfo => ({
  filing_id, concept, source_tag: `us-gaap:${concept}`, value: value * M, unit: "USD", period_start: start, period_end: end, fetched_at: fetched,
});
const inst = (filing_id: number, concept: string, end: string, value: number): FactInfo => ({
  filing_id, concept, source_tag: `us-gaap:${concept}`, value: value * M, unit: "USD", period_start: null, period_end: end, fetched_at: fetched,
});
const year = (id: number, y: number, v: Record<string, number>) =>
  Object.entries(v).map(([c, x]) => flow(id, c, `${y}-01-01`, `${y}-12-31`, x));

const facts: FactInfo[] = [
  ...year(1, 2024, { revenue: 1000, cost_of_revenue: 600, operating_income: 200, net_income: 150, operating_cash_flow: 250, capex: 50 }),
  inst(1, "cash", "2024-12-31", 100),
  inst(1, "debt_total", "2024-12-31", 500),
  { ...flow(1, "shares_diluted", "2024-01-01", "2024-12-31", 0), value: 100 * M, unit: "shares" },
  ...year(2, 2025, { revenue: 1200, cost_of_revenue: 700, operating_income: 260, net_income: 200, operating_cash_flow: 300, capex: 60 }),
  // Comparativa 2024 dentro del 10-K 2025 (debe ignorarse para 2025)
  ...year(2, 2024, { revenue: 1000 }),
  inst(2, "cash", "2025-12-31", 150),
  inst(2, "short_term_investments", "2025-12-31", 50),
  inst(2, "debt_total", "2025-12-31", 600),
  inst(2, "short_term_borrowings", "2025-12-31", 40),
  { ...flow(2, "shares_diluted", "2025-01-01", "2025-12-31", 0), value: 100 * M, unit: "shares" },
  // 10-Q: trimestre y semestre acumulado de 2026, y lo mismo de 2025
  flow(3, "revenue", "2026-04-01", "2026-06-30", 360),
  flow(3, "revenue", "2025-04-01", "2025-06-30", 300),
  flow(3, "revenue", "2026-01-01", "2026-06-30", 700),
  flow(3, "revenue", "2025-01-01", "2025-06-30", 560),
  flow(3, "net_income", "2026-01-01", "2026-06-30", 120),
  flow(3, "net_income", "2025-01-01", "2025-06-30", 90),
  flow(3, "operating_cash_flow", "2026-01-01", "2026-06-30", 160),
  flow(3, "operating_cash_flow", "2025-01-01", "2025-06-30", 140),
  flow(3, "capex", "2026-01-01", "2026-06-30", 40),
  // capex del año anterior ausente → la caja libre usa el último anual
  inst(3, "cash", "2026-06-30", 180),
  inst(3, "debt_total", "2026-06-30", 600),
  { ...flow(3, "shares_diluted", "2026-04-01", "2026-06-30", 0), value: 98 * M, unit: "shares" },
];

describe("cifras anuales y métricas (datos ficticios)", () => {
  const years = yearlyFundamentals(filings, facts);

  it("calcula márgenes, caja libre y crecimiento por ejercicio", () => {
    expect(years.map((y) => y.periodEnd)).toEqual(["2024-12-31", "2025-12-31"]);
    const y25 = years[1]!;
    expect(y25.grossProfit.value).toBe(500 * M);
    expect(y25.grossProfit.note).toMatch(/calculado/);
    expect(y25.grossMargin.value).toBeCloseTo(500 / 1200);
    expect(y25.freeCashFlow.value).toBe(240 * M);
    expect(y25.cashConversion.value).toBeCloseTo(1.2);
    expect(y25.revenueGrowth.value).toBeCloseTo(0.2);
    expect(y25.netIncomeGrowth.value).toBeCloseTo(1 / 3);
    expect(years[0]!.revenueGrowth.value).toBeNull();
  });

  it("deuda neta = deuda + préstamos a corto − caja − inversiones a corto", () => {
    const y25 = years[1]!;
    expect(y25.grossDebt.value).toBe(640 * M);
    expect(y25.cash.value).toBe(200 * M);
    expect(y25.netDebt.value).toBe(440 * M);
    expect(y25.debtYears.value).toBeCloseTo(440 / 240);
    // 2024 sin inversiones a corto: cuentan como 0 y se dice
    expect(years[0]!.cash.note).toMatch(/cuentan como 0/);
  });

  it("guarda el origen de cada pieza", () => {
    const fcf = years[1]!.freeCashFlow;
    expect(fcf.formula).toBe("Caja de las operaciones − Inversión (capex)");
    expect(fcf.inputs.map((i) => i.sources[0]!.filing.accession_no)).toEqual(["f-25", "f-25"]);
  });
});

describe("últimos doce meses (datos ficticios)", () => {
  it("TTM = anual + acumulado del año − acumulado del año anterior", () => {
    const rev = ttmFlow(filings, facts, "revenue")!;
    expect(rev.basis).toBe("ttm");
    expect(rev.value).toBe((1200 + 700 - 560) * M);
    expect(rev.parts.map((p) => p.role)).toEqual(["annual", "ytd", "prior-ytd"]);
  });

  it("si falta una pieza, usa el último anual y lo dice", () => {
    const capex = ttmFlow(filings, facts, "capex")!;
    expect(capex.basis).toBe("annual");
    expect(capex.value).toBe(60 * M);
  });

  it("cada cifra sale del intermedio más reciente que la trae (nota de ventas posterior)", () => {
    const note: FilingInfo = { id: 4, form_type: "Otro (PDF)", period_type: "interim", period_end: "2026-09-30", filed_at: null, accession_no: "f-q3", url: null };
    const all = [...filings, note];
    const more = [...facts, flow(4, "revenue", "2026-01-01", "2026-09-30", 1080), flow(4, "revenue", "2025-01-01", "2025-09-30", 870)];
    const rev = ttmFlow(all, more, "revenue")!;
    expect(rev).toMatchObject({ basis: "ttm", periodEnd: "2026-09-30", value: (1200 + 1080 - 870) * M });
    const ni = ttmFlow(all, more, "net_income")!;
    expect(ni).toMatchObject({ basis: "ttm", periodEnd: "2026-06-30", value: (200 + 120 - 90) * M });
    expect(fundamentals(currentGetter(all, more)).cash.value).toBe(180 * M);
  });

  it("toma el balance y las acciones del informe más reciente", () => {
    const f = fundamentals(currentGetter(filings, facts));
    expect(f.cash.value).toBe(180 * M);
    expect(f.shares!.value).toBe(98 * M);
    expect(f.netIncome!.value).toBe((200 + 120 - 90) * M);
    expect(f.netIncome!.note).toMatch(/Últimos doce meses/);
  });

  it("crecimiento del último trimestre frente al mismo del año anterior", () => {
    expect(lastQuarterGrowth(filings, facts, "revenue")!.growth).toBeCloseTo(0.2);
  });
});

describe("acciones diluidas (datos ficticios)", () => {
  it("si no hay total, las deduce de beneficio ÷ BPA y lo dice", async () => {
    const { dilutedShares } = await import("./metrics");
    const s = { concept: "x", value: 0, unit: "USD", tag: null, periodStart: null, periodEnd: "2020-12-31", fetchedAt: "", filing: filings[0]!, fromComparative: false };
    const get = (c: string) =>
      c === "net_income" ? { label: "Beneficio", value: 100 * M, unit: "USD", sources: [s] } : c === "eps_diluted" ? { label: "BPA", value: 2, unit: "USD/shares", sources: [s] } : null;
    expect(dilutedShares(get)).toMatchObject({ value: 50 * M, note: expect.stringMatching(/beneficio neto ÷ beneficio por acción/) });
  });
});

describe("deuda con bonos aparte (cifras FICTICIAS al estilo de TSMC)", () => {
  const getter = (v: Record<string, number>) => (c: string) =>
    v[c] === undefined ? null : { label: c, value: v[c]!, unit: "USD", sources: [] };

  it("suma los bonos cuando no caben dentro de la deuda a largo", () => {
    const d = grossDebt(getter({ debt_noncurrent: 1_270, bonds_noncurrent: 27_295, debt_current: 4_365 }));
    expect(d.value).toBe(1_270 + 27_295 + 4_365);
    expect(d.formula).toBe("Deuda a largo + Bonos a largo + Deuda que vence en 12 meses");
  });

  it("no los cuenta dos veces si la deuda a largo ya los incluye", () => {
    expect(grossDebt(getter({ debt_noncurrent: 30_000, bonds_noncurrent: 27_295, debt_current: 4_365 })).value).toBe(34_365);
  });
});
