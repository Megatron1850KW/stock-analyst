// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getLatestAnalysis, monthSpend } from "@/db/ai-repo";
import { importUsTicker } from "@/features/watchlist/import-us";
import { FAKE_ANALYSIS, fakeReportHtml } from "../../../tests/helpers/fake-claude";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { parseStored, prepareAnalysis, type PreparedAnalysis } from "./equity-analysis";
import { buildManualPrompt, MANUAL_LIMITS, MANUAL_MODEL, parseManualAnswer, saveManualAnalysis } from "./manual";
import { EQUITY_ANALYSIS_PROMPT } from "./prompts";

async function prepared() {
  const db = memoryDb();
  const { securityId } = await importUsTicker(fakeSec(), db, "FICT");
  const ready = await prepareAnalysis(
    { db, fetchDocument: async (url) => fakeReportHtml(url.includes("26000020") || url.includes("26000025") ? "10-K" : "10-Q") },
    securityId,
    { force: true, limits: MANUAL_LIMITS },
  );
  if ("cached" in ready) throw new Error("no debería haber caché");
  return { db, securityId, p: ready.prepared as PreparedAnalysis };
}

describe("modo Claude.ai manual (respuestas FICTICIAS)", () => {
  it("prepara un texto con instrucciones, esquema, cifras y extractos", async () => {
    const { p } = await prepared();
    const text = buildManualPrompt(p);
    expect(text).toContain("(FICT)");
    expect(text).toContain(EQUITY_ANALYSIS_PROMPT.text);
    expect(text).toContain('"modelo_negocio"');
    expect(text).toContain("<resumen_numerico>");
    expect(text).toMatch(/<extracto documento="0009999999-26-000040"/);
    expect(p.documents.map((d) => d.form).sort()).toEqual(["10-K", "10-Q"]);
  });

  it("acepta la respuesta con o sin bloque de código y texto alrededor", () => {
    const json = JSON.stringify(FAKE_ANALYSIS);
    expect(parseManualAnswer(json)).toEqual(FAKE_ANALYSIS);
    expect(parseManualAnswer("Aquí tienes:\n```json\n" + json + "\n```\nEspero que te sirva.")).toEqual(FAKE_ANALYSIS);
  });

  it("explica en llano una respuesta vacía, cortada, con otro formato o incompleta", () => {
    expect(() => parseManualAnswer("  ")).toThrow(/Pega la respuesta/);
    expect(() => parseManualAnswer("Lo siento, no puedo")).toThrow(/No encuentro el JSON/);
    expect(() => parseManualAnswer('{"modelo_negocio": "corta')).toThrow(/No encuentro el JSON/);
    expect(() => parseManualAnswer('{"modelo_negocio": "x", }')).toThrow(/mal formada/);
    expect(() => parseManualAnswer(JSON.stringify({ ...FAKE_ANALYSIS, veredicto: { postura: "Comprar", resumen: "x" } }))).toThrow(/veredicto\.postura/);
    expect(() => parseManualAnswer(JSON.stringify({ ...FAKE_ANALYSIS, riesgos: [] }))).toThrow(/incompleto/);
  });

  it("guarda el análisis sin coste y con sus fuentes", async () => {
    const { db, securityId, p } = await prepared();
    const row = await saveManualAnalysis(db, p, JSON.stringify(FAKE_ANALYSIS));
    expect(row.model).toBe(MANUAL_MODEL);
    expect(row.cost_eur).toBe(0);
    const stored = parseStored(row)!;
    expect(stored.servedModel).toBe(MANUAL_MODEL);
    expect(stored.documents).toHaveLength(2);
    expect(stored.snapshot).toHaveProperty("verdict");
    expect((await getLatestAnalysis(db, securityId))!.id).toBe(row.id);
    expect(await monthSpend(db)).toEqual({ eur: 0, calls: 0 });
  });
});
