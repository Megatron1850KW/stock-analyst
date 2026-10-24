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
import { currentGetter, fundamentals, yearlyFundamentals } from "@/domain/fundamentals/metrics";
import { ownPeriodFact } from "@/domain/fundamentals/period-value";
import { marginsAtPeak, qualityScore } from "@/domain/scoring/quality-score";
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
  return { r, filings, value, current: fundamentals(currentGetter(filings, facts)), years: yearlyFundamentals(filings, facts) };
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

  it("Alphabet: cifras de los últimos doce meses y caja neta", async () => {
    const { current: f, years } = await importReal("GOOG");
    // Ventas 2025 (402.836 M$) + 1S 2026 − 1S 2025
    expect(f.revenue!.value).toBe(445_866_000_000);
    expect(f.revenue!.sources.map((s) => s.filing.form_type)).toEqual(["10-K", "10-Q", "10-Q"]);
    // No publica beneficio bruto: se calcula y se dice
    expect(f.grossProfit.note).toMatch(/calculado/);
    expect(f.netDebt.value).toBeLessThan(0);
    expect(f.debtYears).toMatchObject({ value: 0, note: expect.stringMatching(/caja neta/) });
    expect(years.at(-1)!.revenueGrowth.value).toBeCloseTo(402_836 / 350_018 - 1, 6);
  });

  it("Micron: con el 10-K más reciente que los 10-Q, usa el ejercicio completo", async () => {
    const { current: f } = await importReal("MU");
    expect(f.revenue!.sources).toHaveLength(1);
    expect(f.revenue!.note).toMatch(/Último ejercicio completo/);
    // Deuda 5.179 M$ − (caja + inversiones a corto)
    expect(f.grossDebt.value).toBe(5_179_000_000);
    expect(f.netDebt.value).toBe(5_179_000_000 - f.cash.value!);
  });

  it("historia de 10 años desde companyfacts, sin pedir más a la SEC", async () => {
    const mu = await importReal("MU");
    expect(mu.r.historyYears).toBe(8);
    expect(mu.years.map((y) => y.periodEnd.slice(0, 4))).toEqual(["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
    // Ejercicio 2023 de Micron: pérdidas y caja libre negativa
    expect(mu.years.find((y) => y.periodEnd.startsWith("2023"))!.netIncome!.value).toBeLessThan(0);

    const goog = await importReal("GOOG");
    expect(goog.r.historyYears).toBe(8);
    // Antes de 2022 Alphabet no da el total de acciones diluidas: se deducen de beneficio ÷ BPA
    const y2021 = goog.years.find((y) => y.periodEnd === "2021-12-31")!;
    expect(y2021.shares!.note).toMatch(/beneficio neto ÷ beneficio por acción/);
    // Base anterior al split 20×1 de julio de 2022 (≈ 680 M de acciones)
    expect(y2021.shares!.value / 1e6).toBeGreaterThan(600);
    expect(y2021.shares!.value / 1e6).toBeLessThan(720);
  });
});

describe("calidad con datos reales (sin conexión)", () => {
  it("MU (cíclica en máximos) y GOOG: buena nota; a GOOG le cae la caja libre por la inversión", async () => {
    const mu = await importReal("MU");
    const qMu = qualityScore(mu.current, mu.years, "Baja", "$");
    expect(qMu.score).toBeGreaterThan(70);
    expect(qMu.parts.find((p) => p.id === "margins")?.explanation).toMatch(/^De cada 100 \$ que vende/);
    expect(qMu.activeSignals).toBe(0);

    const goog = await importReal("GOOG");
    const qGoog = qualityScore(goog.current, goog.years, "Baja", "$");
    expect(qGoog.score).toBeGreaterThan(80);
    expect(qGoog.parts.find((p) => p.id === "dilution")?.explanation).toMatch(/Recompra acciones/);
    // Capex récord en 2026: la caja libre de los últimos 12 meses cae más de un 25 %
    expect(qGoog.signals.filter((s) => s.active).map((s) => s.id)).toEqual(["fcfWeak"]);

    // Micron en máximos del ciclo de memoria (margen 75 %); Alphabet, no
    expect(marginsAtPeak(mu.current, mu.years)).toBe(true);
    expect(marginsAtPeak(goog.current, goog.years)).toBe(false);
  });
});
