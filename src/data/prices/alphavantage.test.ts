// @vitest-environment node
import { describe, expect, it } from "vitest";
import { avSearchJson, avSeriesJson } from "../../../tests/helpers/fake-alphavantage";
import { alphaVantageProvider, detectSplits, parseAvQuote, parseAvSearch, parseAvSeries, pickAvSymbol, ProviderLimitError, splitAdjusted } from "./alphavantage";

describe("Alpha Vantage (respuestas FICTICIAS con su formato)", () => {
  it("lee la cotización y traduce sus errores", () => {
    const raw = JSON.stringify({
      "Global Quote": {
        "01. symbol": "FTX.MC", "02. open": "40.10", "03. high": "41.00", "04. low": "39.90", "05. price": "40.50",
        "06. volume": "123456", "07. latest trading day": "2026-10-23", "08. previous close": "40.00", "09. change": "0.50", "10. change percent": "1.25%",
      },
    });
    expect(parseAvQuote(raw, "FTX.MC")).toEqual({ symbol: "FTX.MC", price: 40.5, open: 40.1, high: 41, low: 39.9, volume: 123456, date: "2026-10-23" });
    expect(() => parseAvQuote(JSON.stringify({ "Global Quote": {} }), "NO.MC")).toThrow("no tiene cotización de NO.MC");
    const limit = JSON.stringify({ Information: "We have detected your API key as ... standard API rate limit is 25 requests per day." });
    expect(() => parseAvQuote(limit, "FTX.MC")).toThrow(ProviderLimitError);
    expect(() => parseAvQuote(JSON.stringify({ "Error Message": "Invalid API call." }), "X")).toThrow("no reconoce el símbolo X");
  });

  it("deduce un split 2×1 del salto entre cierre real y ajustado, y ajusta solo por splits", () => {
    // Split 2×1 el 15-03-2024: cae en la vela mensual de marzo. Dividendos pequeños en medio.
    const rows = parseAvSeries(avSeriesJson("monthly", { split: { date: "2024-03-15", ratio: 2 } }), "FTX.MC", "monthly");
    const splits = detectSplits(rows);
    expect(splits).toEqual([{ date: "2024-03-31", numerator: 2, denominator: 1 }]);
    const bars = splitAdjusted(rows, splits);
    const before = bars.find((b) => b.date === "2024-02-29")!;
    const after = bars.find((b) => b.date === "2024-04-30")!;
    // Sin salto artificial: antes del split se divide por 2
    expect(before.close / after.close).toBeGreaterThan(0.9);
    expect(before.close / after.close).toBeLessThan(1.1);
    // En la vela del split no se inventan apertura, máximo ni mínimo
    expect(bars.find((b) => b.date === "2024-03-31")).toMatchObject({ open: null, high: null, low: null });
  });

  it("no confunde los dividendos con splits", () => {
    expect(detectSplits(parseAvSeries(avSeriesJson("weekly"), "FTX.MC", "weekly"))).toEqual([]);
  });

  it("elige el símbolo de la bolsa correcta y no el de otra empresa", () => {
    const matches = parseAvSearch(avSearchJson());
    const target = { ticker: "FTX", name: "Ficticia Textil, S.A.", exchange: "SM", currency: "EUR" };
    expect(pickAvSymbol(matches, target)).toBe("FTX.MC");
    expect(pickAvSymbol(matches, { ...target, exchange: "GY" })).toBe("FTX.DEX");
    // Mismo ticker en Londres pero otra empresa y otra divisa: no vale
    expect(pickAvSymbol(matches.filter((m) => m.region === "United Kingdom"), target)).toBeNull();
    // Un ETF también se encuentra; un fondo de inversión no cotizado, no
    expect(pickAvSymbol(matches, { ticker: "FWRL", name: "FICTICIO MSCI WORLD", exchange: "GY", currency: "EUR" })).toBe("FWRL.DEX");
    expect(pickAvSymbol(matches, { ticker: "FIDX", name: "Ficticio Index Fund", exchange: null, currency: "USD" })).toBeNull();
  });

  it("sabe sin consultar que no cubre la Bolsa de Madrid", () => {
    expect(alphaVantageProvider.unsupported?.({ ticker: "ITX", name: "Inditex", exchange: "SM", currency: "EUR" })).toMatch(/Madrid/);
    expect(alphaVantageProvider.unsupported?.({ ticker: "MC", name: "LVMH", exchange: "FP", currency: "EUR" })).toBeNull();
  });
});
