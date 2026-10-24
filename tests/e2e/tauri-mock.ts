import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Page } from "@playwright/test";
import { FAKE_ANALYSIS, fakeReportHtml } from "../helpers/fake-claude";
import { fakeDaily } from "../helpers/fake-prices";

/**
 * Simula el lado Rust de Tauri para los tests de UI en el navegador:
 * SQLite real (node:sqlite con las migraciones de la app), ajustes y llavero
 * en memoria y respuestas de la SEC y de FMP con los datos FICTICIOS de
 * tests/fixtures/ficticio. Nada de esto se usa en la app.
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
}

const REAL_CIKS: Record<string, string> = { "723125": "MU", "1652044": "GOOG" };
const realTickers = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"],
    [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
  ],
});
/** Precios REALES guardados (tests/fixtures/prices), si existen para ese símbolo. */
function realPrices(symbol: string, kind: "history" | "splits" | "quote" = "history"): string | null {
  const file = join(root, "tests/fixtures/prices", `${symbol}-${kind}.json`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
const realFile = (ticker: string, kind: string) => readFileSync(join(root, "tests/fixtures/sec", `${ticker}-${kind}.json`), "utf8");

export async function installTauriMock(page: Page, opts: MockOptions = {}) {
  const db = new DatabaseSync(":memory:");
  const migrations = join(root, "src/db/migrations");
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, f), "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  // La app consulta esta tabla para mostrar la versión del esquema
  db.exec("CREATE TABLE _sqlx_migrations (version INTEGER); INSERT INTO _sqlx_migrations VALUES (1), (2), (3);");

  const store = new Map<string, unknown>(opts.settings ? [["settings", opts.settings]] : []);
  const secrets = new Set(opts.secrets ?? []);
  const calls: string[] = [];
  const uploads: string[] = [];

  await page.exposeFunction("__pwInvoke", (cmd: string, args: Record<string, unknown>) => {
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
        return file && existsSync(file) ? gunzipSync(readFileSync(file)).toString("utf8") : fakeReportHtml("10-K");
      }
      case "claude_request": {
        if (!secrets.has("anthropic_api_key")) throw "Falta la clave de Claude. Añádela en Ajustes.";
        const body = JSON.parse(args.body as string) as { model: string; messages: { content: string }[] };
        // Análisis REAL guardado (Claude Sonnet 5.5, 24-10-2026) para MU y GOOG; FICTICIO para el resto
        const ticker = /"ticker": "([A-Z]+)"/.exec(body.messages[0]!.content)?.[1];
        const realAi = ticker && join(root, "tests/fixtures/ai", `${ticker}-analysis.json`);
        const analysis = opts.analysis ?? (realAi && existsSync(realAi) ? JSON.parse(readFileSync(realAi, "utf8")).analysis : FAKE_ANALYSIS);
        const message = {
          id: "msg_ficticio",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: JSON.stringify(analysis) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 30_000, output_tokens: 4_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
        return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(message) };
      }
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

  return { db, calls, uploads };
}
