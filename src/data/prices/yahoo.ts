import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { PriceBar, PriceHistory, PriceProvider, Quote, Split, SymbolTarget } from "./provider";

/**
 * Yahoo Finance como respaldo de Alpha Vantage para las bolsas europeas: sin
 * clave ni cupo publicado, con Madrid incluida y décadas de histórico. No es
 * una API oficial (puede cambiar o limitarse sin aviso), así que solo entra
 * cuando Alpha Vantage no tiene el valor o se ha agotado su cupo.
 *
 * Sus cierres («close») ya vienen ajustados por splits y no por dividendos,
 * igual que los guarda la app.
 */

/** Sufijo de Yahoo para cada bolsa (códigos de OpenFIGI). */
export const YAHOO_SUFFIX: Record<string, string> = {
  SM: "MC", SQ: "MC", GY: "DE", GR: "DE", GF: "F", FP: "PA", NA: "AS", IM: "MI", BB: "BR", PL: "LS", ID: "IR",
  FH: "HE", AV: "VI", LN: "L", SW: "SW", SE: "SW", SS: "ST", DC: "CO", NO: "OL",
};

/** Símbolo de Yahoo de un valor europeo (ticker + sufijo de su bolsa), o null si su bolsa no está en la tabla. */
export function yahooSymbol(target: SymbolTarget): string | null {
  const suffix = YAHOO_SUFFIX[target.exchange ?? ""];
  const ticker = target.ticker.trim().toUpperCase().replace(/\//g, "-").replace(/\s+/g, "-");
  if (!suffix || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) return null;
  return `${ticker}.${suffix}`;
}

const n = z.number().nullable().optional();
const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string(),
            currency: z.string().nullish(),
            regularMarketPrice: z.number().nullish(),
            regularMarketTime: z.number().nullish(),
            exchangeTimezoneName: z.string().nullish(),
          }),
          timestamp: z.array(z.number()).optional(),
          events: z.object({ splits: z.record(z.string(), z.object({ date: z.number(), numerator: z.number(), denominator: z.number() })).optional() }).nullish(),
          indicators: z.object({ quote: z.array(z.object({ open: z.array(n).optional(), high: z.array(n).optional(), low: z.array(n).optional(), close: z.array(n).optional(), volume: z.array(n).optional() })) }),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string().nullish(), description: z.string().nullish() }).nullable().optional(),
  }),
});

export type YahooChart = NonNullable<z.infer<typeof chartSchema>["chart"]["result"]>[number];

export function parseYahooChart(raw: string, symbol: string): YahooChart {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Yahoo Finance devolvió una respuesta que no es JSON");
  }
  const parsed = chartSchema.safeParse(json);
  if (!parsed.success) throw new Error("Yahoo Finance devolvió una respuesta con formato inesperado");
  const { result, error } = parsed.data.chart;
  if (error || !result?.[0]) throw new Error(`Yahoo Finance no tiene ${symbol}${error?.description ? ` (${error.description.slice(0, 80)})` : ""}.`);
  return result[0];
}

/** Fecha AAAA-MM-DD de un instante en la zona horaria de la bolsa. */
function localDate(seconds: number, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(seconds * 1000));
  } catch {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }
}

export function yahooBars(chart: YahooChart): PriceBar[] {
  const ts = chart.timestamp ?? [];
  const q = chart.indicators.quote[0] ?? {};
  const tz = chart.meta.exchangeTimezoneName;
  const bars: PriceBar[] = [];
  ts.forEach((t, k) => {
    const close = q.close?.[k];
    if (close == null || !(close > 0)) return;
    bars.push({ date: localDate(t, tz), open: q.open?.[k] ?? null, high: q.high?.[k] ?? null, low: q.low?.[k] ?? null, close, volume: q.volume?.[k] ?? null });
  });
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

export function yahooSplits(chart: YahooChart): Split[] {
  return Object.values(chart.events?.splits ?? {})
    .filter((s) => s.numerator > 0 && s.denominator > 0)
    .map((s) => ({ date: localDate(s.date, chart.meta.exchangeTimezoneName), numerator: s.numerator, denominator: s.denominator }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function yahooQuote(chart: YahooChart): Quote {
  const bars = yahooBars(chart);
  const last = bars.at(-1);
  const price = chart.meta.regularMarketPrice ?? last?.close;
  if (!price || !(price > 0)) throw new Error(`Yahoo Finance no tiene cotización de ${chart.meta.symbol}.`);
  const date = chart.meta.regularMarketTime ? localDate(chart.meta.regularMarketTime, chart.meta.exchangeTimezoneName) : last!.date;
  const sameDay = last?.date === date ? last : null;
  return { symbol: chart.meta.symbol, price, open: sameDay?.open ?? null, high: sameDay?.high ?? null, low: sameDay?.low ?? null, volume: sameDay?.volume ?? null, date };
}

/** Yahoo llama GBp a los peniques de Londres, igual que OpenFIGI. */
const sameCurrency = (a: string | null | undefined, b: string) => !a || a.toUpperCase() === b.toUpperCase();

const chart = async (symbol: string, interval: "quote" | "weekly" | "monthly") => parseYahooChart(await invoke<string>("price_series", { provider: "yahoo", symbol, interval }), symbol);

export const yahooProvider: PriceProvider = {
  id: "yahoo",
  label: "Yahoo Finance",
  quote: async (symbol) => yahooQuote(await chart(symbol, "quote")),
  history: async (symbol, from): Promise<PriceHistory> => {
    const weeklyChart = await chart(symbol, "weekly");
    const monthlyChart = await chart(symbol, "monthly");
    const since = (bars: PriceBar[]) => bars.filter((b) => b.date >= from);
    const weekly = since(yahooBars(weeklyChart));
    return { bars: weekly, weekly, monthly: since(yahooBars(monthlyChart)), splits: yahooSplits(monthlyChart) };
  },
  resolveSymbol: async (target) => {
    const symbol = yahooSymbol(target);
    if (!symbol) return null;
    try {
      const c = await chart(symbol, "quote");
      // Misma divisa: si no, es otro valor (u otra línea) con el mismo ticker
      return sameCurrency(c.meta.currency, target.currency) ? symbol : null;
    } catch {
      return null;
    }
  },
};
