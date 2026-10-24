import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { providerFor } from "@/data/prices/provider";
import { appDb } from "@/platform/database";
import { inDesktopApp } from "@/platform/runtime";
import { loadSettings } from "@/platform/settings-store";
import { refreshPrices, type RefreshResult } from "./refresh";

export const lastRefreshKey = ["price-refresh"] as const;
export interface LastRefresh extends RefreshResult {
  at: string;
  provider: string;
}

export function useRefreshPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["refresh-prices"],
    mutationFn: async (): Promise<LastRefresh> => {
      const provider = providerFor((await loadSettings()).priceProvider);
      if (!provider) throw new Error("Elige un proveedor de precios en Ajustes.");
      const result = await refreshPrices(await appDb(), provider);
      return { ...result, at: new Date().toISOString(), provider: provider.label };
    },
    onSuccess: (r) => {
      qc.setQueryData(lastRefreshKey, r);
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
      void qc.invalidateQueries({ queryKey: ["comparison"] });
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
