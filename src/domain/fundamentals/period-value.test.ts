// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ownPeriodFact } from "./period-value";

// Cifras FICTICIAS
const facts = [
  { filing_id: 1, concept: "revenue", value: 1200, period_start: "2025-01-01", period_end: "2025-12-31" },
  { filing_id: 1, concept: "revenue", value: 1000, period_start: "2024-01-01", period_end: "2024-12-31" },
  { filing_id: 1, concept: "revenue", value: 300, period_start: "2025-10-01", period_end: "2025-12-31" },
  { filing_id: 2, concept: "revenue", value: 330, period_start: "2026-04-01", period_end: "2026-06-30" },
  { filing_id: 2, concept: "revenue", value: 640, period_start: "2026-01-01", period_end: "2026-06-30" },
  { filing_id: 2, concept: "operating_cash_flow", value: 90, period_start: "2026-01-01", period_end: "2026-06-30" },
  { filing_id: 2, concept: "cash", value: 50, period_start: null, period_end: "2026-06-30" },
  { filing_id: 2, concept: "cash", value: 45, period_start: null, period_end: "2025-12-31" },
];
const annual = { id: 1, period_end: "2025-12-31", period_type: "annual" as const };
const interim = { id: 2, period_end: "2026-06-30", period_type: "interim" as const };

describe("cifra propia de cada informe", () => {
  it("en un anual toma el año completo, no el comparativo ni el 4.º trimestre", () => {
    expect(ownPeriodFact(facts, annual, "revenue")?.fact.value).toBe(1200);
  });

  it("en un trimestral prefiere el trimestre", () => {
    expect(ownPeriodFact(facts, interim, "revenue")).toMatchObject({ fact: { value: 330 }, cumulative: false });
  });

  it("si solo hay acumulado del año lo marca como tal", () => {
    expect(ownPeriodFact(facts, interim, "operating_cash_flow")).toMatchObject({ fact: { value: 90 }, cumulative: true });
  });

  it("en el balance toma el saldo al cierre del informe", () => {
    expect(ownPeriodFact(facts, interim, "cash")?.fact.value).toBe(50);
  });

  it("devuelve null si no hay cifra (se mostrará «Sin dato»)", () => {
    expect(ownPeriodFact(facts, annual, "gross_profit")).toBeNull();
  });
});
