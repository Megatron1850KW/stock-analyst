import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getLatestAnalysis, recordAiUsage } from "@/db/ai-repo";
import { getAppState, setAppState } from "@/db/calendar-repo";
import type { Db } from "@/db/client";
import type { Amount, NextBuyResult } from "@/domain/portfolio/next-buy";
import type { FundProfileRow } from "@/features/portfolio/fund-profile";
import { checkBudget } from "./budget";
import { costUsd, estimateCostUsd, usdToEur } from "./cost";
import { AiAnalysisError, describeApiError, parseStored, type AnalysisModel } from "./equity-analysis";
import { NEXT_BUY_PROMPT, type Prompt } from "./prompts";

/**
 * Segunda opinión de Claude en «Qué compro hoy» (opcional: solo al pulsar el
 * botón). Recibe la comparativa ya calculada por la app y lo que ya hay
 * guardado de cada posición (último análisis IA, ficha del ETF); no se le
 * mandan informes. La respuesta se valida y se guarda con una clave que
 * resume todo lo enviado: con los mismos datos no se vuelve a pagar.
 */

export const nextBuyAiSchema = z.object({
  eleccion: z.string(),
  coincide_con_app: z.boolean(),
  resumen: z.string(),
  posiciones: z.array(
    z.object({
      ticker: z.string(),
      a_favor: z.array(z.string()),
      en_contra: z.array(z.string()),
      crecimiento_esperado: z.string(),
    }),
  ),
  reparto: z.string(),
  avisos: z.array(z.string()),
});
export type NextBuyAi = z.infer<typeof nextBuyAiSchema>;

export interface StoredNextBuyAi {
  key: string;
  result: NextBuyAi;
  model: string;
  costEur: number;
  costApprox: boolean;
  createdAt: string;
}

/** Comprobaciones que el esquema no puede expresar. Si hay alguna, la respuesta se descarta. */
export function nextBuyAiProblems(a: NextBuyAi, eligible: string[], all: string[]): string[] {
  const issues: string[] = [];
  if (!eligible.includes(a.eleccion)) issues.push(`Eligió «${a.eleccion}», que no es una de las posiciones que se pueden comprar.`);
  for (const t of all) if (!a.posiciones.some((p) => p.ticker === t)) issues.push(`Falta la opinión sobre ${t}.`);
  if (a.resumen.trim().length < 40) issues.push("El resumen está vacío.");
  return issues;
}

export interface NextBuyAiInput {
  result: NextBuyResult;
  amount: Amount;
  totalEur: number;
  /** Fichas de los ETF/ETC elegidos. */
  funds: Map<number, FundProfileRow>;
}

const round = (x: number | null, d = 4) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Mensaje para Claude: cifras de la app + lo ya guardado de cada posición. */
export async function buildNextBuyMessage(db: Db, input: NextBuyAiInput): Promise<string> {
  const { result, amount, totalEur, funds } = input;
  const comparativa = {
    elegida_por_la_app: result.winner?.candidate.ticker ?? null,
    reparto_propuesto: result.plan.map((a) => ({ ticker: a.ticker, acciones: round(a.shares), euros: round(a.eur, 2), peso_despues: round(a.weightAfter) })),
    sin_invertir_eur: result.leftover ? round(result.leftover.eur, 2) : 0,
    pasa_del_maximo: result.overCap,
    por_que_segun_la_app: result.why,
    posiciones: result.ranked.map((r) => ({
      ticker: r.candidate.ticker,
      nombre: r.candidate.name,
      tipo: r.candidate.kind === "stock" ? "acción" : r.candidate.kind === "etf" ? "ETF" : "ETC",
      valor_actual_eur: round(r.candidate.valueEur, 2),
      precio_eur: round(r.candidate.priceEur, 2),
      coste_compra_eur: round(r.costEur, 2),
      peso_despues: round(r.weightAfter),
      sector: r.candidate.sector?.name ?? null,
      recomendacion_cartera: r.candidate.action,
      riesgo_tecnico_largo_plazo: r.candidate.technical,
      calidad_0_100: r.candidate.quality,
      criterios: Object.fromEntries(r.criteria.map((k) => [k.id, { nota: k.score, explicacion: k.text }])),
      nota_final: r.total,
      excluida: r.excluded,
      avisos: r.warnings,
    })),
  };

  const posiciones = [];
  for (const r of result.ranked) {
    const c = r.candidate;
    if (c.kind === "stock") {
      const row = await getLatestAnalysis(db, c.id);
      const stored = row ? parseStored(row) : null;
      const a = stored?.analysis;
      posiciones.push({
        ticker: c.ticker,
        analisis_guardado: a
          ? {
              fecha: row!.created_at.slice(0, 10),
              postura: a.veredicto.postura,
              resumen: a.veredicto.resumen,
              outlook: a.outlook.resumen,
              guidance: a.outlook.guidance.slice(0, 5).map((g) => g.texto),
              catalizadores: a.catalizadores.slice(0, 4).map((x) => x.titulo),
              riesgos: a.riesgos.slice(0, 5).map((x) => `${x.titulo} (${x.gravedad})`),
            }
          : null,
      });
    } else {
      const f = funds.get(c.id)?.profile;
      posiciones.push({
        ticker: c.ticker,
        ficha: f ? { indice: f.index, ter: f.ter, replicacion: f.replication, principales_posiciones: f.holdings.slice(0, 5).map((h) => h.name) } : null,
      });
    }
  }

  return [
    "<compra>",
    JSON.stringify({ modo: amount.mode === "eur" ? "euros" : "acciones", cantidad: amount.value, valor_cartera_eur: round(totalEur, 2) }),
    "</compra>",
    "<comparativa_app>",
    JSON.stringify(comparativa, null, 1),
    "</comparativa_app>",
    "<posiciones>",
    JSON.stringify(posiciones, null, 1),
    "</posiciones>",
    "Da tu segunda opinión siguiendo las instrucciones y el esquema de salida.",
  ].join("\n");
}

/** Huella corta del mensaje: si no cambia nada de lo enviado, se reutiliza la respuesta. */
function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

export const nextBuyCacheKey = (message: string, prompt: Prompt) => `next-buy-ai|${prompt.key}|${fingerprint(message)}`;

/** Respuesta ya guardada para estos mismos datos, si la hay (sin llamar a la IA). */
export async function cachedNextBuyAi(db: Db, input: NextBuyAiInput, prompt = NEXT_BUY_PROMPT): Promise<StoredNextBuyAi | null> {
  return readCached(db, nextBuyCacheKey(await buildNextBuyMessage(db, input), prompt));
}

async function readCached(db: Db, key: string): Promise<StoredNextBuyAi | null> {
  const raw = await getAppState(db, key);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredNextBuyAi;
    const ok = nextBuyAiSchema.safeParse(s.result);
    return ok.success ? { ...s, result: ok.data } : null;
  } catch {
    return null;
  }
}

export interface NextBuyAiDeps {
  db: Db;
  client: Anthropic;
  model: AnalysisModel;
  budgetEur: number;
  prompt?: Prompt;
  now?: Date;
}

export async function runNextBuyAi(deps: NextBuyAiDeps, input: NextBuyAiInput, opts: { allowOverBudget?: boolean } = {}): Promise<StoredNextBuyAi> {
  const { db, client, model } = deps;
  const prompt = deps.prompt ?? NEXT_BUY_PROMPT;
  if (input.result.ranked.length < 2) throw new AiAnalysisError("Elige al menos dos posiciones para pedir una segunda opinión.");
  const eligible = input.result.ranked.filter((r) => !r.excluded).map((r) => r.candidate.ticker);
  if (eligible.length === 0) throw new AiAnalysisError("Ninguna de las posiciones elegidas se puede comprar hoy: no hay nada que opinar.");

  const message = await buildNextBuyMessage(db, input);
  const key = nextBuyCacheKey(message, prompt);
  const cached = await readCached(db, key);
  if (cached) return cached;

  const rate = await checkBudget(db, {
    budgetEur: deps.budgetEur,
    estimateUsd: estimateCostUsd(prompt.text.length + message.length, model, 3000),
    now: deps.now,
    allowOverBudget: opts.allowOverBudget,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 6000,
      system: [{ type: "text", text: prompt.text, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: message }],
      output_config: { effort: "medium", format: betaZodOutputFormat(nextBuyAiSchema) },
    });
  } catch (e) {
    throw new AiAnalysisError(describeApiError(e));
  }

  // El gasto se apunta siempre, aunque luego la respuesta no sirva
  const cost = usdToEur(Math.max(costUsd(response.usage, model), costUsd(response.usage, response.model)), rate);
  await recordAiUsage(db, {
    analysisId: null,
    purpose: "other",
    model: response.model,
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    costEur: cost.eur,
  });

  if (response.stop_reason === "refusal") throw new AiAnalysisError("Claude ha declinado dar esta opinión. Prueba con otro modelo en Ajustes.");
  if (response.stop_reason === "max_tokens") throw new AiAnalysisError("La respuesta de la IA se cortó antes de terminar. No se ha guardado.");
  const checked = nextBuyAiSchema.safeParse(response.parsed_output);
  if (!checked.success) {
    console.error("[ia] qué compro hoy, respuesta no válida:", checked.error.message);
    throw new AiAnalysisError("La IA devolvió una respuesta con un formato inesperado. No se ha guardado.");
  }
  const problems = nextBuyAiProblems(checked.data, eligible, input.result.ranked.map((r) => r.candidate.ticker));
  if (problems.length) {
    console.error("[ia] qué compro hoy, respuesta incompleta:", problems.join(" "));
    throw new AiAnalysisError(`La respuesta de la IA no sirve (${problems.join(" ")}). No se ha guardado.`);
  }

  const stored: StoredNextBuyAi = { key, result: checked.data, model: response.model, costEur: cost.eur, costApprox: cost.approx, createdAt: (deps.now ?? new Date()).toISOString() };
  await setAppState(db, key, JSON.stringify(stored));
  return stored;
}
