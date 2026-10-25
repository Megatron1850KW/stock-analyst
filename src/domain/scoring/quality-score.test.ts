import { describe, expect, it } from "vitest";
import type { Fundamentals, YearFundamentals } from "@/domain/fundamentals/metrics";
import { qualityScore, trapSignals } from "./quality-score";

// Datos FICTICIOS de prueba: solo los campos que usa la puntuación
const input = (value: number | undefined) => (value === undefined ? null : { label: "", value, unit: "USD", sources: [] });
const metric = (value: number | null | undefined) => ({ label: "", kind: "money", value: value ?? null, formula: "", inputs: [] });

interface Y { revenue?: number; netIncome?: number; opMargin?: number; fcf?: number; netDebt?: number; shares?: number }
function year(end: string, y: Y): YearFundamentals {
  return {
    revenue: input(y.revenue),
    netIncome: input(y.netIncome),
    shares: input(y.shares),
    operatingMargin: metric(y.opMargin),
    freeCashFlow: metric(y.fcf),
    netDebt: metric(y.netDebt),
    periodEnd: end,
  } as unknown as YearFundamentals;
}
const series = (ys: Y[]) => ys.map((y, k) => year(`${2021 + k}-12-31`, y));
const now = (ys: YearFundamentals[]) => ys.at(-1) as unknown as Fundamentals;

const healthy = series([
  { revenue: 100, netIncome: 10, opMargin: 0.15, fcf: 10, netDebt: 20, shares: 100 },
  { revenue: 110, netIncome: 12, opMargin: 0.16, fcf: 12, netDebt: 15, shares: 99 },
  { revenue: 121, netIncome: 14, opMargin: 0.17, fcf: 14, netDebt: 10, shares: 98 },
  { revenue: 133, netIncome: 16, opMargin: 0.18, fcf: 16, netDebt: 5, shares: 97 },
]);
const sick = series([
  { revenue: 133, netIncome: 16, opMargin: 0.18, fcf: 16, netDebt: 10, shares: 100 },
  { revenue: 125, netIncome: 12, opMargin: 0.15, fcf: 12, netDebt: 12, shares: 104 },
  { revenue: 118, netIncome: 8, opMargin: 0.12, fcf: 7, netDebt: 14, shares: 108 },
  { revenue: 110, netIncome: 4, opMargin: 0.08, fcf: 3, netDebt: 20, shares: 113 },
]);

describe("qualityScore", () => {
  it("puntúa alto a una empresa que crece, mejora márgenes, convierte en caja y recompra", () => {
    const q = qualityScore(now(healthy), healthy, "Baja");
    expect(q.score).toBeGreaterThan(75);
    expect(q.parts.find((p) => p.id === "growth")?.value).toBeCloseTo(0.1, 2);
    expect(q.parts.find((p) => p.id === "dilution")?.explanation).toMatch(/Recompra acciones/);
    expect(q.activeSignals).toBe(0);
  });

  it("puntúa bajo y marca señales de trampa a una empresa que empeora", () => {
    const q = qualityScore(now(sick), sick, "Moderada");
    expect(q.score).toBeLessThan(40);
    const active = q.signals.filter((s) => s.active).map((s) => s.id);
    expect(active).toEqual(["salesFalling", "marginsDown", "debtGrowing", "fcfWeak", "dilution"]);
  });

  it("sin datos suficientes no da nota", () => {
    const one = series([{ revenue: 100 }]);
    const q = qualityScore(now(one), one, null);
    expect(q.score).toBeNull();
    expect(q.note).toMatch(/Faltan datos/);
  });

  it("reparte el peso entre las partes que tienen dato", () => {
    const noShares = healthy.map((y) => ({ ...y, shares: null }));
    const q = qualityScore(now(noShares), noShares, "Baja");
    expect(q.parts.find((p) => p.id === "dilution")?.score).toBeNull();
    expect(q.score).toBeGreaterThan(75);
  });
});

describe("trapSignals", () => {
  it("sin datos de un año la señal queda sin saber (null), no en falso", () => {
    const gaps = series([{ revenue: 100 }, { revenue: 90 }]);
    const s = trapSignals(gaps, now(gaps));
    expect(s.find((x) => x.id === "marginsDown")?.active).toBeNull();
    expect(s.find((x) => x.id === "salesFalling")?.active).toBe(true);
  });
  it("una caja libre negativa cuenta como señal", () => {
    const neg = series([{ fcf: 5 }, { fcf: -2 }]);
    expect(trapSignals(neg, now(neg)).find((x) => x.id === "fcfWeak")?.active).toBe(true);
  });
});

describe("calidad de un banco (datos FICTICIOS al estilo de UniCredit)", () => {
  it("sin margen operativo ni caja libre, mira el margen neto y la rentabilidad sobre el capital", () => {
    const bank = [100, 110, 120, 125].map((rev, k) => ({
      ...year(`${2022 + k}-12-31`, { revenue: rev, netIncome: rev * 0.4, shares: 100 - k * 5 }),
      netMargin: metric(0.4),
      statement: { values: { equity: { value: rev * 2.5 } } },
    })) as unknown as YearFundamentals[];
    const q = qualityScore(now(bank), bank, null);
    expect(q.score).not.toBeNull();
    expect(q.parts.find((p) => p.id === "margins")!.explanation).toMatch(/beneficio neto/);
    // 40 / 250 = 16 % sobre el capital: la nota máxima de esa parte
    expect(q.parts.find((p) => p.id === "roe")).toMatchObject({ score: 100 });
  });

  it("una industrial no cambia: la rentabilidad sobre el capital no entra", () => {
    expect(qualityScore(now(healthy), healthy, "Baja").parts.some((p) => p.id === "roe")).toBe(false);
  });
});
