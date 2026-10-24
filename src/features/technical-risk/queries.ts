import { useQuery } from "@tanstack/react-query";
import { appDb } from "@/platform/database";
import { loadCandles, loadTechnicalRisk } from "./load";

export const technicalKey = ["technical-risk"] as const;

export function useTechnicalRisk() {
  return useQuery({ queryKey: technicalKey, queryFn: async () => loadTechnicalRisk(await appDb()) });
}

export function useCandles(id: number | null, interval: "1mo" | "1w") {
  return useQuery({
    queryKey: [...technicalKey, "candles", id, interval],
    enabled: id !== null,
    queryFn: async () => loadCandles(await appDb(), id!, interval),
  });
}
