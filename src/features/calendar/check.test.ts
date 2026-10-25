// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SecClient } from "@/data/sec-edgar/client";
import { getAppState, listCalendar, listNewReports } from "@/db/calendar-repo";
import { getFilings } from "@/db/repo";
import { importUsTicker } from "@/features/watchlist/import-us";
import { fakeEu } from "../../../tests/helpers/fake-eu";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { checkIsDue, checkNewReports, isDue, LAST_CHECK_KEY, processNewReport, refreshCalendar } from "./check";

// DATOS FICTICIOS: «Ficticia Corp» (FICT) de tests/fixtures/ficticio.

/** La SEC ficticia con un 10-Q nuevo (Q3 2026) publicado. */
function secWithNewQ3(): SecClient & { calls: string[] } {
  const base = fakeSec();
  return {
    ...base,
    submissions: async (cik) => {
      const s = await base.submissions(cik);
      const r = s.filings.recent as unknown as Record<string, unknown[]>;
      const add: Record<string, unknown> = { accessionNumber: "0009999999-26-000050", filingDate: "2026-11-03", reportDate: "2026-09-30", form: "10-Q", primaryDocument: "fict-20260930.htm" };
      for (const k of Object.keys(r)) r[k] = [k in add ? add[k] : "", ...r[k]!];
      return s;
    },
  };
}

describe("calendario y comprobación de informes nuevos (datos ficticios)", () => {
  it("estima la fecha del siguiente informe con su historial", async () => {
    const db = memoryDb();
    await importUsTicker(fakeSec(), db, "FICT");
    await refreshCalendar(db, new Date("2026-10-24"));
    const [row] = await listCalendar(db);
    expect(row).toMatchObject({ ticker: "FICT", source: "inferred", expected_date: "2026-11-01" });
    expect(JSON.parse(row!.fiscal_period!).label).toBe("10-Q de Q3 2026");
  });

  it("solo consulta la SEC cerca de la fecha estimada", async () => {
    const db = memoryDb();
    await importUsTicker(fakeSec(), db, "FICT");
    const sec = secWithNewQ3();
    const early = await checkNewReports({ db, sec, eu: fakeEu().client }, { today: new Date("2026-09-15") });
    expect(early.checked).toEqual([]);
    expect(sec.calls).toEqual([]);
    expect(isDue("2026-11-01", new Date("2026-10-29"))).toBe(true);
  });

  it("detecta el 10-Q nuevo una sola vez y lo guarda para avisar", async () => {
    const db = memoryDb();
    await importUsTicker(fakeSec(), db, "FICT");
    const deps = { db, sec: secWithNewQ3(), eu: fakeEu().client };
    const r = await checkNewReports(deps, { today: new Date("2026-11-04") });
    expect(r.checked).toEqual(["FICT"]);
    expect(r.found).toHaveLength(1);
    expect(r.found[0]).toMatchObject({ formType: "10-Q", label: "10-Q de Q3 2026", periodEnd: "2026-09-30" });
    expect(r.found[0]!.url).toMatch(/fict-20260930\.htm$/);
    expect((await checkNewReports(deps, { today: new Date("2026-11-04") })).found).toHaveLength(0);
    expect((await listNewReports(db, true)).map((x) => x.label)).toEqual(["10-Q de Q3 2026"]);
    expect(await getAppState(db, LAST_CHECK_KEY)).toBe("2026-11-04T00:00:00.000Z");
  });

  it("sin email de la SEC no consulta EE. UU. y lo dice", async () => {
    const db = memoryDb();
    await importUsTicker(fakeSec(), db, "FICT");
    const r = await checkNewReports({ db, sec: null, eu: fakeEu().client }, { force: true });
    expect(r.checked).toEqual([]);
    expect(r.problems[0]).toMatch(/falta tu nombre y email/);
  });

  it("«Analizar ahora» vuelve a leer sus informes y lanza la IA", async () => {
    const db = memoryDb();
    const { securityId } = await importUsTicker(fakeSec(), db, "FICT");
    const sec = secWithNewQ3();
    await checkNewReports({ db, sec, eu: fakeEu().client }, { today: new Date("2026-11-04") });
    const [report] = await listNewReports(db, true);
    const analyzed: number[] = [];
    const out = await processNewReport({ db, sec, eu: fakeEu().client, analyze: async (id) => analyzed.push(id) }, report!.id, new Date("2026-11-04"));
    expect(out.aiError).toBeNull();
    expect(analyzed).toEqual([securityId]);
    expect((await getFilings(db, securityId)).some((f) => f.accession_no === "0009999999-26-000050")).toBe(true);
    expect(await listNewReports(db, true)).toHaveLength(0);
    // El calendario ya apunta al anual
    expect(JSON.parse((await listCalendar(db))[0]!.fiscal_period!).label).toBe("10-K del ejercicio 2026");
  });

  it("si la IA no puede, los datos quedan actualizados y se dice por qué", async () => {
    const db = memoryDb();
    await importUsTicker(fakeSec(), db, "FICT");
    const sec = secWithNewQ3();
    await checkNewReports({ db, sec, eu: fakeEu().client }, { today: new Date("2026-11-04") });
    const [report] = await listNewReports(db, true);
    const out = await processNewReport({ db, sec, eu: fakeEu().client, analyze: async () => { throw new Error("Falta la clave de Claude."); } }, report!.id, new Date("2026-11-04"));
    expect(out.aiError).toBe("Falta la clave de Claude.");
    expect(await listNewReports(db, true)).toHaveLength(0);
  });

  it("la comprobación automática respeta la frecuencia de Ajustes", async () => {
    const db = memoryDb();
    const now = new Date("2026-11-04T12:00:00Z");
    expect(await checkIsDue(db, "daily", now)).toBe(true);
    await checkNewReports({ db, sec: null, eu: fakeEu().client }, { today: new Date("2026-11-04T08:00:00Z") });
    expect(await checkIsDue(db, "daily", now)).toBe(false);
    expect(await checkIsDue(db, "daily", new Date("2026-11-05T09:00:00Z"))).toBe(true);
    expect(await checkIsDue(db, "manual", new Date("2027-01-01"))).toBe(false);
  });
});
