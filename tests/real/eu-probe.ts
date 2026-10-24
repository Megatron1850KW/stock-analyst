/**
 * Sondeo REAL de la fase 6 en el Mac de Pablo (la nube no llega a estas fuentes):
 *
 *   node eu-probe.mjs [carpeta]
 *
 * Para unas cuantas acciones europeas (por ISIN) descarga y guarda en <carpeta>/eu:
 * - GLEIF: ISIN → LEI (registro oficial de entidades).
 * - OpenFIGI: ISIN → tickers y bolsas.
 * - filings.xbrl.org: lista de informes ESEF y el xBRL-JSON de los últimos anuales.
 * - Alpha Vantage: búsqueda del símbolo, precio y velas mensuales (para ver si cubre
 *   cada bolsa). Plan gratis: 25 consultas al día, así que se gastan como mucho 15.
 *
 * La clave de Alpha Vantage se lee del Llavero (alphavantage_api_key), viaja en la
 * URL de la petición y NUNCA se escribe ni se muestra.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const [out = "af-fixtures"] = process.argv.slice(2);
const dir = join(out, "eu");
mkdirSync(join(dir, "esef"), { recursive: true });

const COMPANIES = [
  { isin: "ES0148396007", search: "Inditex" },
  { isin: "ES0144580Y14", search: "Iberdrola" },
  { isin: "DE0007164600", search: "SAP" },
  { isin: "FR0000121014", search: "LVMH" },
  { isin: "NL0010273215", search: "ASML" },
];
const ANNUALS = 6;

let avKey: string | null = null;
try {
  avKey = execFileSync("security", ["find-generic-password", "-s", "es.agentefinanciero.app", "-a", "alphavantage_api_key", "-w"], { encoding: "utf8" }).trim();
} catch {
  console.log("Aviso: no hay alphavantage_api_key en el Llavero; se omite Alpha Vantage.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const save = (name: string, text: string) => writeFileSync(join(dir, name), text);
const saveGz = (name: string, text: string) => writeFileSync(join(dir, `${name}.gz`), gzipSync(text));

async function get(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} → HTTP ${res.status}: ${text.slice(0, 160)}`);
  return text;
}

let avCalls = 0;
async function av(params: Record<string, string>): Promise<unknown> {
  if (!avKey) return null;
  avCalls++;
  await sleep(13_000); // el plan gratis limita también por minuto
  const url = new URL("https://www.alphavantage.co/query");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", avKey);
  const json = JSON.parse(await get(url.toString())) as Record<string, unknown>;
  for (const k of ["Information", "Note", "Error Message"]) {
    if (typeof json[k] === "string") return { [k]: (json[k] as string).replace(avKey, "***") };
  }
  return json;
}

interface Summary {
  isin: string;
  lei?: string;
  name?: string;
  figi?: string;
  esef?: string;
  av?: string;
}
const summary: Summary[] = [];

for (const c of COMPANIES) {
  const s: Summary = { isin: c.isin };
  summary.push(s);
  console.log(`\n== ${c.search} (${c.isin}) ==`);
  try {
    const gleif = await get(`https://api.gleif.org/api/v1/lei-records?filter[isin]=${c.isin}`, { headers: { Accept: "application/vnd.api+json" } });
    save(`gleif-${c.isin}.json`, gleif);
    const rec = JSON.parse(gleif).data?.[0]?.attributes;
    s.lei = rec?.lei;
    s.name = rec?.entity?.legalName?.name;
    console.log(`GLEIF: ${s.lei} · ${s.name}`);
  } catch (e) {
    console.log(`GLEIF falló: ${(e as Error).message}`);
  }

  try {
    await sleep(2600); // OpenFIGI sin clave: 25 peticiones por minuto
    const figi = await get("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: c.isin, securityType2: "Common Stock" }]),
    });
    save(`figi-${c.isin}.json`, figi);
    const rows = (JSON.parse(figi)[0]?.data ?? []) as { ticker: string; exchCode: string; name: string }[];
    s.figi = rows.slice(0, 8).map((r) => `${r.ticker}:${r.exchCode}`).join(" ");
    console.log(`OpenFIGI: ${rows.length} líneas · ${s.figi}`);
  } catch (e) {
    console.log(`OpenFIGI falló: ${(e as Error).message}`);
  }

  if (s.lei) {
    try {
      const list = await get(`https://filings.xbrl.org/api/entities/${s.lei}/filings?page[size]=100`);
      save(`xbrlorg-${s.lei}.json`, list);
      const filings = (JSON.parse(list).data ?? []) as { attributes: { period_end: string; json_url: string | null; fxo_id: string; error_count: number } }[];
      // Un informe por cierre: el último añadido (las reediciones llevan sufijo -1, -2…)
      const byPeriod = new Map<string, (typeof filings)[number]>();
      for (const f of filings) {
        const prev = byPeriod.get(f.attributes.period_end);
        if (!prev || f.attributes.fxo_id > prev.attributes.fxo_id) byPeriod.set(f.attributes.period_end, f);
      }
      const latest = [...byPeriod.values()].sort((a, b) => b.attributes.period_end.localeCompare(a.attributes.period_end)).slice(0, ANNUALS);
      s.esef = `${filings.length} informes · cierres ${latest.map((f) => f.attributes.period_end).join(", ")}`;
      console.log(`filings.xbrl.org: ${s.esef}`);
      for (const f of latest) {
        if (!f.attributes.json_url) {
          console.log(`  ${f.attributes.period_end}: sin xBRL-JSON`);
          continue;
        }
        await sleep(500);
        const json = await get(`https://filings.xbrl.org${f.attributes.json_url}`);
        saveGz(`esef/${s.lei}-${f.attributes.period_end}.json`, json);
        console.log(`  ${f.attributes.period_end}: ${(json.length / 1e6).toFixed(1)} MB`);
      }
    } catch (e) {
      console.log(`filings.xbrl.org falló: ${(e as Error).message}`);
    }
  }

  if (avKey) {
    try {
      const search = (await av({ function: "SYMBOL_SEARCH", keywords: c.search })) as { bestMatches?: Record<string, string>[] } | null;
      save(`av-search-${c.isin}.json`, JSON.stringify(search, null, 1));
      const matches = search?.bestMatches ?? [];
      console.log(`Alpha Vantage busca «${c.search}»: ${matches.map((m) => `${m["1. symbol"]} (${m["4. region"]}, ${m["8. currency"]})`).join("; ") || JSON.stringify(search)}`);
      // Primero la bolsa de su país; si no, cualquier europea
      const region = { ES: "Spain", DE: "Frankfurt", FR: "Paris", NL: "Amsterdam" }[c.isin.slice(0, 2)] ?? "";
      const pick = matches.find((m) => m["4. region"]?.includes(region)) ?? matches.find((m) => m["8. currency"] === "EUR");
      if (pick) {
        const symbol = pick["1. symbol"]!;
        const quote = await av({ function: "GLOBAL_QUOTE", symbol });
        save(`av-quote-${symbol}.json`, JSON.stringify(quote, null, 1));
        const monthly = (await av({ function: "TIME_SERIES_MONTHLY_ADJUSTED", symbol })) as Record<string, Record<string, unknown>> | null;
        save(`av-monthly-${symbol}.json`, JSON.stringify(monthly, null, 1));
        const months = Object.keys(monthly?.["Monthly Adjusted Time Series"] ?? {}).sort();
        s.av = `${symbol}: ${months.length} meses (${months[0] ?? "—"} → ${months.at(-1) ?? "—"}) · precio ${JSON.stringify((quote as Record<string, Record<string, string>>)?.["Global Quote"]?.["05. price"] ?? quote)}`;
      } else {
        s.av = "sin símbolo europeo";
      }
      console.log(`Alpha Vantage: ${s.av}`);
    } catch (e) {
      console.log(`Alpha Vantage falló: ${(e as Error).message}`);
    }
  }
}

save("summary.json", JSON.stringify(summary, null, 1));
console.log(`\nConsultas a Alpha Vantage: ${avCalls} (de 25 al día). Listo: ${dir}`);
