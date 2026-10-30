import { describe, expect, it } from "vitest";
import { monthlyWithoutGaps, parseYahooChart, yahooBars, yahooQuote, yahooSplits, yahooSymbol } from "./yahoo";

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

describe("serie mensual de Yahoo con huecos", () => {
  // Velas FICTICIAS
  const bar = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: null });

  it("si viene un punto cada tres meses, rehace los meses con las semanales", () => {
    const monthly = [bar("2016-01-01", 1), bar("2016-04-01", 2), bar("2016-07-01", 3), bar("2016-10-01", 4)];
    const weekly = [bar("2016-06-27", 10), bar("2016-07-04", 11), bar("2016-07-25", 12), bar("2016-08-01", 13), bar("2016-09-26", 14), bar("2016-10-03", 15)];
    expect(monthlyWithoutGaps(monthly, weekly).map((b) => [b.date, b.close])).toEqual([
      ["2016-01-01", 1],
      ["2016-04-01", 2],
      ["2016-06-01", 10],
      ["2016-07-01", 12],
      ["2016-08-01", 13],
      ["2016-09-01", 14],
      ["2016-10-01", 15],
    ]);
  });

  it("sin huecos, la mensual se queda como está", () => {
    const monthly = [bar("2016-01-01", 1), bar("2016-02-01", 2)];
    expect(monthlyWithoutGaps(monthly, [bar("2016-02-01", 9)])).toBe(monthly);
  });
});
