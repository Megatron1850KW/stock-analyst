import { describe, expect, it } from "vitest";
import { addMonthsEnd, expectedNextReport, type PastReport } from "./expected";

// DATOS FICTICIOS para tests: fechas inventadas con el patrón típico de cada mercado.

const us: PastReport[] = [
  { periodType: "interim", periodEnd: "2026-06-30", filedAt: "2026-08-04" }, // 35 días
  { periodType: "interim", periodEnd: "2026-03-31", filedAt: "2026-05-05" }, // 35
  { periodType: "annual", periodEnd: "2025-12-31", filedAt: "2026-02-20" }, // 51
  { periodType: "interim", periodEnd: "2025-09-30", filedAt: "2025-11-04" }, // 35
  { periodType: "annual", periodEnd: "2024-12-31", filedAt: "2025-02-19" }, // 50
];

describe("calendario estimado de resultados", () => {
  it("fin de mes al sumar meses", () => {
    expect(addMonthsEnd("2026-06-30", 3)).toBe("2026-09-30");
    expect(addMonthsEnd("2025-11-30", 3)).toBe("2026-02-28");
    expect(addMonthsEnd("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("EE. UU.: el siguiente 10-Q con el retraso habitual de la empresa", () => {
    const e = expectedNextReport(us, "us-domestic", "2026-10-24")!;
    expect(e).toMatchObject({ periodType: "interim", periodEnd: "2026-09-30", expectedDate: "2026-11-04", label: "10-Q de Q3 2026" });
    expect(e.basis).toMatch(/suelen salir 35 días/);
  });

  it("tras el tercer trimestre toca el anual, con su propio retraso", () => {
    const e = expectedNextReport([{ periodType: "interim", periodEnd: "2026-09-30", filedAt: "2026-11-03" }, ...us], "us-domestic", "2026-12-01")!;
    expect(e).toMatchObject({ periodType: "annual", periodEnd: "2026-12-31", expectedDate: "2027-02-20", label: "10-K del ejercicio 2026" });
  });

  it("ejercicio que no acaba en diciembre (cierre en mayo)", () => {
    const e = expectedNextReport(
      [
        { periodType: "annual", periodEnd: "2026-05-31", filedAt: "2026-07-20" },
        { periodType: "interim", periodEnd: "2026-02-28", filedAt: "2026-04-03" },
      ],
      "us-domestic",
      "2026-07-25",
    )!;
    expect(e.label).toBe("10-Q de Q1 2027");
    expect(e.periodEnd).toBe("2026-08-31");
  });

  it("Europa: semestral y anual, con retraso por defecto si no hay fechas", () => {
    const eu: PastReport[] = [{ periodType: "annual", periodEnd: "2025-12-31", filedAt: null }];
    const e = expectedNextReport(eu, "eu", "2026-06-01")!;
    expect(e).toMatchObject({ periodType: "interim", periodEnd: "2026-06-30", expectedDate: "2026-08-29", label: "Informe semestral H1 2026" });
    expect(e.basis).toMatch(/sin fechas/);
  });

  it("si la fecha pasó hace mucho sin informe, pasa al periodo siguiente", () => {
    const eu: PastReport[] = [{ periodType: "annual", periodEnd: "2024-12-31", filedAt: "2025-03-20" }];
    const e = expectedNextReport(eu, "eu", "2026-10-24")!;
    expect(e.periodEnd).toBe("2026-12-31");
    expect(e.label).toBe("Informe anual 2026");
  });

  it("sin informes no hay calendario", () => {
    expect(expectedNextReport([], "eu", "2026-10-24")).toBeNull();
  });
});
