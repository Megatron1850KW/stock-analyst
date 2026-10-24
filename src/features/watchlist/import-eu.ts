import type { EuClient } from "@/data/esef/client";
import type { FigiRow } from "@/data/esef/schemas";
import type { Db } from "@/db/client";
import { getFilings, pruneFilings, replaceFilingFacts, syncDocumentRequests, upsertEuSecurity, upsertFiling } from "@/db/repo";
import { euMissingRequests } from "@/features/document-requests/missing";
import { addXbrlJson, emptyFacts, periodTypeOf, pickEsefFilings } from "@/domain/fundamentals/esef";
import { HISTORY_YEARS } from "@/domain/fundamentals/history-filings";
import { normalizeCompanyFacts } from "@/domain/fundamentals/normalize";
import { WANTED_PER_TYPE, type FilingRef } from "@/domain/fundamentals/select-filings";
import { ImportError, type ImportResult, type ImportStep } from "./import-us";

/**
 * Alta de una acción europea por ISIN (CLAUDE.md §4.2):
 * ISIN → LEI (GLEIF) y cotización (OpenFIGI) → informes anuales ESEF de
 * filings.xbrl.org → cifras NIIF normalizadas al modelo común. Los informes
 * intermedios no tienen formato estructurado obligatorio en Europa: se piden
 * en la bandeja «Documentos pendientes». Idempotente, como la de EE. UU.
 */

export const EU_STEP_LABELS: Record<ImportStep, string> = {
  ticker: "Identificando el ISIN (registro LEI y bolsas)",
  filings: "Localizando sus informes anuales ESEF",
  facts: "Leyendo las cifras de los informes (NIIF)",
  save: "Guardando en tu Mac",
};

/** Bolsa principal por país (códigos de bolsa de OpenFIGI), por orden de preferencia. */
const HOME_EXCHANGES: Record<string, string[]> = {
  ES: ["SM", "SQ"],
  DE: ["GY", "GR", "GF"],
  FR: ["FP"],
  NL: ["NA"],
  IT: ["IM"],
  BE: ["BB"],
  PT: ["PL"],
  IE: ["ID"],
  FI: ["FH"],
  AT: ["AV"],
  LU: ["LX"],
  GB: ["LN"],
  CH: ["SW", "SE"],
  SE: ["SS"],
  DK: ["DC"],
  NO: ["NO"],
};

export const EXCHANGE_NAMES: Record<string, string> = {
  SM: "Madrid", SQ: "Madrid", GY: "Xetra", GR: "Alemania", GF: "Fráncfort", FP: "París", NA: "Ámsterdam", IM: "Milán",
  BB: "Bruselas", PL: "Lisboa", ID: "Dublín", FH: "Helsinki", AV: "Viena", LX: "Luxemburgo", LN: "Londres",
  SW: "Suiza", SE: "Suiza", SS: "Estocolmo", DC: "Copenhague", NO: "Oslo",
};

/** Divisa de cotización por bolsa. Londres cotiza en peniques (GBp). */
const EXCHANGE_CURRENCY: Record<string, string> = { LN: "GBp", SW: "CHF", SE: "CHF", SS: "SEK", DC: "DKK", NO: "NOK" };

export function pickListing(rows: FigiRow[], country: string | null): FigiRow | null {
  const stocks = rows.filter((r) => r.ticker && (r.marketSector ?? "Equity") === "Equity");
  const home = HOME_EXCHANGES[country ?? ""] ?? [];
  for (const code of home) {
    const hit = stocks.find((r) => r.exchCode === code);
    if (hit) return hit;
  }
  // Si no cotiza en su país, la primera bolsa europea conocida
  return stocks.find((r) => r.exchCode && r.exchCode in EXCHANGE_NAMES) ?? null;
}

export const currencyOfExchange = (exchCode: string | null | undefined) => EXCHANGE_CURRENCY[exchCode ?? ""] ?? "EUR";

export async function importEuIsin(
  eu: EuClient,
  db: Db,
  rawIsin: string,
  onStep: (step: ImportStep) => void = () => {},
  today: Date = new Date(),
  opts: { watchlist?: boolean } = {},
): Promise<ImportResult> {
  const watchlist = opts.watchlist ?? true;
  const isin = rawIsin.trim().toUpperCase();

  onStep("ticker");
  const entity = await eu.leiByIsin(isin);
  if (!entity) {
    throw new ImportError(`No encuentro el ISIN ${isin} en el registro oficial de entidades (GLEIF). Revisa que esté bien escrito.`);
  }
  const country = entity.country ?? isin.slice(0, 2);
  const listing = pickListing(await eu.figi(isin), country);
  if (!listing?.ticker) {
    throw new ImportError(`${entity.name} (${isin}) no aparece cotizando en ninguna bolsa europea según OpenFIGI.`);
  }
  const ticker = listing.ticker.replace(/\s.*$/, "");
  const notes: string[] = [];

  onStep("filings");
  const all = pickEsefFilings(await eu.esefFilings(entity.lei));
  if (all.length === 0) notes.push("No hay informes ESEF de esta empresa en filings.xbrl.org: se te pedirán en «Documentos pendientes».");

  onStep("facts");
  const facts = emptyFacts(entity.lei, entity.name);
  const loaded: FilingRef[] = [];
  for (const f of all.slice(0, HISTORY_YEARS)) {
    try {
      addXbrlJson(facts, await eu.esefDocument(f.primaryDocument), { accession: f.accession, filed: f.filingDate });
      // Algunos países publican también semestrales en ESEF: se clasifican por la duración de sus cifras
      const type = periodTypeOf(facts, f.accession, f.reportDate);
      loaded.push(type === "interim" ? { ...f, periodType: "interim" } : f);
    } catch (e) {
      notes.push(`No se pudo leer el informe ESEF con cierre ${f.reportDate}: ${(e as Error).message}`);
    }
  }
  const annual = loaded.filter((f) => f.periodType === "annual");
  const interim = loaded.filter((f) => f.periodType === "interim").slice(0, WANTED_PER_TYPE);
  const core = [...annual.slice(0, WANTED_PER_TYPE), ...interim];
  const history = annual.slice(WANTED_PER_TYPE);
  const normalized = normalizeCompanyFacts(facts, [...core, ...history]);
  if (annual.length > 0 && annual.length < WANTED_PER_TYPE) notes.push(`Solo hay ${annual.length} de ${WANTED_PER_TYPE} informes anuales ESEF.`);
  if (annual.length > WANTED_PER_TYPE && annual.length < HISTORY_YEARS) {
    notes.push(`El formato ESEF es obligatorio desde 2021: la valoración frente a su historia cubre ${annual.length} años, no 10.`);
  }

  onStep("save");
  const latest = annual[0]?.reportDate ?? null;
  const securityId = await upsertEuSecurity(db, {
    isin,
    lei: entity.lei,
    figi: listing.figi,
    ticker,
    name: titleCase(entity.name),
    exchange: listing.exchCode ?? null,
    country,
    currency: currencyOfExchange(listing.exchCode),
    reportingCurrency: normalized.currency,
    fiscalYearEnd: latest ? latest.slice(5, 7) + latest.slice(8, 10) : null,
  }, watchlist);

  const toSave = [...core.map((f) => ({ f, role: "core" as const })), ...history.map((f) => ({ f, role: "history" as const }))];
  for (const { f, role } of toSave) {
    const filingId = await upsertFiling(db, securityId, f, `https://filings.xbrl.org${f.primaryDocument}`, role, "filings.xbrl.org");
    await replaceFilingFacts(
      db,
      securityId,
      filingId,
      normalized.facts.filter((x) => x.accession === f.accession),
      normalized.gaps.filter((g) => g.accession === f.accession),
      "esef",
    );
  }
  await pruneFilings(db, securityId, toSave.map(({ f }) => f.accession), "filings.xbrl.org");

  // Lo que falta se pide en la bandeja, teniendo en cuenta lo que ya subiste
  const uploaded = (await getFilings(db, securityId)).filter((f) => f.role === "upload");
  const requests = !watchlist
    ? []
    : euMissingRequests({
        country,
        annualEnds: [...annual.map((f) => f.reportDate), ...uploaded.filter((f) => f.period_type === "annual").map((f) => f.period_end)].sort().reverse(),
        interimEnds: [...interim.map((f) => f.reportDate), ...uploaded.filter((f) => f.period_type === "interim").map((f) => f.period_end)],
        today,
      });
  await syncDocumentRequests(db, securityId, requests);

  return {
    securityId,
    ticker,
    name: titleCase(entity.name),
    annual: Math.min(annual.length, WANTED_PER_TYPE),
    interim: interim.length,
    historyYears: history.length,
    facts: normalized.facts.length,
    gaps: normalized.gaps.filter((g) => core.some((c) => c.accession === g.accession)).length,
    notes,
    requests: requests.length,
  };
}

/** «INDUSTRIA DE DISEÑO TEXTIL, S.A.» → «Industria De Diseño Textil, S.A.» (los registros oficiales vienen en mayúsculas). */
export function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-(/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\b(S\.p\.a\.|S\.a\.|N\.v\.|S\.e\.)/g, (m) => m.toUpperCase())
    .replace(/\b(Ag|Se|Spa|Plc|Sa|Nv|Ab|Asa|Oyj)\b/g, (m) => m.toUpperCase());
}
