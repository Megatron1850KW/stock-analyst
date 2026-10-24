import { describe, expect, it } from "vitest";
import { highlights, sortRows, type ComparisonRow } from "./rows";

// Filas FICTICIAS
const row = (ticker: string, p: { dev?: number | null; fcf?: number | null; ratio?: number | null; netCash?: boolean; growth?: number | null }): ComparisonRow => ({
  id: ticker.length,
  ticker,
  name: `${ticker} (ficticia)`,
  sector: null,
  kind: "stock",
  price: null,
  valuation: { verdict: p.dev == null ? null : p.dev < -0.15 ? "Barata" : p.dev > 0.15 ? "Cara" : "Justa", score: null, deviation: p.dev ?? null },
  fcfYield: p.fcf ?? null,
  debt: { level: p.ratio === undefined && !p.netCash ? null : "Baja", years: null, netCash: !!p.netCash, ratio: p.ratio ?? null },
  growth: { value: p.growth ?? null, basis: "year" },
  operatingMargin: null,
  revenue: [],
  ai: null,
  quality: null,
  verdict: { outcome: null, reason: "", vsPeers: null, peers: 0 },
});

const rows = [
  row("AAA", { dev: 0.2, fcf: 0.02, ratio: 3, growth: 0.05 }),
  row("BBB", { dev: -0.4, fcf: 0.06, ratio: -2, netCash: true, growth: -0.1 }),
  row("CCC", { dev: null, fcf: null, ratio: -0.5, netCash: true, growth: 0.3 }),
];

describe("comparativa", () => {
  it("ordena por cada pregunta y deja al final las que no tienen dato", () => {
    expect(sortRows(rows, "cheapest").map((r) => r.ticker)).toEqual(["BBB", "AAA", "CCC"]);
    expect(sortRows(rows, "cash").map((r) => r.ticker)).toEqual(["BBB", "AAA", "CCC"]);
    expect(sortRows(rows, "debt").map((r) => r.ticker)).toEqual(["BBB", "CCC", "AAA"]);
    expect(sortRows(rows, "growth").map((r) => r.ticker)).toEqual(["CCC", "AAA", "BBB"]);
    expect(sortRows([rows[2]!, rows[0]!], "ticker").map((r) => r.ticker)).toEqual(["AAA", "CCC"]);
  });

  it("destaca la mejor en cada pregunta solo si hay con quién comparar", () => {
    expect(highlights(rows).map((h) => `${h.key}:${h.row.ticker}`)).toEqual(["cheapest:BBB", "cash:BBB", "debt:BBB", "growth:CCC"]);
    expect(highlights([rows[0]!])).toEqual([]);
  });
});
