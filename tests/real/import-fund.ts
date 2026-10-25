/**
 * Guarda la ficha de un ETF/ETC en la base REAL de la app, igual que «Subir la
 * ficha» + «Leer con Claude.ai» (mismas comprobaciones y esquema), desde el Mac
 * con la app CERRADA:
 *
 *   node import-fund.mjs <base.db> <ISIN> <ficha.pdf> [prompt|respuesta.json]
 *
 * - Copia el PDF a documents/<id del valor>/ junto a la base, como la app.
 * - «prompt» imprime el texto con las instrucciones para leer la ficha.
 * - Con un .json (respuesta en el formato del prompt) guarda la ficha y cierra
 *   la solicitud «Ficha del fondo». No llama a ninguna API.
 *
 * Se empaqueta con `npm run build:real` (vite.real.config.ts).
 */
import { readFileSync } from "node:fs";
import { buildManualFundPrompt, saveManualFund } from "@/features/portfolio/manual-fund";
import { openAppDb, securityByIsin, storeLikeApp } from "./app-files";

const [dbPath, isin, file, extra] = process.argv.slice(2);
if (!dbPath || !isin || !file || !extra) throw new Error("Uso: node import-fund.mjs <base.db> <ISIN> <ficha.pdf> <prompt|respuesta.json>");

const db = openAppDb(dbPath);
const security = await securityByIsin(db, isin);
if (extra === "prompt") {
  console.log(await buildManualFundPrompt(db, security.id));
} else {
  const stored = storeLikeApp(dbPath, security.id, file);
  if (stored.kind !== "pdf") throw new Error("La ficha debe ser un PDF.");
  const profile = await saveManualFund(
    { db, readPdf: async (p) => readFileSync(p) },
    security.id,
    { path: stored.path, name: stored.name, sha256: stored.sha256 },
    readFileSync(extra, "utf8"),
  );
  console.log(JSON.stringify({ valor: security.name, ruta: stored.path, ficha: profile }));
}
db.close();
