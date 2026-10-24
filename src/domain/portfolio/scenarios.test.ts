import { describe, expect, it } from "vitest";
import { buildScenarios, priceCagr } from "./scenarios";

describe("escenarios (datos FICTICIOS)", () => {
  it("pondera por valor, acota y deja planas las posiciones sin dato", () => {
    const s = buildScenarios([
      { ticker: "A", valueEur: 600, growth: 0.1, basis: "ventas" },
      { ticker: "B", valueEur: 300, growth: 0.5, basis: "ventas" }, // se acota al 20 %
      { ticker: "C", valueEur: 100, growth: null, basis: "precio" },
    ])!;
    expect(s.coverage).toBeCloseTo(0.9, 9);
    expect(s.missing).toEqual(["C"]);
    const base = (600 * 0.1 + 300 * 0.2) / 1000;
    expect(s.scenarios.map((x) => x.rate)).toEqual([expect.closeTo(base * 0.5, 9), expect.closeTo(base, 9), expect.closeTo(base * 1.5, 9)]);
    expect(s.scenarios[1]!.valueEur).toBeCloseTo(1000 * (1 + base) ** 10, 6);
  });

  it("con crecimiento negativo el prudente es peor y el optimista mejor", () => {
    const s = buildScenarios([{ ticker: "A", valueEur: 100, growth: -0.04, basis: "ventas" }])!;
    const [p, b, o] = s.scenarios.map((x) => x.rate);
    expect(p).toBeLessThan(b!);
    expect(o).toBeGreaterThan(b!);
  });

  it("sin datos no hay escenario", () => {
    expect(buildScenarios([{ ticker: "A", valueEur: 100, growth: null, basis: "precio" }])).toBeNull();
    expect(buildScenarios([])).toBeNull();
  });

  it("crecimiento del precio con al menos 3 años", () => {
    expect(priceCagr([{ date: "2020-01-31", close: 100 }, { date: "2022-01-31", close: 121 }])).toBeNull();
    expect(priceCagr([{ date: "2016-01-31", close: 100 }, { date: "2026-01-31", close: 200 }])).toBeCloseTo(2 ** (1 / 10.0007) - 1, 4);
  });
});
