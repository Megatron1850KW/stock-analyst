import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";
import { esefFilingsSchema, figiSchema, gleifSchema, xbrlJsonSchema, type EsefFiling, type FigiRow, type XbrlJson } from "./schemas";

/** Acceso a las fuentes europeas. La implementación real pasa por Rust (URLs fijas y límites de ritmo). */
export interface EuClient {
  /** LEI y nombre legal del emisor de un ISIN (GLEIF); null si no consta. */
  leiByIsin(isin: string): Promise<{ lei: string; name: string; country: string | null } | null>;
  /** Líneas de cotización de un ISIN (OpenFIGI). */
  figi(isin: string): Promise<FigiRow[]>;
  /** Informes ESEF publicados por un LEI (filings.xbrl.org). */
  esefFilings(lei: string): Promise<EsefFiling[]>;
  /** xBRL-JSON de un informe (json_url); se guarda en el Mac la primera vez. */
  esefDocument(path: string): Promise<XbrlJson>;
}

export class EuFormatError extends Error {
  constructor(what: string, issues: string) {
    super(`${what} llegó con un formato inesperado. No se ha guardado nada.`);
    this.name = "EuFormatError";
    console.error(`[eu] ${what}: ${issues}`);
  }
}

function parse<T extends z.ZodType>(schema: T, raw: string, what: string): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new EuFormatError(what, "JSON no válido");
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new EuFormatError(what, result.error.message);
  return result.data;
}

export const parseGleif = (raw: string) => {
  const rec = parse(gleifSchema, raw, "El registro LEI (GLEIF)").data[0]?.attributes;
  if (!rec) return null;
  return { lei: rec.lei, name: rec.entity.legalName.name, country: rec.entity.legalAddress?.country ?? rec.entity.jurisdiction ?? null };
};
export const parseFigi = (raw: string) => parse(figiSchema, raw, "La respuesta de OpenFIGI")[0]?.data ?? [];
export const parseEsefFilings = (raw: string) => parse(esefFilingsSchema, raw, "La lista de informes ESEF").data;
export const parseXbrlJson = (raw: string) => parse(xbrlJsonSchema, raw, "El informe ESEF (xBRL-JSON)");

export function tauriEuClient(): EuClient {
  const fetchRaw = (resource: string, id: string) => invoke<string>("eu_fetch", { resource, id });
  return {
    leiByIsin: async (isin) => parseGleif(await fetchRaw("lei_by_isin", isin)),
    figi: async (isin) => parseFigi(await fetchRaw("figi", isin)),
    esefFilings: async (lei) => parseEsefFilings(await fetchRaw("esef_filings", lei)),
    esefDocument: async (path) => parseXbrlJson((await invoke<{ text: string }>("esef_document", { path })).text),
  };
}

/** XHTML de un informe ESEF (report_url completa), para los extractos de texto que lee la IA. Se guarda en el Mac. */
export const fetchEsefReport = async (url: string) => (await invoke<{ text: string }>("esef_report", { url })).text;
