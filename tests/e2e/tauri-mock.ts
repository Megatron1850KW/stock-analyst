import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Page } from "@playwright/test";

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
}

const REAL_CIKS: Record<string, string> = { "723125": "MU", "1652044": "GOOG" };
const realTickers = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"],
    [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
  ],
});
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
      case "price_quote":
        if (!secrets.has("prices_api_key")) throw "Falta la clave del proveedor de precios. Añádela en Ajustes.";
        return JSON.stringify([{ symbol: args.symbol, price: opts.price ?? 42.5, timestamp: 1792785600 }]);
      default:
        throw new Error(`Comando no simulado: ${cmd}`);
    }
  });

  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
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

  return { db, calls };
}
