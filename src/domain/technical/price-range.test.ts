import { describe, expect, it } from "vitest";
import { priceStats, type WeeklyBar } from "./price-range";

// DATOS FICTICIOS para tests.
function weeks(n: number, end: string, f: (i: number) => number): WeeklyBar[] {
  const t = Date.parse(end);
  return Array.from({ length: n }, (_, i) => {
    const close = f(i);
    return { date: new Date(t - (n - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10), high: close * 1.02, low: close * 0.98, close };
  });
}

describe("rango de 52 semanas y año en curso", () => {
  const bars = weeks(80, "2026-10-23", (i) => 100 + i); // sube 1 a la semana

  it("sitúa el precio dentro de su rango", () => {
    const s = priceStats(bars, { value: 150, date: "2026-10-24" });
    expect(s.range52!.high).toBeCloseTo(179 * 1.02, 5);
    expect(s.range52!.low).toBeCloseTo(128 * 0.98, 5); // las 52 semanas empiezan en la vela 28
    expect(s.range52!.position).toBeCloseTo((150 - 128 * 0.98) / (179 * 1.02 - 128 * 0.98), 5);
    expect(s.range52!.fromHigh).toBeCloseTo(150 / (179 * 1.02) - 1, 5);
  });

  it("compara con el último cierre de diciembre", () => {
    const s = priceStats(bars, { value: 179, date: "2026-10-24" });
    expect(s.ytdBase!.date < "2026-01-01").toBe(true);
    expect(s.ytdBase!.date >= "2025-12-22").toBe(true);
    expect(s.ytd).toBeCloseTo(179 / s.ytdBase!.close - 1, 10);
  });

  it("sin historia suficiente o sin precio, sin dato", () => {
    expect(priceStats(bars.slice(-20), { value: 150, date: "2026-10-24" }).range52).toBeNull();
    expect(priceStats(bars.slice(-20), { value: 150, date: "2026-10-24" }).ytd).toBeNull();
    expect(priceStats(bars, null)).toEqual({ range52: null, ytd: null, ytdBase: null });
  });
});
