import { describe, expect, it } from "vitest";
import { fundTrendValuation } from "@/domain/valuation/fund-valuation";
import { companyExposure, complementOf, nextFundBuys, type NextBuyCandidate, type NextBuyPortfolio } from "./fund-next-buy";
import { companyKey, holdingLabel } from "./holdings";

// Todo ficticio salvo los nombres tal como los escriben las fichas
const series = (last: number) => Array.from({ length: 60 }, (_, t) => 100 * 1.01 ** t * (t === 59 ? last : 1));

const base: NextBuyCandidate = {
  id: 1, ticker: "TECH", name: "Fondo tecnológico (ficticio)", kind: "etf", commodity: false,
  valuation: fundTrendValuation(series(1)), technical: "Bajo",
  sectors: [{ key: "Tecnología", weight: 0.7 }, { key: "Comunicaciones", weight: 0.3 }],
  countries: [{ key: "US", weight: 1 }],
  holdings: [{ name: "NVIDIA CORP USD0.001", weight: 0.1 }, { name: "APPLE INC USD0.00001", weight: 0.08 }],
  heldEur: 0,
};

const portfolio: NextBuyPortfolio = {
  totalEur: 10_000,
  bySector: [{ key: "Tecnología", valueEur: 5_000, weight: 0.5 }, { key: "Salud", valueEur: 5_000, weight: 0.5 }],
  byCountry: [{ key: "US", valueEur: 10_000, weight: 1 }],
  companies: companyExposure([{ valueEur: 5_000, kind: "etf", name: "S&P 500", holdings: [{ name: "Nvidia Corp", weight: 0.07 }] }], 10_000),
};

describe("nombres de posiciones", () => {
  it("reconoce la misma empresa escrita de formas distintas", () => {
    expect(companyKey("ALPHABET INC-CL A")).toBe(companyKey("Alphabet Inc. Class C"));
    expect(companyKey("MICRON TECHNOLOGY INC USD0.1")).toBe(companyKey("Micron Technology, Inc."));
    expect(companyKey("Nebius Group N.V.")).toBe("nebius");
    expect(companyKey("AMAZON.COM INC USD0.01")).toBe("amazon");
    expect(companyKey("Apple Inc")).not.toBe(companyKey("Applied Materials"));
  });
  it("hace legibles los nombres en mayúsculas", () => {
    expect(holdingLabel("NVIDIA CORP USD0.001")).toBe("Nvidia Corp");
    expect(holdingLabel("ALPHABET INC-CL A USD0.001")).toBe("Alphabet Inc-Cl A");
    expect(holdingLabel("Taiwan Semiconductor")).toBe("Taiwan Semiconductor");
  });
});

describe("¿Qué comprar después? (§5.5)", () => {
  it("premia lo que tu cartera no tiene", () => {
    const health: NextBuyCandidate = { ...base, id: 2, ticker: "WORLD", sectors: [{ key: "Industria", weight: 0.6 }, { key: "Finanzas", weight: 0.4 }], countries: [{ key: "JP", weight: 1 }], holdings: [{ name: "TOYOTA MOTOR CORP", weight: 0.05 }] };
    const r = nextFundBuys([base, health], portfolio);
    expect(r.picks[0]!.candidate.ticker).toBe("WORLD");
    expect(r.picks[0]!.complement!.score).toBe(100);
  });

  it("detecta empresas que ya tienes dentro de otros fondos", () => {
    const c = complementOf(base, portfolio)!;
    const companies = c.parts.find((p) => p.id === "companies")!;
    expect(companies.text).toContain("Ya tienes 1 de sus 2 mayores posiciones (Nvidia Corp)");
    expect(companies.score).toBe(Math.round(100 * (1 - 0.1 / 0.18)));
  });

  it("reduce el aporte si empuja un sector que ya pasa del 35 %", () => {
    const c = complementOf(base, portfolio)!;
    expect(c.push).toContain("Subiría aún más tu peso en Tecnología, que ya es del 50 %");
  });

  it("no propone los caros, los que pesan más del 15 % ni los de riesgo alto", () => {
    const r = nextFundBuys(
      [
        { ...base, id: 3, ticker: "CARO", valuation: fundTrendValuation(series(1.4)) },
        { ...base, id: 4, ticker: "GORDO", heldEur: 2_000 },
        { ...base, id: 5, ticker: "RIESGO", technical: "Alto" },
        { ...base, id: 6, ticker: "NUEVO", valuation: fundTrendValuation([1, 2, 3]) },
      ],
      portfolio,
    );
    expect(r.picks).toHaveLength(0);
    const why = Object.fromEntries(r.ranking.map((x) => [x.candidate.ticker, x.excluded]));
    expect(why.CARO).toContain("cara");
    expect(why.GORDO).toContain("20 %");
    expect(why.RIESGO).toContain("Riesgo técnico");
    expect(why.NUEVO).toContain("al menos 3 años");
    expect(r.note).toContain("Ninguno");
  });

  it("un ETC cuenta como materias primas y sin país", () => {
    const gold: NextBuyCandidate = { ...base, id: 7, ticker: "ORO", kind: "etc", commodity: true, sectors: [], countries: [], holdings: [] };
    const c = complementOf(gold, portfolio)!;
    expect(c.parts.map((p) => p.id)).toEqual(["sectors"]);
    expect(c.score).toBe(100);
  });

  it("indica cuánto cabe hasta el 15 %", () => {
    const r = nextFundBuys([{ ...base, heldEur: 500 }], portfolio);
    expect(r.ranking[0]!.roomEur).toBeCloseTo((0.15 * 10_000 - 500) / 0.85, 6);
  });
});
