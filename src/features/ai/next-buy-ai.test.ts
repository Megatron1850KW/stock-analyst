// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClaudeClient } from "@/data/claude/client";
import { monthSpend } from "@/db/ai-repo";
import { nextBuy, type NextBuyCandidate } from "@/domain/portfolio/next-buy";
import { fakeClaudeFetch, fakeNextBuyOpinion } from "../../../tests/helpers/fake-claude";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { AiAnalysisError } from "./equity-analysis";
import { cachedNextBuyAi, runNextBuyAi, type NextBuyAiInput } from "./next-buy-ai";
import { NEXT_BUY_PROMPT } from "./prompts";

// DATOS FICTICIOS para tests: valores y respuestas inventadas.

const stock = (id: number, ticker: string, over: Partial<NextBuyCandidate> = {}): NextBuyCandidate => ({
  id, ticker, name: `${ticker} Ficticia`, kind: "stock", valueEur: 5_000, priceEur: 100, fractional: false,
  sector: { name: "Tecnología", valueEur: 5_000 }, action: "Comprar más", alerts: [], technical: "Medio",
  valuation: { source: "history", score: 50, deviation: 0, verdict: "Justa" },
  cash: { fcfYield: 0.04, operatingMargin: 0.15, netMargin: 0.1 },
  growth: { multiYear: 0.05, recent: 0.05, recentPeriod: "último trimestre" }, quality: 60, ...over,
});

function input(): NextBuyAiInput {
  const result = nextBuy([stock(1, "FICA", { valuation: { source: "history", score: 80, deviation: -0.2, verdict: "Barata" } }), stock(2, "FICB")], 100_000, { mode: "eur", value: 1_000 });
  return { result, amount: { mode: "eur", value: 1_000 }, totalEur: 100_000, funds: new Map() };
}

describe("Qué compro hoy: segunda opinión de Claude (respuestas FICTICIAS)", () => {
  it("lee el prompt versionado", () => {
    expect(NEXT_BUY_PROMPT.key).toBe("next-buy@1");
    expect(NEXT_BUY_PROMPT.text).toContain("No inventes datos");
  });

  it("manda la comparativa de la app, valida la respuesta, apunta el gasto y no vuelve a pagar", async () => {
    const db = memoryDb();
    const claude = fakeClaudeFetch({ analysis: fakeNextBuyOpinion(["FICA", "FICB"]), usage: { input_tokens: 3_000, output_tokens: 800 } });
    const deps = { db, client: createClaudeClient(claude.fetch), model: "claude-sonnet-5-5" as const, budgetEur: 10 };
    expect(await cachedNextBuyAi(db, input())).toBeNull();

    const r = await runNextBuyAi(deps, input());
    expect(r.result.eleccion).toBe("FICA");
    expect(claude.requests).toHaveLength(1);
    const body = claude.requests[0]!.body as { messages: { content: string }[]; output_config: unknown };
    expect(body.messages[0]!.content).toContain('"elegida_por_la_app": "FICA"');
    expect(body.messages[0]!.content).toContain("<posiciones>");
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect((await monthSpend(db)).eur).toBeGreaterThan(0);

    // Mismos datos: se reutiliza lo guardado, sin otra llamada
    expect((await cachedNextBuyAi(db, input()))?.result.eleccion).toBe("FICA");
    await runNextBuyAi(deps, input());
    expect(claude.requests).toHaveLength(1);
  });

  it("descarta una respuesta que elige algo que no estaba", async () => {
    const db = memoryDb();
    const claude = fakeClaudeFetch({ analysis: fakeNextBuyOpinion(["OTRA", "FICA", "FICB"]) });
    const deps = { db, client: createClaudeClient(claude.fetch), model: "claude-sonnet-5-5" as const, budgetEur: 10 };
    await expect(runNextBuyAi(deps, input())).rejects.toThrow(AiAnalysisError);
    expect(await cachedNextBuyAi(db, input())).toBeNull();
    // El gasto se apunta aunque la respuesta no sirva
    expect((await monthSpend(db)).eur).toBeGreaterThan(0);
  });

  it("con una sola posición no llama", async () => {
    const db = memoryDb();
    const claude = fakeClaudeFetch();
    const one = nextBuy([stock(1, "FICA")], 100_000, { mode: "eur", value: 1_000 });
    await expect(runNextBuyAi({ db, client: createClaudeClient(claude.fetch), model: "claude-sonnet-5-5", budgetEur: 10 }, { ...input(), result: one })).rejects.toThrow(/al menos dos/);
    expect(claude.requests).toHaveLength(0);
  });
});
