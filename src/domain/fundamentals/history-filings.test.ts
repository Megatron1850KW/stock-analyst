// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CompanyFacts, FactEntry } from "@/data/sec-edgar/schemas";
import { historyFilingsFromFacts } from "./history-filings";
import type { FilingRef } from "./select-filings";

// FICTICIO: empresa inventada con ejercicios que cierran el 31 de diciembre.
function fy(year: number, accn: string, form = "10-K", filed = `${year + 1}-02-15`): FactEntry[] {
  return [
    // Cifra del propio ejercicio y comparativa del anterior (mismo accession).
    { start: `${year}-01-01`, end: `${year}-12-31`, val: 100 + year, accn, fy: year, fp: "FY", form, filed },
    { start: `${year - 1}-01-01`, end: `${year - 1}-12-31`, val: 99 + year, accn, fy: year, fp: "FY", form, filed },
    // Un trimestre dentro del 10-K no cuenta como anual.
    { start: `${year}-10-01`, end: `${year}-12-31`, val: 25, accn, fy: year, fp: "FY", form, filed },
  ];
}

const entries: FactEntry[] = [
  ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].flatMap((y) => fy(y, `acc-${y}`)),
  // Enmienda del 2019: se ignora.
  ...fy(2019, "acc-2019-A", "10-K/A", "2020-06-01"),
  // 10-Q: no es anual.
  { start: "2025-01-01", end: "2025-03-31", val: 30, accn: "q-2025", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01" },
];

const facts: CompanyFacts = {
  cik: "9999999",
  entityName: "Empresa Ficticia S.A.",
  facts: { "us-gaap": { Revenues: { label: "Revenues", units: { USD: entries } } } },
};

const core: FilingRef[] = [2025, 2024, 2023].map((y) => ({
  accession: `acc-${y}`,
  form: "10-K",
  periodType: "annual",
  reportDate: `${y}-12-31`,
  filingDate: `${y + 1}-02-15`,
  primaryDocument: "d.htm",
}));

describe("historia anual desde companyfacts (datos ficticios)", () => {
  it("devuelve los anuales antiguos que no cubren los informes principales", () => {
    const h = historyFilingsFromFacts(facts, core);
    expect(h.map((f) => f.reportDate)).toEqual([
      "2022-12-31", "2021-12-31", "2020-12-31", "2019-12-31", "2018-12-31", "2017-12-31", "2016-12-31",
    ]);
    expect(h.every((f) => f.periodType === "annual" && f.primaryDocument === "")).toBe(true);
    expect(h.find((f) => f.reportDate === "2019-12-31")!.accession).toBe("acc-2019");
  });

  it("limita a los años pedidos contando los principales", () => {
    const h = historyFilingsFromFacts(facts, core, 5);
    expect(h.map((f) => f.reportDate)).toEqual(["2022-12-31", "2021-12-31"]);
  });

  it("si no hay informes principales, usa toda la historia", () => {
    expect(historyFilingsFromFacts(facts, [], 11)).toHaveLength(10);
  });
});
