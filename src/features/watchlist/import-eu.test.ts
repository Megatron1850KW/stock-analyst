// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getDocumentRequests, getFacts, getFilings, getSecurity, listWatchlist } from "@/db/repo";
import { FAKE_ISIN, fakeEu } from "../../../tests/helpers/fake-eu";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { importEuIsin, pickListing, titleCase } from "./import-eu";

const TODAY = new Date("2026-10-24T10:00:00Z");

describe("alta de una acción europea por ISIN (datos FICTICIOS)", () => {
  it("ISIN → LEI → informes ESEF → cifras NIIF guardadas con su origen", async () => {
    const db = memoryDb();
    const eu = fakeEu();
    const r = await importEuIsin(eu.client, db, " es0000000001 ", undefined, TODAY);
    expect(r).toMatchObject({ ticker: "FTX", name: "Ficticia Textil, S.A.", annual: 3, interim: 0, historyYears: 2 });

    const s = (await getSecurity(db, r.securityId))!;
    expect(s).toMatchObject({ isin: FAKE_ISIN, market: "EU", exchange: "SM", currency: "EUR", reporting_currency: "EUR", country: "ES", fiscal_year_end: "0131" });

    const filings = await getFilings(db, r.securityId);
    expect(filings.filter((f) => f.role === "core").map((f) => f.period_end)).toEqual(["2026-01-31", "2025-01-31", "2024-01-31"]);
    expect(filings.every((f) => f.source === "filings.xbrl.org" && f.form_type === "ESEF")).toBe(true);

    const facts = await getFacts(db, r.securityId);
    const rev = facts.filter((f) => f.concept === "revenue" && f.period_end === "2026-01-31");
    expect(rev.map((f) => f.value)).toEqual([1_464_000_000]); // 1.000 M × 1,1⁴, sin el desglose por segmento
    expect(rev[0]).toMatchObject({ origin: "esef", source_tag: "ifrs-full:Revenue", unit: "EUR" });
    expect((await listWatchlist(db)).map((w) => w.ticker)).toEqual(["FTX"]);
  });

  it("pide en la bandeja los 3 últimos semestrales con el regulador del país", async () => {
    const db = memoryDb();
    const r = await importEuIsin(fakeEu().client, db, FAKE_ISIN, undefined, TODAY);
    const reqs = await getDocumentRequests(db, r.securityId);
    expect(reqs.map((q) => [q.document_type, q.period])).toEqual([
      ["Informe semestral H1 2026", "2026-07-31"],
      ["Informe semestral H1 2025", "2025-07-31"],
      ["Informe semestral H1 2024", "2024-07-31"],
    ]);
    expect(reqs[0]!.where_to_find).toContain("CNMV");
    expect(r.requests).toBe(3);
  });

  it("volver a importar no duplica nada ni vuelve a pedir lo mismo", async () => {
    const db = memoryDb();
    const eu = fakeEu();
    const a = await importEuIsin(eu.client, db, FAKE_ISIN, undefined, TODAY);
    const factsA = (await getFacts(db, a.securityId)).length;
    const b = await importEuIsin(eu.client, db, FAKE_ISIN, undefined, TODAY);
    expect(b.securityId).toBe(a.securityId);
    expect((await getFacts(db, a.securityId)).length).toBe(factsA);
    expect((await getDocumentRequests(db, a.securityId)).length).toBe(3);
  });

  it("sin informes ESEF pide también los anuales; un ISIN desconocido da un error claro", async () => {
    const db = memoryDb();
    const r = await importEuIsin(fakeEu({ years: [] }).client, db, FAKE_ISIN, undefined, TODAY);
    const types = (await getDocumentRequests(db, r.securityId)).map((q) => q.document_type);
    expect(types.filter((t) => t.startsWith("Informe financiero anual"))).toHaveLength(3);
    await expect(importEuIsin(fakeEu().client, db, "FR0000000002", undefined, TODAY)).rejects.toThrow(/No encuentro el ISIN/);
  });

  it("elige la bolsa de su país y pone bien los nombres oficiales", () => {
    const rows = [
      { figi: "1", ticker: "FTX", exchCode: "GY" },
      { figi: "2", ticker: "FTX", exchCode: "SM" },
    ];
    expect(pickListing(rows, "ES")?.exchCode).toBe("SM");
    expect(pickListing(rows, "DE")?.exchCode).toBe("GY");
    expect(pickListing([{ figi: "3", ticker: "X", exchCode: "US" }], "ES")).toBeNull();
    expect(titleCase("INDUSTRIA DE DISEÑO TEXTIL, S.A.")).toBe("Industria De Diseño Textil, S.A.");
    expect(titleCase("ASML Holding N.V.")).toBe("ASML Holding N.V.");
  });
});
