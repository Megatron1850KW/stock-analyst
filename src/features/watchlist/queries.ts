import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { tauriEuClient } from "@/data/esef/client";
import { tauriSecClient } from "@/data/sec-edgar/client";
import { listWatchlist, removeFromWatchlist } from "@/db/repo";
import { startInitialAnalysis } from "@/features/ai/queries";
import { startInitialPeers } from "@/features/peers/queries";
import { providersFor, refreshPrices } from "@/features/prices/refresh";
import { secUserAgent } from "@/features/settings/schema";
import { loadSettings } from "@/platform/settings-store";
import { appDb } from "@/platform/database";
import { importEuIsin } from "./import-eu";
import { importUsTicker, ImportError, looksLikeIsin, type ImportStep } from "./import-us";
import { loadSecurityDetail } from "./load";

export const watchlistKey = ["watchlist"] as const;

export function useWatchlist() {
  return useQuery({ queryKey: watchlistKey, queryFn: async () => listWatchlist(await appDb()) });
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
  const mutation = useMutation({
    mutationFn: async (input: string) => {
      const settings = await loadSettings();
      const db = await appDb();
      const eu = tauriEuClient();
      let ticker = input.trim().toUpperCase();
      // ISIN: europeo → ESEF; de EE. UU. → su ticker y la SEC
      if (looksLikeIsin(ticker)) {
        if (!ticker.startsWith("US")) {
          setMarket("EU");
          const result = await importEuIsin(eu, db, ticker, setStep);
          const prices = await refreshPrices(db, providersFor(settings), result.securityId).catch(() => null);
          return { ...result, priceErrors: prices?.failed.map((f) => f.message) ?? [] };
        }
        setStep("ticker");
        const us = (await eu.figi(ticker)).find((r) => r.exchCode === "US" && r.ticker);
        if (!us?.ticker) throw new ImportError(`No encuentro qué ticker de EE. UU. corresponde al ISIN ${ticker}.`);
        ticker = us.ticker.replace(/\//g, ".");
      }
      setMarket("US");
      const ua = secUserAgent(settings);
      if (!ua) throw new ImportError("Antes de consultar la SEC, añade tu nombre y email en Ajustes (la SEC lo exige).");
      const result = await importUsTicker(tauriSecClient(ua), db, ticker, setStep);
      // Precio e histórico del valor recién añadido (si hay proveedor); un fallo aquí no anula el alta
      const prices = await refreshPrices(db, providersFor(settings), result.securityId).catch(() => null);
      return { ...result, priceErrors: prices?.failed.map((f) => f.message) ?? [] };
    },
    onSettled: () => {
      setStep(null);
      void qc.invalidateQueries({ queryKey: watchlistKey });
      void qc.invalidateQueries({ queryKey: ["technical-risk"] });
      void qc.invalidateQueries({ queryKey: ["comparison"] });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["security", r.securityId] });
      startInitialAnalysis(qc, r.securityId, () => startInitialPeers(qc, r.securityId));
    },
  });
  return { ...mutation, step, market };
}

export function useRemoveSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => removeFromWatchlist(await appDb(), id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["peers"] });
      void qc.invalidateQueries({ queryKey: watchlistKey });
      void qc.invalidateQueries({ queryKey: ["technical-risk"] });
      void qc.invalidateQueries({ queryKey: ["comparison"] });
    },
  });
}
