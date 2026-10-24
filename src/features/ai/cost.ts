/**
 * Coste de las llamadas a Claude (CLAUDE.md §7: presupuesto mensual).
 * Precios oficiales en dólares por millón de tokens. Revisar si Anthropic los cambia.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Escribir en caché cuesta 1,25 veces la entrada (caché de 5 minutos). */
  cacheWrite: number;
}

const price = (input: number, output: number, cacheRead: number): ModelPrice => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

export const MODEL_PRICES_USD: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": price(2, 10, 0.2),
  "claude-haiku-5-5": price(0.1, 0.5, 0.01),
  "claude-opus-5-5": price(4, 20, 0.2),
  // Posibles modelos de respaldo si el principal declina una petición
  "claude-opus-5": price(5, 25, 0.5),
  "claude-opus-4-8": price(5, 25, 0.5),
};
/** Para un modelo desconocido se usa el precio más alto: mejor sobrestimar el gasto. */
const FALLBACK_PRICE = price(5, 25, 0.5);

export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES_USD[model] ?? FALLBACK_PRICE;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(usage: TokenUsage, model: string): number {
  const p = priceFor(model);
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

/**
 * Dólares → euros con el último tipo del BCE guardado (EUR→USD). Sin tipo
 * guardado se cuenta 1 $ = 1 €, que sobrestima el gasto mientras el euro valga
 * más que el dólar; la UI lo indica.
 */
export function usdToEur(usd: number, eurUsdRate: number | null): { eur: number; approx: boolean } {
  return eurUsdRate && eurUsdRate > 0 ? { eur: usd / eurUsdRate, approx: false } : { eur: usd, approx: true };
}

/** Estimación previa: ~4 caracteres por token de entrada y un máximo razonable de salida. */
export function estimateCostUsd(inputChars: number, model: string, expectedOutputTokens = 8000): number {
  return costUsd({ input_tokens: Math.ceil(inputChars / 4), output_tokens: expectedOutputTokens }, model);
}
