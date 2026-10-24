import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db } from "@/db/client";

const MIGRATIONS = join(__dirname, "../../src/db/migrations");

/** Base SQLite en memoria con las mismas migraciones que la app. Solo para tests. */
export function memoryDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    raw,
    execute: async (sql, params = []) => {
      const r = raw.prepare(sql).run(...(params as SQLInputValue[]));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    select: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as SQLInputValue[])) as T[],
  };
}
