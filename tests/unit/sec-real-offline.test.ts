// @vitest-environment node
/**
 * Importación con datos REALES de la SEC guardados (MU y GOOG), sin conexión.
 * Las cifras esperadas se han contrastado con los informes publicados, p. ej.
 * el comunicado de resultados del 2T 2026 de Alphabet (8-K, exhibit 99.1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SecClient } from "@/data/sec-edgar/client";
import { companyFactsSchema, submissionsSchema } from "@/data/sec-edgar/schemas";
import { getFacts, getFilings } from "@/db/repo";
import { ownPeriodFact } from "@/domain/fundamentals/period-value";
import { importUsTicker } from "@/features/watchlist/import-us";
import { memoryDb } from "../helpers/sqlite-db";

const dir = join(__dirname, "../fixtures/sec");
const load = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), "utf8"));

const realSec = (ticker: string): SecClient => ({
  // Fila real de company_tickers_exchange.json para los dos valores
  tickers: async () => ({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [
      [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"],
      [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
    ],
  }),
  submissions: async () => submissionsSchema.parse(load(`${ticker}-submissions.json`)),
  submissionsFile: async () => {
    throw new Error("no guardado");
  },
  companyFacts: async () => companyFactsSchema.parse(load(`${ticker}-companyfacts.json`)),
});

async function importReal(ticker: string) {
  const db = memoryDb();
  const r = await importUsTicker(realSec(ticker), db, ticker);
  const filings = await getFilings(db, r.securityId);
  const facts = await getFacts(db, r.securityId);
  const value = (form: string, end: string, concept: string) => {
    const f = filings.find((x) => x.form_type === form && x.period_end === end);
    if (!f) throw new Error(`no hay ${form} ${end}`);
    return ownPeriodFact(facts, f, concept);
  };
  return { r, filings, value };
}

describe("datos reales de la SEC (sin conexión)", () => {
  it("Alphabet: 3 anuales, 3 trimestrales y cifras del 2T 2026 como en su comunicado", async () => {
    const { r, filings, value } = await importReal("GOOG");
    expect([r.annual, r.interim]).toEqual([3, 3]);
    expect(filings.filter((f) => f.period_type === "interim").map((f) => f.period_end)).toEqual(["2026-06-30", "2026-03-31", "2025-09-30"]);
    // Trimestre (no acumulado del semestre)
    expect(value("10-Q", "2026-06-30", "revenue")).toMatchObject({ fact: { value: 119_796_000_000 }, cumulative: false });
    expect(value("10-Q", "2026-06-30", "pretax_income")?.fact.value).toBe(138_753_000_000);
    expect(value("10-Q", "2026-06-30", "net_income")?.fact.value).toBe(112_193_000_000);
    expect(value("10-Q", "2026-06-30", "eps_diluted")?.fact.value).toBe(9.11);
    // Flujos de caja: en un 10-Q solo vienen acumulados del año
    expect(value("10-Q", "2026-06-30", "operating_cash_flow")?.cumulative).toBe(true);
    // Alphabet no publica beneficio bruto: no se inventa
    expect(value("10-K", "2025-12-31", "gross_profit")).toBeNull();
  });

  it("Micron: la deuda total usa la misma definición en todos los informes", async () => {
    const { r, value } = await importReal("MU");
    expect([r.annual, r.interim]).toEqual([3, 3]);
    // Total = no corriente + vencimientos a 12 meses (DebtAndCapitalLeaseObligations)
    expect(value("10-K", "2026-09-03", "debt_total")?.fact).toMatchObject({ value: 5_179_000_000, source_tag: "us-gaap:DebtAndCapitalLeaseObligations" });
    expect(value("10-Q", "2026-05-28", "debt_total")?.fact.value).toBe(5_722_000_000);
    expect(value("10-K", "2026-09-03", "debt_noncurrent")?.fact.value).toBe(4_688_000_000);
    expect(value("10-K", "2026-09-03", "debt_current")?.fact.value).toBe(491_000_000);
    // DebtCurrent ya no se cuela como «préstamos a corto plazo» (se contaría dos veces)
    expect(value("10-K", "2026-09-03", "short_term_borrowings")).toBeNull();
  });
});
