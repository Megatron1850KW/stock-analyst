import { BUFFETT_CONFIG } from "./config";
import type { Verdict } from "./valuation-score";

/**
 * Criterio Buffett «B» (complementa a las estrellas ⭐): determinista, con
 * cada criterio explicado. Marca todas las acciones que lo cumplen hoy, que
 * pueden ser una, varias o ninguna. Ver BUFFETT_CONFIG.
 */

export type BuffettCriterionId = "consistency" | "roe" | "moat" | "debt" | "cash" | "dilution" | "price";

export interface BuffettCriterion {
  id: BuffettCriterionId;
  label: string;
  /** true = lo cumple; false = no; null = faltan datos (cuenta como no cumplido). */
  pass: boolean | null;
  text: string;
}

export interface BuffettInput {
  id: number;
  ticker: string;
  name: string;
  /** Ejercicios del más antiguo al más reciente. */
  years: { netIncome: number | null; equity: number | null }[];
  grossMargin: number | null;
  operatingMargin: number | null;
  netCash: boolean | null;
  debtYears: number | null;
  /** Caja libre ÷ beneficio neto de varios años (la de la nota de calidad). */
  cashConversion: number | null;
  /** Variación anual del nº de acciones. */
  dilution: number | null;
  freeCashFlow: number | null;
  verdict: Verdict | null;
  /** Caja libre ÷ capitalización. */
  ownerYield: number | null;
}

export interface BuffettRow {
  input: BuffettInput;
  criteria: BuffettCriterion[];
  passed: number;
  /** Cumple todos: lleva la «B». */
  buy: boolean;
}

export interface BuffettPick {
  /** Las que llevan «B», de más barata (mayor rentabilidad del dueño) a menos. */
  picks: BuffettRow[];
  /** Todas, las de «B» primero y después por criterios cumplidos. */
  ranking: BuffettRow[];
  note?: string;
}

type Cfg = typeof BUFFETT_CONFIG;
const pct = (x: number, d = 0) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d })} %`;
const num = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 1 });

export function buffettCriteria(x: BuffettInput, cfg: Cfg = BUFFETT_CONFIG): BuffettCriterion[] {
  const out: BuffettCriterion[] = [];

  const profits = x.years.map((y) => y.netIncome).filter((v): v is number => v !== null).slice(-cfg.profitYears);
  out.push(
    profits.length < cfg.minYears
      ? { id: "consistency", label: "Beneficios constantes", pass: null, text: `Hacen falta al menos ${cfg.minYears} años de beneficios publicados.` }
      : profits.every((v) => v > 0)
        ? { id: "consistency", label: "Beneficios constantes", pass: true, text: `Ganó dinero los ${profits.length} últimos años.` }
        : { id: "consistency", label: "Beneficios constantes", pass: false, text: `Tuvo pérdidas en ${profits.filter((v) => v <= 0).length} de los ${profits.length} últimos años.` },
  );

  const roes = x.years
    .slice(-cfg.roeYears)
    .map((y) => (y.netIncome !== null && y.equity !== null && y.equity > 0 ? y.netIncome / y.equity : null))
    .filter((v): v is number => v !== null);
  const roe = roes.length ? roes.reduce((a, b) => a + b, 0) / roes.length : null;
  out.push(
    roe === null
      ? { id: "roe", label: "Rentabilidad sobre el capital", pass: null, text: "Falta el beneficio o el patrimonio de los últimos años." }
      : { id: "roe", label: "Rentabilidad sobre el capital", pass: roe >= cfg.minRoe, text: `Gana ${num(roe * 100)} € al año por cada 100 € de sus accionistas (se piden ${pct(cfg.minRoe)}).` },
  );

  if (x.grossMargin !== null) {
    out.push({ id: "moat", label: "Ventaja duradera", pass: x.grossMargin >= cfg.minGrossMargin, text: `Margen bruto del ${pct(x.grossMargin)} (se pide un ${pct(cfg.minGrossMargin)}): ${x.grossMargin >= cfg.minGrossMargin ? "puede cobrar más que lo que le cuesta" : "compite sobre todo en precio"}.` });
  } else if (x.operatingMargin !== null) {
    out.push({ id: "moat", label: "Ventaja duradera", pass: x.operatingMargin >= cfg.minOperatingMargin, text: `No publica margen bruto; su margen operativo es del ${pct(x.operatingMargin)} (se pide un ${pct(cfg.minOperatingMargin)}).` });
  } else {
    out.push({ id: "moat", label: "Ventaja duradera", pass: null, text: "Faltan sus márgenes." });
  }

  out.push(
    x.netCash
      ? { id: "debt", label: "Poca deuda", pass: true, text: "Tiene más caja que deuda." }
      : x.debtYears !== null
        ? { id: "debt", label: "Poca deuda", pass: x.debtYears <= cfg.maxDebtYears, text: `Pagaría su deuda en ${num(x.debtYears)} años con su caja libre (máximo ${cfg.maxDebtYears}).` }
        : { id: "debt", label: "Poca deuda", pass: null, text: "No se puede medir: falta la deuda o no genera caja libre." },
  );

  out.push(
    x.freeCashFlow === null || x.cashConversion === null
      ? { id: "cash", label: "Caja de verdad", pass: x.freeCashFlow !== null && x.freeCashFlow <= 0 ? false : null, text: x.freeCashFlow !== null && x.freeCashFlow <= 0 ? "No genera caja libre." : "Faltan datos de caja libre." }
      : { id: "cash", label: "Caja de verdad", pass: x.freeCashFlow > 0 && x.cashConversion >= cfg.minCashConversion, text: `Convierte en caja libre el ${pct(x.cashConversion)} de su beneficio (se pide un ${pct(cfg.minCashConversion)}).` },
  );

  out.push(
    x.dilution === null
      ? { id: "dilution", label: "No diluye al accionista", pass: null, text: "Falta el número de acciones de varios años." }
      : { id: "dilution", label: "No diluye al accionista", pass: x.dilution <= cfg.maxDilution, text: x.dilution <= 0 ? `Recompra acciones: un ${pct(-x.dilution, 1)} menos al año.` : `Emite acciones: un ${pct(x.dilution, 1)} más al año.` },
  );

  out.push(
    x.verdict === null || x.ownerYield === null
      ? { id: "price", label: "Precio sensato", pass: null, text: "Falta su valoración o su caja libre frente a lo que vale." }
      : x.verdict === "Cara"
        ? { id: "price", label: "Precio sensato", pass: false, text: "Hoy está cara frente a su propia historia." }
        : { id: "price", label: "Precio sensato", pass: x.ownerYield >= cfg.minOwnerYield, text: `Por cada 100 € que pagas, genera ${num(x.ownerYield * 100)} € de caja al año (se piden ${num(cfg.minOwnerYield * 100)} €).` },
  );
  return out;
}

export function buffettPick(inputs: BuffettInput[], empty: string, cfg: Cfg = BUFFETT_CONFIG): BuffettPick {
  const ranking: BuffettRow[] = inputs.map((input) => {
    const criteria = buffettCriteria(input, cfg);
    const passed = criteria.filter((c) => c.pass === true).length;
    return { input, criteria, passed, buy: passed === criteria.length };
  });
  ranking.sort(
    (a, b) =>
      Number(b.buy) - Number(a.buy) ||
      b.passed - a.passed ||
      (b.input.ownerYield ?? -Infinity) - (a.input.ownerYield ?? -Infinity) ||
      a.input.ticker.localeCompare(b.input.ticker),
  );
  const picks = ranking.filter((r) => r.buy);
  return {
    picks,
    ranking,
    note: inputs.length === 0 ? empty : picks.length === 0 ? "Ninguna cumple hoy todos sus criterios: Buffett esperaría." : undefined,
  };
}

/** 2 o 3 razones en llano para el porqué de una «B». */
export function buffettReasons(row: BuffettRow): string[] {
  const pick = (id: BuffettCriterionId) => row.criteria.find((c) => c.id === id)?.text;
  return [pick("roe"), pick("moat"), pick("price")].filter((t): t is string => !!t);
}
