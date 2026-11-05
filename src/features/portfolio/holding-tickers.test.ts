// @vitest-environment node
import { describe, expect, it } from "vitest";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { resolveHoldingTickers } from "./holding-tickers";

// Lista de la SEC reducida (formato real de company_tickers_exchange.json)
const SEC = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"],
    [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
    [2488, "ADVANCED MICRO DEVICES INC", "AMD", "Nasdaq"],
  ],
};

describe("tickers de las posiciones de los fondos", () => {
  it("usa tus acciones, luego la SEC, y guarda el resultado para no volver a pedirlo", async () => {
    const db = memoryDb();
    await db.execute("INSERT INTO securities (ticker, name, kind, currency) VALUES ('MU', 'MICRON TECHNOLOGY INC', 'stock', 'USD'), ('GOOG', 'Alphabet Inc.', 'stock', 'USD')");
    let calls = 0;
    const fetch = async () => (calls++, SEC);
    const names = ["MICRON TECHNOLOGY INC USD0.1", "ADVANCED MICRO DEVICES USD0.01", "ALPHABET INC-CL A USD0.001", "ALPHABET INC-CL C USD0.001", "EMPRESA FICTICIA SA"];
    const first = await resolveHoldingTickers(db, names, fetch);
    expect(Object.fromEntries(first)).toEqual({
      "MICRON TECHNOLOGY INC USD0.1": "MU",
      "ADVANCED MICRO DEVICES USD0.01": "AMD",
      "ALPHABET INC-CL A USD0.001": "GOOGL",
      "ALPHABET INC-CL C USD0.001": "GOOG",
    });
    expect(calls).toBe(1);
    await resolveHoldingTickers(db, names, fetch);
    expect(calls).toBe(1);
  });

  it("sin red se queda con el nombre y lo reintenta otra vez", async () => {
    const db = memoryDb();
    let calls = 0;
    const down = async () => {
      calls++;
      throw new Error("sin red");
    };
    expect((await resolveHoldingTickers(db, ["ADVANCED MICRO DEVICES"], down)).size).toBe(0);
    await resolveHoldingTickers(db, ["ADVANCED MICRO DEVICES"], down);
    expect(calls).toBe(2);
  });
});
