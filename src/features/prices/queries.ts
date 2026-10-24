import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { tauriFxClient } from "@/data/fx/frankfurter";
import { refreshFx } from "@/features/fx/refresh";
import { appDb } from "@/platform/database";
import { inDesktopApp } from "@/platform/runtime";
import { loadSettings } from "@/platform/settings-store";
import { providersFor, providersLabel, refreshPrices, type RefreshResult } from "./refresh";

export const lastRefreshKey = ["price-refresh"] as const;
export interface LastRefresh extends RefreshResult {
  at: string;
  provider: string;
  /** Tipos de cambio del BCE: error en llano si no se pudieron traer. */
  fxError?: string;
}

export function useRefreshPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["refresh-prices"],
    mutationFn: async (): Promise<LastRefresh> => {
      const providers = providersFor(await loadSettings());
      const db = await appDb();
      // Los tipos del BCE no dependen del proveedor de precios: van primero
      const fxError = await refreshFx(db, tauriFxClient()).then(
        () => undefined,
        (e: unknown) => `Tipos de cambio: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (!providers.US && !providers.EU) throw new Error("Elige un proveedor de precios en Ajustes.");
      const result = await refreshPrices(db, providers);
      return { ...result, fxError, at: new Date().toISOString(), provider: providersLabel(providers) };
    },
    onSuccess: (r) => {
      qc.setQueryData(lastRefreshKey, r);
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
      void qc.invalidateQueries({ queryKey: ["comparison"] });
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

let launchedThisSession = false;

/**
 * Precio al abrir la app (CLAUDE.md §4.3): una sola vez por sesión, y ⌘R
 * para repetirlo a mano. Nada de refrescos periódicos.
 */
export function usePriceRefreshOnLaunch() {
  const refresh = useRefreshPrices();
  const { mutate } = refresh;
  useEffect(() => {
    if (!inDesktopApp || launchedThisSession) return;
    launchedThisSession = true;
    mutate();
  }, [mutate]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (inDesktopApp) mutate();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mutate]);
  return refresh;
}
