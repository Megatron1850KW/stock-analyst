import { looksLikeIsin } from "./import-us";

/**
 * Lo que el usuario escribe en «Ticker o ISIN». Admite varios valores de golpe
 * (separados por «;», «,» o saltos de línea) y el prefijo de bolsa con el que
 * suelen aparecer en webs y brókeres («NYSE: V (Visa)», «ETR: BMW»).
 */

export type WatchlistEntry =
  | { raw: string; kind: "isin"; isin: string }
  | { raw: string; kind: "us"; ticker: string }
  /** Acción europea por ticker: sin ISIN no se puede identificar al emisor sin ambigüedad. */
  | { raw: string; kind: "eu-ticker"; ticker: string; exchange: string };

const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "NYSEARCA", "NYSEAMERICAN", "AMEX", "BATS", "CBOE", "OTC", "OTCMKTS"]);

/** Prefijos de bolsas europeas (Google Finance, TradingView…) → nombre en llano. */
const EU_EXCHANGES: Record<string, string> = {
  ETR: "Xetra", XETRA: "Xetra", XETR: "Xetra", FRA: "Fráncfort", EPA: "París", BIT: "Milán", BME: "Madrid", AMS: "Ámsterdam",
  EBR: "Bruselas", ELI: "Lisboa", LON: "Londres", LSE: "Londres", SWX: "Suiza", VTX: "Suiza", STO: "Estocolmo",
  CPH: "Copenhague", OSL: "Oslo", HEL: "Helsinki", VIE: "Viena", ISE: "Dublín",
};

export function splitWatchlistInput(text: string): string[] {
  return text
    .split(/[;\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseWatchlistEntry(raw: string): WatchlistEntry {
  // «NYSE: V (Visa)» → sin el nombre entre paréntesis
  const clean = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const m = /^([A-Z]+)\s*:\s*(\S+)$/.exec(clean);
  if (m) {
    const [, prefix, symbol] = m as unknown as [string, string, string];
    if (looksLikeIsin(symbol)) return { raw, kind: "isin", isin: symbol };
    if (US_EXCHANGES.has(prefix)) return { raw, kind: "us", ticker: symbol };
    if (prefix in EU_EXCHANGES) return { raw, kind: "eu-ticker", ticker: symbol, exchange: EU_EXCHANGES[prefix]! };
    return { raw, kind: "us", ticker: symbol };
  }
  if (looksLikeIsin(clean)) return { raw, kind: "isin", isin: clean };
  return { raw, kind: "us", ticker: clean.replace(/\s+/g, "") };
}
