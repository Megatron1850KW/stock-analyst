/**
 * Prueba REAL de la fase 5 en el Mac de Pablo (la nube no llega a la SEC):
 *
 *   node peers-real.mjs "Nombre email" [carpeta] [MU,GOOG]
 *
 * Para cada valor, con datos en vivo y el mismo código de la app:
 * - Lo importa de la SEC y pide su precio a Tiingo.
 * - Reutiliza su análisis IA guardado (<carpeta>/ai/<T>-analysis.json), si existe, para que
 *   la IA conozca su modelo de negocio (igual que en la app).
 * - Pide a Claude Haiku 5.5 sus competidores (una llamada), los valida contra la
 *   lista oficial de la SEC y descarga sus cifras y precios.
 * - Imprime la comparativa y el veredicto «¿oportunidad o trampa?».
 * - Guarda en <carpeta> lo descargado (recortado y comprimido) para los tests sin conexión.
 *
 * Las claves se leen del Llavero (anthropic_api_key, prices_api_key), viajan en
 * una cabecera y NUNCA se escriben ni se muestran.
 *
 * Se empaqueta con `npm run build:real` (vite.real.config.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createClaudeClient } from "@/data/claude/client";
import { parseTiingoHistory, parseTiingoQuote, type PriceProvider } from "@/data/prices/provider";
import type { SecClient } from "@/data/sec-edgar/client";
import { companyFactsSchema, filingColumnsSchema, submissionsSchema, tickersExchangeSchema } from "@/data/sec-edgar/schemas";
import { monthSpend, saveAnalysis } from "@/db/ai-repo";
import { CONCEPTS } from "@/domain/fundamentals/concepts";
import { refreshPrices } from "@/features/prices/refresh";
import { loadPeerGroup } from "@/features/peers/load";
import { proposePeers } from "@/features/peers/propose";
import { linkPeers, memoTickers } from "@/features/peers/sync";
import { importUsTicker } from "@/features/watchlist/import-us";
import { memoryDb } from "./memory-db";

const [ua, out = "af-fixtures", tickers = "MU,GOOG"] = process.argv.slice(2);
if (!ua || !/@/.test(ua)) throw new Error('Uso: node peers-real.mjs "Nombre email" [carpeta] [MU,GOOG]');
const userAgent: string = ua;

const keychain = (account: string) => {
  try {
    return execFileSync("security", ["find-generic-password", "-s", "es.agentefinanciero.app", "-a", account, "-w"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`No hay ${account} en el Llavero. Guárdala primero desde Ajustes.`);
  }
};
const claudeKey = keychain("anthropic_api_key");
const pricesKey = keychain("prices_api_key");

for (const d of ["sec", "prices", "ai"]) mkdirSync(join(out, d), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const save = (path: string, text: string) => writeFileSync(join(out, `${path}.gz`), gzipSync(text));

// Solo las etiquetas XBRL que usa la app, de 10-K/10-Q/20-F/40-F desde 2013 (como fetch-real.mjs)
const TAGS = new Set(CONCEPTS.flatMap((c) => c.tags.map((t) => t.tag)));
const FORMS = new Set(["10-K", "10-Q", "20-F", "40-F"]);
function trimFacts(raw: { facts: Record<string, Record<string, { units: Record<string, { form: string; filed: string }[]> }>> }) {
  for (const [tax, concepts] of Object.entries(raw.facts)) {
    for (const tag of Object.keys(concepts)) {
      if (!TAGS.has(tag)) {
        delete concepts[tag];
        continue;
      }
      for (const [unit, entries] of Object.entries(concepts[tag]!.units)) concepts[tag]!.units[unit] = entries.filter((e) => FORMS.has(e.form) && e.filed >= "2013-01-01");
    }
    if (Object.keys(concepts).length === 0) delete raw.facts[tax];
  }
  return raw;
}

async function secGet(url: string): Promise<string> {
  await sleep(150); // ≤10 peticiones por segundo
  const res = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" } });
  if (!res.ok) throw new Error(`SEC ${url} → HTTP ${res.status}`);
  return res.text();
}
const cikTicker = new Map<string, string>();
const liveSec: SecClient = memoTickers({
  tickers: async () => tickersExchangeSchema.parse(JSON.parse(await secGet("https://www.sec.gov/files/company_tickers_exchange.json"))),
  submissions: async (cik) => {
    const text = await secGet(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
    const parsed = submissionsSchema.parse(JSON.parse(text));
    cikTicker.set(cik, parsed.tickers?.[0] ?? cik);
    save(`sec/${cikTicker.get(cik)}-submissions.json`, text);
    return parsed;
  },
  submissionsFile: async (name) => filingColumnsSchema.parse(JSON.parse(await secGet(`https://data.sec.gov/submissions/${name}`))),
  companyFacts: async (cik) => {
    const raw = JSON.parse(await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`));
    const parsed = companyFactsSchema.parse(raw);
    save(`sec/${cikTicker.get(cik) ?? cik}-companyfacts.json`, JSON.stringify(trimFacts(raw)));
    return parsed;
  },
});

async function tiingo(symbol: string, startDate: string | null): Promise<string> {
  const url = new URL(`https://api.tiingo.com/tiingo/daily/${symbol.toLowerCase()}/prices`);
  if (startDate) url.searchParams.set("startDate", startDate);
  await sleep(300);
  const res = await fetch(url, { headers: { Authorization: `Token ${pricesKey}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Tiingo ${symbol} → HTTP ${res.status}: ${text.slice(0, 160)}`);
  save(`prices/${symbol}-${startDate ? "history" : "quote"}.json`, text);
  return text;
}
const livePrices: PriceProvider = {
  id: "tiingo",
  label: "Tiingo",
  quote: async (s) => parseTiingoQuote(await tiingo(s, null), s),
  history: async (s) => parseTiingoHistory(await tiingo(s, "2015-01-01")),
};

const sent: unknown[] = [];
const claudeFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("x-api-key", claudeKey);
  sent.push({ url: String(input), beta: headers.get("anthropic-beta"), body: JSON.parse(String(init?.body)) });
  return fetch(input, { ...init, headers });
};

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);
const num = (v: number | null) => (v === null ? "—" : v.toFixed(1));

for (const t of tickers.split(",")) {
  const db = memoryDb();
  console.log(`\n== ${t} ==`);
  const { securityId } = await importUsTicker(liveSec, db, t);
  await refreshPrices(db, livePrices, securityId);

  // El análisis IA de la fase 4 (si está) da a la IA el modelo de negocio
  const aiFile = join(out, "ai", `${t}-analysis.json`);
  if (existsSync(aiFile)) {
    const { row } = JSON.parse(readFileSync(aiFile, "utf8"));
    await saveAnalysis(db, { securityId, filingIds: [], cacheKey: row.cache_key, model: row.model, promptVersion: row.prompt_version, resultJson: row.result_json, inputTokens: 0, outputTokens: 0, costEur: 0 });
  }

  sent.length = 0;
  const started = Date.now();
  const { stored } = await proposePeers({ db, client: createClaudeClient(claudeFetch), tickers: liveSec.tickers, model: "claude-haiku-5-5", budgetEur: 0 }, securityId);
  const spend = await monthSpend(db);
  console.log(`Claude Haiku 5.5: ${((Date.now() - started) / 1000).toFixed(0)} s · ${spend.eur.toFixed(5)} € (aprox.)`);
  console.log(`Propuestos: ${stored.proposal.competidores.map((c) => c.ticker).join(", ")}`);
  console.log(`Aceptados: ${stored.accepted.map((p) => `${p.ticker} (${p.reason})`).join("; ")}`);
  if (stored.rejected.length) console.log(`Descartados: ${stored.rejected.map((r) => `${r.ticker}: ${r.why}`).join("; ")}`);
  if (stored.proposal.nota) console.log(`Nota: ${stored.proposal.nota}`);
  writeFileSync(join(out, "ai", `${t}-peers.json`), JSON.stringify(stored, null, 1));
  writeFileSync(join(out, "ai", `${t}-peers-request.json`), JSON.stringify(sent, null, 1));

  const sync = await linkPeers({ db, sec: liveSec, prices: livePrices }, securityId, stored.accepted, "ai-validated");
  if (sync.failed.length) console.log(`Fallos: ${sync.failed.map((f) => `${f.ticker}: ${f.message}`).join("; ")}`);

  const group = await loadPeerGroup(db, securityId);
  console.log("Empresa  PER  EV/EBIT  FCF/precio  Ventas  Margen  Calidad  Vs.historia");
  for (const r of group.rows) {
    console.log(
      [r.ticker.padEnd(7), num(r.pe), num(r.evEbit), pct(r.fcfYield), pct(r.growth), pct(r.operatingMargin), r.quality === null ? "—" : Math.round(r.quality), r.historyVerdict ?? "—", r.missing ?? ""].join("  "),
    );
  }
  console.log(`Frente a la competencia: ${group.comparison?.verdict ?? "—"} (${pct(group.comparison?.deviation ?? null)})`);
  console.log(`Veredicto: ${group.verdict.outcome} — ${group.verdict.reason}`);
}
console.log("\nListo:", out);
