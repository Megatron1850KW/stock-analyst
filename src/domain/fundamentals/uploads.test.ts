// @vitest-environment node
import { describe, expect, it } from "vitest";
import { historicalMultiples, publishedBy, type PricePoint } from "@/domain/valuation/multiples";
import { yearlyFundamentals } from "./metrics";
import { lastQuarterGrowth, type FactInfo, type FilingInfo } from "./statements";

/*
 * Empresa FICTICIA europea con ejercicio de octubre a septiembre y SOLO
 * informes subidos en PDF (sin fecha de presentación): anuales 2024 y 2025,
 * un resumen de varios años («Otro») y el semestral H1 2026. Millones de EUR.
 */
const M = 1e6;
const up = (id: number, period_type: "annual" | "interim", period_end: string, form = "Anual (PDF)"): FilingInfo => ({
  id, form_type: form, period_type, period_end, filed_at: null, accession_no: `upload-${id}`, url: null, source: "user-upload",
});
const filings: FilingInfo[] = [
  up(1, "annual", "2024-09-30"),
  up(2, "annual", "2025-09-30"),
  up(3, "interim", "2025-09-30", "Otro (PDF)"),
  up(4, "interim", "2026-03-31", "Semestral (PDF)"),
];
const fact = (filing_id: number, concept: string, start: string | null, end: string, value: number, unit = "EUR"): FactInfo => ({
  filing_id, concept, source_tag: "pdf", value, unit, period_start: start, period_end: end, fetched_at: "2026-11-03T00:00:00Z", page: 1,
});
const fy = (id: number, y: number, v: Record<string, number>) =>
  Object.entries(v).map(([c, x]) => fact(id, c, `${y - 1}-10-01`, `${y}-09-30`, c === "shares_diluted" ? x : x * M, c === "shares_diluted" ? "shares" : "EUR"));

const facts: FactInfo[] = [
  ...fy(1, 2024, { revenue: 1000, net_income: 100, operating_income: 150, operating_cash_flow: 200, capex: 100, shares_diluted: 10 * M }),
  // Comparativo 2023 dentro del anual 2024
  ...fy(1, 2023, { revenue: 900, net_income: 90, shares_diluted: 10 * M }),
  ...fy(2, 2025, { revenue: 1100, net_income: 110, operating_income: 160, operating_cash_flow: 220, capex: 100, shares_diluted: 10 * M }),
  // Resumen de 5 años: el beneficio total (no el atribuible) de 2023 y el ejercicio 2022, que no está en ningún anual
  ...fy(3, 2023, { revenue: 900, net_income: 95 }),
  ...fy(3, 2022, { revenue: 800, net_income: 80 }),
  fact(4, "revenue", "2025-10-01", "2026-03-31", 600 * M),
  fact(4, "revenue", "2024-10-01", "2025-03-31", 500 * M),
  fact(4, "net_income", "2025-10-01", "2026-03-31", 66 * M),
  fact(4, "net_income", "2024-10-01", "2025-03-31", 50 * M),
];

describe("informes subidos en PDF (datos ficticios)", () => {
  it("estima la fecha de publicación del anual sin fecha: cierre + 4 meses", () => {
    expect(publishedBy({ filed_at: null, period_end: "2025-09-30" })).toBe("2026-01-30");
    expect(publishedBy({ filed_at: "2025-11-12T00:00:00Z", period_end: "2025-09-30" })).toBe("2025-11-12");
  });

  it("los ejercicios que solo salen como comparativos cuentan como años, con su documento y marcados", () => {
    const years = yearlyFundamentals(filings, facts);
    expect(years.map((y) => y.periodEnd)).toEqual(["2022-09-30", "2023-09-30", "2024-09-30", "2025-09-30"]);
    const y23 = years[1]!;
    // Del anual 2024 (beneficio atribuible), no del resumen
    expect(y23.netIncome!.value).toBe(90 * M);
    expect(y23.netIncome!.sources[0]!.filing.id).toBe(1);
    expect(y23.netIncome!.sources[0]!.fromComparative).toBe(true);
    expect(y23.statement.filing.filed_at).toBeNull();
    expect(years[0]!.revenue!.sources[0]!.filing.id).toBe(3);
    expect(years[2]!.revenueGrowth.value).toBeCloseTo(1000 / 900 - 1);
  });

  it("sin fecha de presentación hay historia de múltiplos, y nunca antes de la fecha estimada", () => {
    const years = yearlyFundamentals(filings, facts);
    const monthly: PricePoint[] = [];
    for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) monthly.push({ date: `${y}-${String(m).padStart(2, "0")}-01`, close: 100 });
    const history = historicalMultiples(years, monthly, []);
    expect(history.length).toBeGreaterThan(24);
    // 2023 (con acciones) se publica como tarde el 30-01-2024: el primer mes con múltiplo es enero de 2024
    expect(history[0]).toMatchObject({ date: "2024-01-01", basedOn: "2023-09-30", pe: (100 * 10 * M) / (90 * M) });
    expect(history.find((p) => p.date === "2025-02-01")!.basedOn).toBe("2024-09-30");
  });

  it("sin trimestre suelto, el crecimiento compara el semestre con el del año anterior", () => {
    expect(lastQuarterGrowth(filings, facts, "revenue")).toBeNull();
    const g = lastQuarterGrowth(filings, facts, "revenue", true)!;
    expect(g.growth).toBeCloseTo(0.2);
    expect(g.months).toBe(6);
  });

  it("los comparativos de un ESEF (filings.xbrl.org) también cuentan; los de la SEC no", () => {
    const esef: FilingInfo = { id: 9, form_type: "ESEF", period_type: "annual", period_end: "2022-12-31", filed_at: "2023-03-28", accession_no: "esef-22", url: null, source: "filings.xbrl.org" };
    const f2 = [
      fact(9, "revenue", "2022-01-01", "2022-12-31", 300 * M),
      fact(9, "revenue", "2021-01-01", "2021-12-31", 250 * M),
    ];
    expect(yearlyFundamentals([esef], f2).map((y) => y.periodEnd)).toEqual(["2021-12-31", "2022-12-31"]);
    expect(yearlyFundamentals([{ ...esef, source: "sec-edgar" }], f2).map((y) => y.periodEnd)).toEqual(["2022-12-31"]);
  });
});
