// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isFinancial } from "./financial";

const m = (v: number | null) => ({ label: "", kind: "percent" as const, value: v, formula: "", inputs: [] });
const byNature = { grossMargin: m(null), operatingMargin: m(null), netMargin: m(0.09) };

describe("¿financiera? (datos ficticios)", () => {
  it("sin margen bruto ni operativo y sector Finanzas o desconocido: sí", () => {
    expect(isFinancial(byNature, "Finanzas")).toBe(true);
    expect(isFinancial(byNature, null)).toBe(true);
  });
  it("una petrolera con la cuenta por naturaleza no es un banco", () => {
    expect(isFinancial(byNature, "Energía")).toBe(false);
  });
  it("con margen operativo nunca", () => {
    expect(isFinancial({ ...byNature, operatingMargin: m(0.2) }, "Finanzas")).toBe(false);
  });
});
