import type { Input, Metric, MetricKind } from "@/domain/fundamentals/metrics";
import { formatMillions, formatNumber, formatPercent, SIN_DATO } from "@/lib/format";

/** Nombre en llano de un tipo de informe. */
export function formLabel(form: string): string {
  return form === "ESEF" ? "Informe anual ESEF" : form;
}

/** De dónde sale una cifra, para los tooltips de origen (CLAUDE.md §2.2). */
export function sourceLabel(source: string | undefined): string {
  if (source === "filings.xbrl.org") return "Informe oficial ESEF (filings.xbrl.org)";
  if (source === "user-upload") return "Documento subido por ti";
  return "SEC EDGAR (XBRL)";
}

export const currencySymbol = (c: string) => (c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : c);

/** Formato de una cifra según su tipo, en español. */
export function formatKind(value: number | null, kind: MetricKind, unit = "USD"): string {
  if (value === null || !Number.isFinite(value)) return SIN_DATO;
  switch (kind) {
    case "money":
      return formatMillions(value, unit);
    case "percent":
      return formatPercent(value, Math.abs(value) >= 10 ? 0 : 1);
    case "multiple":
      return formatNumber(value, 1);
    case "years":
      return `${formatNumber(value, 1)} años`;
    case "shares":
      return `${formatNumber(value / 1e6, 0)} M`;
  }
}

export const formatMetric = (m: Metric, unit?: string) => formatKind(m.value, m.kind, unit ?? m.inputs[0]?.unit ?? "USD");

export function formatInput(i: Input): string {
  if (i.unit === "shares") return formatKind(i.value, "shares");
  if (/^[A-Z]{3}$/.test(i.unit) && Math.abs(i.value) < 1e5) return `${formatNumber(i.value, 2)} ${currencySymbol(i.unit)}`;
  return formatMillions(i.value, i.unit);
}

/** Texto de % con signo: «+12 %», «−3,5 %». */
export function signedPercent(v: number): string {
  const s = formatPercent(Math.abs(v), Math.abs(v) >= 0.1 ? 0 : 1);
  return `${v < 0 ? "−" : "+"}${s}`;
}
