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

/** Importes grandes en millones: 391.035 M$ (sin decimales). */
export function formatMillions(value: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : ` ${currency}`;
  return `${formatNumber(value / 1e6, Math.abs(value) < 1e7 ? 1 : 0)} M${symbol}`;
}

/** Fecha corta en español: «31 dic 2025». */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
    .replace(".", "");
}

/** Mes y año: «dic 2025». */
export function formatMonthYear(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
    .replace(".", "");
}

/**
 * Número escrito a la española o a la inglesa: «1.234,56», «1234,56» o «1234.56».
 * Null si no es un número.
 */
export function parseDecimal(raw: string): number | null {
  let s = raw.trim().replace(/\s|€|\$/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
