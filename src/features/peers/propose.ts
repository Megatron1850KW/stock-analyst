import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { TickersExchange } from "@/data/sec-edgar/schemas";
import { findTicker, type TickerMatch } from "@/data/sec-edgar/client";
import { getLatestAnalysis, recordAiUsage } from "@/db/ai-repo";
import type { Db } from "@/db/client";
import { getPeerProposal, savePeerProposal } from "@/db/peers-repo";
import { getSecurity } from "@/db/repo";
import { PEERS_CONFIG } from "@/domain/scoring/config";
import { checkBudget } from "@/features/ai/budget";
import { costUsd, estimateCostUsd, usdToEur } from "@/features/ai/cost";
import { AiAnalysisError, describeApiError, parseStored } from "@/features/ai/equity-analysis";
import { PEERS_PROMPT, type Prompt } from "@/features/ai/prompts";
import { isinChecksumOk } from "@/features/watchlist/import-us";
import { peerOutputSchema, peerProposalSchema, type PeerProposal } from "./schema";

/**
 * Competidores propuestos por la IA una sola vez por valor (CLAUDE.md §4.3):
 * el modelo barato propone, el código comprueba que cada ticker existe en la
 * SEC (o que el ISIN europeo es válido) y no es la propia empresa, y se
 * guarda. No se repite salvo que lo pidas. Al descargar una europea se
 * comprueba además que el ISIN es de esa empresa (import-eu.ts).
 */

export type AcceptedPeer =
  | (TickerMatch & { reason: string; isin?: undefined })
  | { ticker: string; name: string; isin: string; reason: string; cik?: undefined };

export interface StoredPeerProposal {
  proposal: PeerProposal;
  accepted: AcceptedPeer[];
  rejected: { ticker: string; why: string }[];
}

export interface ProposeDeps {
  db: Db;
  client: Anthropic;
  /** Lista oficial de tickers de la SEC, para validar lo que propone la IA. Null sin datos para la SEC. */
  tickers: (() => Promise<TickersExchange>) | null;
  model: "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5";
  budgetEur: number;
  prompt?: Prompt;
  now?: Date;
}

export function validatePeers(
  proposal: PeerProposal,
  list: TickersExchange | null,
  self: { cik: string | null; isin?: string | null },
  max = PEERS_CONFIG.max,
) {
  const accepted: AcceptedPeer[] = [];
  const rejected: StoredPeerProposal["rejected"] = [];
  const seen = new Set<string>(self.cik ? [self.cik] : []);
  for (const c of proposal.competidores) {
    const isin = c.isin?.trim().toUpperCase();
    if (c.mercado === "Europa" || (isin && !isin.startsWith("US"))) {
      if (!isin || !isinChecksumOk(isin)) rejected.push({ ticker: c.ticker, why: "Su ISIN no es válido." });
      else if (isin === self.isin) rejected.push({ ticker: c.ticker, why: "Es la propia empresa." });
      else if (seen.has(isin)) rejected.push({ ticker: c.ticker, why: "Repetido (misma empresa que otro de la lista)." });
      else if (accepted.length >= max) rejected.push({ ticker: c.ticker, why: `Ya hay ${max} competidores más parecidos.` });
      else {
        seen.add(isin);
        accepted.push({ ticker: c.ticker, name: c.nombre, isin, reason: c.motivo });
      }
      continue;
    }
    if (!list) {
      rejected.push({ ticker: c.ticker, why: "Es de EE. UU. y falta tu nombre y email para la SEC (Ajustes)." });
      continue;
    }
    const match = findTicker(list, c.ticker);
    if (!match) rejected.push({ ticker: c.ticker, why: "No aparece entre las empresas que presentan en la SEC." });
    else if (self.cik && match.cik === self.cik) rejected.push({ ticker: c.ticker, why: "Es la propia empresa." });
    else if (seen.has(match.cik)) rejected.push({ ticker: c.ticker, why: "Repetido (misma empresa que otro de la lista)." });
    else if (accepted.length >= max) rejected.push({ ticker: c.ticker, why: `Ya hay ${max} competidores más parecidos.` });
    else {
      seen.add(match.cik);
      accepted.push({ ...match, reason: c.motivo });
    }
  }
  return { accepted, rejected };
}

export function parseStoredPeers(json: string): StoredPeerProposal | null {
  try {
    const raw = JSON.parse(json) as StoredPeerProposal;
    return peerProposalSchema.safeParse(raw.proposal).success ? raw : null;
  } catch {
    return null;
  }
}

export async function proposePeers(
  deps: ProposeDeps,
  securityId: number,
  opts: { force?: boolean; allowOverBudget?: boolean } = {},
): Promise<{ status: "cached" | "created"; stored: StoredPeerProposal }> {
  const { db, client, model } = deps;
  const prompt = deps.prompt ?? PEERS_PROMPT;
  if (!opts.force) {
    const cached = await getPeerProposal(db, securityId);
    const stored = cached && parseStoredPeers(cached.result_json);
    if (stored) return { status: "cached", stored };
  }
  const security = await getSecurity(db, securityId);
  if (!security) throw new AiAnalysisError("Este valor ya no está guardado.");
  const latest = await getLatestAnalysis(db, securityId);
  const business = latest ? parseStored(latest)?.analysis.modelo_negocio : undefined;
  const userMessage = [
    "<empresa>",
    JSON.stringify({
      ticker: security.ticker,
      nombre: security.name,
      pais: security.country ?? null,
      isin: security.market === "EU" ? security.isin : null,
      sector_sic: security.sic_description,
      modelo_negocio: business ?? null,
    }),
    "</empresa>",
    "Propón sus competidores siguiendo las instrucciones y el esquema de salida.",
  ].join("\n");

  const rate = await checkBudget(db, {
    budgetEur: deps.budgetEur,
    estimateUsd: estimateCostUsd(prompt.text.length + userMessage.length, model, 1500),
    now: deps.now,
    allowOverBudget: opts.allowOverBudget,
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      system: [{ type: "text", text: prompt.text }],
      messages: [{ role: "user", content: userMessage }],
      // Tarea sencilla: poco razonamiento basta
      output_config: { effort: "low", format: betaZodOutputFormat(peerOutputSchema) },
    });
  } catch (e) {
    throw new AiAnalysisError(describeApiError(e));
  }

  const cost = usdToEur(costUsd(response.usage, response.model), rate);
  await recordAiUsage(db, {
    analysisId: null,
    purpose: "peers",
    model: response.model,
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    costEur: cost.eur,
  });
  if (response.stop_reason === "refusal") throw new AiAnalysisError("Claude ha declinado proponer competidores. Puedes añadirlos tú.");
  const checked = peerOutputSchema.safeParse(response.parsed_output);
  if (!checked.success || response.stop_reason === "max_tokens") {
    console.error("[ia] propuesta de competidores no válida:", checked.error?.message ?? response.stop_reason);
    throw new AiAnalysisError("La IA devolvió una lista de competidores con un formato inesperado. Puedes añadirlos tú.");
  }

  const needsSec = checked.data.competidores.some((c) => c.mercado === "EEUU");
  const list = needsSec && deps.tickers ? await deps.tickers() : null;
  const { accepted, rejected } = validatePeers(checked.data, list, { cik: security.cik, isin: security.isin });
  const stored: StoredPeerProposal = { proposal: checked.data, accepted, rejected };
  await savePeerProposal(db, { security_id: securityId, model: response.model, prompt_version: prompt.key, result_json: JSON.stringify(stored), cost_eur: cost.eur });
  return { status: "created", stored };
}
