/**
 * Formato numérico español (1.234,56 €). `useGrouping: "always"` es necesario
 * porque es-ES por defecto no agrupa números de 4 cifras (1234 en vez de 1.234).
 */
const LOCALE = "es-ES";

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: "always",
  }).format(value);
}

export function formatCurrency(value: number, currency = "EUR", decimals = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: "always",
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: "always",
  }).format(value);
}

/** Texto a mostrar cuando una cifra no está en ninguna fuente (CLAUDE.md §2.1). */
export const SIN_DATO = "Sin dato";

export function formatOrMissing(value: number | null | undefined, fmt: (v: number) => string): string {
  return value === null || value === undefined || Number.isNaN(value) ? SIN_DATO : fmt(value);
}
