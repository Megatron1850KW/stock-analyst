// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FigiRow } from "@/data/esef/schemas";
import { getDocumentRequests, listWatchlist } from "@/db/repo";
import { FUND_SHEET_REQUEST, saveFundProfileEdit } from "@/features/portfolio/fund-profile";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { fundKindOf, importFundToWatchlist } from "./import-fund";

// Respuestas de OpenFIGI FICTICIAS, con los campos que da para fondos y acciones
const ETF: FigiRow[] = [
  { figi: "BBG0FICTE001", name: "FICTICIO MSCI WORLD UCITS ETF", ticker: "FWLD", exchCode: "LN", marketSector: "Equity", securityType: "ETP", securityType2: "Mutual Fund" },
  { figi: "BBG0FICTE002", name: "FICTICIO MSCI WORLD UCITS ETF", ticker: "FWRL", exchCode: "GY", marketSector: "Equity", securityType: "ETP", securityType2: "Mutual Fund" },
];
const ETC: FigiRow[] = [{ figi: "BBG0FICTC001", name: "FICTICIO PHYSICAL GOLD ETC", ticker: "FGLD", exchCode: "GY", marketSector: "Equity", securityType: "ETP", securityType2: "Mutual Fund" }];
const STOCK: FigiRow[] = [{ figi: "BBG0FICTS001", name: "FICTICIA TEXTIL", ticker: "FTX", exchCode: "SM", marketSector: "Equity", securityType: "Common Stock", securityType2: "Common Stock" }];

describe("ETF o ETC en la watchlist (datos FICTICIOS)", () => {
  it("distingue fondos de acciones con lo que dice OpenFIGI", () => {
    expect(fundKindOf(ETF)).toBe("etf");
    expect(fundKindOf(ETC)).toBe("etc");
    expect(fundKindOf(STOCK)).toBeNull();
  });

  it("lo guarda en la watchlist (bolsa en euros) y pide su ficha con el enlace a justETF", async () => {
    const db = memoryDb();
    const r = await importFundToWatchlist(db, "IE000FICTET1", ETF, "etf");
    expect(r).toMatchObject({ ticker: "FWRL", exchange: "GY", kind: "etf", requests: 1 });
    expect((await listWatchlist(db)).map((w) => [w.ticker, w.kind, w.currency])).toEqual([["FWRL", "etf", "EUR"]]);
    const [req] = await getDocumentRequests(db, r.securityId);
    expect(req).toMatchObject({ document_type: FUND_SHEET_REQUEST, status: "pending", preferred_format: "PDF" });
    expect(req!.where_to_find).toContain("https://www.justetf.com/es/etf-profile.html?isin=IE000FICTET1");
  });

  it("con la ficha ya escrita la solicitud se cierra y no se vuelve a pedir", async () => {
    const db = memoryDb();
    const r = await importFundToWatchlist(db, "IE000FICTET1", ETF, "etf");
    await saveFundProfileEdit(db, r.securityId, {
      ter: 0.002, index: "Índice FICTICIO", replication: "física completa", domicile: "IE", aumMillions: null, aumCurrency: null, fundCurrency: null,
      distribution: null, collateral: null, holdings: [], sectors: [], countries: [], asOf: null, pages: {}, notes: [],
    });
    expect((await getDocumentRequests(db, r.securityId)).map((q) => q.status)).toEqual(["fulfilled"]);
    const again = await importFundToWatchlist(db, "IE000FICTET1", ETF, "etf");
    expect(again).toMatchObject({ securityId: r.securityId, requests: 0 });
    expect((await listWatchlist(db))[0]).toMatchObject({ has_profile: 1, pending_requests: 0 });
  });
});
