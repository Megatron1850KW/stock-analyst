import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db } from "@/db/client";

// Todas las migraciones de la app, en orden
const migrations = import.meta.glob<string>("../../src/db/migrations/*.sql", { query: "?raw", import: "default", eager: true });

/** SQLite en memoria con el esquema de la app (para las pruebas reales en el Mac). */
export function memoryDb(): Db {
  const raw = new DatabaseSync(":memory:");
  for (const name of Object.keys(migrations).sort()) raw.exec(migrations[name]!);
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    execute: async (sql, params = []) => {
      const r = raw.prepare(sql).run(...(params as SQLInputValue[]));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    select: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as SQLInputValue[])) as T[],
  };
}
