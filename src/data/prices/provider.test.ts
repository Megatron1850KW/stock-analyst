// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseFmpHistory, parseFmpQuote, parseFmpSplits, parseTiingoHistory, parseTiingoLive, parseTiingoQuote, tiingoQuote } from "./provider";

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

  // FICTICIO: precios inventados para probar la elección entre cierre y sesión
  const daily = JSON.stringify([row("2026-11-13", 778.31)]);
  const iex = (timestamp: string, tngoLast: number) => JSON.stringify([{ ticker: "FICT", timestamp, tngoLast, last: tngoLast, open: 750, high: 760, low: 720, prevClose: 778.31 }]);

  it("lee el precio en sesión de IEX con la fecha de Nueva York", () => {
    // 16-11 a las 00:30 en Madrid sigue siendo el 15-11 en Nueva York
    expect(parseTiingoLive(iex("2026-11-15T18:30:00-05:00", 700), "FICT")).toMatchObject({ price: 700, date: "2026-11-15", volume: null, source: "tiingo-iex" });
    expect(parseTiingoLive(iex("2026-11-16T16:54:52+00:00", 732.88), "FICT")).toMatchObject({ date: "2026-11-16" });
    expect(parseTiingoLive("[]", "FICT")).toBeNull();
    expect(parseTiingoLive(JSON.stringify({ detail: "Not permitted" }), "FICT")).toBeNull();
  });

  it("usa el precio de hoy si la sesión ya empezó y guarda también el cierre anterior", async () => {
    const q = await tiingoQuote("FICT", async (c) => (c === "price_quote" ? daily : iex("2026-11-16T11:54:52-05:00", 732.88)));
    expect(q).toMatchObject({ price: 732.88, date: "2026-11-16", source: "tiingo-iex" });
    expect(q.previousClose).toMatchObject({ price: 778.31, date: "2026-11-13" });
  });

  it("se queda con el cierre si IEX no trae nada nuevo o falla", async () => {
    const same = await tiingoQuote("FICT", async (c) => (c === "price_quote" ? daily : iex("2026-11-13T16:00:00-05:00", 778.0)));
    expect(same).toMatchObject({ price: 778.31, date: "2026-11-13" });
    expect(same.previousClose).toBeUndefined();
    const failed = await tiingoQuote("FICT", async (c) => {
      if (c === "price_quote") return daily;
      throw new Error("Comando no simulado");
    });
    expect(failed).toMatchObject({ price: 778.31, date: "2026-11-13" });
  });
});
