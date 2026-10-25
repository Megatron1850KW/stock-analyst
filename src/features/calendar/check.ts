import type { EuClient } from "@/data/esef/client";
import { filingUrl, type SecClient } from "@/data/sec-edgar/client";
import { getAppState, getNewReport, insertNewReport, listTrackedStocks, replaceInferredDate, setAppState, setNewReportStatus, type NewReportInput, type TrackedStock } from "@/db/calendar-repo";
import type { Db } from "@/db/client";
import { getFilings } from "@/db/repo";
import { CALENDAR_CONFIG, expectedNextReport, reportLabel, type ReportRegime } from "@/domain/calendar/expected";
import { pickEsefFilings } from "@/domain/fundamentals/esef";
import { selectFilings, toRows, type FilingRef } from "@/domain/fundamentals/select-filings";
import { importEuIsin } from "@/features/watchlist/import-eu";
import { importUsTicker } from "@/features/watchlist/import-us";

/**
 * Autonomía (CLAUDE.md §7): calendario estimado y comprobación de informes
 * nuevos SIN IA. Solo se consulta la SEC o filings.xbrl.org de los valores con
 * resultados recientes o próximos. Analizar un informe nuevo (con IA) lo
 * decide el usuario, salvo que en Ajustes elija hacerlo automáticamente.
 */

export const LAST_CHECK_KEY = "last_report_check";
/** Se consulta la fuente desde 3 días antes de la fecha estimada. */
const DAYS_BEFORE = 3;
const DAY = 86_400_000;

export const regimeOf = (s: Pick<TrackedStock, "market" | "filer_type">): ReportRegime =>
  s.market === "EU" ? "eu" : s.filer_type === "foreign" ? "us-foreign" : "us-domestic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function pastReports(db: Db, securityId: number) {
  return (await getFilings(db, securityId)).map((f) => ({ periodType: f.period_type, periodEnd: f.period_end, filedAt: f.filed_at?.slice(0, 10) ?? null }));
}

/** Recalcula la fecha estimada del siguiente informe de cada valor. Local, sin red. */
export async function refreshCalendar(db: Db, today = new Date()): Promise<void> {
  for (const s of await listTrackedStocks(db)) {
    const e = expectedNextReport(await pastReports(db, s.id), regimeOf(s), iso(today));
    await replaceInferredDate(db, s.id, e && { expectedDate: e.expectedDate, label: e.label, basis: e.basis });
  }
}

export interface CheckDeps {
  db: Db;
  /** Null si falta el User-Agent de la SEC: los de EE. UU. no se comprueban. */
  sec: SecClient | null;
  eu: EuClient;
}

export interface FoundReport extends NewReportInput {
  ticker: string;
  id?: number;
}

export interface CheckResult {
  checked: string[];
  found: FoundReport[];
  /** Avisos en llano (fuente caída, falta el email de la SEC…). */
  problems: string[];
}

/** ¿Toca mirar este valor hoy? Desde 3 días antes de su fecha estimada hasta 45 después. */
export function isDue(expectedDate: string | null, today: Date): boolean {
  if (!expectedDate) return false;
  const diff = (today.getTime() - Date.parse(expectedDate)) / DAY;
  return diff >= -DAYS_BEFORE && diff <= CALENDAR_CONFIG.staleAfterDays;
}

/** Informes de la fuente posteriores a lo que tienes guardado. */
export function newerThanStored(source: FilingRef[], stored: { accession_no: string; period_end: string; period_type: string }[]): FilingRef[] {
  const known = new Set(stored.map((f) => f.accession_no));
  const latest = (type: string) => stored.filter((f) => f.period_type === type).reduce((m, f) => (f.period_end > m ? f.period_end : m), "");
  return source.filter((f) => !known.has(f.accession) && f.reportDate > latest(f.periodType));
}

export async function checkNewReports(deps: CheckDeps, opts: { force?: boolean; today?: Date } = {}): Promise<CheckResult> {
  const today = opts.today ?? new Date();
  const { db } = deps;
  const result: CheckResult = { checked: [], found: [], problems: [] };
  let missingUa = false;

  for (const s of await listTrackedStocks(db)) {
    const regime = regimeOf(s);
    const past = await pastReports(db, s.id);
    const expected = expectedNextReport(past, regime, iso(today));
    if (!opts.force && !isDue(expected?.expectedDate ?? null, today)) continue;

    let source: FilingRef[] = [];
    try {
      if (regime === "eu") {
        if (!s.lei) continue;
        source = pickEsefFilings(await deps.eu.esefFilings(s.lei));
      } else {
        if (!deps.sec || !s.cik) {
          missingUa ||= !deps.sec;
          continue;
        }
        const sel = selectFilings(toRows((await deps.sec.submissions(s.cik)).filings.recent));
        source = [...sel.annual, ...sel.interim];
      }
    } catch (e) {
      result.problems.push(`${s.ticker}: no se pudo comprobar (${e instanceof Error ? e.message : String(e)}).`);
      continue;
    }
    result.checked.push(s.ticker);

    const stored = await getFilings(db, s.id);
    const fyEnd = Number((past.find((p) => p.periodType === "annual") ?? past[0])?.periodEnd.slice(5, 7) ?? 12);
    for (const f of newerThanStored(source, stored)) {
      const report: FoundReport = {
        securityId: s.id,
        ticker: s.ticker,
        formType: regime === "eu" ? (f.periodType === "annual" ? "Informe anual" : "Informe semestral") : f.form,
        periodType: f.periodType,
        periodEnd: f.reportDate,
        filedAt: f.filingDate || null,
        accession: f.accession,
        label: regime === "eu" ? reportLabel(f.reportDate, fyEnd, regime, f.periodType) : `${f.form} ${reportLabel(f.reportDate, fyEnd, regime, f.periodType).replace(/^\S+ /, "")}`,
        source: regime === "eu" ? "filings.xbrl.org" : "sec-edgar",
        url: regime === "eu" ? `https://filings.xbrl.org${f.reportUrl ?? f.primaryDocument}` : filingUrl(s.cik!, f.accession, f.primaryDocument),
      };
      if (await insertNewReport(db, report)) result.found.push(report);
    }
  }
  if (missingUa) result.problems.push("Las acciones de EE. UU. no se han comprobado: falta tu nombre y email para la SEC (Ajustes).");
  await setAppState(db, LAST_CHECK_KEY, today.toISOString());
  return result;
}

/** ¿Toca la comprobación automática según Ajustes? */
export async function checkIsDue(db: Db, frequency: "daily" | "weekly" | "manual", now = new Date()): Promise<boolean> {
  if (frequency === "manual") return false;
  const last = await getAppState(db, LAST_CHECK_KEY);
  if (!last) return true;
  const hours = (now.getTime() - Date.parse(last)) / 3_600_000;
  return hours >= (frequency === "daily" ? 20 : 24 * 6.5);
}

export interface ProcessDeps extends CheckDeps {
  /** Análisis con IA (con su caché y su presupuesto). */
  analyze: (securityId: number) => Promise<unknown>;
}

/**
 * «Analizar ahora»: vuelve a leer sus informes (determinista, incluido el
 * nuevo) y lanza el análisis con IA. Si la IA no puede (sin clave o sin
 * presupuesto), los datos quedan actualizados igualmente y se dice por qué.
 */
export async function processNewReport(deps: ProcessDeps, reportId: number, today = new Date()): Promise<{ aiError: string | null }> {
  const { db } = deps;
  const report = await getNewReport(db, reportId);
  if (!report) throw new Error("Ese informe ya no está en la lista.");
  const s = (await listTrackedStocks(db)).find((x) => x.id === report.security_id);
  if (!s) throw new Error(`${report.ticker} ya no está en tu watchlist ni en tu cartera.`);
  const opts = { watchlist: s.in_watchlist === 1, held: s.held === 1 };
  if (regimeOf(s) === "eu") {
    if (!s.isin) throw new Error(`${s.ticker} no tiene ISIN guardado.`);
    await importEuIsin(deps.eu, db, s.isin, undefined, today, opts);
  } else {
    if (!deps.sec) throw new Error("Falta tu nombre y email para la SEC. Añádelos en Ajustes.");
    await importUsTicker(deps.sec, db, s.ticker, undefined, today, opts);
  }
  await setNewReportStatus(db, reportId, "analyzed");
  await refreshCalendar(db, today);
  try {
    await deps.analyze(s.id);
    return { aiError: null };
  } catch (e) {
    return { aiError: e instanceof Error ? e.message : String(e) };
  }
}
