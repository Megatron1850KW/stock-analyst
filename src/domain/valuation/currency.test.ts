import { describe, expect, it } from "vitest";
import { FxTable } from "@/domain/portfolio/fx";
import { convert, pricesInReportingCurrency } from "./currency";

// Tipos FICTICIOS (base EUR): 1 € = 0,85 £ = 1,10 $
const fx = new FxTable([
  { date: "2026-09-30", quote: "GBP", rate: 0.85 },
  { date: "2026-09-30", quote: "USD", rate: 1.1 },
  { date: "2026-10-23", quote: "GBP", rate: 0.8 },
  { date: "2026-10-23", quote: "USD", rate: 1.2 },
]);
const price = { value: 5000, date: "2026-10-23", currency: "GBp", source: "test", fetchedAt: "" };

describe("precio en la divisa de las cuentas", () => {
  it("peniques → dólares al tipo del BCE de esa fecha", () => {
    // 5.000 p = 50 £ = 62,5 € = 75 $
    expect(convert(5000, "GBp", "USD", "2026-10-23", fx)!.value).toBeCloseTo(75, 9);
    expect(convert(100, "EUR", "USD", "2026-10-25", fx)).toEqual({ value: expect.closeTo(120, 9), rateDate: "2026-10-23" });
  });

  it("misma divisa en otra unidad no necesita tipo", () => {
    expect(convert(5000, "GBp", "GBP", "2026-10-23", null)).toEqual({ value: 50, rateDate: null });
  });

  it("sin tipo no se inventa nada", () => {
    expect(convert(100, "EUR", "USD", "2020-01-01", fx)).toBeNull();
    const r = pricesInReportingCurrency(price, [{ date: "2026-09-30", close: 4000 }], "USD", null);
    expect(r.unresolved).toBe(true);
    expect(r.price).toBe(price);
    expect(r.monthly).toEqual([]);
  });

  it("pasa el precio y los cierres mensuales, y quita los meses sin tipo", () => {
    const r = pricesInReportingCurrency(price, [{ date: "2015-01-31", close: 3000 }, { date: "2026-09-30", close: 4000 }], "USD", fx);
    expect(r.unresolved).toBe(false);
    expect(r.price.currency).toBe("USD");
    expect(r.price.value).toBeCloseTo(75, 9);
    expect(r.price.note).toContain("23-10-2026");
    // 4.000 p = 40 £ = 47,06 € = 51,76 $
    expect(r.monthly).toHaveLength(1);
    expect(r.monthly[0]!.close).toBeCloseTo((40 / 0.85) * 1.1, 9);
  });

  it("si ya coincide, no toca nada", () => {
    const usd = { ...price, currency: "USD" };
    expect(pricesInReportingCurrency(usd, [], "USD", fx).price).toBe(usd);
  });
});
