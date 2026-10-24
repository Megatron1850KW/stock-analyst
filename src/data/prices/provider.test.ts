// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseFmpHistory, parseFmpQuote, parseFmpSplits, parseTiingoHistory, parseTiingoQuote } from "./provider";

describe("cotización de FMP (respuestas ficticias)", () => {
  it("lee precio, rango del día y fecha en hora de Nueva York", () => {
    const raw = JSON.stringify([
      { symbol: "FICT", price: 123.45, open: 120, dayHigh: 124, dayLow: 119.5, volume: 1000, timestamp: 1761249600, name: "Ficticia" },
    ]);
    // 1761249600 = 2025-10-23 20:00 UTC = 16:00 en Nueva York
    expect(parseFmpQuote(raw)).toEqual({ symbol: "FICT", price: 123.45, open: 120, high: 124, low: 119.5, volume: 1000, date: "2025-10-23" });
  });

  it("muestra el mensaje de FMP si rechaza la clave", () => {
    expect(() => parseFmpQuote(JSON.stringify({ "Error Message": "Invalid API KEY." }))).toThrow(/FMP rechazó la consulta: Invalid API KEY/);
  });

  it("rechaza respuestas vacías o mal formadas", () => {
    expect(() => parseFmpQuote("[]")).toThrow(/cotización válida/);
    expect(() => parseFmpQuote("<html>")).toThrow(/no es JSON/);
  });
});

describe("histórico y splits de FMP (respuestas ficticias)", () => {
  it("ordena las velas de la más antigua a la más reciente", () => {
    const raw = JSON.stringify([
      { symbol: "FICT", date: "2026-01-05", open: 11, high: 12, low: 10, close: 11.5, volume: 10, vwap: 11 },
      { symbol: "FICT", date: "2026-01-02", open: 10, high: 11, low: 9, close: 10.5, volume: 20 },
    ]);
    expect(parseFmpHistory(raw).map((b) => b.date)).toEqual(["2026-01-02", "2026-01-05"]);
  });

  it("lee los splits y rechaza respuestas raras", () => {
    const raw = JSON.stringify([{ symbol: "FICT", date: "2024-06-10", numerator: 10, denominator: 1 }]);
    expect(parseFmpSplits(raw)).toEqual([{ date: "2024-06-10", numerator: 10, denominator: 1 }]);
    expect(() => parseFmpSplits(JSON.stringify([{ date: "x" }]))).toThrow(/splits válido/);
    expect(() => parseFmpHistory(JSON.stringify({ "Error Message": "Premium" }))).toThrow(/Premium/);
  });
});

describe("Tiingo (respuestas ficticias)", () => {
  const row = (date: string, close: number, splitFactor = 1) => ({ date: `${date}T00:00:00.000Z`, open: close, high: close, low: close, close, volume: 100, adjClose: close, splitFactor });

  it("ajusta por splits los días anteriores y los lista", () => {
    // Split 20×1 el 2022-07-18: antes cotizaba a 2.000, después a 100
    const raw = JSON.stringify([row("2022-07-15", 2000), row("2022-07-18", 105, 20), row("2022-07-19", 110)]);
    const h = parseTiingoHistory(raw);
    expect(h.bars.map((b) => [b.date, b.close, b.volume])).toEqual([
      ["2022-07-15", 100, 2000],
      ["2022-07-18", 105, 100],
      ["2022-07-19", 110, 100],
    ]);
    expect(h.splits).toEqual([{ date: "2022-07-18", numerator: 20, denominator: 1 }]);
  });

  it("toma el último día como cotización y explica los errores", () => {
    expect(parseTiingoQuote(JSON.stringify([row("2026-10-22", 10), row("2026-10-23", 11)]), "FICT")).toMatchObject({ price: 11, date: "2026-10-23" });
    expect(() => parseTiingoQuote(JSON.stringify({ detail: "Invalid token." }), "FICT")).toThrow(/Tiingo rechazó la consulta: Invalid token/);
    expect(() => parseTiingoQuote("[]", "FICT")).toThrow(/no tiene cotización/);
  });
});
