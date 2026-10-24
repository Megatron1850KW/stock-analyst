// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClaudeClient } from "@/data/claude/client";
import { monthSpend } from "@/db/ai-repo";
import { listPeers } from "@/db/peers-repo";
import { getDocumentRequests, listWatchlist, removeFromWatchlist, saveQuote } from "@/db/repo";
import { refreshPrices } from "@/features/prices/refresh";
import { importUsTicker } from "@/features/watchlist/import-us";
import { fakeClaudeFetch } from "../../../tests/helpers/fake-claude";
import { fakePrices } from "../../../tests/helpers/fake-prices";
import { fakeSec } from "../../../tests/helpers/fake-sec";
import { fakeEu, FAKE_ISIN, FAKE_PEER_ISIN } from "../../../tests/helpers/fake-eu";
import { importEuIsin, sameCompany } from "@/features/watchlist/import-eu";
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { proposePeers, type ProposeDeps } from "./propose";
import { linkPeers } from "./sync";

// Propuesta FICTICIA: uno bueno, la propia empresa, uno que no existe y otro bueno
const PROPOSAL = {
  competidores: [
    { ticker: "OTRF", nombre: "Otra Ficticia", mercado: "EEUU", isin: null, motivo: "También vende piezas (ficticio)." },
    { ticker: "FICT", nombre: "Ficticia", mercado: "EEUU", isin: null, motivo: "Es ella misma." },
    { ticker: "NOEXISTE", nombre: "Inventada", mercado: "EEUU", isin: null, motivo: "No cotiza." },
    { ticker: "FIC.B", nombre: "Ficticia clase B", mercado: "EEUU", isin: null, motivo: "Negocio parecido (ficticio)." },
  ],
  nota: "",
};

async function setup() {
  const db = memoryDb();
  const sec = fakeSec();
  const { securityId } = await importUsTicker(sec, db, "FICT");
  const claude = fakeClaudeFetch({ analysis: PROPOSAL, model: "claude-haiku-5-5", usage: { input_tokens: 800, output_tokens: 300 } });
  const deps: ProposeDeps = { db, client: createClaudeClient(claude.fetch), tickers: sec.tickers, model: "claude-haiku-5-5", budgetEur: 10 };
  return { db, sec, securityId, claude, deps };
}

describe("competidores (datos FICTICIOS)", () => {
  it("la IA propone una sola vez; el código descarta lo que no existe o es la propia empresa", async () => {
    const { db, securityId, claude, deps } = await setup();
    const r = await proposePeers(deps, securityId);
    expect(r.status).toBe("created");
    expect(r.stored.accepted.map((p) => p.ticker)).toEqual(["OTRF", "FIC.B"]);
    expect(r.stored.rejected.map((p) => p.ticker)).toEqual(["FICT", "NOEXISTE"]);

    const body = claude.requests[0]!.body;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config).toMatchObject({ effort: "low" });
    expect(String(body.messages && JSON.stringify(body.messages))).toContain("FICTICIA CORP");
    // Gasto apuntado: 800 × 0,1 $ + 300 × 0,5 $ por millón
    expect((await monthSpend(db)).eur).toBeCloseTo(0.00023, 6);

    // La segunda vez no se llama a la IA
    expect((await proposePeers(deps, securityId)).status).toBe("cached");
    expect(claude.requests).toHaveLength(1);
  });

  it("guarda los datos de los competidores sin meterlos en la watchlist ni pedirte sus informes", async () => {
    const { db, sec, securityId, deps } = await setup();
    const { stored } = await proposePeers(deps, securityId);
    const calls: string[] = [];
    const r = await linkPeers({ db, sec, eu: fakeEu().client, prices: fakePrices({ calls }) }, securityId, stored.accepted, "ai-validated");
    expect(r).toEqual({ added: ["OTRF", "FIC.B"], failed: [] });

    const peers = await listPeers(db, securityId);
    expect(peers.map((p) => [p.ticker, p.in_watchlist, p.source])).toEqual([["OTRF", 0, "ai-validated"], ["FIC.B", 0, "ai-validated"]]);
    expect(peers[0]!.reason).toMatch(/piezas/);
    expect((await listWatchlist(db)).map((w) => w.ticker)).toEqual(["FICT"]);
    expect(await getDocumentRequests(db, peers[0]!.peer_id)).toEqual([]);
    expect(calls.filter((c) => c.startsWith("quote:"))).toEqual(["quote:OTRF", "quote:FIC-B"]);
    // La lista de tickers de la SEC se pide una vez para toda la tanda
    expect(sec.calls.filter((c) => c === "tickers").length).toBe(3);
  });

  it("un competidor que ya está en tu watchlist sigue en ella y no se descarga otra vez", async () => {
    const { db, sec, securityId } = await setup();
    await importUsTicker(sec, db, "OTRF");
    const before = sec.calls.length;
    await linkPeers({ db, sec, eu: fakeEu().client, prices: null }, securityId, [{ ticker: "OTRF", cik: "8888888", reason: null }], "user");
    expect(sec.calls.length).toBe(before);
    expect((await listWatchlist(db)).map((w) => w.ticker)).toEqual(["FICT", "OTRF"]);
  });

  it("al quitar un valor se borran los competidores que ya nadie usa", async () => {
    const { db, sec, securityId, deps } = await setup();
    const { stored } = await proposePeers(deps, securityId);
    await linkPeers({ db, sec, eu: fakeEu().client, prices: null }, securityId, stored.accepted, "ai-validated");
    await removeFromWatchlist(db, securityId);
    const left = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM securities");
    expect(left[0]!.n).toBe(0);
  });

  it("la cotización de un competidor se renueva como mucho cada 7 días; la de tu watchlist, siempre", async () => {
    const { db, sec, securityId } = await setup();
    await linkPeers({ db, sec, eu: fakeEu().client, prices: null }, securityId, [{ ticker: "OTRF", reason: null }], "ai-validated");
    const [peer] = await listPeers(db, securityId);
    await saveQuote(db, { securityId: peer!.peer_id, date: "2026-10-20", open: 1, high: 1, low: 1, close: 1, volume: 1, currency: "USD", source: "test" });
    const calls: string[] = [];
    await refreshPrices(db, fakePrices({ calls }), undefined, new Date());
    expect(calls.filter((c) => c.startsWith("quote:"))).toEqual(["quote:FICT"]);
    const later = new Date(Date.now() + 8 * 86_400_000);
    calls.length = 0;
    await refreshPrices(db, fakePrices({ calls }), undefined, later);
    expect(calls.filter((c) => c.startsWith("quote:"))).toEqual(["quote:FICT", "quote:OTRF"]);
  });
});

describe("competidores europeos (datos FICTICIOS)", () => {
  // Propuesta FICTICIA para Ficticia Textil: una europea buena, ella misma, un ISIN mal copiado,
  // un ISIN válido de otra empresa y una de EE. UU. sin datos para la SEC
  const EU_PROPOSAL = {
    competidores: [
      { ticker: "FMD", nombre: "Ficticia Moda", mercado: "Europa", isin: FAKE_PEER_ISIN, motivo: "También vende ropa (ficticio)." },
      { ticker: "FTX", nombre: "Ficticia Textil", mercado: "Europa", isin: FAKE_ISIN, motivo: "Es ella misma." },
      { ticker: "MAL", nombre: "Mal copiada", mercado: "Europa", isin: "FR0000000011", motivo: "ISIN con dígito erróneo." },
      { ticker: "OTRF", nombre: "Otra Ficticia", mercado: "EEUU", isin: null, motivo: "De EE. UU. (ficticio)." },
    ],
    nota: "",
  };

  async function setupEu() {
    const db = memoryDb();
    const eu = fakeEu();
    const { securityId } = await importEuIsin(eu.client, db, FAKE_ISIN, undefined, new Date("2026-10-24"));
    const claude = fakeClaudeFetch({ analysis: EU_PROPOSAL, model: "claude-haiku-5-5", usage: { input_tokens: 800, output_tokens: 300 } });
    const deps: ProposeDeps = { db, client: createClaudeClient(claude.fetch), tickers: null, model: "claude-haiku-5-5", budgetEur: 10 };
    return { db, eu, securityId, claude, deps };
  }

  it("valida los ISIN europeos y, sin datos para la SEC, descarta las de EE. UU. explicándolo", async () => {
    const { securityId, claude, deps } = await setupEu();
    const { stored } = await proposePeers(deps, securityId);
    expect(stored.accepted).toEqual([{ ticker: "FMD", name: "Ficticia Moda", isin: FAKE_PEER_ISIN, reason: "También vende ropa (ficticio)." }]);
    expect(stored.rejected.map((r) => [r.ticker, r.why])).toEqual([
      ["FTX", "Es la propia empresa."],
      ["MAL", "Su ISIN no es válido."],
      ["OTRF", expect.stringMatching(/falta tu nombre y email para la SEC/)],
    ]);
    // La IA recibe el país y el ISIN de la empresa
    expect(JSON.stringify(claude.requests[0]!.body.messages)).toContain(`\\"isin\\":\\"${FAKE_ISIN}\\"`);
  });

  it("descarga la competidora por ESEF sin meterla en tu watchlist ni pedirte sus informes", async () => {
    const { db, eu, securityId, deps } = await setupEu();
    const { stored } = await proposePeers(deps, securityId);
    const r = await linkPeers({ db, sec: null, eu: eu.client, prices: null }, securityId, stored.accepted, "ai-validated");
    expect(r).toEqual({ added: ["FMD"], failed: [] });
    const [peer] = await listPeers(db, securityId);
    expect([peer!.ticker, peer!.in_watchlist]).toEqual(["FMD", 0]);
    expect(await getDocumentRequests(db, peer!.peer_id)).toEqual([]);
    // Ya guardada: no se vuelve a descargar
    const before = eu.calls.length;
    await linkPeers({ db, sec: null, eu: eu.client, prices: null }, securityId, stored.accepted, "ai-validated");
    expect(eu.calls.length).toBe(before);
  });

  it("rechaza un ISIN que es de otra empresa y no deja nada guardado", async () => {
    const { db, eu, securityId } = await setupEu();
    const r = await linkPeers({ db, sec: null, eu: eu.client, prices: null }, securityId, [{ ticker: "ZZZ", name: "Empresa Distinta", isin: FAKE_PEER_ISIN, reason: null }], "ai-validated");
    expect(r.failed[0]!.message).toMatch(/es de Ficticia Moda SE, no de Empresa Distinta/);
    const left = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM securities");
    expect(left[0]!.n).toBe(1);
  });

  it("reconoce la misma empresa por una palabra del nombre o por el ticker", () => {
    expect(sameCompany({ name: "Hennes & Mauritz", ticker: "HM-B" }, { name: "H & M HENNES & MAURITZ AB", tickers: [] })).toBe(true);
    expect(sameCompany({ name: "H&M", ticker: "HM-B" }, { name: "H & M HENNES & MAURITZ AB", tickers: ["HMB SS"] })).toBe(true);
    expect(sameCompany({ name: "Inditex", ticker: "ITX" }, { name: "INDUSTRIA DE DISEÑO TEXTIL, S.A.", tickers: ["ITX"] })).toBe(true);
    expect(sameCompany({ name: "Zalando", ticker: "ZAL" }, { name: "INDUSTRIA DE DISEÑO TEXTIL, S.A.", tickers: ["ITX"] })).toBe(false);
  });
});
