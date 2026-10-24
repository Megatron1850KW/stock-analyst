import { describe, expect, it } from "vitest";
import { complement, correlation, portfolioCorrelation, portfolioStar, watchlistStar, type HoldingCandidate, type PortfolioMix, type StarCandidate } from "./stars";

// DATOS FICTICIOS para tests: empresas y cifras inventadas.

const base = (over: Partial<StarCandidate> = {}): StarCandidate => ({
  id: 1,
  ticker: "FICT",
  name: "Ficticia SA",
  valuation: { verdict: "Justa", score: 50, deviation: 0 },
  peers: { verdict: null, deviation: null },
  quality: 70,
  outcome: "Justa",
  technical: "Medio",
  sector: "Tecnología",
  country: "US",
  currency: "USD",
  correlation: null,
  ...over,
});

const EMPTY: PortfolioMix = { sector: {}, country: {}, currency: {} };
const MIX: PortfolioMix = {
  sector: { Tecnología: 0.5, Consumo: 0.2, Finanzas: 0.3 },
  country: { US: 0.7, ES: 0.3 },
  currency: { USD: 0.7, EUR: 0.3 },
};

describe("complemento de cartera", () => {
  it("con la cartera vacía todo complementa", () => {
    expect(complement(base(), EMPTY).score).toBe(100);
  });

  it("premia lo que falta y penaliza lo que ya pesa mucho", () => {
    const tech = complement(base(), MIX);
    const health = complement(base({ sector: "Salud", country: "DE", currency: "EUR" }), MIX);
    expect(tech.score).toBe(0); // sector 50 % > 35 %, EE. UU. 70 % > 60 %, USD 70 % > 60 %
    expect(health.score).toBeGreaterThan(80);
    expect(health.parts.find((p) => p.id === "sector")?.text).toBe("Aporta el sector Salud, que no tienes en tu cartera.");
  });

  it("la correlación baja suma y la alta resta", () => {
    const low = complement(base({ sector: null, country: null, correlation: 0.1 }), { ...MIX, currency: {} });
    const high = complement(base({ sector: null, country: null, correlation: 0.95 }), { ...MIX, currency: {} });
    expect(low.score).toBe(100);
    expect(high.score).toBe(0);
  });
});

describe("estrella de la watchlist", () => {
  it("elige valoración × calidad × complemento y da 2–3 razones", () => {
    const r = watchlistStar(
      [
        base({ id: 1, ticker: "AAA", valuation: { verdict: "Barata", score: 80, deviation: -0.3 } }), // barata pero no complementa
        base({ id: 2, ticker: "BBB", sector: "Salud", country: "DE", currency: "EUR", valuation: { verdict: "Barata", score: 70, deviation: -0.2 }, quality: 75 }),
        base({ id: 3, ticker: "CCC", sector: "Industria", country: "FR", currency: "EUR", quality: 90 }),
      ],
      MIX,
    );
    expect(r.star?.ticker).toBe("BBB");
    expect(r.star!.reasons.length).toBeGreaterThanOrEqual(2);
    expect(r.star!.reasons.length).toBeLessThanOrEqual(3);
    expect(r.star!.reasons[0]).toBe("Un 20 % más barata que su media histórica.");
    expect(r.ranking.map((x) => x.candidate.ticker)).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("no premia trampas, calidad baja, caras ni riesgo técnico alto", () => {
    const cheap = { verdict: "Barata" as const, score: 90, deviation: -0.4 };
    const r = watchlistStar(
      [
        base({ id: 1, ticker: "TRAP", valuation: cheap, outcome: "Trampa de valor" }),
        base({ id: 2, ticker: "LOWQ", valuation: cheap, quality: 30 }),
        base({ id: 3, ticker: "CARA", valuation: { verdict: "Cara", score: 20, deviation: 0.3 } }),
        base({ id: 4, ticker: "TECH", valuation: cheap, technical: "Alto" }),
        base({ id: 5, ticker: "NOPX", valuation: { verdict: null, score: null, deviation: null } }),
        base({ id: 6, ticker: "HEAVY", valuation: cheap, heldWeight: 0.2 }),
      ],
      EMPTY,
    );
    expect(r.star).toBeNull();
    expect(r.note).toMatch(/mínimos/);
    expect(r.ranking.every((x) => x.excluded)).toBe(true);
    expect(r.ranking.find((x) => x.candidate.ticker === "TRAP")?.excluded).toBe("Posible trampa de valor.");
    expect(r.ranking.find((x) => x.candidate.ticker === "HEAVY")?.excluded).toMatch(/^Ya pesa un 20 % de tu cartera/);
  });

  it("la valoración mezcla historia y competencia", () => {
    const r = watchlistStar([base({ valuation: { verdict: "Justa", score: 50, deviation: 0 }, peers: { verdict: "Barata", deviation: -0.25 } })], EMPTY);
    expect(r.ranking[0]!.valuation).toBe(63); // (50 + 75) / 2 redondeado
    expect(r.star?.reasons.at(-1)).toBe("Tu cartera está vacía: cualquier acción la diversifica.");
  });

  it("sin acciones, sin estrella y con explicación", () => {
    expect(watchlistStar([], EMPTY).note).toMatch(/Añade acciones/);
  });
});

describe("estrella de la cartera", () => {
  const h = (over: Partial<HoldingCandidate>): HoldingCandidate => ({ ...base(), weight: 0.1, ...over });

  it("la más barata frente a su historia y a la competencia con calidad mínima", () => {
    const r = portfolioStar([
      h({ id: 1, ticker: "AAA", valuation: { verdict: "Barata", score: 70, deviation: -0.2 }, peers: { verdict: "Justa", deviation: -0.1 } }),
      h({ id: 2, ticker: "BBB", valuation: { verdict: "Barata", score: 80, deviation: -0.35 }, peers: { verdict: "Barata", deviation: -0.2 }, outcome: "Oportunidad" }),
      h({ id: 3, ticker: "TRAP", valuation: { verdict: "Barata", score: 95, deviation: -0.5 }, outcome: "Trampa de valor" }),
    ]);
    expect(r.star?.ticker).toBe("BBB");
    expect(r.star!.reasons).toEqual([
      "Más barata que de costumbre (un 35 %) y que sus competidores (un 20 %).",
      "Calidad de 70 de 100: no parece una trampa de valor.",
      "Barata frente a su historia y a la competencia con igual o mejor calidad: oportunidad.",
    ]);
    expect(r.ranking.at(-1)?.excluded).toBe("Posible trampa de valor.");
  });

  it("avisa si ya pesa demasiado, sin quitarle la estrella", () => {
    const r = portfolioStar([h({ weight: 0.2, valuation: { verdict: "Barata", score: 70, deviation: -0.2 } })]);
    expect(r.star?.caution).toMatch(/ya pesa un 20 %/);
  });

  it("sin descuento no hay estrella", () => {
    const r = portfolioStar([h({ valuation: { verdict: "Justa", score: 52, deviation: -0.02 } })]);
    expect(r.star).toBeNull();
    expect(r.ranking[0]!.excluded).toBe("Hoy no está más barata que de costumbre.");
  });
});

describe("correlación de precios mensuales", () => {
  const series = (f: (i: number) => number, n = 40) =>
    Array.from({ length: n }, (_, i) => ({ date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-28`, close: f(i) }));
  const up = series((i) => 100 * (1 + 0.05 * Math.sin(i)) * 1.01 ** i);
  const same = series((i) => 50 * (1 + 0.05 * Math.sin(i)) * 1.01 ** i);
  const opposite = series((i) => 100 * (1 - 0.05 * Math.sin(i)));

  it("misma forma → 1; forma opuesta → negativa", () => {
    expect(correlation(up, same)).toBeCloseTo(1, 5);
    expect(correlation(up, opposite)!).toBeLessThan(-0.5);
  });

  it("con pocos meses no se calcula", () => {
    expect(correlation(up.slice(0, 10), same.slice(0, 10))).toBeNull();
  });

  it("la media con la cartera pondera por peso", () => {
    const c = portfolioCorrelation(up, [
      { weight: 0.75, bars: same },
      { weight: 0.25, bars: opposite },
    ])!;
    expect(c).toBeCloseTo(0.75 * 1 + 0.25 * correlation(up, opposite)!, 5);
  });
});
