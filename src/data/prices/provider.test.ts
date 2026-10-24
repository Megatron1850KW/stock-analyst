// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseFmpHistory, parseFmpQuote, parseFmpSplits } from "./provider";

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
