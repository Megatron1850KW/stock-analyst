import { describe, expect, it } from "vitest";
import { FxTable } from "./fx";
import { buildPortfolio, type SecurityInfo, type Transaction } from "./positions";
import { xirr } from "./xirr";

// Cartera FICTICIA: cifras inventadas para comprobar los cálculos
const SEC: SecurityInfo[] = [
  { id: 1, ticker: "FICT", name: "Ficticia Corp", kind: "stock", currency: "USD", sector: "Tecnología", country: "US" },
  { id: 2, ticker: "FTX", name: "Ficticia Textil", kind: "stock", currency: "EUR", sector: "Consumo", country: "ES" },
  { id: 3, ticker: "FLON", name: "Ficticia Londres", kind: "etf", currency: "GBp", sector: null, country: "GB" },
];
const fx = new FxTable([
  { date: "2024-01-02", quote: "USD", rate: 1.1 },
  { date: "2026-10-23", quote: "USD", rate: 1.25 },
  { date: "2025-06-02", quote: "GBP", rate: 0.8 },
  { date: "2026-10-23", quote: "GBP", rate: 0.8 },
]);
let id = 0;
const tx = (t: Omit<Transaction, "id" | "fees" | "fxRateToBase"> & Partial<Transaction>): Transaction => ({ id: ++id, fees: 0, fxRateToBase: null, ...t });

describe("cartera en euros (datos FICTICIOS)", () => {
  it("precio medio, ventas al coste medio, dividendos y divisas", () => {
    const p = buildPortfolio({
      securities: SEC,
      transactions: [
        // 10 FICT a 110 $ + 11 $ de comisión con 1 € = 1,10 $ → 1.010 €
        tx({ securityId: 1, date: "2024-01-02", type: "buy", quantity: 10, price: 110, currency: "USD", fees: 11 }),
        // Vende 4 a 150 $ el 2026-10-23 (1 € = 1,25 $) → 480 €; coste medio de 4 = 404 € → +76 € realizados
        tx({ securityId: 1, date: "2026-10-23", type: "sell", quantity: 4, price: 150, currency: "USD" }),
        // Dividendo de 1 $ bruto por acción a 6 acciones, con 0,9 $ de retención, cambio fijado por el bróker
        tx({ securityId: 1, date: "2026-10-23", type: "dividend", quantity: 6, price: 1, currency: "USD", fees: 0.9, fxRateToBase: 0.8 }),
        tx({ securityId: 2, date: "2025-01-10", type: "buy", quantity: 100, price: 20, currency: "EUR", fees: 5 }),
        // 50 participaciones a 500 peniques (5 £) con 1 € = 0,8 £ → 312,50 €
        tx({ securityId: 3, date: "2025-06-02", type: "buy", quantity: 50, price: 500, currency: "GBp" }),
      ],
      quotes: new Map([
        [1, { price: 150, date: "2026-10-23", currency: "USD" }],
        [2, { price: 25, date: "2026-10-23", currency: "EUR" }],
        [3, { price: 600, date: "2026-10-23", currency: "GBp" }],
      ]),
      fx,
      today: "2026-10-24",
    });
    const fict = p.positions.find((x) => x.security.ticker === "FICT")!;
    expect(fict.shares).toBe(6);
    expect(fict.costEur).toBeCloseTo(606, 6);
    expect(fict.avgCostEur).toBeCloseTo(101, 6);
    expect(fict.avgCostLocal).toBeCloseTo(111.1, 6);
    expect(fict.realizedEur).toBeCloseTo(76, 6);
    expect(fict.dividendsEur).toBeCloseTo(4.08, 6);
    expect(fict.valueEur).toBeCloseTo(720, 6);
    expect(fict.unrealizedEur).toBeCloseTo(114, 6);
    expect(fict.totalReturnEur).toBeCloseTo(194.08, 6);
    expect(fict.totalReturnPct).toBeCloseTo(194.08 / 1010, 6);

    const flon = p.positions.find((x) => x.security.ticker === "FLON")!;
    expect(flon.costEur).toBeCloseTo(312.5, 6);
    expect(flon.valueEur).toBeCloseTo(375, 6);

    expect(p.valueEur).toBeCloseTo(720 + 2500 + 375, 6);
    expect(p.positions.map((x) => x.security.ticker)).toEqual(["FTX", "FICT", "FLON"]);
    expect(p.byCurrency.map((e) => e.key)).toEqual(["EUR", "USD", "GBP"]);
    expect(p.bySector.find((e) => e.key === "ETF sin ficha")?.valueEur).toBeCloseTo(375, 6);
    expect(p.positions.reduce((s, x) => s + x.weight!, 0)).toBeCloseTo(1, 9);
    expect(p.annualizedPct).not.toBeNull();
  });

  it("sin precio o sin tipo de cambio no inventa el valor y lo explica", () => {
    const p = buildPortfolio({
      securities: SEC,
      transactions: [
        tx({ securityId: 1, date: "2020-03-02", type: "buy", quantity: 1, price: 100, currency: "USD" }),
        tx({ securityId: 2, date: "2025-01-10", type: "buy", quantity: 1, price: 20, currency: "EUR" }),
      ],
      quotes: new Map(),
      fx,
      today: "2026-10-24",
    });
    expect(p.unvalued).toBe(2);
    expect(p.positions.find((x) => x.security.id === 1)!.problems).toEqual(["Falta el tipo de cambio USD/EUR del 2020-03-02.", "Sin precio todavía."]);
    expect(p.positions.find((x) => x.security.id === 2)!.valueEur).toBeNull();
  });

  it("avisa si vendes más de lo que tenías", () => {
    const p = buildPortfolio({
      securities: SEC,
      transactions: [
        tx({ securityId: 2, date: "2025-01-10", type: "buy", quantity: 5, price: 20, currency: "EUR" }),
        tx({ securityId: 2, date: "2025-02-10", type: "sell", quantity: 8, price: 22, currency: "EUR" }),
      ],
      quotes: new Map(),
      fx,
      today: "2026-10-24",
    });
    expect(p.closed[0]!.problems[0]).toMatch(/vendes 8 acciones, pero solo tenías 5/);
  });
});

describe("rentabilidad anualizada (XIRR)", () => {
  it("1.000 € que valen 1.100 € al año → 10 %", () => {
    expect(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 1100 }])).toBeCloseTo(0.1, 6);
  });
  it("sin sentido con menos de un mes o sin cobros", () => {
    expect(xirr([{ date: "2026-10-01", amount: -1000 }, { date: "2026-10-10", amount: 1100 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: -1000 }])).toBeNull();
  });
});

describe("tipos de cambio del BCE", () => {
  it("usa el último tipo publicado (fines de semana) pero no uno de hace más de una semana", () => {
    expect(fx.eurPer("USD", "2024-01-06")?.value).toBeCloseTo(1 / 1.1, 9);
    expect(fx.eurPer("USD", "2024-02-01")).toBeNull();
    expect(fx.eurPer("EUR", "2000-01-01")?.value).toBe(1);
    expect(fx.eurPer("GBp", "2026-10-24")?.value).toBeCloseTo(0.0125, 9);
  });

  it("mira dentro de un ETF con ficha para la exposición por sector y país", () => {
    const withProfile = SEC.map((s) =>
      s.id === 3
        ? { ...s, breakdown: { sectors: [{ key: "Tecnología", weight: 0.6 }, { key: "Salud", weight: 0.3 }], countries: [{ key: "US", weight: 1 }] } }
        : s,
    );
    const p = buildPortfolio({
      securities: withProfile,
      transactions: [
        tx({ securityId: 1, date: "2024-01-02", type: "buy", quantity: 1, price: 100, currency: "EUR" }),
        tx({ securityId: 3, date: "2025-06-02", type: "buy", quantity: 1, price: 100, currency: "EUR" }),
      ],
      quotes: new Map([
        [1, { price: 100, date: "2026-10-23", currency: "EUR" }],
        [3, { price: 100, date: "2026-10-23", currency: "EUR" }],
      ]),
      fx,
      today: "2026-10-24",
    });
    expect(p.bySector).toEqual([
      { key: "Tecnología", valueEur: 160, weight: 0.8 },
      { key: "Salud", valueEur: 30, weight: 0.15 },
      { key: "Otros", valueEur: expect.closeTo(10, 6), weight: expect.closeTo(0.05, 6) },
    ]);
    expect(p.byCountry).toEqual([{ key: "US", valueEur: 200, weight: 1 }]);
  });
});

describe("materias primas (datos FICTICIOS)", () => {
  it("un ETF de materias primas cuenta como «Materias primas», no como ETF sin ficha", () => {
    const p = buildPortfolio({
      securities: [{ id: 9, ticker: "FCOM", name: "Ficticio Commodity Swap", kind: "etf", currency: "EUR", sector: null, country: "IE", commodity: true }],
      transactions: [tx({ securityId: 9, date: "2025-01-02", type: "buy", quantity: 10, price: 10, currency: "EUR" })],
      quotes: new Map([[9, { price: 12, date: "2026-10-23", currency: "EUR" }]]),
      fx,
      today: "2026-10-24",
    });
    expect(p.bySector.map((e) => e.key)).toEqual(["Materias primas"]);
    expect(p.byCountry.map((e) => e.key)).toEqual(["IE"]);
  });
});
