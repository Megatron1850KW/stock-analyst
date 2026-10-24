// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FigiRow } from "@/data/esef/schemas";
import { listWatchlist } from "@/db/repo";
import { FAKE_ISIN, fakeEu } from "../../../tests/helpers/fake-eu";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { addToWatchlist } from "./add";

const ETF_ISIN = "IE000FICTET1";
const ETF: FigiRow[] = [{ figi: "BBG0FICTE002", name: "FICTICIO MSCI WORLD UCITS ETF", ticker: "FWRL", exchCode: "GY", marketSector: "Equity", securityType: "ETP", securityType2: "Mutual Fund" }];

describe("alta de varios valores de golpe (datos FICTICIOS)", () => {
  it("añade lo que puede, explica lo que no y sigue con los demás", async () => {
    const db = memoryDb();
    const eu = fakeEu();
    const figi = eu.client.figi;
    eu.client.figi = async (isin) => (isin === ETF_ISIN ? ETF : figi(isin));
    const refreshed: number[] = [];
    const out = await addToWatchlist(
      { db, eu: eu.client, sec: null, refreshPrices: async (id) => (refreshed.push(id), []) },
      `${FAKE_ISIN} ; ETR: FTX ; ${ETF_ISIN} ; NYSE: FICT (Ficticia)`,
    );
    expect(out.map((o) => [o.input, o.ok])).toEqual([[FAKE_ISIN, true], ["ETR: FTX", false], [ETF_ISIN, true], ["NYSE: FICT (Ficticia)", false]]);
    expect(out[0]).toMatchObject({ type: "stock", market: "EU" });
    expect(out[1]).toMatchObject({ message: expect.stringContaining("ISIN") });
    expect(out[2]).toMatchObject({ type: "fund", result: { kind: "etf", requests: 1 } });
    expect(out[3]).toMatchObject({ message: expect.stringContaining("la SEC lo exige") });
    expect((await listWatchlist(db)).map((w) => w.ticker).sort()).toEqual(["FTX", "FWRL"]);
    expect(refreshed).toHaveLength(2);
  });

  it("un fallo de precios no anula el alta", async () => {
    const db = memoryDb();
    const out = await addToWatchlist({ db, eu: fakeEu().client, sec: null, refreshPrices: async () => Promise.reject(new Error("Sin clave de precios")) }, FAKE_ISIN);
    expect(out[0]).toMatchObject({ ok: true, priceErrors: ["Sin clave de precios"] });
  });
});
