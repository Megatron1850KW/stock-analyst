import type { Fundamentals, Input, Metric, YearFundamentals } from "@/domain/fundamentals/metrics";

/**
 * Múltiplos de valoración: actuales (con cifras de los últimos doce meses) y
 * su serie mensual histórica (con el último informe anual publicado en cada
 * fecha), para comparar la empresa con su propia historia (§5.1.4, §8.1).
 */

export type MultipleId = "pe" | "pfcf" | "evEbit";

export const MULTIPLES: Record<MultipleId, { label: string; technical: string; plain: string }> = {
  pe: {
    label: "Años de beneficios",
    technical: "PER (precio / beneficio)",
    plain: "Cuántos años de beneficios pagas al comprar la empresa entera al precio de hoy.",
  },
  pfcf: {
    label: "Años de caja libre",
    technical: "P/FCF (precio / caja libre)",
    plain: "Cuántos años de caja libre pagas por la empresa entera.",
  },
  evEbit: {
    label: "Años de beneficio operativo (con deuda)",
    technical: "EV/EBIT (valor empresa / beneficio operativo)",
    plain: "Como el anterior, pero sumando la deuda neta al precio y usando el beneficio antes de intereses e impuestos.",
  },
};

export interface PricePoint {
  date: string;
  close: number;
}

export interface SplitInfo {
  date: string;
  numerator: number;
  denominator: number;
}

/** Factor por el que multiplicar las acciones publicadas antes de `date` para llevarlas a la base de hoy. */
export function splitFactorAfter(splits: SplitInfo[], date: string): number {
  return splits.filter((s) => s.date > date).reduce((f, s) => f * (s.numerator / s.denominator), 1);
}

export interface MultiplePoint {
  date: string;
  close: number;
  marketCap: number;
  pe: number | null;
  pfcf: number | null;
  evEbit: number | null;
  /** Cierre del ejercicio cuyas cifras se usan. */
  basedOn: string;
}

const positive = (num: number | null, den: number | null) => (num !== null && den !== null && den > 0 && num > 0 ? num / den : null);

function monthEnd(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

/** Fecha en la que se publicaron las acciones usadas (para saber qué splits faltan por aplicar). */
const sharesFiledAt = (shares: Input) => shares.sources[0]?.filing.filed_at ?? shares.sources[0]?.periodEnd ?? "";

/**
 * Serie mensual de múltiplos. En cada mes se usa el último informe anual que
 * ya estaba publicado entonces (sin mirar al futuro), con las acciones
 * pasadas a la base actual si ha habido splits después.
 */
export function historicalMultiples(years: YearFundamentals[], monthly: PricePoint[], splits: SplitInfo[], adrRatio = 1): MultiplePoint[] {
  const usable = years
    .filter((y) => y.shares && y.statement.filing.filed_at)
    .sort((a, b) => a.statement.filing.filed_at!.localeCompare(b.statement.filing.filed_at!));
  const out: MultiplePoint[] = [];
  for (const bar of monthly) {
    const end = monthEnd(bar.date);
    let year: YearFundamentals | undefined;
    for (const y of usable) if (y.statement.filing.filed_at! <= end) year = y;
    if (!year) continue;
    // Precio de un ADR: cada uno vale `adrRatio` acciones ordinarias
    const shares = (year.shares!.value * splitFactorAfter(splits, sharesFiledAt(year.shares!))) / adrRatio;
    const marketCap = bar.close * shares;
    const ev = year.netDebt.value === null ? null : marketCap + year.netDebt.value;
    out.push({
      date: bar.date,
      close: bar.close,
      marketCap,
      pe: positive(marketCap, year.netIncome?.value ?? null),
      pfcf: positive(marketCap, year.freeCashFlow.value),
      evEbit: positive(ev, year.operatingIncome?.value ?? null),
      basedOn: year.periodEnd,
    });
  }
  return out;
}

export interface PriceInput {
  value: number;
  date: string;
  currency: string;
  source: string;
  fetchedAt: string;
}

export interface CurrentMultiples {
  price: PriceInput;
  marketCap: Metric;
  pe: Metric;
  pfcf: Metric;
  evEbit: Metric;
  /** Caja libre ÷ capitalización: lo que genera la empresa por cada 100 € que vale. */
  fcfYield: Metric;
}

/** Múltiplos de hoy: precio actual y cifras de los últimos doce meses. */
export function currentMultiples(f: Fundamentals, price: PriceInput, splits: SplitInfo[], reportingCurrency: string | null, adrRatio = 1): CurrentMultiples {
  const unit = f.revenue?.unit ?? reportingCurrency ?? price.currency;
  const none = (label: string, kind: Metric["kind"], formula: string, note: string): Metric => ({ label, kind, value: null, formula, inputs: [], note });
  const mismatch = unit !== price.currency;
  const capFormula = "Precio × Acciones diluidas";
  let marketCap: Metric;
  if (mismatch) {
    marketCap = none("Capitalización", "money", capFormula, `Las cuentas están en ${unit} y el precio en ${price.currency}; el cambio de divisa llega en la fase de cartera.`);
  } else if (!f.shares) {
    marketCap = none("Capitalización", "money", capFormula, "No hay número de acciones en los informes.");
  } else {
    const factor = splitFactorAfter(splits, sharesFiledAt(f.shares));
    const notes = [
      factor !== 1 ? `Ajustadas por splits posteriores (×${factor}).` : null,
      adrRatio !== 1 ? `El precio es el de un ADR, que equivale a ${String(adrRatio).replace(".", ",")} acciones: se cuentan ADR (acciones ÷ ${String(adrRatio).replace(".", ",")}).` : null,
    ].filter(Boolean);
    const shares: Input = notes.length === 0 ? f.shares : { ...f.shares, value: (f.shares.value * factor) / adrRatio, note: notes.join(" ") };
    marketCap = {
      label: "Capitalización",
      kind: "money",
      value: price.value * shares.value,
      formula: capFormula,
      inputs: [{ label: "Precio", value: price.value, unit: price.currency, sources: [] }, shares],
    };
  }
  const cap: Input | null = marketCap.value === null ? null : { label: "Capitalización", value: marketCap.value, unit, sources: marketCap.inputs.flatMap((i) => i.sources) };
  const asInput = (m: Metric): Input | null => (m.value === null ? null : { label: m.label, value: m.value, unit, sources: m.inputs.flatMap((i) => i.sources), note: m.note });

  function multiple(id: MultipleId, num: Input | null, den: Input | null, formula: string): Metric {
    const label = MULTIPLES[id].label;
    const inputs = [num, den].filter((x): x is Input => !!x);
    if (!num || !den) return { label, kind: "multiple", value: null, formula, inputs, note: marketCap.note ?? "Falta alguna cifra." };
    if (den.value <= 0) return { label, kind: "multiple", value: null, formula, inputs, note: `${den.label} es negativo o cero: el múltiplo no tiene sentido.` };
    return { label, kind: "multiple", value: num.value / den.value, formula, inputs };
  }

  const fcf = asInput(f.freeCashFlow);
  const ev: Input | null = cap && f.netDebt.value !== null
    ? { label: "Valor de empresa", value: cap.value + f.netDebt.value, unit, sources: [...cap.sources, ...f.netDebt.inputs.flatMap((i) => i.sources)] }
    : null;
  return {
    price,
    marketCap,
    pe: multiple("pe", cap, f.netIncome, "Capitalización ÷ Beneficio neto (12 meses)"),
    pfcf: multiple("pfcf", cap, fcf, "Capitalización ÷ Caja libre (12 meses)"),
    evEbit: multiple("evEbit", ev, f.operatingIncome, "(Capitalización + Deuda neta) ÷ Beneficio operativo (12 meses)"),
    fcfYield:
      cap && fcf
        ? { label: "Rentabilidad en caja libre", kind: "percent", value: fcf.value / cap.value, formula: "Caja libre ÷ Capitalización", inputs: [fcf, cap] }
        : none("Rentabilidad en caja libre", "percent", "Caja libre ÷ Capitalización", marketCap.note ?? "Falta la caja libre."),
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface WindowStat {
  median: number | null;
  /** Meses con múltiplo válido en la ventana. */
  points: number;
  enough: boolean;
}

/** Fecha `months` meses antes de `date` (AAAA-MM-DD). */
export function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function windowMedian(points: MultiplePoint[], id: MultipleId, asOf: string, months: number, minPoints: number): WindowStat {
  const from = monthsBefore(asOf, months);
  const values = points.filter((p) => p.date > from && p.date <= asOf).map((p) => p[id]).filter((v): v is number => v !== null);
  return { median: values.length >= minPoints ? median(values) : null, points: values.length, enough: values.length >= minPoints };
}

export interface PriceRange {
  min: number;
  max: number;
  /** 0 = en el mínimo del periodo, 1 = en el máximo. */
  position: number;
  from: string;
  months: number;
}

export function priceRange(monthly: PricePoint[], current: number, asOf: string, months: number): PriceRange | null {
  const from = monthsBefore(asOf, months);
  const closes = monthly.filter((p) => p.date > from && p.date <= asOf).map((p) => p.close);
  if (closes.length < 12) return null;
  const min = Math.min(...closes, current);
  const max = Math.max(...closes, current);
  return { min, max, position: max === min ? 0.5 : (current - min) / (max - min), from: monthly.find((p) => p.date > from)!.date, months };
}
