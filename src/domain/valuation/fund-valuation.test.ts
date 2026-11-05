import { describe, expect, it } from "vitest";
import { fundTrendValuation } from "./fund-valuation";

// Datos ficticios: un fondo que sube un 1 % al mes, con el último cierre movido
const series = (months: number, last = 1) => Array.from({ length: months }, (_, t) => 100 * 1.01 ** t * (t === months - 1 ? last : 1));

describe("fundTrendValuation (§5.5)", () => {
  it("en su tendencia → Justa, con el ritmo anual", () => {
    const v = fundTrendValuation(series(120));
    expect(v.verdict).toBe("Justa");
    expect(v.deviation).toBeCloseTo(0, 6);
    expect(v.score).toBe(50);
    expect(v.trendAnnual).toBeCloseTo(1.01 ** 12 - 1, 6);
    expect(v.sentence).toContain("justo en su tendencia de 10 años");
  });

  it("muy por encima → Cara; muy por debajo → Barata", () => {
    const hi = fundTrendValuation(series(60, 1.4));
    expect(hi.verdict).toBe("Cara");
    expect(hi.deviation!).toBeGreaterThan(0.15);
    expect(hi.score!).toBeLessThan(50);
    expect(hi.sentence).toMatch(/por encima de su tendencia de 5 años/);
    const lo = fundTrendValuation(series(60, 0.7));
    expect(lo.verdict).toBe("Barata");
    expect(lo.score!).toBeGreaterThan(50);
  });

  it("usa como mucho 10 años y exige 3", () => {
    expect(fundTrendValuation(series(200)).months).toBe(120);
    const short = fundTrendValuation(series(30));
    expect(short.verdict).toBeNull();
    expect(short.sentence).toContain("al menos 3 años");
  });

  it("ignora cierres no válidos", () => {
    const xs = series(48);
    xs[10] = 0;
    xs[11] = Number.NaN;
    expect(fundTrendValuation(xs).months).toBe(46);
  });
});
