import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { tauriEuClient } from "@/data/esef/client";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { getPriceBars, listWatchlist, removeFromWatchlist, type WatchlistRow } from "@/db/repo";
import { priceStats, type PriceStats } from "@/domain/technical/price-range";
import { startInitialAnalysis } from "@/features/ai/queries";
import { startInitialPeers } from "@/features/peers/queries";
import { providersFor, refreshPrices } from "@/features/prices/refresh";
import { secUserAgent } from "@/features/settings/schema";
import { loadSettings } from "@/platform/settings-store";
import { appDb } from "@/platform/database";
import { addToWatchlist, type AddDeps, type AddOutcome } from "./add";
import { ImportError, type ImportStep } from "./import-us";
import { loadSecurityDetail } from "./load";
import { loadWatchlistFunds } from "./load-funds";

export const watchlistKey = ["watchlist"] as const;

export type WatchlistItem = WatchlistRow & { stats: PriceStats };

export function useWatchlist() {
  return useQuery({
    queryKey: watchlistKey,
    queryFn: async (): Promise<WatchlistItem[]> => {
      const db = await appDb();
      const rows = await listWatchlist(db);
      return Promise.all(
        rows.map(async (r) => ({
          ...r,
          stats: priceStats(await getPriceBars(db, r.id, "1w"), r.price != null && r.price_date ? { value: r.price, date: r.price_date } : null),
        })),
      );
    },
  });
}

export const watchlistFundsKey = ["watchlist-funds"] as const;

export function useWatchlistFunds(only?: number) {
  return useQuery({ queryKey: [...watchlistFundsKey, only ?? "all"], queryFn: async () => loadWatchlistFunds(await appDb(), only) });
}

export function useSecurityDetail(id: number) {
  return useQuery({
    queryKey: ["security", id],
    queryFn: async () => loadSecurityDetail(await appDb(), id),
  });
}

/** Mensaje en llano para cualquier error de la importación. */
export function describeError(e: unknown): string {
  if (e instanceof ImportError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function useAddTicker() {
  const qc = useQueryClient();
  const [step, setStep] = useState<ImportStep | null>(null);
  const [market, setMarket] = useState<"US" | "EU">("US");
  const [current, setCurrent] = useState<string | null>(null);
  const [done, setDone] = useState<AddOutcome[]>([]);
  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: watchlistKey });
    void qc.invalidateQueries({ queryKey: watchlistFundsKey });
    void qc.invalidateQueries({ queryKey: ["technical-risk"] });
    void qc.invalidateQueries({ queryKey: ["comparison"] });
    void qc.invalidateQueries({ queryKey: ["stars"] });
  };
  const mutation = useMutation({
    mutationFn: async (text: string) => {
      setDone([]);
      const settings = await loadSettings();
      const db = await appDb();
      const ua = secUserAgent(settings);
      const deps: AddDeps = {
        db,
        eu: tauriEuClient(),
        sec: ua ? tauriSecClient(ua) : null,
        refreshPrices: async (id) => (await refreshPrices(db, providersFor(settings), id)).failed.map((f) => f.message),
        onEntry: (e) => setCurrent(e.kind === "isin" ? e.isin : e.ticker),
        onStep: setStep,
        onMarket: setMarket,
      };
      return addToWatchlist(deps, text, (o) => {
        setStep(null);
        setDone((d) => [...d, o]);
        refreshLists();
        if (!o.ok) return;
        void qc.invalidateQueries({ queryKey: ["security", o.result.securityId] });
        // Solo las acciones tienen informes que analizar (una vez, al darlas de alta)
        if (o.type === "stock") startInitialAnalysis(qc, o.result.securityId, () => startInitialPeers(qc, o.result.securityId));
      });
    },
    onSettled: () => {
      setStep(null);
      setCurrent(null);
      refreshLists();
    },
  });
  return { ...mutation, step, market, current, done };
}

export function useRemoveSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => removeFromWatchlist(await appDb(), id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["peers"] });
      void qc.invalidateQueries({ queryKey: watchlistKey });
      void qc.invalidateQueries({ queryKey: watchlistFundsKey });
      void qc.invalidateQueries({ queryKey: ["technical-risk"] });
      void qc.invalidateQueries({ queryKey: ["comparison"] });
      void qc.invalidateQueries({ queryKey: ["stars"] });
    },
  });
}
