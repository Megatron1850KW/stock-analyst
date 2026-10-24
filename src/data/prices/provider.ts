import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/** Proveedor de precios intercambiable (CLAUDE.md §4). */
export interface Quote {
  symbol: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** Fecha de la cotización (YYYY-MM-DD, hora de Nueva York). */
  date: string;
}

export interface PriceProvider {
  id: string;
  label: string;
  quote(symbol: string): Promise<Quote>;
}

/** Respuesta de https://financialmodelingprep.com/stable/quote (solo los campos que usamos). */
const fmpQuoteSchema = z
  .array(
    z.object({
      symbol: z.string(),
      price: z.number(),
      open: z.number().nullish(),
      dayHigh: z.number().nullish(),
      dayLow: z.number().nullish(),
      volume: z.number().nullish(),
      timestamp: z.number(),
    }),
  )
  .min(1);

const nyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function parseFmpQuote(raw: string): Quote {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("FMP devolvió una respuesta que no es JSON");
  }
  // FMP responde con un objeto {"Error Message": …} cuando la clave o el plan no valen
  if (json && typeof json === "object" && !Array.isArray(json) && "Error Message" in json) {
    throw new Error(`FMP rechazó la consulta: ${String((json as Record<string, unknown>)["Error Message"]).slice(0, 160)}`);
  }
  const parsed = fmpQuoteSchema.safeParse(json);
  if (!parsed.success) throw new Error("FMP no devolvió una cotización válida para este símbolo");
  const q = parsed.data[0]!;
  return {
    symbol: q.symbol,
    price: q.price,
    open: q.open ?? null,
    high: q.dayHigh ?? null,
    low: q.dayLow ?? null,
    volume: q.volume ?? null,
    date: nyDate.format(new Date(q.timestamp * 1000)),
  };
}

export const fmpProvider: PriceProvider = {
  id: "fmp",
  label: "Financial Modeling Prep",
  quote: async (symbol) => parseFmpQuote(await invoke<string>("price_quote", { provider: "fmp", symbol })),
};

export function providerFor(id: string | null): PriceProvider | null {
  return id === "fmp" ? fmpProvider : null;
}
