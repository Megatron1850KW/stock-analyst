// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listTransactions } from "@/db/portfolio-repo";
import { fakeEu } from "../../../tests/helpers/fake-eu";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { CSV_EXAMPLE, parseCsvDate, parseTransactionsCsv } from "./import-csv";
import { importTransactions } from "./import-transactions";

// Operaciones FICTICIAS: valores e ISIN inventados para las pruebas
const ETF_ISIN = "IE000FICTET1";
const etfFigi = [{ figi: "BBG000ETF0GY", name: "FICTICIO MSCI WORLD", ticker: "FWRL", exchCode: "GY", marketSector: "Equity" }];
const HEADER = "fecha;tipo;valor;clase;cantidad;precio;divisa;comisiones;cambio_eur;broker;notas";

describe("CSV de operaciones", () => {
  it("lee el ejemplo de la ayuda", () => {
    const r = parseTransactionsCsv(CSV_EXAMPLE, "2026-10-25");
    expect(r.error).toBeNull();
    expect(r.lines.every((l) => l.tx && !l.problem)).toBe(true);
    expect(r.lines[2]!.tx).toMatchObject({ input: "MSFT", kind: "stock", price: 420.5, currency: "USD", fees: 12, fxRateToBase: 0.918, broker: "ING" });
  });

  it("admite comas, fechas españolas, mayúsculas y columnas en otro orden", () => {
    const csv = ['Valor,Fecha,Tipo,Clase,Cantidad,Precio,Divisa', `${ETF_ISIN},15/03/2024,Compra,ETF,"1.000","5.62",eur`].join("\r\n");
    const [l] = parseTransactionsCsv(csv, "2026-10-25").lines;
    expect(l!.tx).toMatchObject({ input: ETF_ISIN, date: "2024-03-15", type: "buy", kind: "etf", quantity: 1000, price: 5.62, currency: "EUR", fees: 0, fxRateToBase: null });
  });

  it("explica cada línea con problemas y no la importa", () => {
    const csv = [
      HEADER,
      "2024-02-30;compra;FICT;accion;1;10;EUR;;;;",
      "2027-01-01;compra;FICT;accion;1;10;EUR;;;;",
      "2024-01-02;regalo;FICT;accion;1;10;EUR;;;;",
      "2024-01-02;compra;FICT;etf;1;10;EUR;;;;",
      "2024-01-02;compra;FICT;accion;0;10;EUR;;;;",
      "2024-01-02;compra;FICT;accion;1;10;JPY;;;;",
      ";;;;;;;;;;",
    ].join("\n");
    const r = parseTransactionsCsv(csv, "2026-10-25");
    expect(r.lines.map((l) => l.problem)).toEqual([
      expect.stringMatching(/fecha no es válida/),
      expect.stringMatching(/futura/),
      expect.stringMatching(/compra, venta o dividendo/),
      expect.stringMatching(/ISIN/),
      expect.stringMatching(/mayor que cero/),
      expect.stringMatching(/Divisa no reconocida/),
    ]);
    expect(r.lines.map((l) => l.line)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("pide la cabecera", () => {
    expect(parseTransactionsCsv("2024-01-02;compra;FICT").error).toMatch(/Faltan: fecha/);
    expect(parseTransactionsCsv(`${HEADER}\n`).error).toMatch(/no tiene operaciones/);
  });

  it("fechas", () => {
    expect(parseCsvDate("1/2/2024")).toBe("2024-02-01");
    expect(parseCsvDate("2024-13-01")).toBeNull();
  });
});

describe("importación en bloque", () => {
  it("guarda en orden de fecha, no duplica y rechaza ventas de más", async () => {
    const db = memoryDb();
    const deps = { db, eu: fakeEu({ figi: etfFigi }).client, sec: fakeSec() };
    const csv = [
      HEADER,
      "2024-06-01;venta;FICT;accion;5;12;USD;1;;ING;",
      "2024-01-02;compra;FICT;accion;10;10;USD;1;0,9;ING;",
      `2024-03-01;compra;${ETF_ISIN};etf;20;5;EUR;0;;ING;`,
      "2024-07-01;venta;FICT;accion;50;12;USD;1;;ING;",
      `2024-02-01;dividendo;${ETF_ISIN};etf;20;0,1;EUR;0;;ING;`,
    ].join("\n");
    const lines = parseTransactionsCsv(csv, "2026-10-25").lines.map((l) => ({ line: l.line, tx: l.tx! }));

    const first = await importTransactions(deps, lines);
    expect(first.map((o) => [o.line, o.status])).toEqual([
      [2, "added"],
      [3, "added"],
      [4, "added"],
      [5, "failed"],
      [6, "failed"],
    ]);
    expect(first[3]!.message).toMatch(/solo tenías 5/);
    expect(first[4]!.message).toMatch(/Dividendo sin acciones/);
    expect(first.filter((o) => o.newSecurity).length).toBe(2);
    expect((await listTransactions(db)).length).toBe(3);

    // Repetir la importación no duplica nada
    const again = await importTransactions(deps, lines);
    expect(again.filter((o) => o.status === "skipped").length).toBe(3);
    expect((await listTransactions(db)).length).toBe(3);
  });

  it("no mezcla un valor guardado con otra clase", async () => {
    const db = memoryDb();
    const deps = { db, eu: fakeEu({ figi: etfFigi }).client, sec: fakeSec() };
    await importTransactions(deps, [{ line: 2, tx: { input: ETF_ISIN, kind: "etf", type: "buy", date: "2024-01-02", quantity: 1, price: 5, currency: "EUR", fees: 0, fxRateToBase: null, broker: null, notes: null } }]);
    const [o] = await importTransactions(deps, [{ line: 3, tx: { input: ETF_ISIN, kind: "etc", type: "buy", date: "2024-01-03", quantity: 1, price: 5, currency: "EUR", fees: 0, fxRateToBase: null, broker: null, notes: null } }]);
    expect(o).toMatchObject({ status: "failed", message: expect.stringMatching(/como ETF/) });
  });
});
