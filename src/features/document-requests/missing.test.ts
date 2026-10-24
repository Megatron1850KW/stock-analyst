// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getDocumentRequests, resolveDocumentRequest, syncDocumentRequests } from "@/db/repo";
import { importUsTicker } from "@/features/watchlist/import-us";
import type { FilingRef } from "@/domain/fundamentals/select-filings";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { missingReportRequests, monthText } from "./missing";

// FICTICIO
const annual = (y: number, form = "20-F"): FilingRef => ({
  accession: `a-${y}`, form, periodType: "annual", reportDate: `${y}-12-31`, filingDate: `${y + 1}-04-20`, primaryDocument: "d.htm",
});
const base = { gapsByAccession: new Map<string, string[]>(), secUrl: (f: FilingRef) => `https://sec.example/${f.accession}`, today: new Date("2026-10-24") };

describe("informes que hay que pedir al usuario (datos ficticios)", () => {
  it("emisor extranjero sin 10-Q: pide los semestrales ya publicados", () => {
    const r = missingReportRequests({ ...base, filerType: "foreign", annual: [annual(2025), annual(2024)], interim: [] });
    expect(r.map((x) => [x.documentType, x.period, x.expectedDate])).toEqual([
      ["Informe semestral H1 2026 (6-K)", "2026-06-30", "2026-08"],
      ["Informe semestral H1 2025 (6-K)", "2025-06-30", "2025-08"],
      ["Informe semestral H1 2024 (6-K)", "2024-06-30", "2024-08"],
    ]);
    expect(monthText("2026-09")).toBe("septiembre 2026");
  });

  it("no pide un semestral que aún no ha podido publicarse", () => {
    const r = missingReportRequests({ ...base, filerType: "foreign", annual: [annual(2025)], interim: [], today: new Date("2026-08-15") });
    expect(r.map((x) => x.period)).toEqual(["2025-06-30", "2024-06-30"]);
  });

  it("pide el PDF si a un informe le faltan cifras clave", () => {
    const r = missingReportRequests({
      ...base,
      filerType: "domestic",
      annual: [annual(2025, "10-K")],
      interim: [],
      gapsByAccession: new Map([["a-2025", ["revenue", "commercial_paper"]]]),
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.documentType).toBe("10-K con cierre 2025-12-31");
    expect(r[0]!.whereToFind).toMatch(/no traen las ventas\. Está en https:\/\/sec\.example\/a-2025/);
  });

  it("al volver a comprobar, conserva las descartadas y retira las que sobran", async () => {
    const db = memoryDb();
    const { securityId } = await importUsTicker(fakeSec(), db, "FICT");
    const req = (period: string) => ({ documentType: `Semestral ${period}`, period, expectedDate: null, preferredFormat: "PDF", whereToFind: "x" });
    await syncDocumentRequests(db, securityId, [req("2026-06-30"), req("2025-06-30")]);
    const [first] = await getDocumentRequests(db, securityId);
    await resolveDocumentRequest(db, first!.id, "dismissed");
    await syncDocumentRequests(db, securityId, [req("2026-06-30")]);
    const after = await getDocumentRequests(db, securityId);
    expect(after.map((r) => [r.period, r.status])).toEqual([["2026-06-30", "dismissed"]]);
  });
});

describe("informes subidos (datos ficticios)", () => {
  it("registra el archivo, cierra la solicitud y no duplica", async () => {
    const { registerUpload } = await import("./upload");
    const { getFilings, deleteUpload } = await import("@/db/repo");
    const db = memoryDb();
    const { securityId } = await importUsTicker(fakeSec(), db, "FICT");
    await syncDocumentRequests(db, securityId, [{ documentType: "Semestral", period: "2026-06-30", expectedDate: null, preferredFormat: "PDF", whereToFind: "x" }]);
    const [req] = await getDocumentRequests(db, securityId);
    const stored = { path: "/tmp/ficticio.pdf", sha256: "a".repeat(64), bytes: 1234, kind: "pdf" as const };
    const form = { securityId, kind: "half" as const, periodEnd: "2026-06-30", requestId: req!.id };
    const id = await registerUpload(db, form, { name: "Informe H1 2026.pdf" }, stored);
    expect(await registerUpload(db, form, { name: "Informe H1 2026.pdf" }, stored)).toBe(id);
    const up = (await getFilings(db, securityId)).filter((f) => f.role === "upload");
    expect(up).toEqual([expect.objectContaining({ form_type: "Semestral (PDF)", period_end: "2026-06-30", original_name: "Informe H1 2026.pdf", bytes: 1234, source: "user-upload" })]);
    expect((await getDocumentRequests(db, securityId))[0]).toMatchObject({ status: "fulfilled", filing_id: id });
    // Borrarlo devuelve la solicitud a pendiente
    expect(await deleteUpload(db, id)).toBe("/tmp/ficticio.pdf");
    expect((await getDocumentRequests(db, securityId))[0]).toMatchObject({ status: "pending", filing_id: null });
    await expect(registerUpload(db, { ...form, periodEnd: "" }, { name: "x.pdf" }, stored)).rejects.toThrow(/fecha de cierre/);
  });
});
