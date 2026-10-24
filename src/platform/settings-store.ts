import { LazyStore } from "@tauri-apps/plugin-store";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "@/features/settings/schema";
import { inDesktopApp } from "./runtime";

/** Preferencias no secretas: settings.json en la carpeta de datos de la app. */
const store = inDesktopApp ? new LazyStore("settings.json") : null;
const KEY = "settings";
let previewSettings: Settings = DEFAULT_SETTINGS;

export async function loadSettings(): Promise<Settings> {
  if (!store) return previewSettings;
  return parseSettings(await store.get(KEY));
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const valid = parseSettings(next);
  if (!store) {
    previewSettings = valid;
    return valid;
  }
  await store.set(KEY, valid);
  await store.save();
  return valid;
}
