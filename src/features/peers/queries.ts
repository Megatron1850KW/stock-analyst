import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createClaudeClient } from "@/data/claude/client";
import { tauriEuClient } from "@/data/esef/client";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { removePeer } from "@/db/peers-repo";
import { deleteIfUnused } from "@/db/repo";
import { aiSpendKey } from "@/features/ai/queries";
import { apiReady, requireApi } from "@/features/ai/mode";
import { secUserAgent } from "@/features/settings/schema";
import { looksLikeIsin } from "@/features/watchlist/import-us";
import { appDb } from "@/platform/database";
import { loadSettings } from "@/platform/settings-store";
import { providersFor } from "@/features/prices/refresh";
import { loadPeerGroup } from "./load";
import { proposePeers } from "./propose";
import { linkPeers, memoTickers, type PeerSyncResult } from "./sync";

export const peerGroupKey = (securityId: number) => ["peers", securityId] as const;
const findKey = (securityId: number) => ["peers-find", securityId] as const;

export function usePeerGroup(securityId: number) {
  return useQuery({ queryKey: peerGroupKey(securityId), queryFn: async () => loadPeerGroup(await appDb(), securityId) });
}

/** Sin nombre y email para la SEC se pueden buscar igualmente competidores europeos. */
async function syncDeps() {
  const settings = await loadSettings();
  const ua = secUserAgent(settings);
  const sec = ua ? memoTickers(tauriSecClient(ua)) : null;
  return { settings, db: await appDb(), sec, eu: tauriEuClient(), prices: providersFor(settings) };
}

/**
 * Pide a la IA los competidores (una sola vez; `force` = volver a proponer) y
 * descarga sus datos. Coste típico: unas décimas de céntimo con Haiku.
 */
export async function findPeers(securityId: number, opts: { force?: boolean; allowOverBudget?: boolean } = {}): Promise<PeerSyncResult> {
  await requireApi("Añade tú los competidores con su ticker o ISIN.");
  const { settings, db, sec, eu, prices } = await syncDeps();
  const { stored } = await proposePeers(
    { db, client: createClaudeClient(), tickers: sec ? sec.tickers : null, model: settings.aiModelExtraction, budgetEur: settings.aiMonthlyBudgetEur },
    securityId,
    opts,
  );
  if (opts.force) {
    // Volver a proponer sustituye a los propuestos antes por la IA; los tuyos se quedan
    await db.execute("DELETE FROM peers WHERE security_id = ? AND source = 'ai-validated'", [securityId]);
  }
  return linkPeers({ db, sec, eu, prices }, securityId, stored.accepted, "ai-validated");
}

function invalidate(qc: QueryClient, securityId: number) {
  void qc.invalidateQueries({ queryKey: peerGroupKey(securityId) });
  void qc.invalidateQueries({ queryKey: aiSpendKey });
  void qc.invalidateQueries({ queryKey: ["comparison"] });
  void qc.invalidateQueries({ queryKey: ["stars"] });
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
      const { db, sec, eu, prices } = await syncDeps();
      const id = ticker.trim().toUpperCase();
      // Un ISIN europeo va por ESEF; un ticker o un ISIN de EE. UU., por la SEC
      const peer = looksLikeIsin(id) && !id.startsWith("US") ? { ticker: id, isin: id } : { ticker: id };
      const r = await linkPeers({ db, sec, eu, prices }, securityId, [{ ...peer, reason: "Añadido por ti" }], "user");
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
    if (!(await apiReady())) return;
    const mutation = qc.getMutationCache().build(qc, {
      mutationKey: findKey(securityId),
      mutationFn: () => findPeers(securityId),
      onSettled: () => invalidate(qc, securityId),
    });
    await mutation.execute(undefined).catch((e: unknown) => console.warn("[ia] competidores no buscados:", e instanceof Error ? e.message : e));
  })();
}
