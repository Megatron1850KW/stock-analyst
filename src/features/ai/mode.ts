import type { Settings } from "@/features/settings/schema";
import { secrets } from "@/platform/secrets";
import { loadSettings } from "@/platform/settings-store";
import { AiAnalysisError } from "./equity-analysis";

/**
 * Puerta única de la API de Claude: solo se llama en el modo «API de Claude» y
 * con clave. En modo manual o sin IA, se explica en llano qué hacer en su lugar.
 */
export async function requireApi(hint: string | ((mode: Settings["aiMode"]) => string)): Promise<Settings> {
  const settings = await loadSettings();
  if (typeof hint === "function") hint = hint(settings.aiMode);
  if (settings.aiMode === "manual") throw new AiAnalysisError(`La app está en modo «Claude.ai manual» (Ajustes) y no usa la API de Claude. ${hint}`);
  if (settings.aiMode === "off") throw new AiAnalysisError(`La IA está desactivada en Ajustes. ${hint}`);
  if (!(await secrets.has("anthropic_api_key"))) throw new AiAnalysisError(`Falta la clave de Claude. Añádela en Ajustes. ${hint}`);
  return settings;
}

/** ¿Se puede llamar a la API sin preguntar? Para los análisis automáticos al dar de alta un valor. */
export async function apiReady(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.aiMode === "api" && (await secrets.has("anthropic_api_key"));
}
