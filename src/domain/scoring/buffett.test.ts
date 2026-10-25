import { describe, expect, it } from "vitest";
import { buffettCriteria, buffettPick, type BuffettInput } from "./buffett";

// Empresas FICTICIAS para comprobar el criterio
const good: BuffettInput = {
  id: 1,
  ticker: "BUEN",
  name: "Buena Ficticia",
  years: [100, 110, 120, 130, 140].map((n) => ({ netIncome: n, equity: 500 })),
  grossMargin: 0.6,
  operatingMargin: 0.3,
  netCash: true,
  debtYears: null,
  cashConversion: 0.9,
  dilution: -0.02,
  freeCashFlow: 130,
  verdict: "Justa",
  ownerYield: 0.05,
};

describe("criterio Buffett (datos FICTICIOS)", () => {
  it("marca la que cumple los siete criterios", () => {
    const r = buffettPick([good], "");
    expect(r.picks.map((p) => p.input.ticker)).toEqual(["BUEN"]);
    expect(r.ranking[0]!.criteria.every((c) => c.pass)).toBe(true);
  });

  it("un criterio sin dato cuenta como no cumplido", () => {
    const r = buffettPick([{ ...good, dilution: null }], "");
    expect(r.picks).toHaveLength(0);
    expect(r.note).toMatch(/esperaría/);
  });

  it("descarta pérdidas, ROE bajo, deuda alta, precio caro y dilución", () => {
    const fails = (x: Partial<BuffettInput>, id: string) =>
      buffettCriteria({ ...good, ...x }).find((c) => c.id === id)!.pass;
    expect(fails({ years: [...good.years.slice(0, 4), { netIncome: -5, equity: 500 }] }, "consistency")).toBe(false);
    expect(fails({ years: good.years.map((y) => ({ ...y, equity: 2000 })) }, "roe")).toBe(false);
    expect(fails({ netCash: false, debtYears: 5 }, "debt")).toBe(false);
    expect(fails({ verdict: "Cara" }, "price")).toBe(false);
    expect(fails({ ownerYield: 0.02 }, "price")).toBe(false);
    expect(fails({ dilution: 0.03 }, "dilution")).toBe(false);
    // Sin margen bruto (un banco, Visa): mira el operativo
    expect(fails({ grossMargin: null, operatingMargin: 0.5 }, "moat")).toBe(true);
  });

  it("varias con «B»: primero la que más caja da por lo que cuesta", () => {
    const r = buffettPick([good, { ...good, id: 2, ticker: "OTRA", ownerYield: 0.08 }], "");
    expect(r.picks.map((p) => p.input.ticker)).toEqual(["OTRA", "BUEN"]);
  });
});
