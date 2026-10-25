import { z } from "zod";

/** Modelos de Claude seleccionables (CLAUDE.md §7). */
export const AI_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Equilibrado · recomendado para análisis" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Rápido y barato · extracción y clasificación" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Más profundo · más caro" },
] as const;
const aiModelId = z.enum(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]);

/** Proveedores de precios históricos candidatos (§4.3). La elección es del usuario. */
export const PRICE_PROVIDERS = [
  { id: "tiingo", label: "Tiingo (gratis, EE. UU.)" },
  { id: "fmp", label: "Financial Modeling Prep (de pago)" },
  { id: "eodhd", label: "EODHD" },
  { id: "finnhub", label: "Finnhub" },
  { id: "alphavantage", label: "Alpha Vantage" },
  { id: "stooq", label: "Stooq (sin clave)" },
] as const;
const priceProviderId = z.enum(["tiingo", "fmp", "eodhd", "finnhub", "alphavantage", "stooq"]);

export const settingsSchema = z.object({
  secUserAgentName: z.string().trim().max(80),
  secUserAgentEmail: z.union([z.literal(""), z.email("Email no válido")]),
  /**
   * Cómo se usa la IA: con la API de Claude (de pago por uso), copiando y
   * pegando en claude.ai (gratis, a mano) o sin IA.
   */
  aiMode: z.enum(["api", "manual", "off"]),
  aiModelAnalysis: aiModelId,
  aiModelExtraction: aiModelId,
  aiMonthlyBudgetEur: z.number().min(0).max(10_000),
  priceProvider: priceProviderId.nullable(),
  /** Precios de las bolsas europeas (Tiingo solo cubre EE. UU.). */
  priceProviderEu: z.enum(["alphavantage"]).nullable(),
  /** Respaldo para Europa: cuando el principal no tiene el valor o se agota su cupo. */
  priceProviderEuBackup: z.enum(["yahoo"]).nullable(),
  baseCurrency: z.enum(["EUR", "USD"]),
  language: z.enum(["es"]),
  theme: z.enum(["system", "light", "dark"]),
  autostart: z.boolean(),
  reportCheckFrequency: z.enum(["daily", "weekly", "manual"]),
  /** Informe nuevo detectado: avisar y preguntar (por defecto) o analizarlo solo (§7). */
  newReportAction: z.enum(["ask", "auto"]),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  secUserAgentName: "",
  secUserAgentEmail: "",
  aiMode: "manual",
  aiModelAnalysis: "claude-sonnet-5-5",
  aiModelExtraction: "claude-haiku-5-5",
  aiMonthlyBudgetEur: 10,
  priceProvider: "tiingo",
  priceProviderEu: "alphavantage",
  priceProviderEuBackup: "yahoo",
  baseCurrency: "EUR",
  language: "es",
  theme: "system",
  autostart: false,
  reportCheckFrequency: "daily",
  newReportAction: "ask",
};

/**
 * Combina lo guardado con los valores por defecto. Un campo que no valida se
 * descarta (y se avisa en consola) en lugar de romper toda la configuración.
 */
export function parseSettings(raw: unknown): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      const field = settingsSchema.shape[key as keyof Settings];
      const result = field.safeParse(value);
      if (result.success) merged[key] = result.data;
      else console.warn(`Ajuste "${key}" no válido, se usa el valor por defecto`);
    }
  }
  return settingsSchema.parse(merged);
}

/** Cabecera User-Agent exigida por la SEC: "Nombre email". */
export function secUserAgent(s: Pick<Settings, "secUserAgentName" | "secUserAgentEmail">): string | null {
  if (!s.secUserAgentName.trim() || !s.secUserAgentEmail) return null;
  return `${s.secUserAgentName.trim()} ${s.secUserAgentEmail}`;
}

/** Claves que se guardan en el Llavero de macOS. Debe coincidir con la lista de Rust. */
export const SECRET_KEYS = [
  {
    id: "anthropic_api_key",
    label: "Claude (Anthropic)",
    description: "Solo en el modo «API de Claude»: análisis narrativo, competidores y lectura de PDFs. Solo se usa cuando tú lo pides o sale un informe nuevo.",
    required: false,
  },
  {
    id: "prices_api_key",
    label: "Proveedor de precios",
    description: "Clave de Tiingo (plan gratuito) u otro proveedor que elijas abajo. Precios de EE. UU.",
    required: false,
  },
  {
    id: "alphavantage_api_key",
    label: "Alpha Vantage",
    description: "Precios de las bolsas europeas (plan gratuito: 25 consultas al día).",
    required: false,
  },
  {
    id: "openfigi_api_key",
    label: "OpenFIGI",
    description: "Opcional. Sube el límite de consultas para traducir ISIN a ticker.",
    required: false,
  },
] as const;
export type SecretKeyId = (typeof SECRET_KEYS)[number]["id"];
