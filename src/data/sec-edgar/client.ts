import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";
import {
  companyFactsSchema,
  filingColumnsSchema,
  submissionsSchema,
  tickersExchangeSchema,
  type CompanyFacts,
  type FilingColumns,
  type Submissions,
  type TickersExchange,
} from "./schemas";

/** Acceso a EDGAR. La implementación real pasa por Rust (User-Agent y límite de 10 peticiones/s). */
export interface SecClient {
  tickers(): Promise<TickersExchange>;
  submissions(cik: string): Promise<Submissions>;
  submissionsFile(name: string): Promise<FilingColumns>;
  companyFacts(cik: string): Promise<CompanyFacts>;
  /** HTML de un informe (se guarda en el Mac la primera vez). Opcional en los tests. */
  document?(url: string): Promise<string>;
}

export class SecFormatError extends Error {
  constructor(what: string, issues: string) {
    super(`La SEC devolvió ${what} con un formato inesperado. No se ha guardado nada.`);
    this.name = "SecFormatError";
    console.error(`[sec] ${what}: ${issues}`);
  }
}

function parse<T extends z.ZodType>(schema: T, raw: string, what: string): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SecFormatError(what, "JSON no válido");
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new SecFormatError(what, result.error.message);
  return result.data;
}

export function tauriSecClient(userAgent: string): SecClient {
  const fetchRaw = (resource: string, args: { cik?: string; file?: string } = {}) =>
    invoke<string>("sec_fetch", { resource, cik: args.cik ?? null, file: args.file ?? null, userAgent });
  return {
    tickers: async () => parse(tickersExchangeSchema, await fetchRaw("tickers"), "la lista de tickers"),
    submissions: async (cik) => parse(submissionsSchema, await fetchRaw("submissions", { cik }), "la lista de informes"),
    submissionsFile: async (file) =>
      parse(filingColumnsSchema, await fetchRaw("submissions_file", { file }), "la lista de informes antiguos"),
    companyFacts: async (cik) => parse(companyFactsSchema, await fetchRaw("company_facts", { cik }), "los datos XBRL"),
    document: async (url) => (await fetchSecDocument(url, userAgent)).html,
  };
}

export interface TickerMatch {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
}

/** Busca un ticker (sin distinguir mayúsculas; BRK.B y BRK-B son equivalentes). */
export function findTicker(list: TickersExchange, ticker: string): TickerMatch | null {
  const idx = (f: string) => list.fields.indexOf(f);
  const [iCik, iName, iTicker, iExchange] = [idx("cik"), idx("name"), idx("ticker"), idx("exchange")];
  if (iCik < 0 || iTicker < 0) throw new SecFormatError("la lista de tickers", "faltan columnas cik/ticker");
  const wanted = ticker.trim().toUpperCase().replace(/\./g, "-");
  for (const row of list.data) {
    const t = String(row[iTicker] ?? "").toUpperCase().replace(/\./g, "-");
    if (t === wanted) {
      return {
        cik: String(row[iCik]),
        name: String(row[iName] ?? ""),
        ticker: String(row[iTicker]),
        exchange: iExchange >= 0 && row[iExchange] != null ? String(row[iExchange]) : null,
      };
    }
  }
  return null;
}

/** URL pública del documento principal de una presentación. */
export function filingUrl(cik: string, accession: string, primaryDocument: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${primaryDocument}`;
}

export interface SecDocument {
  html: string;
  /** Copia local en la carpeta de datos de la app ("" si no se pudo guardar). */
  path: string;
  /** Ya estaba guardado: no se ha pedido nada a la SEC. */
  cached: boolean;
}

/** HTML de un informe (10-K, 10-Q, 20-F). Se descarga una vez y se guarda en el Mac. */
export function fetchSecDocument(url: string, userAgent: string): Promise<SecDocument> {
  return invoke<SecDocument>("sec_document", { url, userAgent });
}
