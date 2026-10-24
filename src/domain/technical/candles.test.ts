// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aggregateBars, periodStart } from "./candles";

// FICTICIO
const day = (date: string, close: number, high = close + 1, low = close - 1) => ({ date, open: close, high, low, close, volume: 100 });

describe("velas semanales y mensuales (datos ficticios)", () => {
  it("calcula el inicio del periodo", () => {
    expect(periodStart("2026-10-23", "1w")).toBe("2026-10-19"); // viernes → lunes
    expect(periodStart("2026-10-19", "1w")).toBe("2026-10-19");
    expect(periodStart("2026-10-25", "1w")).toBe("2026-10-19"); // domingo
    expect(periodStart("2026-10-23", "1mo")).toBe("2026-10-01");
  });

  it("agrupa apertura, máximo, mínimo, cierre y volumen", () => {
    const daily = [day("2026-09-29", 10), day("2026-09-30", 12, 20), day("2026-10-01", 9, 10, 5), day("2026-10-02", 11)];
    expect(aggregateBars(daily, "1mo")).toEqual([
      { date: "2026-09-01", open: 10, high: 20, low: 9, close: 12, volume: 200 },
      { date: "2026-10-01", open: 9, high: 12, low: 5, close: 11, volume: 200 },
    ]);
    expect(aggregateBars(daily, "1w")).toEqual([{ date: "2026-09-28", open: 10, high: 20, low: 5, close: 11, volume: 400 }]);
  });
});
