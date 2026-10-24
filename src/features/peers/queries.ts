import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createClaudeClient } from "@/data/claude/client";
import { providerFor } from "@/data/prices/provider";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { removePeer } from "@/db/peers-repo";
import { deleteIfUnused } from "@/db/repo";
import { aiSpendKey } from "@/features/ai/queries";
import { AiAnalysisError } from "@/features/ai/equity-analysis";
import { secUserAgent } from "@/features/settings/schema";
import { appDb } from "@/platform/database";
import { secrets } from "@/platform/secrets";
import { loadSettings } from "@/platform/settings-store";
import { loadPeerGroup } from "./load";
import { proposePeers } from "./propose";
import { linkPeers, memoTickers, type PeerSyncResult } from "./sync";

export const peerGroupKey = (securityId: number) => ["peers", securityId] as const;
const findKey = (securityId: number) => ["peers-find", securityId] as const;

export function usePeerGroup(securityId: number) {
  return useQuery({ queryKey: peerGroupKey(securityId), queryFn: async () => loadPeerGroup(await appDb(), securityId) });
}

async function syncDeps() {
  const settings = await loadSettings();
  const ua = secUserAgent(settings);
  if (!ua) throw new AiAnalysisError("Falta tu nombre y email para la SEC. Añádelos en Ajustes.");
  return { settings, db: await appDb(), sec: memoTickers(tauriSecClient(ua)), prices: providerFor(settings.priceProvider) };
}

/**
 * Pide a la IA los competidores (una sola vez; `force` = volver a proponer) y
 * descarga sus datos. Coste típico: unas décimas de céntimo con Haiku.
 */
export async function findPeers(securityId: number, opts: { force?: boolean; allowOverBudget?: boolean } = {}): Promise<PeerSyncResult> {
  if (!(await secrets.has("anthropic_api_key"))) throw new AiAnalysisError("Falta la clave de Claude. Añádela en Ajustes, o añade tú los competidores.");
  const { settings, db, sec, prices } = await syncDeps();
  const { stored } = await proposePeers(
    { db, client: createClaudeClient(), tickers: sec.tickers, model: settings.aiModelExtraction, budgetEur: settings.aiMonthlyBudgetEur },
    securityId,
    opts,
  );
  if (opts.force) {
    // Volver a proponer sustituye a los propuestos antes por la IA; los tuyos se quedan
    await db.execute("DELETE FROM peers WHERE security_id = ? AND source = 'ai-validated'", [securityId]);
  }
  return linkPeers({ db, sec, prices }, securityId, stored.accepted, "ai-validated");
}

function invalidate(qc: QueryClient, securityId: number) {
  void qc.invalidateQueries({ queryKey: peerGroupKey(securityId) });
  void qc.invalidateQueries({ queryKey: aiSpendKey });
  void qc.invalidateQueries({ queryKey: ["comparison"] });
}

export function useFindPeers(securityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: findKey(securityId),
    mutationFn: (opts: { force?: boolean; allowOverBudget?: boolean }) => findPeers(securityId, opts),
    onSettled: () => invalidate(qc, securityId),
  });
}

export function useFindingPeers(securityId: number): boolean {
  return useIsMutating({ mutationKey: findKey(securityId) }) > 0;
}

/** Competidor añadido a mano por el usuario (sin IA). */
export function useAddPeer(securityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticker: string) => {
      const { db, sec, prices } = await syncDeps();
      const r = await linkPeers({ db, sec, prices }, securityId, [{ ticker: ticker.trim().toUpperCase(), reason: "Añadido por ti" }], "user");
      if (r.failed.length && !r.added.length) throw new Error(r.failed[0]!.message);
      return r;
    },
    onSettled: () => invalidate(qc, securityId),
  });
}

export function useRemovePeer(securityId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (peerId: number) => {
      const db = await appDb();
      await removePeer(db, securityId, peerId);
      await deleteIfUnused(db, peerId);
    },
    onSettled: () => invalidate(qc, securityId),
  });
}

/** Búsqueda inicial de competidores al dar de alta un valor (si hay clave). Corre en segundo plano. */
export function startInitialPeers(qc: QueryClient, securityId: number): void {
  void (async () => {
    if (!(await secrets.has("anthropic_api_key"))) return;
    const mutation = qc.getMutationCache().build(qc, {
      mutationKey: findKey(securityId),
      mutationFn: () => findPeers(securityId),
      onSettled: () => invalidate(qc, securityId),
    });
    await mutation.execute(undefined).catch((e: unknown) => console.warn("[ia] competidores no buscados:", e instanceof Error ? e.message : e));
  })();
}
