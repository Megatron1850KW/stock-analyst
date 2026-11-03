/**
 * Análisis narrativo en el modo «Claude.ai manual», desde el Mac y con la app
 * CERRADA: hace lo mismo que «Analizar con Claude.ai» + «Guardar» en la ficha
 * (mismo texto, mismas validaciones), sin llamar a ninguna API.
 *
 *   node manual-analysis.mjs <base.db> <ISIN> prompt          → imprime el texto y los PDF que hay que leer
 *   node manual-analysis.mjs <base.db> <ISIN> respuesta.json  → valida y guarda la respuesta
 *
 * Se empaqueta con `npm run build:real` (vite.real.config.ts).
 */
import { readFileSync } from "node:fs";
import { openAppDb, securityByIsin } from "./app-files";
import { prepareAnalysis } from "@/features/ai/equity-analysis";
import { buildManualPrompt, MANUAL_LIMITS, saveManualAnalysis } from "@/features/ai/manual";

const [dbPath, isin, what] = process.argv.slice(2);
if (!dbPath || !isin || !what) throw new Error("Uso: node manual-analysis.mjs <base.db> <ISIN> <prompt|respuesta.json>");

const db = openAppDb(dbPath);
const security = await securityByIsin(db, isin);
const ready = await prepareAnalysis(
  {
    db,
    pdfAttachments: true,
    fetchDocument: async (url) => {
      const r = await fetch(url, { headers: { "User-Agent": "Agente Financiero (uso personal)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    },
  },
  security.id,
  { force: true, limits: MANUAL_LIMITS },
);
if ("cached" in ready) throw new Error("No se ha podido preparar el texto.");
const { prepared } = ready;

if (what === "prompt") {
  const pdfs = prepared.documents.flatMap((d) => (d.attachment ? [d.attachment.path] : []));
  console.log(JSON.stringify({ valor: security.name, adjuntar: pdfs }));
  console.log(buildManualPrompt(prepared));
} else {
  const row = await saveManualAnalysis(db, prepared, readFileSync(what, "utf8"));
  console.log(JSON.stringify({ guardado: row.id, clave: prepared.cacheKey }));
}
db.close();
