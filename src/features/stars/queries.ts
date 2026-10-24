import { useQuery } from "@tanstack/react-query";
import { appDb } from "@/platform/database";
import { loadStars } from "./load";

export const starsKey = ["stars"] as const;

export function useStars() {
  return useQuery({ queryKey: starsKey, queryFn: async () => loadStars(await appDb()) });
}
