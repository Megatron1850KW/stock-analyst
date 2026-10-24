// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ProviderLimitError } from "@/data/prices/alphavantage";
import type { PriceProvider } from "@/data/prices/provider";
import { getLatestQuote, getPriceBars } from "@/db/repo";
import { importEuIsin } from "@/features/watchlist/import-eu";
import { importUsTicker } from "@/features/watchlist/import-us";
import { fakeEu, FAKE_ISIN, FAKE_PEER_ISIN } from "../../../tests/helpers/fake-eu";
import { fakePrices } from "../../../tests/helpers/fake-prices";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { refreshPrices } from "./refresh";

const today = new Date("2026-10-24T08:00:00Z");

/** Proveedor europeo FICTICIO: símbolo con sufijo de bolsa y velas ya agregadas, como Alpha Vantage. */
function fakeEuPrices(calls: string[], opts: { limitAfter?: number; known?: string[] } = {}): PriceProvider {
  const base = fakePrices({ calls, price: 40 });
  let n = 0;
  const count = () => {
    if (opts.limitAfter !== undefined && ++n > opts.limitAfter) throw new ProviderLimitError("Se han agotado las 25 consultas gratuitas de hoy (ficticio).");
  };
  return {
    ...base,
    id: "eu-test",
    label: "Proveedor europeo ficticio",
    quote: async (s) => (count(), base.quote(s)),
    history: async (s, from) => {
      count();
      const h = await base.history(s, from);
      return { ...h, weekly: h.bars, monthly: h.bars };
    },
    resolveSymbol: async (t) => {
      count();
      calls.push(`search:${t.ticker}:${t.exchange}`);
      return (opts.known ?? ["FTX", "FMD"]).includes(t.ticker) ? `${t.ticker}.${t.exchange === "FP" ? "PA" : "MC"}` : null;
    },
  };
}

async function setup() {
  const db = memoryDb();
  const eu = fakeEu();
  const us = await importUsTicker(fakeSec(), db, "FICT");
  const ftx = await importEuIsin(eu.client, db, FAKE_ISIN, undefined, today);
  const fmd = await importEuIsin(eu.client, db, FAKE_PEER_ISIN, undefined, today);
  return { db, ids: { us: us.securityId, ftx: ftx.securityId, fmd: fmd.securityId } };
}

describe("precios por mercado (datos FICTICIOS)", () => {
  it("cada valor va a su proveedor y el símbolo europeo se busca una sola vez", async () => {
    const { db, ids } = await setup();
    const usCalls: string[] = [];
    const euCalls: string[] = [];
    const r = await refreshPrices(db, { US: fakePrices({ calls: usCalls }), EU: fakeEuPrices(euCalls) }, undefined, today);
    expect(r).toMatchObject({ updated: 3, failed: [] });
    expect(usCalls.filter((c) => c.startsWith("quote:"))).toEqual(["quote:FICT"]);
    expect(euCalls.filter((c) => c.startsWith("quote:")).sort()).toEqual(["quote:FMD.PA", "quote:FTX.MC"]);
    expect((await getLatestQuote(db, ids.ftx))?.close).toBe(40);
    expect((await getPriceBars(db, ids.ftx, "1mo")).length).toBeGreaterThan(100);

    euCalls.length = 0;
    await refreshPrices(db, { US: null, EU: fakeEuPrices(euCalls) }, undefined, today);
    expect(euCalls.filter((c) => c.startsWith("search:"))).toEqual([]);
  });

  it("si el proveedor no cubre un valor lo dice, y no lo vuelve a buscar hasta pasada una semana", async () => {
    const { db } = await setup();
    const calls: string[] = [];
    const r = await refreshPrices(db, { US: null, EU: fakeEuPrices(calls, { known: ["FMD"] }) }, undefined, today);
    expect(r.failed).toEqual([{ ticker: "FTX", message: "Proveedor europeo ficticio no tiene la cotización de FTX (Ficticia Textil, S.A.)." }]);
    calls.length = 0;
    await refreshPrices(db, { US: null, EU: fakeEuPrices(calls, { known: ["FMD"] }) }, undefined, new Date("2026-10-28T08:00:00Z"));
    expect(calls.filter((c) => c.startsWith("search:"))).toEqual([]);
    await refreshPrices(db, { US: null, EU: fakeEuPrices(calls, { known: ["FMD"] }) }, undefined, new Date("2026-11-10T08:00:00Z"));
    expect(calls.filter((c) => c.startsWith("search:"))).toEqual(["search:FTX:SM"]);
  });

  it("al agotar las consultas del día deja de pedir precios europeos, pero sigue con los de EE. UU.", async () => {
    const { db } = await setup();
    const usCalls: string[] = [];
    const euCalls: string[] = [];
    const r = await refreshPrices(db, { US: fakePrices({ calls: usCalls }), EU: fakeEuPrices(euCalls, { limitAfter: 1 }) }, undefined, today);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.message).toMatch(/agotado/);
    expect(usCalls.filter((c) => c.startsWith("quote:"))).toEqual(["quote:FICT"]);
  });

  it("sin proveedor europeo, las europeas de tu watchlist avisan de que falta elegirlo", async () => {
    const { db } = await setup();
    const r = await refreshPrices(db, { US: fakePrices(), EU: null }, undefined, today);
    expect(r.failed.map((f) => f.message)).toEqual(Array(2).fill("Elige un proveedor de precios europeos en Ajustes."));
  });
});
