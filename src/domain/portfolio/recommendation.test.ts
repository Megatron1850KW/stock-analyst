import { describe, expect, it } from "vitest";
import { recommend, trendFromCloses, type RecommendationInput } from "./recommendation";

const base: RecommendationInput = {
  kind: "stock",
  weight: 0.08,
  sector: { name: "Tecnología", weight: 0.2 },
  valuation: "Justa",
  outcome: "Justa",
  quality: 70,
  activeSignals: [],
  debt: "Baja",
  trend: null,
};

describe("recommend (§8.4)", () => {
  it("compra más una oportunidad sin sobreconcentración", () => {
    expect(recommend({ ...base, valuation: "Barata", outcome: "Oportunidad" }).action).toBe("Comprar más");
  });

  it("precio justo: compra solo con buena calidad", () => {
    expect(recommend(base).action).toBe("Comprar más");
    expect(recommend({ ...base, quality: 50 }).action).toBe("Mantener");
  });

  it("cara → mantener", () => {
    expect(recommend({ ...base, valuation: "Cara", outcome: "Cara" }).action).toBe("Mantener");
  });

  it("no sobreconcentra: posición > 15 % o sector > 35 %", () => {
    const pos = recommend({ ...base, valuation: "Barata", outcome: "Oportunidad", weight: 0.18 });
    expect(pos.action).toBe("Mantener");
    expect(pos.reasons[0]).toContain("18 %");
    expect(recommend({ ...base, valuation: "Barata", sector: { name: "Tecnología", weight: 0.4 } }).action).toBe("Mantener");
  });

  it("alertas serias → Mantener — vigilar, con el motivo", () => {
    const r = recommend({ ...base, valuation: "Barata", outcome: "Trampa de valor", activeSignals: ["Ventas cayendo", "Deuda creciendo"] });
    expect(r.action).toBe("Mantener — vigilar");
    expect(r.reasons[0]).toBe("Posible trampa de valor: ventas cayendo y deuda creciendo.");
    expect(recommend({ ...base, debt: "Alta" }).action).toBe("Mantener — vigilar");
    expect(recommend({ ...base, quality: 30 }).action).toBe("Mantener — vigilar");
  });

  it("sin valoración no recomienda comprar", () => {
    expect(recommend({ ...base, valuation: null, outcome: null }).action).toBe("Mantener");
  });

  it("ETF/ETC: tendencia y equilibrio, sin estados financieros", () => {
    const etf = { ...base, kind: "etf" as const, valuation: null, outcome: null, quality: null, debt: null };
    const up = recommend({ ...etf, trend: { price: 110, average: 100 } });
    expect(up.action).toBe("Comprar más");
    expect(up.noFinancials).toBe(true);
    expect(up.reasons.at(-1)).toContain("no hay estados financieros");
    expect(recommend({ ...etf, kind: "etc", trend: { price: 90, average: 100 } }).action).toBe("Mantener");
    expect(recommend({ ...etf, trend: null }).action).toBe("Mantener");
    expect(recommend({ ...etf, weight: 0.3, trend: { price: 110, average: 100 } }).action).toBe("Mantener");
  });

  it("media de 10 meses", () => {
    expect(trendFromCloses([1, 2, 3])).toBeNull();
    expect(trendFromCloses([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ price: 10, average: 5.5 });
  });
});
