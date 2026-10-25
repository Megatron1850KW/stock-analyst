// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createClaudeClient } from "@/data/claude/client";
import { monthSpend } from "@/db/ai-repo";
import { getFacts, getFilings } from "@/db/repo";
import { importEuIsin } from "@/features/watchlist/import-eu";
import { fakeClaudeFetch } from "../../../tests/helpers/fake-claude";
import { FAKE_ISIN, fakeEu } from "../../../tests/helpers/fake-eu";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { countPdfPages, extractPdfFacts, toFacts, type PdfExtraction } from "./extract-pdf";
import { registerUpload } from "./upload";

// Respuesta FICTICIA de la IA para un semestral inventado (cifras en millones)
const OUT: PdfExtraction = {
  moneda: "EUR",
  tipo: "semestral",
  periodo: { inicio: "2026-02-01", fin: "2026-07-31" },
  cifras: [
    { concepto: "revenue", valor: 780, escala: "millones", inicio: "2026-02-01", fin: "2026-07-31", pagina: 3, etiqueta: "Importe neto de la cifra de negocios" },
    { concepto: "revenue", valor: 700, escala: "millones", inicio: "2025-02-01", fin: "2025-07-31", pagina: 3, etiqueta: "Importe neto de la cifra de negocios" },
    { concepto: "net_income", valor: 95_500, escala: "miles", inicio: "2026-02-01", fin: "2026-07-31", pagina: 3, etiqueta: "Resultado atribuido a la dominante" },
    { concepto: "eps_diluted", valor: 0.31, escala: "millones", inicio: "2026-02-01", fin: "2026-07-31", pagina: 3, etiqueta: "Beneficio por acción diluido (euros)" },
    { concepto: "cash", valor: 450, escala: "millones", inicio: null, fin: "2026-07-31", pagina: 4, etiqueta: "Efectivo y equivalentes" },
    // Incoherentes: página que no existe, balance con inicio, fecha mal escrita
    { concepto: "capex", valor: 30, escala: "millones", inicio: "2026-02-01", fin: "2026-07-31", pagina: 99, etiqueta: "Inversiones" },
    { concepto: "equity", valor: 900, escala: "millones", inicio: "2026-02-01", fin: "2026-07-31", pagina: 4, etiqueta: "Patrimonio" },
    { concepto: "operating_cash_flow", valor: 120, escala: "millones", inicio: "2026-02-01", fin: "31/07/2026", pagina: 5, etiqueta: "Flujo de explotación" },
  ],
  notas: "Las cifras del semestre no están auditadas (dato ficticio).",
};

const PDF = new TextEncoder().encode("%PDF-1.4 ficticio\n" + "<< /Type /Page >>\n".repeat(6) + "<< /Type /Pages >>");

async function setup(output: unknown = OUT, periodEnd = "2026-07-31") {
  const db = memoryDb();
  const { securityId } = await importEuIsin(fakeEu().client, db, FAKE_ISIN, undefined, new Date("2026-10-24T10:00:00Z"));
  const filingId = await registerUpload(
    db,
    { securityId, kind: "half", periodEnd },
    { name: "H1-2026.pdf" },
    { path: "/datos/documents/1/abc-H1-2026.pdf", sha256: "a".repeat(64), bytes: PDF.length, kind: "pdf" },
  );
  const claude = fakeClaudeFetch({ analysis: output, model: "claude-haiku-5-5", usage: { input_tokens: 20_000, output_tokens: 2_000 } });
  const read: string[] = [];
  const deps = {
    db,
    client: createClaudeClient(claude.fetch),
    readPdf: async (p: string) => (read.push(p), PDF),
    model: "claude-haiku-5-5",
    budgetEur: 10,
  };
  return { db, securityId, filingId, claude, deps, read };
}

describe("extracción de cifras de un PDF subido (datos FICTICIOS)", () => {
  it("cuenta las páginas del PDF para estimar el coste", async () => {
    expect(await countPdfPages(PDF)).toBe(6);
  });

  it("cuenta también las páginas guardadas en flujos de objetos comprimidos", async () => {
    // PDF 1.5 FICTICIO: 2 páginas sueltas y 33 dentro de un /ObjStm comprimido
    const objs = Array.from({ length: 33 }, () => "<< /Type /Page /Parent 2 0 R >>").join("\n") + "\n<< /Type /Pages /Count 35 >>";
    const z = deflateSync(Buffer.from(objs, "latin1"));
    const head = Buffer.from("%PDF-1.5\n1 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj\n<< /Type /ObjStm /N 34 /First 0 /Filter /FlateDecode /Length " + z.length + " >>\nstream\n", "latin1");
    const tail = Buffer.from("\nendstream\nendobj\n%%EOF", "latin1");
    expect(await countPdfPages(new Uint8Array(Buffer.concat([head, z, tail])))).toBe(35);
  });

  it("aplica la escala en el código y descarta lo incoherente", () => {
    const r = toFacts(OUT, "ACC", 6);
    const v = (c: string, end = "2026-07-31") => r.facts.find((f) => f.concept === c && f.periodEnd === end);
    expect(v("revenue")?.value).toBe(780_000_000);
    expect(v("revenue", "2025-07-31")?.value).toBe(700_000_000);
    expect(v("net_income")?.value).toBe(95_500_000);
    expect(v("eps_diluted")).toMatchObject({ value: 0.31, unit: "EUR/shares" });
    expect(v("cash")).toMatchObject({ value: 450_000_000, periodStart: null, page: 4 });
    expect(r.discarded).toBe(3);
  });

  it("una sola llamada a Haiku con el PDF; las cifras quedan marcadas con su página", async () => {
    const { db, securityId, filingId, claude, deps, read } = await setup();
    const r = await extractPdfFacts(deps, securityId, filingId);
    expect(r).toMatchObject({ status: "created", facts: 5, discarded: 3 });
    expect(r.notes[0]).toMatch(/no están auditadas/);
    expect(read).toEqual(["/datos/documents/1/abc-H1-2026.pdf"]);

    const body = claude.requests[0]!.body as { model: string; messages: { content: { type: string; source?: { media_type: string } }[] }[] };
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages[0]!.content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });

    const facts = (await getFacts(db, securityId)).filter((f) => f.filing_id === filingId);
    expect(facts.find((f) => f.concept === "revenue" && f.period_end === "2026-07-31")).toMatchObject({ origin: "pdf-extraction", page: 3, value: 780_000_000 });
    expect((await monthSpend(db)).eur).toBeGreaterThan(0);

    // Ya leído: no se vuelve a llamar a la IA
    expect((await extractPdfFacts(deps, securityId, filingId)).status).toBe("cached");
    expect(claude.requests).toHaveLength(1);
  });

  it("si el PDF es de otro periodo, corrige el cierre del informe", async () => {
    const { db, securityId, filingId, deps } = await setup(OUT, "2026-06-30");
    const r = await extractPdfFacts(deps, securityId, filingId);
    expect(r.notes.join(" ")).toMatch(/2026-07-31/);
    expect((await getFilings(db, securityId)).find((f) => f.id === filingId)?.period_end).toBe("2026-07-31");
  });

  it("si la IA devuelve otra cosa no guarda nada", async () => {
    const { db, securityId, filingId, deps } = await setup({ hola: "mundo" });
    await expect(extractPdfFacts(deps, securityId, filingId)).rejects.toThrow(/formato inesperado/);
    expect((await getFacts(db, securityId)).filter((f) => f.filing_id === filingId)).toHaveLength(0);
  });
});
