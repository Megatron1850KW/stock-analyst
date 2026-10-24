// @vitest-environment node
/**
 * Prueba de integración contra la SEC REAL (no datos ficticios).
 * Solo se ejecuta si se define SEC_USER_AGENT="Nombre email", porque la SEC lo exige:
 *
 *   SEC_USER_AGENT="Pablo tu@email.com" npx vitest run tests/integration
 *
 * Además de comprobar la importación, guarda en tests/fixtures/sec/ un extracto
 * de los datos reales (solo los informes elegidos) para los tests sin conexión.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SecClient } from "@/data/sec-edgar/client";
import {
  companyFactsSchema,
  filingColumnsSchema,
  submissionsSchema,
  tickersExchangeSchema,
  type CompanyFacts,
} from "@/data/sec-edgar/schemas";
import { getFacts, getFilings, getGaps } from "@/db/repo";
import { CONCEPTS } from "@/domain/fundamentals/concepts";
import { ownPeriodFact } from "@/domain/fundamentals/period-value";
import { importUsTicker } from "@/features/watchlist/import-us";
import { memoryDb } from "../helpers/sqlite-db";

const UA = process.env.SEC_USER_AGENT;
const TICKERS = (process.env.SEC_TICKERS ?? "MU,GOOG").split(",");
const OUT = join(__dirname, "../fixtures/sec");

function nodeSecClient(ua: string): SecClient & { lastFacts?: CompanyFacts; lastSubmissionsRaw?: unknown } {
  let last = 0;
  async function get(url: string): Promise<unknown> {
    const wait = 110 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }
  const client: SecClient & { lastFacts?: CompanyFacts; lastSubmissionsRaw?: unknown } = {
    tickers: async () => tickersExchangeSchema.parse(await get("https://www.sec.gov/files/company_tickers_exchange.json")),
    submissions: async (cik) => {
      const raw = await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
      client.lastSubmissionsRaw = raw;
      return submissionsSchema.parse(raw);
    },
    submissionsFile: async (name) => filingColumnsSchema.parse(await get(`https://data.sec.gov/submissions/${name}`)),
    companyFacts: async (cik) => {
      const facts = companyFactsSchema.parse(await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`));
      client.lastFacts = facts;
      return facts;
    },
  };
  return client;
}

/** Recorta companyfacts a los informes elegidos para guardarlo como fixture. */
function trimFacts(facts: CompanyFacts, accessions: Set<string>) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [tax, concepts] of Object.entries(facts.facts)) {
    for (const [tag, c] of Object.entries(concepts)) {
      const units: Record<string, unknown[]> = {};
      for (const [u, entries] of Object.entries(c.units)) {
        const kept = entries.filter((e) => accessions.has(e.accn));
        if (kept.length) units[u] = kept;
      }
      if (Object.keys(units).length) (out[tax] ??= {})[tag] = { label: c.label, units };
    }
  }
  return { _origen: "SEC EDGAR companyfacts (datos REALES, recortados a los informes elegidos)", cik: facts.cik, entityName: facts.entityName, facts: out };
}

describe.skipIf(!UA)("SEC real", () => {
  for (const ticker of TICKERS) {
    it(`importa ${ticker} con datos reales`, { timeout: 120_000 }, async () => {
      const sec = nodeSecClient(UA!);
      const db = memoryDb();
      const r = await importUsTicker(sec, db, ticker);
      const filings = await getFilings(db, r.securityId);
      const facts = await getFacts(db, r.securityId);
      const gaps = await getGaps(db, r.securityId);

      // Informe legible
      const lines = [`# ${r.ticker} · ${r.name}`, "", `Informes: ${r.annual} anuales, ${r.interim} trimestrales · ${r.facts} cifras · ${r.gaps} huecos`, ...r.notes, ""];
      lines.push(`| Concepto | ${filings.map((f) => `${f.form_type} ${f.period_end}`).join(" | ")} |`);
      lines.push(`|---|${filings.map(() => "---:").join("|")}|`);
      for (const def of CONCEPTS) {
        const cells = filings.map((f) => {
          const own = ownPeriodFact(facts, f, def.id);
          if (!own) return "Sin dato";
          const v = def.kind === "perShare" ? own.fact.value.toFixed(2) : (own.fact.value / 1e6).toFixed(0) + " M";
          return own.cumulative ? `${v} (acum.)` : v;
        });
        lines.push(`| ${def.label} | ${cells.join(" | ")} |`);
      }
      lines.push("", "Etiquetas usadas:", ...[...new Set(facts.map((f) => `${f.concept} ← ${f.source_tag}`))].sort().map((l) => `- ${l}`));
      lines.push("", "Huecos por informe:", ...filings.map((f) => `- ${f.form_type} ${f.period_end}: ${gaps.filter((g) => g.filing_id === f.id).map((g) => g.concept).join(", ") || "ninguno"}`));
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${r.ticker}-informe.md`), lines.join("\n"));
      writeFileSync(
        join(OUT, `${r.ticker}-companyfacts.json`),
        JSON.stringify(trimFacts(sec.lastFacts!, new Set(filings.map((f) => f.accession_no)))),
      );
      writeFileSync(join(OUT, `${r.ticker}-submissions.json`), JSON.stringify(sec.lastSubmissionsRaw));

      expect(r.annual).toBe(3);
      expect(r.interim).toBe(3);
      for (const f of filings) {
        expect(ownPeriodFact(facts, f, "revenue"), `ventas en ${f.form_type} ${f.period_end}`).not.toBeNull();
        expect(ownPeriodFact(facts, f, "net_income"), `beneficio en ${f.form_type} ${f.period_end}`).not.toBeNull();
      }
    });
  }
});
