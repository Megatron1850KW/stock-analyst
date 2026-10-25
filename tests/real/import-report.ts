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
import { readFileSync } from "node:fs";
import { openAppDb, securityByIsin, storeLikeApp } from "./app-files";
import { buildManualPdfPrompt, saveManualPdf } from "@/features/document-requests/manual-pdf";
import { registerUpload, UPLOAD_KINDS, type UploadKind } from "@/features/document-requests/upload";

const [dbPath, isin, file, kind, periodEnd, extra] = process.argv.slice(2);
if (!dbPath || !isin || !file || !UPLOAD_KINDS.some((k) => k.id === kind) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd ?? "")) {
  throw new Error("Uso: node import-report.mjs <base.db> <ISIN> <archivo> <annual|half|quarter|other> <AAAA-MM-DD> [prompt|respuesta.json]");
}

const db = openAppDb(dbPath);
const security = await securityByIsin(db, isin);
const stored = storeLikeApp(dbPath, security.id, file);
const { path } = stored;

const [request] = await db.select<{ id: number }>(
  "SELECT id FROM document_requests WHERE security_id = ? AND status = 'pending' AND period = ? ORDER BY id LIMIT 1",
  [security.id, periodEnd],
);
const filingId = await registerUpload(
  db,
  { securityId: security.id, kind: kind as UploadKind, periodEnd: periodEnd!, requestId: request?.id ?? null },
  { name: stored.name },
  { path, sha256: stored.sha256, bytes: stored.bytes, kind: stored.kind },
);
console.log(JSON.stringify({ valor: security.name, filingId, ruta: path, solicitudCerrada: request?.id ?? null }));

if (extra === "prompt") {
  console.log(await buildManualPdfPrompt(db, security.id, filingId));
} else if (extra) {
  const saved = await saveManualPdf({ db, readPdf: async (p) => readFileSync(p) }, security.id, filingId, readFileSync(extra, "utf8"));
  console.log(JSON.stringify(saved));
}
db.close();
