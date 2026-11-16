import { describe, expect, it } from "vitest";
import { nextBuy, type NextBuyCandidate } from "./next-buy";

// DATOS FICTICIOS para tests: valores y cifras inventadas.

const stock = (over: Partial<NextBuyCandidate> = {}): NextBuyCandidate => ({
  id: 1,
  ticker: "FICA",
  name: "Ficticia A SA",
  kind: "stock",
  valueEur: 5_000,
  priceEur: 100,
  fractional: false,
  sector: { name: "Tecnología", valueEur: 5_000 },
  action: "Comprar más",
  alerts: [],
  technical: "Medio",
  valuation: { source: "history", score: 50, deviation: 0, verdict: "Justa" },
  cash: { fcfYield: 0.04, operatingMargin: 0.15, netMargin: 0.1 },
  growth: { multiYear: 0.05, recent: 0.05, recentPeriod: "último trimestre" },
  quality: 60,
  ...over,
});

const TOTAL = 100_000;

describe("Qué compro hoy", () => {
  it("elige la más barata, que más caja genera y que más crece, y explica por qué", () => {
    const good = stock({
      id: 2,
      ticker: "FICB",
      valuation: { source: "history", score: 80, deviation: -0.25, verdict: "Barata" },
      cash: { fcfYield: 0.07, operatingMargin: 0.25, netMargin: 0.2 },
      growth: { multiYear: 0.12, recent: 0.15, recentPeriod: "último trimestre" },
    });
    const r = nextBuy([stock(), good], TOTAL, { mode: "eur", value: 1_000 });
    expect(r.winner?.candidate.ticker).toBe("FICB");
    expect(r.why[0]).toMatch(/^Frente a FICA .*FICB está más barata, genera más caja y crece más\.$/);
    expect(r.plan).toEqual([{ id: 2, ticker: "FICB", shares: 10, eur: 1_000, weightAfter: 6_000 / 101_000 }]);
    expect(r.leftover).toBeNull();
  });

  it("el peso en cartera penaliza a la que ya pesa mucho", () => {
    const heavy = stock({ id: 2, ticker: "PESA", valueEur: 14_000, sector: { name: "Salud", valueEur: 14_000 } });
    const light = stock({ id: 3, ticker: "LIGE", valueEur: 2_000, sector: { name: "Consumo", valueEur: 2_000 } });
    const r = nextBuy([heavy, light], TOTAL, { mode: "eur", value: 3_000 });
    expect(r.winner?.candidate.ticker).toBe("LIGE");
    const balance = r.ranked.find((x) => x.candidate.ticker === "PESA")!.criteria.find((c) => c.id === "balance")!;
    expect(balance.score).toBe(0);
    expect(balance.text).toMatch(/por encima del máximo recomendado del 15 %/);
  });

  it("si el sector pasaría del 35 %, el criterio de peso no da más de 20 puntos", () => {
    const r = nextBuy([stock({ sector: { name: "Tecnología", valueEur: 36_000 } })], TOTAL, { mode: "eur", value: 1_000 });
    const balance = r.ranked[0]!.criteria.find((c) => c.id === "balance")!;
    expect(balance.score).toBe(20);
    expect(balance.text).toMatch(/El sector Tecnología pasaría a un 37 %/);
  });

  it("«Mantener — vigilar» y sin precio no pueden ganar, y se dice", () => {
    const watch = stock({ id: 2, ticker: "VIGI", action: "Mantener — vigilar", alerts: ["Tiene mucha deuda para la caja que genera."], valuation: { source: "history", score: 100, deviation: -0.5, verdict: "Barata" } });
    const noPrice = stock({ id: 3, ticker: "SINP", priceEur: null, valueEur: null });
    const r = nextBuy([watch, noPrice, stock()], TOTAL, { mode: "eur", value: 500 });
    expect(r.winner?.candidate.ticker).toBe("FICA");
    expect(r.why).toContain("VIGI queda fuera: está en «Mantener — vigilar»: tiene mucha deuda para la caja que genera.");
    expect(r.ranked.find((x) => x.candidate.ticker === "SINP")!.excluded).toMatch(/No tiene precio/);
  });

  it("un ETF: caja no aplica (neutro), valoración por su media de 10 meses y crecimiento por precio", () => {
    const etf = stock({ id: 4, ticker: "FETF", kind: "etf", sector: null, cash: null, valuation: { source: "trend", deviation: -0.075 }, growth: { multiYear: 0.1, recent: null, recentPeriod: null } });
    const r = nextBuy([etf], TOTAL, { mode: "eur", value: 1_000 });
    const [balance, valuation, cash, growth] = r.ranked[0]!.criteria;
    expect(valuation!.score).toBe(75);
    expect(valuation!.text).toMatch(/un 8 % por debajo de su media de 10 meses/);
    expect(cash!.score).toBeNull();
    expect(cash!.text).toMatch(/No aplica/);
    expect(growth!.score).toBe(75);
    expect(balance!.text).toMatch(/Un fondo ya reparte/);
  });

  it("si todo en la ganadora pasaría del 15 %, el resto va a la siguiente", () => {
    const best = stock({ id: 2, ticker: "BEST", valueEur: 13_000, sector: { name: "Salud", valueEur: 13_000 },
      valuation: { source: "history", score: 100, deviation: -0.5, verdict: "Barata" },
      cash: { fcfYield: 0.1, operatingMargin: 0.3, netMargin: 0.2 },
      growth: { multiYear: 0.2, recent: 0.2, recentPeriod: "último trimestre" },
    });
    const second = stock({ id: 3, ticker: "SEGU", valueEur: 1_000, sector: { name: "Consumo", valueEur: 1_000 } });
    const r = nextBuy([best, second], TOTAL, { mode: "eur", value: 5_000 });
    expect(r.winner?.candidate.ticker).toBe("BEST");
    // Cabe 15 % × 105.000 − 13.000 = 2.750 € → 27 acciones enteras; el resto a SEGU
    expect(r.plan.map((a) => [a.ticker, a.shares])).toEqual([["BEST", 27], ["SEGU", 23]]);
    expect(r.leftover).toBeNull();
    expect(r.overCap).toBe(false);
  });

  it("si ninguna tiene sitio, el dinero va a la ganadora y se avisa", () => {
    const a = stock({ id: 2, ticker: "GRAA", valueEur: 40_000, sector: null });
    const b = stock({ id: 3, ticker: "GRAB", valueEur: 50_000, sector: null, valuation: { source: "history", score: 0, deviation: 0.5, verdict: "Cara" } });
    const r = nextBuy([a, b], TOTAL, { mode: "eur", value: 1_000 });
    expect(r.plan).toEqual([{ id: 2, ticker: "GRAA", shares: 10, eur: 1_000, weightAfter: 41_000 / 101_000 }]);
    expect(r.overCap).toBe(true);
    expect(r.leftover).toBeNull();
  });

  it("acciones enteras: lo que sobra se dice; con fracciones se compra todo", () => {
    const whole = nextBuy([stock({ priceEur: 300 })], TOTAL, { mode: "eur", value: 1_000 });
    expect(whole.plan[0]!.shares).toBe(3);
    expect(whole.leftover?.eur).toBe(100);
    const frac = nextBuy([stock({ priceEur: 300, fractional: true })], TOTAL, { mode: "eur", value: 1_000 });
    expect(frac.plan[0]!.shares).toBeCloseTo(3.3333, 4);
    const tooDear = nextBuy([stock({ priceEur: 2_000 })], TOTAL, { mode: "eur", value: 1_000 });
    expect(tooDear.plan).toEqual([]);
    expect(tooDear.leftover?.reason).toMatch(/no llega para una acción entera/);
  });

  it("en acciones, el coste de cada una es ese número de acciones a su precio", () => {
    const r = nextBuy([stock(), stock({ id: 2, ticker: "CARA", priceEur: 1_000, sector: { name: "Salud", valueEur: 5_000 } })], TOTAL, { mode: "shares", value: 5 });
    expect(r.ranked.find((x) => x.candidate.ticker === "CARA")!.costEur).toBe(5_000);
    expect(r.winner?.candidate.ticker).toBe("FICA");
    expect(r.plan).toEqual([{ id: 1, ticker: "FICA", shares: 5, eur: 500, weightAfter: 5_500 / 100_500 }]);
  });

  it("riesgo técnico alto resta puntos y se avisa", () => {
    const r = nextBuy([stock({ technical: "Alto" })], TOTAL, { mode: "eur", value: 100 });
    const plain = nextBuy([stock()], TOTAL, { mode: "eur", value: 100 });
    expect(plain.winner!.total - r.winner!.total).toBe(10);
    expect(r.winner!.warnings[0]).toMatch(/Riesgo técnico de largo plazo alto/);
  });
});
