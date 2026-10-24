import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setAutostart } from "@/platform/autostart";
import { getDbStatus } from "@/platform/database";
import { secrets } from "@/platform/secrets";
import { loadSettings, saveSettings } from "@/platform/settings-store";
import type { SecretKeyId, Settings } from "./schema";

export const settingsKey = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: loadSettings, staleTime: Infinity });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const current = qc.getQueryData<Settings>(settingsKey) ?? (await loadSettings());
      if (patch.autostart !== undefined && patch.autostart !== current.autostart) await setAutostart(patch.autostart);
      return saveSettings({ ...current, ...patch });
    },
    onSuccess: (saved) => qc.setQueryData(settingsKey, saved),
  });
}

export function useSecretExists(id: SecretKeyId) {
  return useQuery({ queryKey: ["secret", id], queryFn: () => secrets.has(id) });
}

export function useSaveSecret(id: SecretKeyId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => secrets.set(id, value),
    onSuccess: () => qc.setQueryData(["secret", id], true),
  });
}

export function useDeleteSecret(id: SecretKeyId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => secrets.remove(id),
    onSuccess: () => qc.setQueryData(["secret", id], false),
  });
}

export function useDbStatus() {
  return useQuery({ queryKey: ["db-status"], queryFn: getDbStatus });
}
