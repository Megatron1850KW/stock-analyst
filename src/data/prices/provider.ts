import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { alphaVantageProvider } from "./alphavantage";

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

/** Lo que hace falta para encontrar el símbolo de un valor en un proveedor. */
export interface SymbolTarget {
  ticker: string;
  name: string;
  /** Código de bolsa de OpenFIGI (SM, GY, LN…) o null en EE. UU. */
  exchange: string | null;
  currency: string;
}

export interface PriceProvider {
  id: string;
  label: string;
  quote(symbol: string): Promise<Quote>;
  /**
   * Símbolo del valor en este proveedor, si no basta con el ticker (bolsas
   * europeas). Null si el proveedor no lo cubre. Se guarda: se busca una vez.
   */
  resolveSymbol?(target: SymbolTarget): Promise<string | null>;
  /** Motivo en llano si se sabe de antemano que no cubre el valor (sin gastar consultas). */
  unsupported?(target: SymbolTarget): string | null;
  /**
   * Cierres diarios ajustados por splits desde `from` (AAAA-MM-DD), del más
   * antiguo al más reciente, y los splits del proveedor (null si no los da).
   */
  history(symbol: string, from: string): Promise<PriceHistory>;
}

export interface PriceHistory {
  bars: PriceBar[];
  /** Velas ya agregadas por el proveedor (si no da el diario completo). */
  weekly?: PriceBar[];
  monthly?: PriceBar[];
  splits: Split[] | null;
  /** Por qué faltan los splits, si faltan. */
  splitsError?: string;
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
  history: async (symbol, from) => {
    const bars = parseFmpHistory(await invoke<string>("price_history", { provider: "fmp", symbol, from }));
    try {
      return { bars, splits: parseFmpSplits(await invoke<string>("price_splits", { provider: "fmp", symbol })) };
    } catch (e) {
      return { bars, splits: null, splitsError: e instanceof Error ? e.message : String(e) };
    }
  },
};

/* ---------- Tiingo ---------- */

/** Fila de https://api.tiingo.com/tiingo/daily/<ticker>/prices (precios sin ajustar + factor de split). */
const tiingoRowsSchema = z.array(
  z.object({
    date: isoDate,
    open: z.number().nullish(),
    high: z.number().nullish(),
    low: z.number().nullish(),
    close: z.number().positive(),
    volume: z.number().nullish(),
    splitFactor: z.number().positive().default(1),
  }),
);

function parseTiingoRows(raw: string) {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Tiingo devolvió una respuesta que no es JSON");
  }
  // Tiingo responde {"detail": "..."} cuando la clave o el símbolo no valen
  if (json && typeof json === "object" && !Array.isArray(json) && "detail" in json) {
    throw new Error(`Tiingo rechazó la consulta: ${String((json as Record<string, unknown>).detail).slice(0, 160)}`);
  }
  const parsed = tiingoRowsSchema.safeParse(json);
  if (!parsed.success) throw new Error("Tiingo no devolvió precios válidos para este símbolo");
  return parsed.data.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseTiingoQuote(raw: string, symbol: string): Quote {
  const last = parseTiingoRows(raw).at(-1);
  if (!last) throw new Error("Tiingo no tiene cotización para este símbolo");
  return { symbol, price: last.close, open: last.open ?? null, high: last.high ?? null, low: last.low ?? null, volume: last.volume ?? null, date: last.date };
}

/**
 * Tiingo da precios sin ajustar y el factor de split de cada día. Se ajustan
 * aquí solo por splits (no por dividendos), dividiendo cada día anterior a un
 * split por el producto de los factores posteriores.
 */
export function parseTiingoHistory(raw: string): PriceHistory {
  const rows = parseTiingoRows(raw);
  const splits: Split[] = rows.filter((r) => r.splitFactor !== 1).map((r) => ({ date: r.date, numerator: r.splitFactor, denominator: 1 }));
  const bars: PriceBar[] = new Array(rows.length);
  let factor = 1;
  for (let k = rows.length - 1; k >= 0; k--) {
    const r = rows[k]!;
    const adj = (v: number | null | undefined) => (v === null || v === undefined ? null : v / factor);
    bars[k] = { date: r.date, open: adj(r.open), high: adj(r.high), low: adj(r.low), close: r.close / factor, volume: r.volume == null ? null : r.volume * factor };
    // Los días anteriores al split se dividen también por su factor
    factor *= r.splitFactor;
  }
  return { bars, splits };
}

export const tiingoProvider: PriceProvider = {
  id: "tiingo",
  label: "Tiingo",
  quote: async (symbol) => parseTiingoQuote(await invoke<string>("price_quote", { provider: "tiingo", symbol }), symbol),
  history: async (symbol, from) => parseTiingoHistory(await invoke<string>("price_history", { provider: "tiingo", symbol, from })),
};

const PROVIDERS: Record<string, PriceProvider> = { fmp: fmpProvider, tiingo: tiingoProvider, alphavantage: alphaVantageProvider };

export function providerFor(id: string | null): PriceProvider | null {
  return (id && PROVIDERS[id]) || null;
}

export const providerLabel = (id: string | null | undefined) => (id && PROVIDERS[id]?.label) || id || "";
