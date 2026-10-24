import { describe, expect, it } from "vitest";
import { approxSnapshot, sinceAnalysis, type AnalysisSnapshot } from "./since";

// Datos ficticios de prueba
const snap = (value: number, verdict: AnalysisSnapshot["verdict"], deviation: number | null = null): AnalysisSnapshot => ({
  price: { value, currency: "USD", date: "2026-10-01" },
  verdict,
  score: null,
  deviation,
});

describe("sinceAnalysis", () => {
  it("calcula la variación de precio sin pedir re-analizar si es pequeña", () => {
    const s = sinceAnalysis(snap(100, "Barata"), snap(108, "Barata"));
    expect(s.priceChange).toBeCloseTo(0.08);
    expect(s.bigMove).toBe(false);
    expect(s.suggestRefresh).toBe(false);
  });

  it("sugiere re-analizar si el precio se mueve más de un 20 %", () => {
    const s = sinceAnalysis(snap(100, "Justa"), snap(75, "Justa"));
    expect(s.bigMove).toBe(true);
    expect(s.suggestRefresh).toBe(true);
  });

  it("sugiere re-analizar si cambia el veredicto de valoración", () => {
    const s = sinceAnalysis(snap(100, "Barata"), snap(110, "Justa"));
    expect(s.verdictChanged).toBe(true);
    expect(s.suggestRefresh).toBe(true);
  });

  it("no compara precios en divisas distintas", () => {
    const now = { ...snap(100, null), price: { value: 90, currency: "EUR", date: "2026-10-20" } };
    expect(sinceAnalysis(snap(100, null), now).priceChange).toBeNull();
  });

  it("sin veredicto antiguo no da el veredicto por cambiado", () => {
    expect(sinceAnalysis(snap(100, null), snap(101, "Cara")).verdictChanged).toBe(false);
  });
});

describe("approxSnapshot", () => {
  const monthly = [
    { date: "2026-08-31", close: 90 },
    { date: "2026-09-30", close: 95 },
    { date: "2026-10-24", close: 99 },
  ];
  it("toma el cierre mensual del mes del análisis", () => {
    expect(approxSnapshot(monthly, "2026-09-12T10:00:00Z", "USD")).toMatchObject({ price: { value: 95 }, approx: true });
  });
  it("sin barras anteriores no hay foto", () => {
    expect(approxSnapshot(monthly, "2025-01-01T00:00:00Z", "USD")).toBeNull();
  });
});
