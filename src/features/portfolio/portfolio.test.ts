// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClaudeClient } from "@/data/claude/client";
import type { FxClient } from "@/data/fx/frankfurter";
import { parseFxSeries } from "@/data/fx/frankfurter";
import { insertTransaction, listPortfolioSecurities, upsertFundSecurity } from "@/db/portfolio-repo";
import { getDocumentRequests, getFxCoverage, isTracked, removeFromWatchlist, saveQuote } from "@/db/repo";
import { refreshFx } from "@/features/fx/refresh";
import { fakeClaudeFetch } from "../../../tests/helpers/fake-claude";
import { fakeEu } from "../../../tests/helpers/fake-eu";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { findOrImportHolding, pickFundListing } from "./add-holding";
import { extractFundProfile, toFundProfile, type EtfExtraction } from "./fund-profile";
import { loadPortfolio } from "./load";

// Cartera FICTICIA: valores, ISIN y tipos de cambio inventados para las pruebas
const ETF_ISIN = "IE000FICTET1";
const etfFigi = [
  { figi: "BBG000ETF0LN", name: "FICTICIO MSCI WORLD", ticker: "FWLD", exchCode: "LN", marketSector: "Equity" },
  { figi: "BBG000ETF0GY", name: "FICTICIO MSCI WORLD", ticker: "FWRL", exchCode: "GY", marketSector: "Equity" },
];

function fakeFx(): FxClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    series: async (from, currencies) => {
      calls.push(`${from}:${currencies.join(",")}`);
      const raw = JSON.stringify({
        amount: 1,
        base: "EUR",
        start_date: from,
        end_date: "2026-10-23",
        rates: { "2025-01-02": { USD: 1.04 }, "2026-10-23": { USD: 1.16 } },
      });
      return parseFxSeries(raw).filter((r) => r.date >= from);
    },
  };
}

const ETF_OUT: EtfExtraction = {
  coincide: true,
  ter: 0.2,
  indice: "MSCI World (ficticio)",
  replicacion: "física optimizada (muestreo)",
  domicilio: "ie",
  patrimonio_millones: 1234,
  divisa_patrimonio: "usd",
  divisa_fondo: "USD",
  dividendos: "acumulación",
  colateral: null,
  principales_posiciones: [{ nombre: "Ficticia Corp", peso: 4.5 }],
  sectores: [{ nombre: "Tecnología", peso: 25 }, { nombre: "Finanzas", peso: 15 }, { nombre: "Salud", peso: 140 }],
  paises: [{ nombre: "US", peso: 70 }, { nombre: "Resto", peso: 30 }],
  fecha_datos: "2026-09-30",
  paginas: [{ dato: "ter", pagina: 1 }, { dato: "sectores", pagina: 9 }],
  notas: "",
};
const fakePdf = new TextEncoder().encode("%PDF-1.7 /Type /Page /Type /Page /Type /Pages");

async function setup() {
  const db = memoryDb();
  const deps = { db, eu: fakeEu({ figi: etfFigi }).client, sec: fakeSec() };
  return { db, deps };
}

describe("cartera (datos FICTICIOS)", () => {
  it("una acción nueva pasa por el mismo análisis (sin entrar en la watchlist) y un ETF se identifica por su ISIN", async () => {
    const { db, deps } = await setup();
    const stock = await findOrImportHolding(deps, "fict", "stock");
    expect(stock.existing).toBe(false);
    expect(stock.imported?.annual).toBeGreaterThan(0);
    const etf = await findOrImportHolding(deps, ETF_ISIN, "etf");
    expect(etf).toMatchObject({ existing: false, kind: "etf", currency: "EUR" });
    // Ya guardados: no se vuelve a descargar nada
    expect((await findOrImportHolding(deps, "FICT", "stock")).existing).toBe(true);
    expect((await findOrImportHolding(deps, ETF_ISIN, "etf")).existing).toBe(true);
    const rows = await listPortfolioSecurities(db);
    expect(rows).toEqual([]); // sin operaciones todavía
    const [w] = await db.select<{ in_watchlist: number }>("SELECT in_watchlist FROM securities WHERE id = ?", [stock.securityId]);
    expect(w!.in_watchlist).toBe(0);
    // Los informes que falten se piden aunque no esté en la watchlist (está en tu cartera)
    expect(await getDocumentRequests(db, stock.securityId)).toBeDefined();
  });

  it("ETF/ETC sin ISIN: se pide el ISIN; y se prefiere Xetra a Londres", async () => {
    const { deps } = await setup();
    await expect(findOrImportHolding(deps, "VWCE", "etf")).rejects.toThrow(/ISIN/);
    expect(pickFundListing(etfFigi)?.exchCode).toBe("GY");
    // Xetra solo con el código compuesto de Alemania (GR): mejor que París
    const onlyGr = [
      { figi: "BBG0FICT0FP", ticker: "FCOM", exchCode: "FP", marketSector: "Equity", securityType: "ETP" },
      { figi: "BBG0FICT0GR", ticker: "FXRS", exchCode: "GR", marketSector: "Equity", securityType: "ETP" },
    ];
    expect(pickFundListing(onlyGr)?.ticker).toBe("FXRS");
  });

  it("si un fondo cambia de bolsa, su símbolo de precio se vuelve a buscar", async () => {
    const db = memoryDb();
    const base = { isin: "IE000FICT001", figi: "BBG0FICT0FP", ticker: "FCOM", name: "FONDO FICTICIO", exchange: "FP", currency: "EUR", kind: "etf" as const, watchlist: true };
    const id = await upsertFundSecurity(db, base);
    await db.execute("UPDATE securities SET price_symbol = 'alphavantage:FCOM.PAR' WHERE id = ?", [id]);
    await upsertFundSecurity(db, base);
    const sym = async () => (await db.select<{ price_symbol: string | null }>("SELECT price_symbol FROM securities WHERE id = ?", [id]))[0]!.price_symbol;
    expect(await sym()).toBe("alphavantage:FCOM.PAR");
    await upsertFundSecurity(db, { ...base, figi: "BBG0FICT0GR", ticker: "FXRS", exchange: "GR" });
    expect(await sym()).toBeNull();
  });

  it("tipos del BCE: solo las divisas que hacen falta y solo lo que falta", async () => {
    const { db, deps } = await setup();
    const { securityId } = await findOrImportHolding(deps, "FICT", "stock");
    const fx = fakeFx();
    expect(await refreshFx(db, fx)).toEqual({ saved: 0, currencies: [] });
    await insertTransaction(db, { securityId, date: "2025-01-03", type: "buy", quantity: 10, price: 104, currency: "USD", fees: 0, fxRateToBase: null, broker: null, notes: null });
    const first = await refreshFx(db, fx, new Date("2026-10-24"));
    expect(first.currencies).toEqual(["USD"]);
    expect(fx.calls).toEqual(["2024-12-27:USD"]);
    expect(await getFxCoverage(db)).toEqual([{ quote: "USD", first: "2025-01-02", last: "2026-10-23" }]);
    await refreshFx(db, fx, new Date("2026-10-24"));
    expect(fx.calls.at(-1)).toBe("2026-10-23:USD");
  });

  it("tipos del BCE para valorar un valor que publica en dólares y cotiza en peniques", async () => {
    const db = memoryDb();
    await db.execute("INSERT INTO securities (id, isin, name, kind, currency, in_watchlist) VALUES (1, 'GB00FICT0001', 'MINERA FICTICIA', 'stock', 'GBp', 1)");
    await db.execute("INSERT INTO financial_facts (security_id, concept, value, unit, period_end, origin) VALUES (1, 'revenue', 100, 'USD', '2025-12-31', 'user')");
    const fx = fakeFx();
    const r = await refreshFx(db, fx, new Date("2026-10-24"));
    expect(r.currencies).toEqual(["GBP", "USD"]);
    // 11 años atrás (más la semana de margen), para la historia de 10 años
    expect(fx.calls).toEqual(["2015-10-09:GBP,USD"]);
  });

  it("vision board: rentabilidad en euros, recomendación y escenarios, sin IA", async () => {
    const { db, deps } = await setup();
    const stock = await findOrImportHolding(deps, "FICT", "stock");
    const etf = await findOrImportHolding(deps, ETF_ISIN, "etf");
    await insertTransaction(db, { securityId: stock.securityId, date: "2025-01-02", type: "buy", quantity: 10, price: 104, currency: "USD", fees: 0, fxRateToBase: null, broker: "Ficticio", notes: null });
    await insertTransaction(db, { securityId: etf.securityId, date: "2025-01-02", type: "buy", quantity: 100, price: 10, currency: "EUR", fees: 1, fxRateToBase: null, broker: null, notes: null });
    await refreshFx(db, fakeFx(), new Date("2026-10-24"));
    await saveQuote(db, { securityId: stock.securityId, date: "2026-10-23", open: null, high: null, low: null, close: 116, volume: null, currency: "USD", source: "test" });
    await saveQuote(db, { securityId: etf.securityId, date: "2026-10-23", open: null, high: null, low: null, close: 12, volume: null, currency: "EUR", source: "test" });

    const view = await loadPortfolio(db, new Date("2026-10-24T10:00:00Z"));
    const p = view.portfolio;
    const fict = view.holdings.find((h) => h.row.ticker === "FICT")!;
    // 10 × 104 $ a 1,04 $/€ = 1.000 €; hoy 10 × 116 $ a 1,16 $/€ = 1.000 €
    expect(fict.position.costEur).toBeCloseTo(1000, 6);
    expect(fict.position.valueEur).toBeCloseTo(1000, 6);
    const fund = view.holdings.find((h) => h.row.kind === "etf")!;
    expect(fund.position.costEur).toBeCloseTo(1001, 6);
    expect(fund.position.valueEur).toBeCloseTo(1200, 6);
    expect(p.valueEur).toBeCloseTo(2200, 6);
    // Cada posición pesa más del 15 %: la recomendación no amplía
    expect(fict.recommendation.action).not.toBe("Comprar más");
    expect(fund.recommendation.action).toBe("Mantener");
    expect(fund.recommendation.noFinancials).toBe(true);
    expect(fict.sectorSource === "sic" || fict.sectorSource === null).toBe(true);
    expect(view.transactions).toHaveLength(2);
  });

  it("ficha de ETF: Haiku la lee una vez por archivo y el código valida pesos y páginas", async () => {
    const { db, deps } = await setup();
    const etf = await findOrImportHolding(deps, ETF_ISIN, "etf");
    const claude = fakeClaudeFetch({ analysis: ETF_OUT, model: "claude-haiku-5-5", usage: { input_tokens: 7000, output_tokens: 900 } });
    const fdeps = { db, client: createClaudeClient(claude.fetch), readPdf: async () => fakePdf, model: "claude-haiku-5-5", budgetEur: 10 };
    const doc = { path: "/tmp/ficha.pdf", name: "ficha.pdf", sha256: "a".repeat(64) };
    const r = await extractFundProfile(fdeps, etf.securityId, doc);
    expect(r.status).toBe("created");
    expect(r.profile.ter).toBeCloseTo(0.002, 9);
    expect(r.profile.domicile).toBe("IE");
    // El 140 % de Salud es imposible: se descarta
    expect(r.profile.sectors).toEqual([{ key: "Tecnología", weight: 0.25 }, { key: "Finanzas", weight: 0.15 }]);
    expect(r.profile.countries).toEqual([{ key: "US", weight: 0.7 }, { key: "Otros", weight: 0.3 }]);
    // La página 9 no existe en un PDF de 2 páginas
    expect(r.profile.pages).toEqual({ ter: 1 });
    expect(r.profile.notes).toEqual(["1 pesos descartados por no ser coherentes."]);
    const again = await extractFundProfile(fdeps, etf.securityId, doc);
    expect(again.status).toBe("cached");
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0]!.body.model).toBe("claude-haiku-5-5");
  });

  it("si el PDF es de otro fondo no se guarda nada", async () => {
    const { db, deps } = await setup();
    const etf = await findOrImportHolding(deps, ETF_ISIN, "etf");
    const claude = fakeClaudeFetch({ analysis: { ...ETF_OUT, coincide: false, notas: "Es la ficha de otro fondo." }, model: "claude-haiku-5-5" });
    const fdeps = { db, client: createClaudeClient(claude.fetch), readPdf: async () => fakePdf, model: "claude-haiku-5-5", budgetEur: 10 };
    await expect(extractFundProfile(fdeps, etf.securityId, { path: "/x.pdf", name: "x.pdf", sha256: "b".repeat(64) })).rejects.toThrow(/no parece la ficha/);
    expect(await db.select("SELECT * FROM fund_profiles")).toEqual([]);
  });

  it("una suma de pesos imposible (>105 %) se descarta entera", () => {
    const p = toFundProfile({ ...ETF_OUT, sectores: [{ nombre: "Tecnología", peso: 80 }, { nombre: "Finanzas", peso: 60 }] }, 2);
    expect(p.sectors).toEqual([]);
  });

  it("al borrar la última operación de un valor que no sigues, deja de estar guardado", async () => {
    const { db, deps } = await setup();
    const etf = await findOrImportHolding(deps, ETF_ISIN, "etf");
    const id = await insertTransaction(db, { securityId: etf.securityId, date: "2025-01-02", type: "buy", quantity: 1, price: 10, currency: "EUR", fees: 0, fxRateToBase: null, broker: null, notes: null });
    expect(await isTracked(db, etf.securityId)).toBe(true);
    await db.execute("DELETE FROM transactions WHERE id = ?", [id]);
    expect(await isTracked(db, etf.securityId)).toBe(false);
    await removeFromWatchlist(db, etf.securityId);
    expect(await db.select("SELECT id FROM securities WHERE id = ?", [etf.securityId])).toEqual([]);
  });
});
