// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getFacts } from "@/db/repo";
import { importEuIsin } from "@/features/watchlist/import-eu";
import { FAKE_ISIN, fakeEu } from "../../../tests/helpers/fake-eu";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import type { PdfExtraction } from "./extract-pdf";
import { buildManualPdfPrompt, saveManualPdf } from "./manual-pdf";
import { registerUpload } from "./upload";

// Respuesta FICTICIA pegada desde claude.ai para un semestral inventado
const ANSWER: PdfExtraction = {
  moneda: "EUR",
  tipo: "semestral",
  periodo: { inicio: "2026-02-01", fin: "2026-07-31" },
  cifras: [
    { concepto: "revenue", valor: 780, escala: "millones", inicio: "2026-02-01", fin: "2026-07-31", pagina: 3, etiqueta: "Ventas" },
    { concepto: "cash", valor: 450, escala: "millones", inicio: null, fin: "2026-07-31", pagina: 4, etiqueta: "Efectivo" },
    { concepto: "capex", valor: 30, escala: "millones", inicio: "2026-02-01", fin: "2026-07-31", pagina: 99, etiqueta: "Inversiones" },
  ],
  notas: "Dato ficticio.",
};

const PDF = new TextEncoder().encode("%PDF-1.4 ficticio\n" + "<< /Type /Page >>\n".repeat(6));

async function setup() {
  const db = memoryDb();
  const { securityId } = await importEuIsin(fakeEu().client, db, FAKE_ISIN, undefined, new Date("2026-10-24T10:00:00Z"));
  const filingId = await registerUpload(
    db,
    { securityId, kind: "half", periodEnd: "2026-07-31" },
    { name: "H1-2026.pdf" },
    { path: "/datos/documents/1/abc-H1-2026.pdf", sha256: "b".repeat(64), bytes: PDF.length, kind: "pdf" },
  );
  return { db, securityId, filingId, deps: { db, readPdf: async () => PDF } };
}

describe("lectura de un PDF con claude.ai a mano (datos FICTICIOS)", () => {
  it("prepara el texto con instrucciones, formato JSON y el periodo esperado", async () => {
    const { db, securityId, filingId } = await setup();
    const text = await buildManualPdfPrompt(db, securityId, filingId);
    expect(text).toMatch(/Te adjunto un informe en PDF/);
    expect(text).toContain('"cifras"');
    expect(text).toContain("2026-07-31");
  });

  it("guarda las cifras válidas con su página y descarta las incoherentes, sin coste", async () => {
    const { db, securityId, filingId, deps } = await setup();
    const r = await saveManualPdf(deps, securityId, filingId, "Aquí tienes:\n```json\n" + JSON.stringify(ANSWER) + "\n```");
    expect(r).toMatchObject({ facts: 2, discarded: 1 });
    const facts = (await getFacts(db, securityId)).filter((f) => f.filing_id === filingId);
    expect(facts.map((f) => f.concept).sort()).toEqual(["cash", "revenue"]);
    expect(facts.every((f) => f.origin === "pdf-extraction")).toBe(true);
  });

  it("explica en llano si la respuesta no sirve", async () => {
    const { securityId, filingId, deps } = await setup();
    await expect(saveManualPdf(deps, securityId, filingId, "No puedo leer el archivo")).rejects.toThrow(/JSON/);
    await expect(saveManualPdf(deps, securityId, filingId, JSON.stringify({ ...ANSWER, cifras: [] }))).rejects.toThrow(/ninguna cifra/);
  });
});
