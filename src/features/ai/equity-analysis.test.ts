// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClaudeClient } from "@/data/claude/client";
import { getLatestAnalysis, monthSpend } from "@/db/ai-repo";
import { importUsTicker } from "@/features/watchlist/import-us";
import { FAKE_ANALYSIS, fakeClaudeFetch, fakeReportHtml } from "../../../tests/helpers/fake-claude";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { costUsd, usdToEur } from "./cost";
import { AiAnalysisError, BudgetExceededError, parseStored, runEquityAnalysis, type RunDeps } from "./equity-analysis";
import { EQUITY_ANALYSIS_PROMPT, parsePrompt } from "./prompts";

async function setup(opts: Parameters<typeof fakeClaudeFetch>[0] = {}, deps: Partial<RunDeps> = {}) {
  const db = memoryDb();
  const { securityId } = await importUsTicker(fakeSec(), db, "FICT");
  const claude = fakeClaudeFetch(opts);
  const downloads: string[] = [];
  const run: RunDeps = {
    db,
    client: createClaudeClient(claude.fetch),
    fetchDocument: async (url) => {
      downloads.push(url);
      return fakeReportHtml(url.includes("26000020") || url.includes("26000025") ? "10-K" : "10-Q");
    },
    model: "claude-sonnet-5-5",
    budgetEur: 10,
    ...deps,
  };
  return { db, securityId, claude, downloads, run };
}

describe("análisis con IA (respuestas FICTICIAS)", () => {
  it("lee el prompt versionado", () => {
    expect(EQUITY_ANALYSIS_PROMPT.key).toBe("equity-analysis@1");
    expect(EQUITY_ANALYSIS_PROMPT.text).toContain("No inventes cifras");
    expect(() => parsePrompt("sin cabecera")).toThrow();
  });

  it("envía cifras y extractos, guarda el JSON validado y apunta el gasto", async () => {
    const { db, securityId, claude, downloads, run } = await setup();
    const r = await runEquityAnalysis(run, securityId);
    expect(r.status).toBe("created");

    // Un 10-K y un 10-Q descargados; una sola llamada a Claude
    expect(downloads).toHaveLength(2);
    expect(claude.requests).toHaveLength(1);
    const req = claude.requests[0]!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" } } });
    expect(req.body.system).toEqual([{ type: "text", text: EQUITY_ANALYSIS_PROMPT.text, cache_control: { type: "ephemeral" } }]);
    const content = (req.body.messages as { content: string }[])[0]!.content;
    expect(content).toContain("<resumen_numerico>");
    expect(content).toContain('"ticker": "FICT"');
    expect(content).toMatch(/<extracto documento="0009999999-26-000040" seccion="Comentario de la dirección \(MD&A\)" recortado="no">/);
    expect(content).toContain("One customer accounts");

    const stored = parseStored(r.row)!;
    expect(stored.analysis.veredicto.postura).toBe("Neutral");
    expect(stored.documents.map((d) => d.form).sort()).toEqual(["10-K", "10-Q"]);
    expect(r.row.prompt_version).toBe("equity-analysis@1");
    // Foto del día para comparar después sin volver a llamar a la IA
    expect(stored.snapshot).toHaveProperty("verdict");

    // 30.000 tokens de entrada × 2 $ + 4.000 de salida × 10 $ por millón = 0,10 $
    expect(r.row.cost_eur).toBeCloseTo(0.1, 6);
    expect(await monthSpend(db)).toEqual({ eur: r.row.cost_eur, calls: 1 });
  });

  it("no vuelve a llamar si nada ha cambiado; «Re-analizar» sí", async () => {
    const { securityId, claude, run } = await setup();
    await runEquityAnalysis(run, securityId);
    const again = await runEquityAnalysis(run, securityId);
    expect(again.status).toBe("cached");
    expect(claude.requests).toHaveLength(1);
    const forced = await runEquityAnalysis(run, securityId, { force: true });
    expect(forced.status).toBe("created");
    expect(claude.requests).toHaveLength(2);
    expect((await getLatestAnalysis(run.db, securityId))!.id).toBe(forced.row.id);
  });

  it("pide confirmación antes de pasarse del presupuesto", async () => {
    const { securityId, claude, run } = await setup({}, { budgetEur: 0.01 });
    const err = await runEquityAnalysis(run, securityId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).estimateEur).toBeGreaterThan(0.01);
    expect(claude.requests).toHaveLength(0);
    expect((await runEquityAnalysis(run, securityId, { allowOverBudget: true })).status).toBe("created");
  });

  it("descarta una respuesta que no valida, pero apunta lo gastado", async () => {
    const { db, securityId, run } = await setup({ analysis: { ...FAKE_ANALYSIS, riesgos: [] } });
    await expect(runEquityAnalysis(run, securityId)).rejects.toThrow(/incompleto/);
    expect(await getLatestAnalysis(db, securityId)).toBeNull();
    expect((await monthSpend(db)).calls).toBe(1);
  });

  it("explica una negativa, un corte y un error de clave en llano", async () => {
    let s = await setup({ stopReason: "refusal" });
    await expect(runEquityAnalysis(s.run, s.securityId)).rejects.toThrow(/declinado/);
    s = await setup({ stopReason: "max_tokens" });
    await expect(runEquityAnalysis(s.run, s.securityId)).rejects.toThrow(/se cortó/);
    s = await setup({ status: 401 });
    await expect(runEquityAnalysis(s.run, s.securityId)).rejects.toThrow("La clave de Claude no es válida. Revísala en Ajustes.");
  });

  it("sin texto de ningún informe no gasta", async () => {
    const { securityId, claude, run } = await setup({}, { fetchDocument: async () => { throw new Error("sin conexión"); } });
    await expect(runEquityAnalysis(run, securityId)).rejects.toThrow(AiAnalysisError);
    expect(claude.requests).toHaveLength(0);
  });

  it("Haiku no usa el respaldo del servidor (no lo admite)", async () => {
    const { securityId, claude, run } = await setup({ model: "claude-haiku-5-5" }, { model: "claude-haiku-5-5" });
    await runEquityAnalysis(run, securityId);
    expect(claude.requests[0]!.body.fallbacks).toBeUndefined();
    expect(claude.requests[0]!.headers["anthropic-beta"] ?? "").not.toContain("server-side-fallback");
  });
});

describe("coste", () => {
  it("cuenta la caché y convierte a euros con el tipo del BCE", () => {
    const usd = costUsd({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 }, "claude-sonnet-5-5");
    expect(usd).toBeCloseTo(2 + 1 + 0.2, 6);
    expect(usdToEur(1.16, 1.16)).toEqual({ eur: 1, approx: false });
    expect(usdToEur(1, null)).toEqual({ eur: 1, approx: true });
    // Un modelo desconocido se cobra al precio más alto
    expect(costUsd({ input_tokens: 1_000_000, output_tokens: 0 }, "otro")).toBe(5);
  });
});
