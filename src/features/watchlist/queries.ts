import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { providerFor } from "@/data/prices/provider";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { getFacts, getFilings, getGaps, getSecurity, listWatchlist, removeFromWatchlist } from "@/db/repo";
import { refreshPrices } from "@/features/prices/refresh";
import { secUserAgent } from "@/features/settings/schema";
import { loadSettings } from "@/platform/settings-store";
import { appDb } from "@/platform/database";
import { importUsTicker, ImportError, type ImportStep } from "./import-us";

export const watchlistKey = ["watchlist"] as const;

export function useWatchlist() {
  return useQuery({ queryKey: watchlistKey, queryFn: async () => listWatchlist(await appDb()) });
}

export function useSecurityDetail(id: number) {
  return useQuery({
    queryKey: ["security", id],
    queryFn: async () => {
      const db = await appDb();
      const [security, filings, facts, gaps] = await Promise.all([
        getSecurity(db, id),
        getFilings(db, id),
        getFacts(db, id),
        getGaps(db, id),
      ]);
      return { security, filings, facts, gaps };
    },
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
  const mutation = useMutation({
    mutationFn: async (ticker: string) => {
      const settings = await loadSettings();
      const ua = secUserAgent(settings);
      if (!ua) throw new ImportError("Antes de consultar la SEC, añade tu nombre y email en Ajustes (la SEC lo exige).");
      const db = await appDb();
      const result = await importUsTicker(tauriSecClient(ua), db, ticker, setStep);
      // Precio e histórico del valor recién añadido (si hay proveedor); un fallo aquí no anula el alta
      const provider = providerFor(settings.priceProvider);
      const prices = provider ? await refreshPrices(db, provider, result.securityId).catch(() => null) : null;
      return { ...result, priceErrors: prices?.failed.map((f) => f.message) ?? [] };
    },
    onSettled: () => {
      setStep(null);
      void qc.invalidateQueries({ queryKey: watchlistKey });
    },
    onSuccess: (r) => void qc.invalidateQueries({ queryKey: ["security", r.securityId] }),
  });
  return { ...mutation, step };
}

export function useRemoveSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => removeFromWatchlist(await appDb(), id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: watchlistKey }),
  });
}
