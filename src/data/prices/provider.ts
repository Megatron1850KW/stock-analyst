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

/** Vela diaria ajustada por splits (no por dividendos). */
export interface PriceBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

/** Split: cada `denominator` acciones pasan a ser `numerator` (4 por 1 → 4/1). */
export interface Split {
  date: string;
  numerator: number;
  denominator: number;
}

export interface PriceProvider {
  id: string;
  label: string;
  quote(symbol: string): Promise<Quote>;
  /** Cierres diarios desde `from` (AAAA-MM-DD), del más antiguo al más reciente. */
  history(symbol: string, from: string): Promise<PriceBar[]>;
  splits(symbol: string): Promise<Split[]>;
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

function parseFmpJson(raw: string): unknown {
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
  return json;
}

export function parseFmpQuote(raw: string): Quote {
  const json = parseFmpJson(raw);
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/).transform((d) => d.slice(0, 10));

/** Respuesta de stable/historical-price-eod/full. */
const fmpHistorySchema = z.array(
  z.object({
    date: isoDate,
    open: z.number().nullish(),
    high: z.number().nullish(),
    low: z.number().nullish(),
    close: z.number().positive(),
    volume: z.number().nullish(),
  }),
);

export function parseFmpHistory(raw: string): PriceBar[] {
  const parsed = fmpHistorySchema.safeParse(parseFmpJson(raw));
  if (!parsed.success) throw new Error("FMP no devolvió un histórico de precios válido");
  return parsed.data
    .map((b) => ({ date: b.date, open: b.open ?? null, high: b.high ?? null, low: b.low ?? null, close: b.close, volume: b.volume ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Respuesta de stable/splits. */
const fmpSplitsSchema = z.array(z.object({ date: isoDate, numerator: z.number().positive(), denominator: z.number().positive() }));

export function parseFmpSplits(raw: string): Split[] {
  const parsed = fmpSplitsSchema.safeParse(parseFmpJson(raw));
  if (!parsed.success) throw new Error("FMP no devolvió un historial de splits válido");
  return parsed.data.sort((a, b) => a.date.localeCompare(b.date));
}

export const fmpProvider: PriceProvider = {
  id: "fmp",
  label: "Financial Modeling Prep",
  quote: async (symbol) => parseFmpQuote(await invoke<string>("price_quote", { provider: "fmp", symbol })),
  history: async (symbol, from) => parseFmpHistory(await invoke<string>("price_history", { provider: "fmp", symbol, from })),
  splits: async (symbol) => parseFmpSplits(await invoke<string>("price_splits", { provider: "fmp", symbol })),
};

export function providerFor(id: string | null): PriceProvider | null {
  return id === "fmp" ? fmpProvider : null;
}
