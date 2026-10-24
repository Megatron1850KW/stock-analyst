/**
 * Calendario de resultados (CLAUDE.md §7) deducido del historial de informes,
 * sin red ni IA: el siguiente periodo cierra 3 meses (EE. UU.) o 6 meses
 * (Europa y emisores extranjeros) después del último, y se publica con el
 * retraso habitual de esa empresa. Siempre es una ESTIMACIÓN y se dice.
 */

export interface PastReport {
  periodType: "annual" | "interim";
  /** Cierre del periodo (YYYY-MM-DD). */
  periodEnd: string;
  /** Fecha de publicación, si se conoce. */
  filedAt: string | null;
}

export type ReportRegime = "us-domestic" | "us-foreign" | "eu";

export interface ExpectedReport {
  periodType: "annual" | "interim";
  periodEnd: string;
  /** Fecha estimada de publicación. */
  expectedDate: string;
  /** «10-Q de Q3 2026», «Informe anual 2026»… */
  label: string;
  /** Cómo se ha estimado, en llano. */
  basis: string;
}

export const CALENDAR_CONFIG = {
  /** Retraso por defecto (días tras el cierre) cuando no hay historial con fechas. */
  defaultLag: {
    "us-domestic": { annual: 60, interim: 40 },
    "us-foreign": { annual: 120, interim: 75 },
    eu: { annual: 90, interim: 60 },
  },
  /** Si la fecha estimada pasó hace más de esto sin informe, se pasa al periodo siguiente. */
  staleAfterDays: 45,
};

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Último día del mes `months` meses después del de `date`. */
export function addMonthsEnd(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return iso(Date.UTC(Math.floor(total / 12), (total % 12) + 1, 0));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const FORMS: Record<ReportRegime, { annual: string; interim: string }> = {
  "us-domestic": { annual: "10-K", interim: "10-Q" },
  "us-foreign": { annual: "20-F", interim: "6-K" },
  eu: { annual: "Informe anual", interim: "Informe semestral" },
};

/** Ejercicio al que pertenece un cierre y trimestre/semestre dentro de él. */
export function reportLabel(periodEnd: string, fyEndMonth: number, regime: ReportRegime, type: "annual" | "interim"): string {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  const fy = m > fyEndMonth ? y + 1 : y;
  const form = FORMS[regime][type];
  if (type === "annual") return regime === "eu" ? `${form} ${fy}` : `${form} del ejercicio ${fy}`;
  const monthsIn = (m - fyEndMonth + 12) % 12 || 12;
  if (regime === "us-domestic") return `${form} de Q${Math.round(monthsIn / 3)} ${fy}`;
  return regime === "eu" ? `${form} H1 ${fy}` : `${form} del H1 ${fy}`;
}

export function expectedNextReport(past: PastReport[], regime: ReportRegime, today: string, cfg = CALENDAR_CONFIG): ExpectedReport | null {
  const sorted = [...past].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const last = sorted[0];
  if (!last) return null;
  const lastAnnual = sorted.find((p) => p.periodType === "annual");
  const fyEndMonth = Number((lastAnnual ?? last).periodEnd.slice(5, 7));
  const step = regime === "us-domestic" ? 3 : 6;

  const lagOf = (type: "annual" | "interim") => {
    const seen = sorted.filter((p) => p.periodType === type && p.filedAt).map((p) => days(p.periodEnd, p.filedAt!)).filter((d) => d > 0 && d < 250);
    const m = median(seen);
    return m === null ? { lag: cfg.defaultLag[regime][type], fromHistory: false } : { lag: m, fromHistory: true };
  };

  let periodEnd = addMonthsEnd(last.periodEnd, step);
  for (let i = 0; i < 8; i++) {
    const type = Number(periodEnd.slice(5, 7)) === fyEndMonth ? "annual" : "interim";
    const { lag, fromHistory } = lagOf(type);
    const expectedDate = iso(Date.parse(periodEnd) + lag * DAY);
    if (days(expectedDate, today) <= cfg.staleAfterDays) {
      const form = FORMS[regime][type];
      return {
        periodType: type,
        periodEnd,
        expectedDate,
        label: reportLabel(periodEnd, fyEndMonth, regime, type),
        basis: fromHistory
          ? `Estimada: sus ${type === "annual" ? "informes anuales" : "informes intermedios"} suelen salir ${lag} días después del cierre del periodo (${periodEnd}).`
          : `Estimada: sin fechas de sus informes anteriores, se suponen ${lag} días tras el cierre (${periodEnd}), lo habitual para un ${form}.`,
      };
    }
    periodEnd = addMonthsEnd(periodEnd, step);
  }
  return null;
}
