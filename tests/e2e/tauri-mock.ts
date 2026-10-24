import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Page } from "@playwright/test";
import { FAKE_ANALYSIS, fakeReportHtml } from "../helpers/fake-claude";
import { fakeDaily } from "../helpers/fake-prices";
import { avQuoteJson, avSearchJson, avSeriesJson } from "../helpers/fake-alphavantage";
import { fakeEu } from "../helpers/fake-eu";

/**
 * Simula el lado Rust de Tauri para los tests de UI en el navegador:
 * SQLite real (node:sqlite con las migraciones de la app), ajustes y llavero
 * en memoria y respuestas de la SEC, de FMP y de las fuentes europeas con
 * los datos FICTICIOS de tests/fixtures/ficticio y tests/helpers/fake-eu. Nada de esto se usa en la app.
 */
const root = process.cwd();
const fixture = (name: string) => readFileSync(join(root, "tests/fixtures/ficticio", `${name}.json`), "utf8");

export interface MockOptions {
  settings?: Record<string, unknown>;
  secrets?: string[];
  /** Precio ficticio que devuelve el proveedor. */
  price?: number;
  /** Servir los datos REALES guardados de la SEC (MU y GOOG) en vez de los ficticios. */
  realSec?: boolean;
  /** Respuesta de la IA (por defecto, el análisis FICTICIO de tests/helpers/fake-claude). */
  analysis?: unknown;
  /** Competidores que propone la IA (por defecto, los REALES guardados o dos FICTICIOS). */
  peers?: unknown;
}

/** Propuesta FICTICIA de competidores (existen en tests/fixtures/ficticio/tickers.json). */
const FAKE_PEERS = {
  competidores: [
    { ticker: "OTRF", nombre: "Otra Ficticia", mercado: "EEUU", isin: null, motivo: "También vende piezas industriales (ficticio)." },
    { ticker: "FIC.B", nombre: "Ficticia clase B", mercado: "EEUU", isin: null, motivo: "Negocio parecido (ficticio)." },
  ],
  nota: "",
};

/** Lee un fixture REAL, en claro o comprimido (.gz), si existe. */
function readReal(path: string): string | null {
  if (existsSync(path)) return readFileSync(path, "utf8");
  if (existsSync(`${path}.gz`)) return gunzipSync(readFileSync(`${path}.gz`)).toString("utf8");
  return null;
}
const secDir = join(root, "tests/fixtures/sec");
/** Empresas REALES guardadas (MU, GOOG y sus competidores): CIK → ticker. */
const REAL_CIKS: Record<string, string> = {};
const realNames: [number, string, string, string][] = [];
for (const f of readdirSync(secDir).filter((x) => /-submissions\.json(\.gz)?$/.test(x))) {
  const ticker = f.replace(/-submissions\.json(\.gz)?$/, "");
  const subs = JSON.parse(readReal(join(secDir, `${ticker}-submissions.json`))!) as { cik: string; name: string; exchanges?: string[] };
  REAL_CIKS[String(Number(subs.cik))] = ticker;
  realNames.push([Number(subs.cik), subs.name, ticker, subs.exchanges?.[0] ?? "Nasdaq"]);
}
const realTickers = JSON.stringify({ fields: ["cik", "name", "ticker", "exchange"], data: realNames });
/** Precios REALES guardados (tests/fixtures/prices), si existen para ese símbolo. */
function realPrices(symbol: string, kind: "history" | "splits" | "quote" = "history"): string | null {
  return readReal(join(root, "tests/fixtures/prices", `${symbol}-${kind}.json`));
}
/** Informe de gestión FICTICIO en español para los extractos europeos. */
const fakeEuReportHtml = ["Modelo de negocio", "Principales riesgos", "Evolución previsible"]
  .map((h) => `<h2>${h}</h2>` + Array.from({ length: 10 }, (_, k) => `<p>${h} ${k}: texto ficticio de Ficticia Textil para la prueba.</p>`).join(""))
  .join("");
const realFile = (ticker: string, kind: string) => readReal(join(secDir, `${ticker}-${kind}.json`))!;

export async function installTauriMock(page: Page, opts: MockOptions = {}) {
  const db = new DatabaseSync(":memory:");
  const migrations = join(root, "src/db/migrations");
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, f), "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  // La app consulta esta tabla para mostrar la versión del esquema
  db.exec("CREATE TABLE _sqlx_migrations (version INTEGER); INSERT INTO _sqlx_migrations VALUES (1), (2), (3), (4), (5), (6);");

  const store = new Map<string, unknown>(opts.settings ? [["settings", opts.settings]] : []);
  const secrets = new Set(opts.secrets ?? []);
  const calls: string[] = [];
  const uploads: string[] = [];
  /** Qué se pidió a la IA en cada llamada: "analysis" o "peers". */
  const ai: string[] = [];

  const eu = fakeEu().client;
  /** Alpha Vantage FICTICIO (tests/helpers/fake-alphavantage): pide su propia clave. */
  const alphaVantage = (body: () => string) => {
    if (!secrets.has("alphavantage_api_key")) throw "Falta la clave de Alpha Vantage (precios europeos). Añádela en Ajustes.";
    return body();
  };
  await page.exposeFunction("__pwInvoke", async (cmd: string, args: Record<string, unknown>) => {
    calls.push(cmd);
    const values = (args.values as SQLInputValue[] | undefined) ?? [];
    switch (cmd) {
      case "plugin:sql|load":
        return args.db;
      case "plugin:sql|select":
        return db.prepare(args.query as string).all(...values);
      case "plugin:sql|execute": {
        const r = db.prepare(args.query as string).run(...values);
        return [Number(r.changes), Number(r.lastInsertRowid)];
      }
      case "plugin:store|load":
        return 1;
      case "plugin:store|get":
        return [store.get(args.key as string) ?? null, store.has(args.key as string)];
      case "plugin:store|set":
        store.set(args.key as string, args.value);
        return null;
      case "plugin:store|save":
        return null;
      case "plugin:autostart|is_enabled":
        return false;
      case "plugin:autostart|enable":
      case "plugin:autostart|disable":
        return null;
      case "secret_exists":
        return secrets.has(args.name as string);
      case "secret_set":
        secrets.add(args.name as string);
        return null;
      case "secret_delete":
        secrets.delete(args.name as string);
        return null;
      case "sec_fetch": {
        if (opts.realSec) {
          if (args.resource === "tickers") return realTickers;
          // Páginas antiguas de presentaciones: no se guardan (META las pide); se sirve una vacía
          if (args.resource === "submissions_file") return JSON.stringify({ accessionNumber: [], filingDate: [], reportDate: [], form: [], primaryDocument: [] });
          const ticker = REAL_CIKS[String(Number(args.cik))];
          if (!ticker) throw new Error("CIK no guardado");
          return realFile(ticker, args.resource === "submissions" ? "submissions" : "companyfacts");
        }
        const map: Record<string, string> = { tickers: "tickers", submissions: "submissions", company_facts: "companyfacts" };
        const name = map[args.resource as string];
        if (!name) throw new Error("recurso no simulado");
        return fixture(name);
      }
      case "price_quote": {
        if (args.provider === "alphavantage") return alphaVantage(() => avQuoteJson(args.symbol as string, opts.price ?? 38.4));
        if (!secrets.has("prices_api_key")) throw "Falta la clave del proveedor de precios. Añádela en Ajustes.";
        const realQuote = realPrices(args.symbol as string, "quote");
        if (realQuote) return realQuote;
        if (args.provider === "tiingo") return JSON.stringify([{ date: "2026-10-23T00:00:00.000Z", close: opts.price ?? 42.5, splitFactor: 1 }]);
        return JSON.stringify([{ symbol: args.symbol, price: opts.price ?? 42.5, timestamp: 1792785600 }]);
      }
      case "price_history": {
        if (!secrets.has("prices_api_key")) throw "Falta la clave del proveedor de precios. Añádela en Ajustes.";
        const real = realPrices(args.symbol as string);
        if (real) return real;
        // FICTICIO: curva suave que acaba cerca del precio simulado
        const bars = fakeDaily(args.from as string, "2026-10-23", (opts.price ?? 42.5) / 2.6, 0.09);
        if (args.provider === "tiingo") return JSON.stringify(bars.map((b) => ({ ...b, date: `${b.date}T00:00:00.000Z`, splitFactor: 1 })));
        return JSON.stringify(bars.reverse().map((b) => ({ symbol: args.symbol, ...b })));
      }
      case "document_store": {
        // El navegador envía {head, length, headers}: ver addInitScript
        const head = String.fromCharCode(...((args.head as number[]) ?? []));
        if (!head.startsWith("%PDF-") && !head.startsWith("PK")) throw "El archivo no es un PDF ni un ZIP. Sube el informe en PDF o el paquete ESEF (.zip).";
        const headers = (args.headers as Record<string, string>) ?? {};
        const name = decodeURIComponent(headers["x-file-name"] ?? "informe.pdf");
        const sha = createHash("sha256").update(name + String(args.length)).digest("hex");
        uploads.push(name);
        return { path: `/simulado/documents/${headers["x-security-id"]}/${sha.slice(0, 12)}-${name}`, sha256: sha, bytes: args.length, kind: head.startsWith("%PDF-") ? "pdf" : "zip" };
      }
      case "document_open":
      case "document_delete":
        return null;
      case "sec_document": {
        // Informe REAL guardado (MU, GOOG) si existe; si no, el 10-K FICTICIO
        const m = /data\/(\d+)\/(\d{18})\//.exec(args.url as string);
        const ticker = m ? REAL_CIKS[m[1]!] : undefined;
        const file = ticker && join(root, "tests/fixtures/sec-docs", `${ticker}-${m![2]}.htm.gz`);
        const html = file && existsSync(file) ? gunzipSync(readFileSync(file)).toString("utf8") : fakeReportHtml("10-K");
        return { html, path: `/simulado/documents/sec/${m?.[1]}/${m?.[2]}/informe.htm`, cached: false };
      }
      case "claude_request": {
        if (!secrets.has("anthropic_api_key")) throw "Falta la clave de Claude. Añádela en Ajustes.";
        const body = JSON.parse(args.body as string) as { model: string; system: { text: string }[]; messages: { content: string }[] };
        const ticker = /"ticker": ?"([A-Z.-]+)"/.exec(body.messages[0]!.content)?.[1];
        const isPeers = body.system[0]!.text.includes("competidores");
        ai.push(isPeers ? "peers" : "analysis");
        let analysis: unknown;
        if (isPeers) {
          // Propuesta REAL guardada (Claude Haiku 5.5) para MU y GOOG; FICTICIA para el resto
          const realPeers = ticker && join(root, "tests/fixtures/ai", `${ticker}-peers.json`);
          analysis = opts.peers ?? (realPeers && existsSync(realPeers) ? JSON.parse(readFileSync(realPeers, "utf8")).proposal : FAKE_PEERS);
          // Las propuestas REALES guardadas son de la versión 1 del prompt (todas de EE. UU., sin mercado ni ISIN)
          const v1 = analysis as { competidores: Record<string, unknown>[] };
          v1.competidores = v1.competidores.map((c) => ({ mercado: "EEUU", isin: null, ...c }));
        } else {
          // Análisis REAL guardado (Claude Sonnet 5.5, 24-10-2026) para MU y GOOG; FICTICIO para el resto
          const realAi = ticker && join(root, "tests/fixtures/ai", `${ticker}-analysis.json`);
          analysis = opts.analysis ?? (realAi && existsSync(realAi) ? JSON.parse(readFileSync(realAi, "utf8")).analysis : FAKE_ANALYSIS);
        }
        const message = {
          id: "msg_ficticio",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: JSON.stringify(analysis) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: isPeers
            ? { input_tokens: 800, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
            : { input_tokens: 30_000, output_tokens: 4_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
        return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(message) };
      }
      case "eu_fetch": {
        // Europa FICTICIA: «Ficticia Textil» (tests/helpers/fake-eu)
        const id = args.id as string;
        if (args.resource === "lei_by_isin") {
          const r = await eu.leiByIsin(id);
          return JSON.stringify({ data: r ? [{ attributes: { lei: r.lei, entity: { legalName: { name: r.name }, legalAddress: { country: r.country } } } }] : [] });
        }
        if (args.resource === "figi") return JSON.stringify([{ data: await eu.figi(id) }]);
        if (args.resource === "esef_filings") return JSON.stringify({ data: await eu.esefFilings(id) });
        throw new Error("recurso no simulado");
      }
      case "esef_document":
        return { text: JSON.stringify(await eu.esefDocument(args.path as string)), path: `/simulado/documents/esef${args.path as string}`, cached: false };
      case "esef_report":
        return { text: fakeEuReportHtml, path: "/simulado/documents/esef/informe.xhtml", cached: false };
      case "price_series":
        return alphaVantage(() => avSeriesJson(args.interval as "weekly" | "monthly"));
      case "price_search":
        return alphaVantage(() => avSearchJson());
      case "price_splits":
        if (!secrets.has("prices_api_key")) throw "Falta la clave del proveedor de precios. Añádela en Ajustes.";
        return realPrices(args.symbol as string, "splits") ?? "[]";
      default:
        throw new Error(`Comando no simulado: ${cmd}`);
    }
  });

  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) => {
        // Los cuerpos binarios no viajan bien a Node: se mandan la firma y el tamaño
        if (args instanceof Uint8Array) args = { head: Array.from(args.slice(0, 8)), length: args.length, headers: options?.headers ?? {} };
        try {
          return await (w.__pwInvoke as (c: string, a: unknown) => Promise<unknown>)(cmd, args ?? {});
        } catch (e) {
          // Tauri entrega los errores de Rust como texto
          throw e instanceof Error ? e.message : e;
        }
      },
      transformCallback: () => 0,
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
      convertFileSrc: (p: string) => p,
    };
  });

  return { db, calls, uploads, ai };
}
