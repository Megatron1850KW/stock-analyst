// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseFmpQuote } from "./provider";

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
