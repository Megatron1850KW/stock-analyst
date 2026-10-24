import type { Db } from "@/db/client";
import { getFilings, replaceFilingFacts } from "@/db/repo";
import { addXbrlJson, emptyFacts, periodTypeOf } from "@/domain/fundamentals/esef";
import { parseIxbrl } from "@/domain/fundamentals/ixbrl";
import { normalizeCompanyFacts } from "@/domain/fundamentals/normalize";

/**
 * Cifras de un paquete ESEF (.zip) que subiste: lectura determinista del
 * Inline XBRL, sin IA, por el mismo camino que los informes de filings.xbrl.org.
 */
export async function readUploadedEsef(
  db: Db,
  securityId: number,
  filingId: number,
  readReport: (path: string) => Promise<string>,
): Promise<{ facts: number; notes: string[] }> {
  const filing = (await getFilings(db, securityId)).find((f) => f.id === filingId);
  if (!filing?.local_path || filing.role !== "upload") throw new Error("No encuentro el ZIP subido.");
  const doc = parseIxbrl(await readReport(filing.local_path));
  const facts = emptyFacts("", "");
  addXbrlJson(facts, doc, { accession: filing.accession_no, filed: filing.filed_at ?? "" });

  // El cierre lo marca el propio informe: el final más reciente de sus ventas o beneficio
  const ends = ["Revenue", "ProfitLoss", "ProfitLossAttributableToOwnersOfParent"]
    .flatMap((t) => Object.values(facts.facts["ifrs-full"]?.[t]?.units ?? {}).flat())
    .filter((e) => e.start)
    .map((e) => e.end)
    .sort();
  const periodEnd = ends.at(-1) ?? filing.period_end;
  const notes: string[] = [];
  if (periodEnd !== filing.period_end) notes.push(`El informe cierra el ${periodEnd}, no el ${filing.period_end}: lo he corregido.`);
  const periodType = periodTypeOf(facts, filing.accession_no, periodEnd) ?? filing.period_type;
  await db.execute("UPDATE filings SET period_end = ?, period_type = ? WHERE id = ?", [periodEnd, periodType, filingId]);

  const ref = { accession: filing.accession_no, form: filing.form_type, periodType, reportDate: periodEnd, filingDate: filing.filed_at ?? "", primaryDocument: "" };
  const normalized = normalizeCompanyFacts(facts, [ref]);
  if (normalized.facts.length === 0) throw new Error("El ZIP no trae cifras NIIF reconocibles (¿es un paquete ESEF de cuentas consolidadas?).");
  await replaceFilingFacts(db, securityId, filingId, normalized.facts, normalized.gaps, "esef");
  return { facts: normalized.facts.length, notes };
}
