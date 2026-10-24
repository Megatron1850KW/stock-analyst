// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getFacts, getFilings, getGaps, listWatchlist, removeFromWatchlist, saveQuote } from "@/db/repo";
import { refreshPrices } from "@/features/prices/refresh";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { importUsTicker, ImportError, looksLikeIsin } from "./import-us";

describe("alta de una acción de EE. UU. (datos ficticios)", () => {
  it("guarda el valor, sus 6 informes y las cifras con su origen", async () => {
    const db = memoryDb();
    const steps: string[] = [];
    const r = await importUsTicker(fakeSec(), db, "fict", (s) => steps.push(s));

    expect(steps).toEqual(["ticker", "filings", "facts", "save"]);
    expect(r).toMatchObject({ ticker: "FICT", name: "FICTICIA CORP", annual: 3, interim: 3 });

    const filings = await getFilings(db, r.securityId);
    expect(filings).toHaveLength(6);
    expect(filings[0]!.url).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/9999999\//);

    const facts = await getFacts(db, r.securityId);
    expect(facts.length).toBe(r.facts);
    expect(facts.every((f) => f.origin === "xbrl" && f.source_tag && f.fetched_at)).toBe(true);
    expect((await getGaps(db, r.securityId)).length).toBe(r.gaps);

    const [row] = await listWatchlist(db);
    expect(row).toMatchObject({ ticker: "FICT", annual_count: 3, interim_count: 3, price: null });
  });

  it("re-importar no duplica nada", async () => {
    const db = memoryDb();
    const a = await importUsTicker(fakeSec(), db, "FICT");
    const b = await importUsTicker(fakeSec(), db, "FICT");
    expect(b.securityId).toBe(a.securityId);
    expect(await getFilings(db, a.securityId)).toHaveLength(6);
    expect((await getFacts(db, a.securityId)).length).toBe(a.facts);
  });

  it("explica en llano si el ticker no existe", async () => {
    await expect(importUsTicker(fakeSec(), memoryDb(), "nope")).rejects.toThrow(ImportError);
    await expect(importUsTicker(fakeSec(), memoryDb(), "nope")).rejects.toThrow(/No encuentro «NOPE»/);
  });

  it("guarda la cotización y la muestra en la watchlist", async () => {
    const db = memoryDb();
    const r = await importUsTicker(fakeSec(), db, "FICT");
    const res = await refreshPrices(db, {
      id: "test",
      label: "Proveedor ficticio",
      quote: async (s) => ({ symbol: s, price: 10.5, open: 10, high: 11, low: 9.9, volume: 5, date: "2026-10-23" }),
    });
    expect(res).toEqual({ updated: 1, failed: [] });
    const [row] = await listWatchlist(db);
    expect(row).toMatchObject({ price: 10.5, price_date: "2026-10-23", price_source: "test" });
    // Una segunda consulta el mismo día sustituye, no duplica
    await saveQuote(db, { securityId: r.securityId, date: "2026-10-23", open: null, high: null, low: null, close: 11, volume: null, currency: "USD", source: "test" });
    expect((await listWatchlist(db))[0]!.price).toBe(11);
  });

  it("si falta la clave del proveedor, para y lo explica", async () => {
    const db = memoryDb();
    await importUsTicker(fakeSec(), db, "FICT");
    const res = await refreshPrices(db, {
      id: "test",
      label: "x",
      quote: async () => {
        throw "Falta la clave del proveedor de precios. Añádela en Ajustes.";
      },
    });
    expect(res.updated).toBe(0);
    expect(res.failed[0]!.message).toMatch(/Falta la clave/);
  });

  it("quitar de la watchlist borra sus datos si no está en cartera", async () => {
    const db = memoryDb();
    const r = await importUsTicker(fakeSec(), db, "FICT");
    await removeFromWatchlist(db, r.securityId);
    expect(await listWatchlist(db)).toHaveLength(0);
    expect(await getFacts(db, r.securityId)).toHaveLength(0);
  });

  it("reconoce un ISIN", () => {
    expect(looksLikeIsin("ES0148396007")).toBe(true);
    expect(looksLikeIsin("us0378331005")).toBe(true);
    expect(looksLikeIsin("AAPL")).toBe(false);
  });
});
