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
import { memoryDb } from "../../../tests/helpers/sqlite-db";
import { proposePeers, type ProposeDeps } from "./propose";
import { linkPeers } from "./sync";

// Propuesta FICTICIA: uno bueno, la propia empresa, uno que no existe y otro bueno
const PROPOSAL = {
  competidores: [
    { ticker: "OTRF", nombre: "Otra Ficticia", motivo: "También vende piezas (ficticio)." },
    { ticker: "FICT", nombre: "Ficticia", motivo: "Es ella misma." },
    { ticker: "NOEXISTE", nombre: "Inventada", motivo: "No cotiza." },
    { ticker: "FIC.B", nombre: "Ficticia clase B", motivo: "Negocio parecido (ficticio)." },
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
    const r = await linkPeers({ db, sec, prices: fakePrices({ calls }) }, securityId, stored.accepted, "ai-validated");
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
    await linkPeers({ db, sec, prices: null }, securityId, [{ ticker: "OTRF", cik: "8888888", reason: null }], "user");
    expect(sec.calls.length).toBe(before);
    expect((await listWatchlist(db)).map((w) => w.ticker)).toEqual(["FICT", "OTRF"]);
  });

  it("al quitar un valor se borran los competidores que ya nadie usa", async () => {
    const { db, sec, securityId, deps } = await setup();
    const { stored } = await proposePeers(deps, securityId);
    await linkPeers({ db, sec, prices: null }, securityId, stored.accepted, "ai-validated");
    await removeFromWatchlist(db, securityId);
    const left = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM securities");
    expect(left[0]!.n).toBe(0);
  });

  it("la cotización de un competidor se renueva como mucho cada 7 días; la de tu watchlist, siempre", async () => {
    const { db, sec, securityId } = await setup();
    await linkPeers({ db, sec, prices: null }, securityId, [{ ticker: "OTRF", reason: null }], "ai-validated");
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
