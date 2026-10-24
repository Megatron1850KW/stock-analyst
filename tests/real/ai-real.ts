/**
 * Prueba REAL de la fase 4 en el Mac de Pablo (la nube no llega a la SEC):
 *
 *   node ai-real.mjs "Nombre email" [carpeta] [MU,GOOG]
 *
 * - Usa los datos de la SEC y de Tiingo ya descargados en <carpeta> por fetch-real.mjs.
 * - Descarga de la SEC el último 10-K y 10-Q de cada valor (se guardan en <carpeta>/docs).
 * - Llama a Claude con la clave del Llavero (entrada anthropic_api_key), que viaja
 *   en una cabecera y NUNCA se escribe ni se muestra.
 * - Guarda en <carpeta>/ai el análisis validado, la petición enviada (sin clave) y el coste.
 *
 * Se empaqueta con `npm run build:ai-real` (vite.real.config.ts).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createClaudeClient } from "@/data/claude/client";
import { parseTiingoHistory, parseTiingoQuote, type PriceProvider } from "@/data/prices/provider";
import type { SecClient } from "@/data/sec-edgar/client";
import { companyFactsSchema, submissionsSchema } from "@/data/sec-edgar/schemas";
import type { Db } from "@/db/client";
import { getFilings } from "@/db/repo";
import { analysisFilings, parseStored, runEquityAnalysis } from "@/features/ai/equity-analysis";
import { refreshPrices } from "@/features/prices/refresh";
import { importUsTicker } from "@/features/watchlist/import-us";
import m1 from "../../src/db/migrations/0001_init.sql?raw";
import m2 from "../../src/db/migrations/0002_sec.sql?raw";
import m3 from "../../src/db/migrations/0003_ficha.sql?raw";

const [ua, out = "af-fixtures", tickers = "MU,GOOG"] = process.argv.slice(2);
if (!ua || !/@/.test(ua)) throw new Error('Uso: node ai-real.mjs "Nombre email" [carpeta] [MU,GOOG]');
const CIKS: Record<string, [number, string]> = { MU: [723125, "MICRON TECHNOLOGY INC"], GOOG: [1652044, "Alphabet Inc."] };

function memoryDb(): Db {
  const raw = new DatabaseSync(":memory:");
  for (const m of [m1, m2, m3]) raw.exec(m);
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    execute: async (sql, params = []) => {
      const r = raw.prepare(sql).run(...(params as SQLInputValue[]));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    select: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as SQLInputValue[])) as T[],
  };
}

const read = (...p: string[]) => readFileSync(join(out, ...p), "utf8");

const savedSec = (t: string): SecClient => ({
  tickers: async () => ({ fields: ["cik", "name", "ticker", "exchange"], data: [[CIKS[t]![0], CIKS[t]![1], t, "Nasdaq"]] }),
  submissions: async () => submissionsSchema.parse(JSON.parse(read("sec", `${t}-submissions.json`))),
  submissionsFile: async () => {
    throw new Error("no guardado");
  },
  companyFacts: async () => companyFactsSchema.parse(JSON.parse(read("sec", `${t}-companyfacts.json`))),
});

const savedPrices: PriceProvider = {
  id: "tiingo",
  label: "Tiingo",
  quote: async (s) => parseTiingoQuote(read("prices", `${s}-quote.json`), s),
  history: async (s) => parseTiingoHistory(read("prices", `${s}-history.json`)),
};

let key: string;
try {
  key = execFileSync("security", ["find-generic-password", "-s", "es.agentefinanciero.app", "-a", "anthropic_api_key", "-w"], { encoding: "utf8" }).trim();
} catch {
  throw new Error("No hay clave de Claude en el Llavero (entrada anthropic_api_key). Guárdala primero.");
}

// fetch directo a la API con la clave en cabecera; se registra la petición sin la clave
const sent: unknown[] = [];
const claudeFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("x-api-key", key);
  sent.push({ url: String(input), beta: headers.get("anthropic-beta"), body: JSON.parse(String(init?.body)) });
  return fetch(input, { ...init, headers });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(join(out, "docs"), { recursive: true });
mkdirSync(join(out, "ai"), { recursive: true });

for (const t of tickers.split(",")) {
  const db = memoryDb();
  const { securityId } = await importUsTicker(savedSec(t), db, t);
  await refreshPrices(db, savedPrices, securityId);
  const docs = analysisFilings(await getFilings(db, securityId));
  console.log(`${t}: informes para la IA → ${docs.map((d) => `${d.form_type} ${d.period_end}`).join(", ")}`);

  sent.length = 0;
  const started = Date.now();
  const r = await runEquityAnalysis(
    {
      db,
      client: createClaudeClient(claudeFetch),
      fetchDocument: async (url) => {
        await sleep(200);
        const res = await fetch(url, { headers: { "User-Agent": ua, Accept: "text/html" } });
        if (!res.ok) throw new Error(`SEC ${url} → HTTP ${res.status}`);
        const html = await res.text();
        writeFileSync(join(out, "docs", `${t}-${url.split("/").at(-2)}.htm`), html);
        console.log(`  ${url.split("/").at(-1)}: ${(html.length / 1e6).toFixed(1)} MB`);
        return html;
      },
      model: "claude-sonnet-5-5",
      budgetEur: 0,
    },
    securityId,
  );
  const stored = parseStored(r.row);
  writeFileSync(join(out, "ai", `${t}-analysis.json`), JSON.stringify({ row: r.row, stored }, null, 1));
  writeFileSync(join(out, "ai", `${t}-request.json`), JSON.stringify(sent, null, 1));
  console.log(
    `  Claude: ${stored?.servedModel} · ${r.row.input_tokens} tokens de entrada, ${r.row.output_tokens} de salida · ${r.row.cost_eur?.toFixed(3)} € (aprox.) · ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
  console.log(`  Veredicto IA: ${stored?.analysis.veredicto.postura}`);
}
console.log("Listo:", join(out, "ai"));
