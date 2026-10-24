// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseEsefFilings, parseFigi, parseGleif, parseXbrlJson, type EuClient } from "@/data/esef/client";
import { parseAvQuote, parseAvSearch, parseAvSeries, pickAvSymbol } from "@/data/prices/alphavantage";
import { getFilings, getSecurity, saveQuote } from "@/db/repo";
import { importEuIsin } from "@/features/watchlist/import-eu";
import { loadSecurityDetail } from "@/features/watchlist/load";
import { memoryDb } from "../helpers/sqlite-db";

/**
 * Datos REALES descargados en el Mac de Pablo el 24-10-2026 (tests/real/eu-probe.ts):
 * GLEIF, OpenFIGI y filings.xbrl.org de Inditex (ES0148396007) y las respuestas de
 * Alpha Vantage para cinco europeas.
 */
const dir = join(process.cwd(), "tests/fixtures/eu");
const read = (name: string) => readFileSync(join(dir, name), "utf8");

function savedEu(): EuClient {
  return {
    leiByIsin: async (isin) => parseGleif(read(`gleif-${isin}.json`)),
    figi: async (isin) => parseFigi(read(`figi-${isin}.json`)),
    esefFilings: async (lei) => parseEsefFilings(read(`xbrlorg-${lei}.json`)),
    esefDocument: async (path) => {
      // /<LEI>/<cierre>/ESEF/... → esef/<LEI>-<cierre>.json.gz
      const [, lei, end] = path.split("/");
      return parseXbrlJson(gunzipSync(readFileSync(join(dir, "esef", `${lei}-${end}.json.gz`))).toString("utf8"));
    },
  };
}

describe("Inditex con informes ESEF REALES", () => {
  it("importa 3 anuales + 3 de historia con las cifras de sus cuentas", async () => {
    const db = memoryDb();
    const r = await importEuIsin(savedEu(), db, "ES0148396007", undefined, new Date("2026-10-24"));
    expect(r).toMatchObject({ ticker: "ITX", name: "Industria De Diseño Textil, S.A.", annual: 3, interim: 0, historyYears: 3, requests: 3 });
    expect(await getSecurity(db, r.securityId)).toMatchObject({ exchange: "SM", currency: "EUR", country: "ES", lei: "549300TTCXZOGZM2EY83" });
    // Se usa la última versión de cada informe (reediciones en español de 2026)
    const filings = await getFilings(db, r.securityId);
    expect(filings.map((f) => f.period_end)).toEqual(["2026-01-31", "2025-01-31", "2024-01-31", "2023-01-31", "2022-01-31", "2021-01-31"]);

    const { analysis } = await loadSecurityDetail(db, r.securityId);
    const c = analysis!.current;
    // Cuentas anuales 2025 (cierre 31-01-2026): ventas 39.864 M€, beneficio 6.220 M€, caja operativa 9.232 M€
    expect(c.revenue?.value).toBe(39_864_000_000);
    expect(c.netIncome?.value).toBe(6_220_000_000);
    expect(c.operatingCashFlow?.value).toBe(9_232_000_000);
    // Sin BPA diluido: acciones = beneficio ÷ BPA básico (1,996 €) ≈ 3.116 millones
    expect(c.shares?.value).toBeCloseTo(3_116_232_465, -4);
    expect(c.shares?.note).toMatch(/básico/);
    expect(analysis!.years.map((y) => y.periodEnd)).toEqual(["2021-01-31", "2022-01-31", "2023-01-31", "2024-01-31", "2025-01-31", "2026-01-31"]);
  });

  it("con un precio (SUPUESTO de 50 €, solo para el test) calcula sus múltiplos", async () => {
    const db = memoryDb();
    const r = await importEuIsin(savedEu(), db, "ES0148396007", undefined, new Date("2026-10-24"));
    await saveQuote(db, { securityId: r.securityId, date: "2026-10-23", open: 50, high: 50, low: 50, close: 50, volume: 1, currency: "EUR", source: "test" });
    const { analysis } = await loadSecurityDetail(db, r.securityId);
    // 50 € × 3.116 M acciones ÷ 6.220 M€ de beneficio ≈ 25 años
    expect(analysis!.multiples!.pe.value).toBeCloseTo(25.05, 1);
  });
});

describe("Alpha Vantage con respuestas REALES", () => {
  it("lee cotizaciones y velas mensuales reales", () => {
    expect(parseAvQuote(read("av-quote-MC.PAR.json"), "MC.PAR")).toMatchObject({ symbol: "MC.PAR", price: 383, date: "2026-10-23" });
    const rows = parseAvSeries(read("av-monthly-ASML.AMS.json"), "ASML.AMS", "monthly");
    expect(rows.length).toBe(261);
    expect(rows[0]!.date).toBe("2005-02-28");
  });

  it("elige París y Ámsterdam, y no da Madrid (Inditex no aparece; Iberdrola solo fuera de España)", () => {
    const lvmh = parseAvSearch(read("av-search-FR0000121014.json"));
    expect(pickAvSymbol(lvmh, { ticker: "MC", name: "Lvmh Moet Hennessy Louis Vuitton", exchange: "FP", currency: "EUR" })).toBe("MC.PAR");
    const asml = parseAvSearch(read("av-search-NL0010273215.json"));
    expect(pickAvSymbol(asml, { ticker: "ASML", name: "Asml Holding N.V.", exchange: "NA", currency: "EUR" })).toBe("ASML.AMS");
    expect(parseAvSearch(read("av-search-ES0148396007.json"))).toEqual([]);
    const ibe = parseAvSearch(read("av-search-ES0144580Y14.json"));
    expect(pickAvSymbol(ibe, { ticker: "IBE", name: "Iberdrola Sa", exchange: "SM", currency: "EUR" })).toBeNull();
  });
});
