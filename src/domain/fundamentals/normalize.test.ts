// @vitest-environment node
import { describe, expect, it } from "vitest";
import { companyFactsSchema, submissionsSchema } from "@/data/sec-edgar/schemas";
import factsJson from "../../../tests/fixtures/ficticio/companyfacts.json";
import submissionsJson from "../../../tests/fixtures/ficticio/submissions.json";
import { CONCEPTS } from "./concepts";
import { normalizeCompanyFacts } from "./normalize";
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
});
