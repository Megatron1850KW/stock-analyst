// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getPriceBars, getPriceHistoryMeta, getSplits } from "@/db/repo";
import { importUsTicker } from "@/features/watchlist/import-us";
import { fakePrices } from "../../../tests/helpers/fake-prices";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { syncPriceHistory } from "./history";

const today = new Date("2026-10-24T08:00:00Z");

async function setup() {
  const db = memoryDb();
  const r = await importUsTicker(fakeSec(), db, "FICT");
  return { db, target: { id: r.securityId, ticker: "FICT", currency: "USD" } };
}

describe("histórico de precios (datos ficticios)", () => {
  it("pide 11 años, guarda velas mensuales y semanales y los splits", async () => {
    const { db, target } = await setup();
    const calls: string[] = [];
    const res = await syncPriceHistory(db, fakePrices({ calls, splits: [{ date: "2020-08-31", numerator: 4, denominator: 1 }] }), target, { today });
    expect(calls).toEqual(["history:FICT:2015-01-01"]);
    expect(res).toMatchObject({ status: "updated", firstDate: "2015-01-01", splitsChecked: true, note: null });
    const monthly = await getPriceBars(db, target.id, "1mo");
    expect(monthly[0]!.date).toBe("2015-01-01");
    expect(monthly.at(-1)!.date).toBe("2026-10-01");
    expect(monthly).toHaveLength(11 * 12 + 10);
    expect((await getPriceBars(db, target.id, "1w")).length).toBeGreaterThan(560);
    expect(await getSplits(db, target.id)).toEqual([{ date: "2020-08-31", numerator: 4, denominator: 1 }]);
  });

  it("no vuelve a pedirlo hasta que pasan 30 días", async () => {
    const { db, target } = await setup();
    const calls: string[] = [];
    await syncPriceHistory(db, fakePrices({ calls }), target, { today });
    expect(await syncPriceHistory(db, fakePrices({ calls }), target, { today: new Date("2026-11-10T00:00:00Z") })).toEqual({ status: "skipped" });
    expect((await syncPriceHistory(db, fakePrices({ calls }), target, { today: new Date("2026-12-01T00:00:00Z") })).status).toBe("updated");
    expect(calls.filter((c) => c.startsWith("history"))).toHaveLength(2);
  });

  it("si el proveedor no da splits, sigue y lo anota", async () => {
    const { db, target } = await setup();
    const res = await syncPriceHistory(db, fakePrices({ splits: "error" }), target, { today });
    expect(res).toMatchObject({ status: "updated", splitsChecked: false });
    expect((await getPriceHistoryMeta(db, target.id))!.note).toMatch(/Restricted Endpoint/);
  });
});
