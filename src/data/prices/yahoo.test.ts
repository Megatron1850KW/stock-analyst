import { describe, expect, it } from "vitest";
import { parseYahooChart, yahooBars, yahooQuote, yahooSplits, yahooSymbol } from "./yahoo";

// Respuesta FICTICIA con la forma de /v8/finance/chart de Yahoo Finance
const day = (iso: string) => Date.parse(`${iso}T07:00:00Z`) / 1000;
const RAW = JSON.stringify({
  chart: {
    result: [
      {
        meta: { symbol: "FICT.MC", currency: "EUR", regularMarketPrice: 41.5, regularMarketTime: day("2026-10-24") + 9 * 3600, exchangeTimezoneName: "Europe/Madrid" },
        timestamp: [day("2026-09-01"), day("2026-10-01"), day("2026-10-24")],
        events: { splits: { [day("2026-09-15")]: { date: day("2026-09-15"), numerator: 2, denominator: 1 } } },
        indicators: { quote: [{ open: [38, 39, 41], high: [40, 42, 42], low: [37, null, 40], close: [39, null, 41.2], volume: [1000, 2000, 3000] }] },
      },
    ],
    error: null,
  },
});

describe("Yahoo Finance (datos FICTICIOS)", () => {
  it("símbolo con el sufijo de la bolsa", () => {
    expect(yahooSymbol({ ticker: "itx", name: "x", exchange: "SM", currency: "EUR" })).toBe("ITX.MC");
    expect(yahooSymbol({ ticker: "SXRS", name: "x", exchange: "GR", currency: "EUR" })).toBe("SXRS.DE");
    expect(yahooSymbol({ ticker: "UCG", name: "x", exchange: "IM", currency: "EUR" })).toBe("UCG.MI");
    expect(yahooSymbol({ ticker: "X", name: "x", exchange: "ZZ", currency: "EUR" })).toBeNull();
  });

  it("velas, splits y cotización; descarta las velas sin cierre", () => {
    const c = parseYahooChart(RAW, "FICT.MC");
    expect(yahooBars(c).map((b) => [b.date, b.close])).toEqual([["2026-09-01", 39], ["2026-10-24", 41.2]]);
    expect(yahooSplits(c)).toEqual([{ date: "2026-09-15", numerator: 2, denominator: 1 }]);
    expect(yahooQuote(c)).toMatchObject({ price: 41.5, date: "2026-10-24", open: 41, volume: 3000 });
  });

  it("explica en llano un símbolo que no existe", () => {
    const raw = JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } });
    expect(() => parseYahooChart(raw, "NADA.MC")).toThrow(/no tiene NADA\.MC/);
    expect(() => parseYahooChart("<html>", "X")).toThrow(/no es JSON/);
  });
});
