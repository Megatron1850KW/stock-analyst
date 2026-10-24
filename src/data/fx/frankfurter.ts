import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { FxRate } from "@/domain/portfolio/fx";

/**
 * Tipos de referencia del BCE vía Frankfurter (CLAUDE.md §4.3). Base EUR:
 * `rate` = unidades de la divisa por 1 €.
 */

export const FX_SOURCE = "BCE (vía Frankfurter)";

const seriesSchema = z.object({
  base: z.literal("EUR"),
  rates: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive())),
});

export class FxFormatError extends Error {
  constructor(issues: string) {
    super("Los tipos de cambio del BCE llegaron con un formato inesperado. No se ha guardado nada.");
    this.name = "FxFormatError";
    console.error(`[fx] ${issues}`);
  }
}

export function parseFxSeries(raw: string): FxRate[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new FxFormatError("JSON no válido");
  }
  const r = seriesSchema.safeParse(json);
  if (!r.success) throw new FxFormatError(r.error.message);
  return Object.entries(r.data.rates)
    .flatMap(([date, byQuote]) => Object.entries(byQuote).map(([quote, rate]) => ({ date, quote, rate })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.quote.localeCompare(b.quote));
}

export interface FxClient {
  /** Tipos diarios desde `from` hasta hoy para esas divisas. */
  series(from: string, currencies: string[]): Promise<FxRate[]>;
}

export const tauriFxClient = (): FxClient => ({
  series: async (from, currencies) => parseFxSeries(await invoke<string>("fx_series", { from, symbols: currencies.join(",") })),
});
