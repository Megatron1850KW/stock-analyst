// @vitest-environment node
import { describe, expect, it } from "vitest";
import { companyFactsSchema, submissionsSchema } from "@/data/sec-edgar/schemas";
import factsJson from "../../../tests/fixtures/ficticio/companyfacts.json";
import submissionsJson from "../../../tests/fixtures/ficticio/submissions.json";
import { CONCEPTS } from "./concepts";
import { convenienceRate, normalizeCompanyFacts, statementCurrency } from "./normalize";
import { selectFilings, toRows } from "./select-filings";

const facts = companyFactsSchema.parse(factsJson);
const sel = selectFilings(toRows(submissionsSchema.parse(submissionsJson).filings.recent));
const chosen = [...sel.annual, ...sel.interim];
const result = normalizeCompanyFacts(facts, chosen);
const K25 = "0009999999-26-000020";
const K23 = "0009999999-24-000005";

const of = (accn: string, concept: string) => result.facts.filter((f) => f.accession === accn && f.concept === concept);

describe("normalización al modelo común (datos ficticios)", () => {
  it("cada concepto tiene id único y al menos una etiqueta", () => {
    const ids = CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONCEPTS.every((c) => c.tags.length > 0)).toBe(true);
  });

  it("toma las ventas con la etiqueta que use cada informe y la registra", () => {
    const rev25 = of(K25, "revenue");
    expect(rev25.map((f) => [f.periodEnd, f.value])).toEqual([
      ["2025-12-31", 1_200_000_000],
      ["2024-12-31", 1_000_000_000], // comparativo del año anterior, sin duplicar
    ]);
    expect(rev25[0]!.sourceTag).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(rev25[0]!.periodStart).toBe("2025-01-01");
    expect(of(K23, "revenue")[0]!.sourceTag).toBe("us-gaap:Revenues");
  });

  it("guarda las cifras trimestrales y acumuladas con sus fechas", () => {
    const q = of("0009999999-26-000040", "revenue");
    expect(q.map((f) => [f.periodStart, f.periodEnd, f.value])).toContainEqual(["2026-04-01", "2026-06-30", 330_000_000]);
    expect(q.map((f) => [f.periodStart, f.periodEnd, f.value])).toContainEqual(["2026-01-01", "2026-06-30", 640_000_000]);
  });

  it("registra los huecos en vez de inventar cifras", () => {
    expect(of(K25, "gross_profit")).toHaveLength(1);
    expect(result.gaps).toContainEqual({ accession: K23, concept: "gross_profit" });
    expect(result.facts.some((f) => f.accession === K23 && f.concept === "gross_profit")).toBe(false);
  });

  it("no acepta cifras de otro periodo como si fueran del informe", () => {
    expect(of(K25, "operating_income")).toHaveLength(0);
    expect(result.gaps).toContainEqual({ accession: K25, concept: "operating_income" });
  });

  it("acepta la portada (dei) aunque su fecha no sea la del cierre", () => {
    expect(of(K25, "shares_outstanding")[0]).toMatchObject({ value: 1_000_000_000, unit: "shares", sourceTag: "dei:EntityCommonStockSharesOutstanding" });
  });

  it("usa las unidades correctas y detecta la divisa", () => {
    expect(of(K25, "eps_diluted")[0]!.unit).toBe("USD/shares");
    expect(of(K25, "net_income")[0]!.unit).toBe("USD");
    expect(result.currency).toBe("USD");
  });
});

describe("ventas de un banco (datos FICTICIOS al estilo de American Express)", () => {
  it("usa los ingresos netos de intereses antes que las comisiones", () => {
    const accn = "0009999999-26-000409";
    const e = (val: number) => [{ start: "2026-01-01", end: "2026-09-30", val, accn, form: "10-Q", filed: "2026-10-20" }];
    const bank = companyFactsSchema.parse({
      cik: 9999999,
      entityName: "BANCO FICTICIO",
      facts: { "us-gaap": { RevenuesNetOfInterestExpense: { units: { USD: e(58_606) } }, RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: e(32_962) } } } },
    });
    const r = normalizeCompanyFacts(bank, [{ accession: accn, form: "10-Q", periodType: "interim", reportDate: "2026-09-30", filingDate: "2026-10-20", primaryDocument: "x.htm" }]);
    expect(r.facts.find((f) => f.concept === "revenue")).toMatchObject({ value: 58_606, sourceTag: "us-gaap:RevenuesNetOfInterestExpense" });
  });
});

describe("banco europeo con etiquetas propias (datos FICTICIOS al estilo de UniCredit)", () => {
  it("toma el margen de intermediación como ventas y su patrimonio, pero no inventa deuda", () => {
    const accn = "FICTICIO-2025-12-31";
    const fy = (val: number) => [{ start: "2025-01-01", end: "2025-12-31", val, accn, form: "ESEF", filed: "2026-04-02" }];
    const at = (val: number) => [{ end: "2025-12-31", val, accn, form: "ESEF", filed: "2026-04-02" }];
    const bank = companyFactsSchema.parse({
      cik: "FICTICIO",
      entityName: "BANCO FICTICIO",
      facts: {
        ext: { GrossIncome: { units: { EUR: fy(24_826) } }, TotalEquityAttributableToOwnersOfParent: { units: { EUR: at(67_711) } }, TotalEquity: { units: { EUR: at(68_109) } } },
        "ifrs-full": { DebtSecurities: { units: { EUR: at(98_198) } } },
      },
    });
    const r = normalizeCompanyFacts(bank, [{ accession: accn, form: "ESEF", periodType: "annual", reportDate: "2025-12-31", filingDate: "2026-04-02", primaryDocument: "" }]);
    const get = (c: string) => r.facts.find((f) => f.concept === c);
    expect(get("revenue")).toMatchObject({ value: 24_826, sourceTag: "ext:GrossIncome" });
    expect(get("equity")).toMatchObject({ value: 67_711, sourceTag: "ext:TotalEquityAttributableToOwnersOfParent" });
    expect(get("debt_total")).toBeUndefined();
  });

  it("lee también las etiquetas en italiano (informe «-it»)", () => {
    const accn = "FICTICIO-2024-12-31";
    const bank = companyFactsSchema.parse({
      cik: "FICTICIO",
      entityName: "BANCO FICTICIO",
      facts: {
        ext: {
          MargineDiIntermediazione: { units: { EUR: [{ start: "2024-01-01", end: "2024-12-31", val: 24_270, accn, form: "ESEF", filed: "2025-04-02" }] } },
          PatrimonioNettoDelGruppo: { units: { EUR: [{ end: "2024-12-31", val: 62_441, accn, form: "ESEF", filed: "2025-04-02" }] } },
          PatrimonioNetto: { units: { EUR: [{ end: "2024-12-31", val: 62_841, accn, form: "ESEF", filed: "2025-04-02" }] } },
        },
      },
    });
    const r = normalizeCompanyFacts(bank, [{ accession: accn, form: "ESEF", periodType: "annual", reportDate: "2024-12-31", filingDate: "2025-04-02", primaryDocument: "" }]);
    const get = (c: string) => r.facts.find((f) => f.concept === c);
    expect(get("revenue")).toMatchObject({ value: 24_270, sourceTag: "ext:MargineDiIntermediazione" });
    expect(get("equity")).toMatchObject({ value: 62_441, sourceTag: "ext:PatrimonioNettoDelGruppo" });
  });
});

describe("20-F en otra divisa con conversión de conveniencia (datos FICTICIOS al estilo de TSMC)", () => {
  // Cada 20-F trae sus cuentas en TWD (año y comparativo) y solo el año en curso en USD, a su propio cambio
  const A24 = "FICT-20F-2024";
  const A25 = "FICT-20F-2025";
  const fy = (accn: string, y: number, val: number) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, accn, form: "20-F", filed: `${y + 1}-04-15` });
  const facts = companyFactsSchema.parse({
    cik: 9999998,
    entityName: "FUNDICIÓN FICTICIA",
    facts: {
      "ifrs-full": {
        Revenue: {
          units: {
            TWD: [fy(A24, 2023, 2_000), fy(A24, 2024, 3_000), fy(A25, 2024, 3_000), fy(A25, 2025, 4_000)],
            USD: [fy(A24, 2024, 100), fy(A25, 2025, 4_000 / 32)], // 30 NT$/$ en 2024, 32 en 2025
          },
        },
        ProfitLoss: { units: { TWD: [fy(A25, 2024, 1_200), fy(A25, 2025, 1_600)], USD: [fy(A25, 2025, 50)] } },
        BasicEarningsLossPerShare: { units: { "TWD/shares": [fy(A25, 2025, 64)], "USD/shares": [fy(A25, 2025, 2)] } },
      },
    },
  });
  const filing = (accession: string, y: number) => ({ accession, form: "20-F", periodType: "annual" as const, reportDate: `${y}-12-31`, filingDate: `${y + 1}-04-15`, primaryDocument: "x.htm" });
  const r = normalizeCompanyFacts(facts, [filing(A24, 2024), filing(A25, 2025)]);
  const rev = (accn: string, end: string) => r.facts.find((f) => f.accession === accn && f.concept === "revenue" && f.periodEnd === end);

  it("detecta la divisa de las cuentas y el cambio de conveniencia", () => {
    expect(statementCurrency(facts, A25)).toBe("TWD");
    expect(convenienceRate(facts, A25, "TWD")).toBe(32);
  });

  it("pasa todos los años a USD con el último cambio: el crecimiento es el de la divisa original", () => {
    expect(rev(A25, "2025-12-31")).toMatchObject({ value: 125, unit: "USD" });
    // 2024 sale a 3.000 / 32, no a los 100 $ de su propio 20-F (cambio de 30)
    expect(rev(A24, "2024-12-31")!.value).toBeCloseTo(93.75);
    expect(rev(A25, "2025-12-31")!.value / rev(A24, "2024-12-31")!.value - 1).toBeCloseTo(4_000 / 3_000 - 1);
    expect(rev(A24, "2024-12-31")!.sourceTag).toBe("ifrs-full:Revenue (TWD a USD a 32 TWD/USD, el cambio de conveniencia del informe FICT-20F-2025)");
    expect(r.facts.find((f) => f.concept === "eps_basic" || f.unit === "USD/shares")).toMatchObject({ value: 2, unit: "USD/shares" });
    expect(r.currency).toBe("USD");
  });
});
