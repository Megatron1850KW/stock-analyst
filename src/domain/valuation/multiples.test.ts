// @vitest-environment node
import { describe, expect, it } from "vitest";
import { currentGetter, fundamentals, yearlyFundamentals } from "@/domain/fundamentals/metrics";
import type { FactInfo, FilingInfo } from "@/domain/fundamentals/statements";
import { debtLevel } from "@/domain/scoring/debt-level";
import { valuationScore, verdictFor } from "@/domain/scoring/valuation-score";
import { adrRatio } from "./adr";
import { currentMultiples, historicalMultiples, median, splitFactorAfter, type PricePoint } from "./multiples";

/*
 * Empresa FICTICIA y estable: cada año gana 100 M$, genera 100 M$ de caja
 * libre, no tiene deuda y tiene 10 M de acciones (20 M tras un split 2×1 en
 * julio de 2020). El precio ajustado vale 100 $ siempre, así que vale
 * 2.000 M$ y su PER histórico es 20 (antes del split: 100 $ ajustados × 10 M
 * acciones publicadas × 2).
 */
const M = 1e6;
const filings: FilingInfo[] = [];
const facts: FactInfo[] = [];
for (let y = 2014; y <= 2025; y++) {
  const id = y;
  filings.push({ id, form_type: "10-K", period_type: "annual", period_end: `${y}-12-31`, filed_at: `${y + 1}-02-15`, accession_no: `a-${y}`, url: null });
  const f = (concept: string, value: number, unit = "USD", instant = false): FactInfo => ({
    filing_id: id, concept, source_tag: null, value, unit, period_start: instant ? null : `${y}-01-01`, period_end: `${y}-12-31`, fetched_at: "2026-10-24T00:00:00Z",
  });
  facts.push(
    f("revenue", 500 * M), f("operating_income", 120 * M), f("net_income", 100 * M),
    f("operating_cash_flow", 130 * M), f("capex", 30 * M),
    f("cash", 0, "USD", true),
    f("shares_diluted", (y < 2020 ? 10 : 20) * M, "shares"),
  );
}
const splits = [{ date: "2020-07-01", numerator: 2, denominator: 1 }];
const monthly: PricePoint[] = [];
for (let y = 2015; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 10) break;
    // Antes del split el precio real era 200 $, que ajustado por el 2×1 son 100 $
    monthly.push({ date: `${y}-${String(m).padStart(2, "0")}-01`, close: 100 });
  }
}
const years = yearlyFundamentals(filings, facts);

describe("múltiplos frente a su propia historia (datos ficticios)", () => {
  it("ajusta las acciones por splits posteriores al informe", () => {
    expect(splitFactorAfter(splits, "2020-02-15")).toBe(2);
    expect(splitFactorAfter(splits, "2021-02-15")).toBe(1);
    const hist = historicalMultiples(years, monthly, splits);
    // Enero de 2015 aún no hay ningún informe publicado (el de 2014 sale en febrero)
    expect(hist[0]!.date).toBe("2015-02-01");
    // Sin el ajuste, en 2019 el PER saldría 10 en vez de 20
    expect(hist.find((p) => p.date === "2019-06-01")).toMatchObject({ pe: 20, basedOn: "2018-12-31", marketCap: 2000 * M });
    expect(hist.find((p) => p.date === "2024-06-01")).toMatchObject({ pe: 20, pfcf: 20, evEbit: 2000 / 120 });
  });

  it("valora hoy con 12 meses de cifras y el precio actual", () => {
    const f = fundamentals(currentGetter(filings, facts));
    const price = { value: 80, date: "2026-10-23", currency: "USD", source: "test", fetchedAt: "2026-10-23T22:00:00Z" };
    const cur = currentMultiples(f, price, splits, "USD");
    expect(cur.marketCap.value).toBe(1600 * M);
    expect(cur.pe.value).toBe(16);
    expect(cur.fcfYield.value).toBeCloseTo(100 / 1600);

    // A 80 $ el PER es 16 frente a 20 de costumbre → un 20 % más barata que su historia
    const s = valuationScore(cur, historicalMultiples(years, monthly, splits), monthly);
    expect(s.comparisons.find((c) => c.id === "pe")).toMatchObject({ fiveYears: { median: 20, enough: true }, tenYears: { median: 20, enough: true } });
    expect(s.deviation).toBeCloseTo(-0.2);
    expect(s.verdict).toBe("Barata");
    expect(s.parts.priceRange).toBe(100); // en mínimos de 10 años
    expect(s.score).toBe(Math.round(70 * 0.8 + 100 * 0.2));
  });

  it("explica que no hay veredicto sin historia suficiente", () => {
    const f = fundamentals(currentGetter(filings, facts));
    const price = { value: 100, date: "2026-10-23", currency: "USD", source: "test", fetchedAt: "" };
    const s = valuationScore(currentMultiples(f, price, splits, "USD"), historicalMultiples(years, monthly.slice(-12), splits), monthly.slice(-12));
    expect(s.verdict).toBeNull();
    expect(s.note).toMatch(/al menos 2 años/);
  });

  it("un ADR equivale a varias acciones: la capitalización se cuenta en ADR", () => {
    const f = fundamentals(currentGetter(filings, facts));
    // Ficticio: cada ADR vale 5 acciones, así que cotiza 5 veces más caro
    const price = { value: 400, date: "2026-10-23", currency: "USD", source: "test", fetchedAt: "" };
    const cur = currentMultiples(f, price, splits, "USD", 5);
    expect(cur.marketCap.value).toBe(1600 * M);
    expect(cur.fcfYield.value).toBeCloseTo(100 / 1600);
    expect(cur.marketCap.inputs[1]!.note).toMatch(/ADR/);
    const adrMonthly = monthly.map((p) => ({ ...p, close: p.close * 5 }));
    expect(historicalMultiples(years, adrMonthly, splits, 5).find((p) => p.date === "2024-06-01")).toMatchObject({ pe: 20 });
    expect(adrRatio("tsm", "US")).toBe(5);
    expect(adrRatio("TSM", "EU")).toBe(1);
    expect(adrRatio("MU", "US")).toBe(1);
  });

  it("no mezcla divisas", () => {
    const f = fundamentals(currentGetter(filings, facts));
    const cur = currentMultiples(f, { value: 100, date: "2026-10-23", currency: "EUR", source: "t", fetchedAt: "" }, [], "USD");
    expect(cur.pe.value).toBeNull();
    expect(cur.marketCap.note).toMatch(/cuentas están en USD/);
  });

  it("umbrales ±15 % y mediana", () => {
    expect([verdictFor(-0.16), verdictFor(-0.15), verdictFor(0.15), verdictFor(0.151)]).toEqual(["Barata", "Justa", "Justa", "Cara"]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("nivel de deuda (datos ficticios)", () => {
  const m = (value: number | null) => ({ label: "", kind: "money" as const, value, formula: "", inputs: [] });
  it("caja neta o < 2 años = Baja; 2–4 = Moderada; > 4 o sin caja libre = Alta", () => {
    expect(debtLevel(m(0), m(-10), m(5))).toBe("Baja");
    expect(debtLevel(m(1.5), m(10), m(5))).toBe("Baja");
    expect(debtLevel(m(3), m(10), m(5))).toBe("Moderada");
    expect(debtLevel(m(5), m(10), m(5))).toBe("Alta");
    expect(debtLevel(m(null), m(10), m(-1))).toBe("Alta");
    expect(debtLevel(m(null), m(null), m(5))).toBeNull();
  });
});
