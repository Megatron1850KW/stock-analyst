/** Base real de la app y copia de un archivo a su carpeta de documentos, igual que la app (para las herramientas de tests/real). */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db } from "@/db/client";

export function openAppDb(dbPath: string): Db & { close: () => void } {
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    execute: async (sql, params = []) => {
      const r = raw.prepare(sql).run(...(params as SQLInputValue[]));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    select: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as SQLInputValue[])) as T[],
    close: () => raw.close(),
  };
}

/** Igual que safe_name en src-tauri/src/documents.rs. */
function safeName(original: string, ext: string): string {
  const stem = basename(original, extname(original));
  const clean = [...stem].slice(0, 80).map((c) => (/[\p{L}\p{N}_-]/u.test(c) ? c : "-")).join("").replace(/^-+|-+$/g, "");
  return `${clean || "informe"}.${ext}`;
}

export async function securityByIsin(db: Db, isin: string): Promise<{ id: number; name: string }> {
  const [security] = await db.select<{ id: number; name: string }>("SELECT id, name FROM securities WHERE isin = ?", [isin]);
  if (!security) throw new Error(`No hay ningún valor con ISIN ${isin} en la app.`);
  return security;
}

/** Copia el archivo a documents/<id del valor>/ junto a la base, como store() en documents.rs. */
export function storeLikeApp(dbPath: string, securityId: number, file: string) {
  const data = readFileSync(file);
  const head = data.subarray(0, 5).toString("latin1");
  const kind = head.startsWith("%PDF-") ? ("pdf" as const) : head.startsWith("PK") ? ("zip" as const) : null;
  if (!kind) throw new Error("El archivo no es un PDF ni un ZIP.");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const dir = join(dirname(dbPath), "documents", String(securityId));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sha256.slice(0, 12)}-${safeName(basename(file), kind)}`);
  if (!existsSync(path)) copyFileSync(file, path);
  return { path, sha256, bytes: data.length, kind, name: basename(file) };
}
