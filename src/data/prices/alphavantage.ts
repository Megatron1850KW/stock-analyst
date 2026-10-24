import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { PriceBar, PriceHistory, PriceProvider, Quote, Split, SymbolTarget } from "./provider";

/**
 * Alpha Vantage (plan gratuito): precios de las bolsas europeas, que Tiingo no
 * cubre. Límites: 25 consultas al día. Por eso:
 * - el símbolo de cada valor se busca una sola vez y se guarda (SYMBOL_SEARCH);
 * - el histórico son dos consultas (velas semanales y mensuales completas; el
 *   diario completo es de pago) y se renueva como mucho una vez al mes.
 *
 * Sus velas «ajustadas» lo están por splits y por dividendos. La app ajusta
 * solo por splits (como con Tiingo), así que los splits se deducen del salto
 * entre el cierre real y el ajustado, y se aplican al cierre real.
 */

/** Se agotaron las consultas gratuitas del día: no tiene sentido seguir pidiendo. */
export class ProviderLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderLimitError";
  }
}

const num = z.string().transform((s, ctx) => {
  const n = Number(s);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "no es un número" });
    return z.NEVER;
  }
  return n;
});

/** JSON de Alpha Vantage, con sus errores (llegan con estado 200) traducidos. */
function parseAvJson(raw: string, symbol: string): Record<string, unknown> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Alpha Vantage devolvió una respuesta que no es JSON");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Alpha Vantage devolvió una respuesta inesperada");
  const obj = json as Record<string, unknown>;
  const info = String(obj.Information ?? obj.Note ?? "");
  if (info) {
    if (/premium/i.test(info) && !/per day|rate limit/i.test(info)) throw new Error("Alpha Vantage solo da este dato en su plan de pago.");
    if (/per day|rate limit|requests/i.test(info)) {
      throw new ProviderLimitError("Se han agotado las 25 consultas gratuitas de hoy en Alpha Vantage. Los precios europeos que faltan se completarán mañana.");
    }
    if (/api ?key/i.test(info)) throw new Error("Alpha Vantage no acepta la clave guardada. Revísala en Ajustes.");
    throw new Error(`Alpha Vantage: ${info.slice(0, 160)}`);
  }
  if ("Error Message" in obj) throw new Error(`Alpha Vantage no reconoce el símbolo ${symbol}.`);
  return obj;
}

const quoteSchema = z.object({
  "Global Quote": z.object({
    "01. symbol": z.string(),
    "02. open": num.nullish(),
    "03. high": num.nullish(),
    "04. low": num.nullish(),
    "05. price": num,
    "06. volume": num.nullish(),
    "07. latest trading day": z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

export function parseAvQuote(raw: string, symbol: string): Quote {
  const obj = parseAvJson(raw, symbol);
  const gq = obj["Global Quote"];
  if (gq && typeof gq === "object" && Object.keys(gq).length === 0) throw new Error(`Alpha Vantage no tiene cotización de ${symbol}.`);
  const parsed = quoteSchema.safeParse(obj);
  if (!parsed.success) throw new Error("Alpha Vantage no devolvió una cotización válida");
  const q = parsed.data["Global Quote"];
  return {
    symbol: q["01. symbol"],
    price: q["05. price"],
    open: q["02. open"] ?? null,
    high: q["03. high"] ?? null,
    low: q["04. low"] ?? null,
    volume: q["06. volume"] ?? null,
    date: q["07. latest trading day"],
  };
}

const seriesRowSchema = z.object({
  "1. open": num,
  "2. high": num,
  "3. low": num,
  "4. close": num,
  "5. adjusted close": num,
  "6. volume": num.nullish(),
});

export interface AvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted: number;
  volume: number | null;
}

export function parseAvSeries(raw: string, symbol: string, interval: "weekly" | "monthly"): AvRow[] {
  const obj = parseAvJson(raw, symbol);
  const key = interval === "weekly" ? "Weekly Adjusted Time Series" : "Monthly Adjusted Time Series";
  const parsed = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), seriesRowSchema).safeParse(obj[key]);
  if (!parsed.success) throw new Error(`Alpha Vantage no devolvió un histórico válido de ${symbol}`);
  return Object.entries(parsed.data)
    .map(([date, r]) => ({
      date,
      open: r["1. open"],
      high: r["2. high"],
      low: r["3. low"],
      close: r["4. close"],
      adjusted: r["5. adjusted close"],
      volume: r["6. volume"] ?? null,
    }))
    .filter((r) => r.close > 0 && r.adjusted > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Fracción sencilla (hasta 50/10) más cercana a `x`, si está a menos de un 3 %. */
function niceRatio(x: number): { numerator: number; denominator: number } | null {
  let best: { numerator: number; denominator: number; err: number } | null = null;
  for (let d = 1; d <= 10; d++) {
    const n = Math.round(x * d);
    if (n < 1 || n > 50) continue;
    const err = Math.abs(n / d / x - 1);
    if (!best || err < best.err - 1e-9) best = { numerator: n, denominator: d, err };
  }
  return best && best.err < 0.03 ? { numerator: best.numerator, denominator: best.denominator } : null;
}

/**
 * Splits deducidos de una serie: el cociente ajustado/real cambia poco de una
 * vela a otra con los dividendos (unos pocos %), pero salta de golpe (×2, ×3,
 * ×1/10…) en un split. La fecha es la de la vela en que ocurre.
 */
export function detectSplits(rows: AvRow[]): Split[] {
  const splits: Split[] = [];
  for (let k = 1; k < rows.length; k++) {
    const jump = rows[k]!.adjusted / rows[k]!.close / (rows[k - 1]!.adjusted / rows[k - 1]!.close);
    if (jump > 1.25 || jump < 0.8) {
      const r = niceRatio(jump);
      if (r && !(r.numerator === r.denominator)) splits.push({ date: rows[k]!.date, ...r });
    }
  }
  return splits;
}

/**
 * Velas ajustadas solo por splits: cada vela anterior a un split se divide por
 * su factor. En la vela del propio split la apertura, el máximo y el mínimo
 * mezclan precios de antes y después, así que se dejan vacíos.
 */
export function splitAdjusted(rows: AvRow[], splits: Split[]): PriceBar[] {
  return rows.map((r, k) => {
    const factor = splits.filter((s) => s.date > r.date).reduce((f, s) => f * (s.numerator / s.denominator), 1);
    const inside = splits.some((s) => s.date === r.date) && k > 0;
    return {
      date: r.date,
      open: inside ? null : r.open / factor,
      high: inside ? null : r.high / factor,
      low: inside ? null : r.low / factor,
      close: r.close / factor,
      volume: r.volume === null ? null : r.volume * factor,
    };
  });
}

/* ---------- Búsqueda del símbolo ---------- */

const searchSchema = z.object({
  bestMatches: z.array(
    z.object({
      "1. symbol": z.string(),
      "2. name": z.string(),
      "3. type": z.string().nullish(),
      "4. region": z.string(),
      "8. currency": z.string(),
    }),
  ),
});

export type AvMatch = { symbol: string; name: string; type: string | null; region: string; currency: string };

export function parseAvSearch(raw: string): AvMatch[] {
  const parsed = searchSchema.safeParse(parseAvJson(raw, ""));
  if (!parsed.success) throw new Error("Alpha Vantage devolvió una búsqueda con formato inesperado");
  return parsed.data.bestMatches.map((m) => ({ symbol: m["1. symbol"], name: m["2. name"], type: m["3. type"] ?? null, region: m["4. region"], currency: m["8. currency"] }));
}

/** Cómo llama Alpha Vantage a cada bolsa (códigos de bolsa de OpenFIGI). */
const AV_REGIONS: Record<string, string[]> = {
  SM: ["spain", "madrid"], SQ: ["spain", "madrid"], GY: ["xetra", "germany"], GR: ["frankfurt", "xetra", "germany"], GF: ["frankfurt", "germany"],
  FP: ["paris", "france"], NA: ["amsterdam", "netherlands"], IM: ["milan", "italy"], BB: ["brussels", "belgium"], PL: ["lisbon", "portugal"],
  ID: ["dublin", "ireland"], FH: ["helsinki", "finland"], AV: ["vienna", "austria"], LN: ["united kingdom", "london"],
  SW: ["switzerland", "swiss"], SE: ["switzerland", "swiss"], SS: ["stockholm", "sweden"], DC: ["copenhagen", "denmark"], NO: ["oslo", "norway"],
};

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Alpha Vantage llama GBX a los peniques que OpenFIGI llama GBp. */
const currencyCode = (c: string) => (c === "GBp" || c.toUpperCase() === "GBX" ? "GBX" : c.toUpperCase());
const sameCurrency = (a: string, b: string) => currencyCode(a) === currencyCode(b);
const nameWords = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !["the", "group", "holding", "holdings"].includes(w));

/**
 * Elige el símbolo de Alpha Vantage de un valor europeo: la bolsa (región)
 * y el ticker, o la divisa y el nombre, deben coincidir. Null si no hay uno
 * claro: mejor sin precio que con el de otra empresa.
 */
export function pickAvSymbol(matches: AvMatch[], target: SymbolTarget): string | null {
  const regions = AV_REGIONS[target.exchange ?? ""] ?? [];
  const legal = new Set(nameWords(target.name));
  let best: { symbol: string; score: number } | null = null;
  for (const m of matches) {
    if (m.type && !/equity/i.test(m.type)) continue;
    const region = regions.some((r) => m.region.toLowerCase().includes(r));
    const ticker = compact(m.symbol.split(".")[0]!) === compact(target.ticker);
    const currency = sameCurrency(target.currency, m.currency);
    const name = nameWords(m.name).some((w) => legal.has(w));
    const score = (region ? 3 : 0) + (ticker ? 3 : 0) + (currency ? 2 : 0) + (name ? 2 : 0);
    const ok = (region && (ticker || name)) || (currency && ticker && name);
    if (ok && (!best || score > best.score)) best = { symbol: m.symbol, score };
  }
  return best?.symbol ?? null;
}

export const alphaVantageProvider: PriceProvider = {
  id: "alphavantage",
  label: "Alpha Vantage",
  quote: async (symbol) => parseAvQuote(await invoke<string>("price_quote", { provider: "alphavantage", symbol }), symbol),
  history: async (symbol, from): Promise<PriceHistory> => {
    const series = async (interval: "weekly" | "monthly") =>
      parseAvSeries(await invoke<string>("price_series", { provider: "alphavantage", symbol, interval }), symbol, interval);
    const weeklyRows = await series("weekly");
    const monthlyRows = await series("monthly");
    // Cada serie con sus propios splits: la vela del split es distinta en cada una
    const splits = detectSplits(weeklyRows);
    const since = (bars: PriceBar[]) => bars.filter((b) => b.date >= from);
    const weekly = since(splitAdjusted(weeklyRows, splits));
    return { bars: weekly, weekly, monthly: since(splitAdjusted(monthlyRows, detectSplits(monthlyRows))), splits };
  },
  // Comprobado con datos reales (24-10-2026): no tiene Inditex, e Iberdrola solo fuera de España
  unsupported: (target) =>
    target.exchange === "SM" || target.exchange === "SQ" ? "Alpha Vantage no cubre la Bolsa de Madrid: por ahora va sin precio." : null,
  resolveSymbol: async (target) => {
    const search = async (keywords: string) => parseAvSearch(await invoke<string>("price_search", { provider: "alphavantage", keywords }));
    const byTicker = pickAvSymbol(await search(target.ticker), target);
    if (byTicker) return byTicker;
    const words = target.name.replace(/[^\p{L}\p{N} .&-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
    return words ? pickAvSymbol(await search(words), target) : null;
  },
};
