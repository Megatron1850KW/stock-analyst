import Database from "@tauri-apps/plugin-sql";
import { inDesktopApp } from "./runtime";

/**
 * SQLite local. Las migraciones las aplica Rust al cargar la base
 * (src-tauri/src/lib.rs, a partir de src/db/migrations/*.sql).
 * La ruta es relativa a ~/Library/Application Support/<identificador>/.
 */
export const DB_URL = "sqlite:agente-financiero.db";

let db: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!inDesktopApp) return Promise.reject(new Error("La base de datos solo existe en la app de escritorio"));
  db ??= Database.load(DB_URL);
  return db;
}

export interface DbStatus {
  connected: boolean;
  tables: string[];
  schemaVersion: number | null;
  error?: string;
}

export async function getDbStatus(): Promise<DbStatus> {
  if (!inDesktopApp) return { connected: false, tables: [], schemaVersion: null, error: "Vista previa en navegador" };
  try {
    const conn = await getDb();
    const rows = await conn.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sqlx_%' ORDER BY name",
    );
    const version = await conn.select<{ version: number | null }[]>("SELECT MAX(version) AS version FROM _sqlx_migrations");
    return { connected: true, tables: rows.map((r) => r.name), schemaVersion: version[0]?.version ?? null };
  } catch (e) {
    return { connected: false, tables: [], schemaVersion: null, error: String(e) };
  }
}
