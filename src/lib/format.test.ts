import { describe, expect, it } from "vitest";
import { parseDecimal, formatCurrency, formatNumber, formatOrMissing, formatPercent, SIN_DATO } from "./format";

// Intl usa espacio duro (U+00A0) entre cifra y símbolo
const nbsp = (s: string) => s.replace(/ /g, " ");

describe("formato español", () => {
  it("agrupa miles con punto y decimales con coma", () => {
    expect(formatNumber(1234.56)).toBe("1.234,56");
    expect(formatNumber(1234567.891, 1)).toBe("1.234.567,9");
  });

  it("formatea euros como 1.234,56 €", () => {
    expect(nbsp(formatCurrency(1234.56))).toBe("1.234,56 €");
  });

  it("formatea otras divisas", () => {
    expect(nbsp(formatCurrency(1000, "USD"))).toBe("1.000,00 US$");
  });

  it("formatea porcentajes", () => {
    expect(nbsp(formatPercent(0.123))).toBe("12,3 %");
  });

  it("muestra 'Sin dato' si falta la cifra", () => {
    expect(formatOrMissing(null, formatNumber)).toBe(SIN_DATO);
    expect(formatOrMissing(undefined, formatNumber)).toBe(SIN_DATO);
    expect(formatOrMissing(Number.NaN, formatNumber)).toBe(SIN_DATO);
    expect(formatOrMissing(2, (v) => formatNumber(v, 0))).toBe("2");
  });
});

describe("importes y fechas", () => {
  it("muestra importes en millones", async () => {
    const { formatMillions } = await import("./format");
    expect(nbsp(formatMillions(391_035_000_000, "USD"))).toBe("391.035 M$");
    expect(nbsp(formatMillions(4_500_000, "EUR"))).toBe("4,5 M€");
  });

  it("formatea fechas en español", async () => {
    const { formatDate, formatMonthYear } = await import("./format");
    expect(formatDate("2025-12-31")).toBe("31 dic 2025");
    expect(formatMonthYear("2026-06-30")).toBe("jun 2026");
  });
});

describe("parseDecimal", () => {
  it("entiende comas y puntos", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1234,5")).toBe(1234.5);
    expect(parseDecimal("1234.5")).toBe(1234.5);
    expect(parseDecimal("1.234")).toBe(1234);
    expect(parseDecimal("0.5")).toBe(0.5);
    expect(parseDecimal("12 €")).toBe(12);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
  });
});
