// @vitest-environment node
import { describe, expect, it } from "vitest";
import { submissionsSchema } from "@/data/sec-edgar/schemas";
import submissionsJson from "../../../tests/fixtures/ficticio/submissions.json";
import { selectFilings, toRows, type FilingRef } from "./select-filings";

const rows = toRows(submissionsSchema.parse(submissionsJson).filings.recent);

describe("elección de informes (datos ficticios)", () => {
  it("toma los 3 últimos 10-K y 3 últimos 10-Q, más reciente primero", () => {
    const s = selectFilings(rows);
    expect(s.annual.map((f) => f.reportDate)).toEqual(["2025-12-31", "2024-12-31", "2023-12-31"]);
    expect(s.interim.map((f) => f.reportDate)).toEqual(["2026-06-30", "2026-03-31", "2025-09-30"]);
    expect(s.filerType).toBe("domestic");
    expect(s.notes).toEqual([]);
  });

  it("ignora enmiendas, 8-K y formularios 4", () => {
    expect(rows.map((r) => r.form).sort()).not.toContain("10-K/A");
    expect(rows.every((r) => ["10-K", "10-Q"].includes(r.form))).toBe(true);
    expect(selectFilings(rows).annual[0]!.accession).toBe("0009999999-26-000020");
  });

  it("explica cuando faltan informes", () => {
    const s = selectFilings(rows.filter((r) => r.reportDate >= "2025-01-01"));
    expect(s.annual).toHaveLength(1);
    expect(s.notes[0]).toBe("Solo hay 1 de 3 informes anuales en EDGAR.");
  });

  it("trata 20-F como anual de un emisor extranjero y explica que no hay trimestrales", () => {
    const foreign: FilingRef[] = ["2025", "2024", "2023"].map((y) => ({
      accession: `x-${y}`,
      form: "20-F",
      periodType: "annual",
      reportDate: `${y}-12-31`,
      filingDate: `${Number(y) + 1}-04-01`,
      primaryDocument: "d.htm",
    }));
    const s = selectFilings(foreign);
    expect(s.filerType).toBe("foreign");
    expect(s.annual).toHaveLength(3);
    expect(s.notes[0]).toMatch(/emisor extranjero.*6-K/);
  });

  it("con dos informes del mismo periodo se queda con el último presentado", () => {
    const dup: FilingRef[] = [
      { accession: "a", form: "10-K", periodType: "annual", reportDate: "2025-12-31", filingDate: "2026-02-01", primaryDocument: "" },
      { accession: "b", form: "10-K", periodType: "annual", reportDate: "2025-12-31", filingDate: "2026-03-01", primaryDocument: "" },
    ];
    expect(selectFilings(dup).annual.map((f) => f.accession)).toEqual(["b"]);
  });
});
