/**
 * Sube un informe a la base REAL de la app y, si se le da, guarda sus cifras
 * leídas de un PDF. Hace lo mismo que «Subir informe» + «Leer con Claude.ai»
 * (mismas comprobaciones y esquema), para usarlo desde el Mac con la app CERRADA:
 *
 *   node import-report.mjs <base.db> <ISIN> <archivo> <annual|half|quarter|other> <AAAA-MM-DD> [prompt|respuesta.json]
 *
 * - Copia el archivo a documents/<id del valor>/ junto a la base, con el mismo
 *   nombre que le daría la app, y cierra la solicitud pendiente de ese cierre.
 * - «prompt» imprime el texto con las instrucciones para leer el PDF.
 * - Con un .json (respuesta en el formato del prompt) guarda las cifras como
 *   «extraída de PDF», con su página. No llama a ninguna API.
 *
 * Se empaqueta con `npm run build:real` (vite.real.config.ts).
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db } from "@/db/client";
import { buildManualPdfPrompt, saveManualPdf } from "@/features/document-requests/manual-pdf";
import { registerUpload, UPLOAD_KINDS, type UploadKind } from "@/features/document-requests/upload";

const [dbPath, isin, file, kind, periodEnd, extra] = process.argv.slice(2);
if (!dbPath || !isin || !file || !UPLOAD_KINDS.some((k) => k.id === kind) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd ?? "")) {
  throw new Error("Uso: node import-report.mjs <base.db> <ISIN> <archivo> <annual|half|quarter|other> <AAAA-MM-DD> [prompt|respuesta.json]");
}

const raw = new DatabaseSync(dbPath);
raw.exec("PRAGMA foreign_keys = ON");
const db: Db = {
  execute: async (sql, params = []) => {
    const r = raw.prepare(sql).run(...(params as SQLInputValue[]));
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  },
  select: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...(params as SQLInputValue[])) as T[],
};

/** Igual que safe_name en src-tauri/src/documents.rs. */
function safeName(original: string, ext: string): string {
  const stem = basename(original, extname(original));
  const clean = [...stem].slice(0, 80).map((c) => (/[\p{L}\p{N}_-]/u.test(c) ? c : "-")).join("").replace(/^-+|-+$/g, "");
  return `${clean || "informe"}.${ext}`;
}

const data = readFileSync(file);
const head = data.subarray(0, 5).toString("latin1");
const ext = head.startsWith("%PDF-") ? "pdf" : head.startsWith("PK") ? "zip" : null;
if (!ext) throw new Error("El archivo no es un PDF ni un ZIP.");

const [security] = await db.select<{ id: number; name: string }>("SELECT id, name FROM securities WHERE isin = ?", [isin]);
if (!security) throw new Error(`No hay ningún valor con ISIN ${isin} en la app.`);

const sha = createHash("sha256").update(data).digest("hex");
const dir = join(dirname(dbPath), "documents", String(security.id));
mkdirSync(dir, { recursive: true });
const path = join(dir, `${sha.slice(0, 12)}-${safeName(basename(file), ext)}`);
if (!existsSync(path)) copyFileSync(file, path);

const [request] = await db.select<{ id: number }>(
  "SELECT id FROM document_requests WHERE security_id = ? AND status = 'pending' AND period = ? ORDER BY id LIMIT 1",
  [security.id, periodEnd],
);
const filingId = await registerUpload(
  db,
  { securityId: security.id, kind: kind as UploadKind, periodEnd: periodEnd!, requestId: request?.id ?? null },
  { name: basename(file) },
  { path, sha256: sha, bytes: data.length, kind: ext },
);
console.log(JSON.stringify({ valor: security.name, filingId, ruta: path, solicitudCerrada: request?.id ?? null }));

if (extra === "prompt") {
  console.log(await buildManualPdfPrompt(db, security.id, filingId));
} else if (extra) {
  const saved = await saveManualPdf({ db, readPdf: async (p) => readFileSync(p) }, security.id, filingId, readFileSync(extra, "utf8"));
  console.log(JSON.stringify(saved));
}
raw.close();
