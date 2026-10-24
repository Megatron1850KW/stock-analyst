import { describe, expect, it } from "vitest";
import { annualVolatility, maxDrawdown, movingAverage, pivotLevels, technicalRisk, trendOf, worstYear, type Bar } from "./risk";

// Series mensuales FICTICIAS
const month = (k: number) => {
  const d = new Date(Date.UTC(2016, k, 1));
  return d.toISOString().slice(0, 10);
};
const series = (closes: number[]): Bar[] => closes.map((c, k) => ({ date: month(k), open: c, high: c, low: c, close: c }));
const growing = (n: number, rate = 0.01, start = 100) => Array.from({ length: n }, (_, k) => start * (1 + rate) ** k);

describe("riesgo técnico de largo plazo (datos FICTICIOS)", () => {
  it("tendencia: alcista, bajista y lateral", () => {
    expect(trendOf(growing(30))?.trend).toBe("Alcista");
    expect(trendOf(growing(30, -0.01))?.trend).toBe("Bajista");
    expect(trendOf(Array(30).fill(100))?.trend).toBe("Lateral");
    expect(trendOf(growing(8))).toBeNull();
  });

  it("caída máxima y peor año", () => {
    const bars = series([100, 120, 60, 90, 150, 140, ...Array(12).fill(150), 75]);
    expect(maxDrawdown(bars)).toEqual({ value: 0.5, peakDate: month(1), troughDate: month(2) });
    const w = worstYear(bars)!;
    expect(w.value).toBeCloseTo(-0.5, 9);
    expect(w.endDate).toBe(month(18));
  });

  it("volatilidad anual: 0 en una serie que sube igual cada mes", () => {
    expect(annualVolatility(growing(24))).toBeCloseTo(0, 9);
    expect(annualVolatility(growing(6))).toBeNull();
    const zigzag = Array.from({ length: 37 }, (_, k) => (k % 2 ? 110 : 100));
    expect(annualVolatility(zigzag)!).toBeGreaterThan(0.3);
  });

  it("soportes y resistencias: giros que aguantan 3 meses a cada lado, juntando zonas cercanas", () => {
    const closes = [100, 95, 90, 80, 90, 95, 100, 110, 120, 110, 100, 90, 81, 90, 100, 105, 110, 119, 110, 100];
    const { supports, resistances } = pivotLevels(series(closes));
    expect(supports).toHaveLength(1);
    expect(supports[0]!.price).toBeCloseTo(80.5, 9);
    expect(supports[0]!.touches).toBe(2);
    expect(resistances[0]!.touches).toBe(1);
    expect(resistances.map((r) => r.price)).toContain(120);
  });

  it("semáforo: subida tranquila = Bajo; caída fuerte y nerviosa = Alto", () => {
    const calm = technicalRisk(series(growing(120, 0.008)));
    expect(calm.level).toBe("Bajo");
    expect(calm.trend).toBe("Alcista");
    expect(calm.sentence).toMatch(/^La tendencia de fondo es alcista, está cerca de sus máximos y se mueve poco/);

    const crash = Array.from({ length: 60 }, (_, k) => 100 * 0.97 ** k * (k % 2 ? 1.15 : 0.9));
    const r = technicalRisk(series(crash));
    expect(r.level).toBe("Alto");
    expect(r.trend).toBe("Bajista");
    expect(r.parts.map((p) => p.points)).toEqual([2, 2, 2]);
    expect(r.sentence).toMatch(/bajista, está un \d+ % por debajo de su máximo y se mueve mucho \(en su peor año cayó un \d+ %\)\./);
  });

  it("sin 2 años de historia no hay semáforo", () => {
    const r = technicalRisk(series(growing(20)));
    expect(r.level).toBeNull();
    expect(r.sentence).toContain("al menos 2 años");
  });

  it("media móvil para el gráfico", () => {
    const ma = movingAverage(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 10);
    expect(ma).toEqual([{ date: month(9), value: 5.5 }, { date: month(10), value: 6.5 }]);
  });
});
