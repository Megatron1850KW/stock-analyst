import { NEXT_BUY_CONFIG, PORTFOLIO_CONFIG } from "@/domain/scoring/config";
import type { Verdict } from "@/domain/scoring/valuation-score";
import type { RiskLevel } from "@/domain/technical/risk";
import type { Action } from "./recommendation";

/**
 * «Comparo tu cositas» (antes «Qué compro hoy»): compara hasta 3
 * posiciones de tu cartera con los mismos cinco criterios y dice cuál comprar y cuánto. Todo determinista, con los
 * datos que la app ya tiene guardados (sin IA):
 *
 * 1. Equilibrio de la cartera: el peso que tendría la posición después de la
 *    compra frente al máximo del 15 %.
 * 1b. Exposición al sector: cuánto pesan en tu cartera (mirando dentro de tus
 *    ETFs) los sectores en los que invierte; un sector que casi no tienes
 *    puntúa alto, y uno por encima del 35 % puntúa bajo.
 * 2. ¿Cara o barata?: la puntuación de valoración frente a su historia; en un
 *    ETF/ETC, su precio frente a su media de 10 meses.
 * 3. ¿Genera caja?: caja libre por cada 100 € que vale y margen operativo.
 *    Un ETF/ETC no tiene estados financieros: cuenta como neutro (50).
 * 4. ¿Crece?: crecimiento anual de ventas de los últimos años y del último
 *    periodo; en un ETF/ETC, lo que ha subido su precio al año (10 años).
 *
 * La nota final es la media ponderada (pesos en NEXT_BUY_CONFIG). Las
 * posiciones en «Mantener — vigilar» o sin precio no pueden ganar, y se dice
 * por qué.
 */

export type CriterionId = "balance" | "sector" | "valuation" | "cash" | "growth";

export const CRITERIA: { id: CriterionId; label: string; question: string }[] = [
  { id: "balance", label: "Peso en tu cartera", question: "¿Pesa poco en tu cartera?" },
  { id: "sector", label: "Exposición al sector", question: "¿Te diversifica de sector?" },
  { id: "valuation", label: "Cara o barata", question: "¿Está barata?" },
  { id: "cash", label: "Dinero que genera", question: "¿Genera caja?" },
  { id: "growth", label: "Crecimiento", question: "¿Crece?" },
];

export interface NextBuyCandidate {
  id: number;
  ticker: string;
  name: string;
  kind: "stock" | "etf" | "etc";
  /** Valor actual de la posición en euros (null sin precio). */
  valueEur: number | null;
  /** Precio de una acción o participación en euros (null sin precio). */
  priceEur: number | null;
  /** ¿Se pueden comprar fracciones? (bróker que las permite: alguna compra suya no fue entera). */
  fractional: boolean;
  /** Sector de una acción (o «Materias primas» en un ETC), para mostrarlo. */
  sector: string | null;
  /**
   * En qué sectores invierte (acción: el suyo al 100 %; ETF: el reparto de su
   * ficha) y cuánto vale cada uno de esos sectores en tu cartera, mirando
   * dentro de tus ETFs. Vacío si no se sabe.
   */
  sectorMix: { key: string; weight: number; portfolioEur: number }[];
  /** Recomendación de la cartera (§8.4). */
  action: Action;
  alerts: string[];
  technical: RiskLevel | null;
  /** Acciones: frente a su historia. Fondos: precio frente a su media de largo plazo. */
  valuation:
    | { source: "history"; score: number | null; deviation: number | null; verdict: Verdict | null }
    | { source: "trend"; deviation: number }
    | null;
  /** Solo acciones. */
  cash: { fcfYield: number | null; operatingMargin: number | null; netMargin: number | null } | null;
  growth: {
    /** Crecimiento anual compuesto de los últimos años (ventas; en fondos, precio). */
    multiYear: number | null;
    /** Último periodo frente al mismo del año anterior (solo acciones). */
    recent: number | null;
    recentPeriod: string | null;
  };
  quality: number | null;
}

export type Amount = { mode: "eur"; value: number } | { mode: "shares"; value: number };

export interface Criterion {
  id: CriterionId;
  /** 0–100 (más = mejor para comprar hoy); null = sin dato o no aplica (cuenta como 50). */
  score: number | null;
  text: string;
}

export interface ScoredCandidate {
  candidate: NextBuyCandidate;
  criteria: Criterion[];
  total: number;
  /** Lo que costaría la compra si fuera entera a esta posición (€). */
  costEur: number | null;
  /** Peso que tendría tras esa compra. */
  weightAfter: number | null;
  /** Motivo por el que no puede ser la elegida. */
  excluded: string | null;
  /** Avisos que se muestran aunque gane (nunca se ocultan). */
  warnings: string[];
}

export interface Allocation {
  id: number;
  ticker: string;
  shares: number;
  eur: number;
  weightAfter: number;
}

export interface NextBuyResult {
  ranked: ScoredCandidate[];
  winner: ScoredCandidate | null;
  /** Reparto propuesto: normalmente todo a la ganadora; si pasaría del 15 %, el resto a la siguiente. */
  plan: Allocation[];
  /** Euros que no se invierten (acciones enteras o límites de peso) y por qué. */
  leftover: { eur: number; reason: string } | null;
  /** La compra deja alguna posición por encima del peso máximo (no había otra con sitio). */
  overCap: boolean;
  /** Por qué la ganadora y no las otras, en llano. */
  why: string[];
}

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
/** Lineal entre `bad` (0 puntos) y `good` (100). */
const scale = (x: number, bad: number, good: number) => clamp(((x - bad) / (good - bad)) * 100);
const pct = (x: number, d = 0) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d })} %`;
const eur = (x: number) => `${x.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
const isFund = (c: NextBuyCandidate) => c.kind !== "stock";

function balanceCriterion(c: NextBuyCandidate, totalEur: number, spend: number, maxPosition: number): { criterion: Criterion; weightAfter: number | null } {
  if (c.valueEur === null || totalEur <= 0) return { criterion: { id: "balance", score: null, text: "Sin precio no se puede saber cuánto pesa en tu cartera." }, weightAfter: null };
  const weightAfter = (c.valueEur + spend) / (totalEur + spend);
  const now = c.valueEur / totalEur;
  const text =
    weightAfter > maxPosition
      ? `Pesa un ${pct(now)} y pasaría a un ${pct(weightAfter)}: por encima del máximo recomendado del ${pct(maxPosition)}.`
      : spend > 0
        ? `Pesa un ${pct(now)} de tu cartera y pasaría a un ${pct(weightAfter)} (máximo ${pct(maxPosition)}).`
        : `Pesa un ${pct(now)} de tu cartera (máximo ${pct(maxPosition)}).`;
  return { criterion: { id: "balance", score: Math.round(scale(weightAfter, maxPosition, 0)), text }, weightAfter };
}

/**
 * Exposición al sector: peso medio en tu cartera, tras la compra, de los
 * sectores en los que invierte (ponderado por su reparto). 0 % = 100 puntos;
 * el máximo por sector (35 %) = 0. Si un sector importante del valor pasaría
 * del máximo, la nota no sube de `sectorOverCap`.
 */
function sectorCriterion(c: NextBuyCandidate, totalEur: number, spend: number, cfg: typeof NEXT_BUY_CONFIG, maxSector: number): Criterion {
  const mix = c.sectorMix.filter((x) => x.weight > 0);
  const known = mix.reduce((s, x) => s + x.weight, 0);
  if (mix.length === 0 || known < 0.5 || totalEur <= 0) {
    return { id: "sector", score: null, text: isFund(c) ? "La ficha de este fondo no trae su reparto por sectores. Cuenta como neutro." : "No se sabe su sector. Indícalo en Mi Portfolio. Cuenta como neutro." };
  }
  const after = totalEur + spend;
  const parts = mix.map((x) => ({ ...x, after: (x.portfolioEur + spend * x.weight) / after, now: x.portfolioEur / totalEur })).sort((a, b) => b.weight - a.weight);
  const exposure = parts.reduce((s, x) => s + x.weight * x.after, 0) / known;
  let score = scale(exposure, maxSector, 0);
  const over = parts.filter((x) => x.weight >= cfg.sectorMainShare && x.after > maxSector);
  if (over.length) score = Math.min(score, cfg.sectorOverCap);

  let text: string;
  if (parts.length === 1 || parts[0]!.weight >= 0.9) {
    const x = parts[0]!;
    text = `${x.key}: hoy pesa un ${pct(x.now)} de tu cartera, contando lo que llevan dentro tus ETF${spend > 0 ? `, y pasaría a un ${pct(x.after)}` : ""}.`;
  } else {
    const top = parts.slice(0, 3).map((x) => `${x.key} ${pct(x.weight)} (en tu cartera ${pct(x.now)})`);
    text = `Invierte en ${top.join(", ")}${parts.length > 3 ? " y otros" : ""}. De media, esos sectores pesan un ${pct(exposure)} de tu cartera.`;
  }
  if (over.length) text += ` ${over.map((x) => x.key).join(" y ")} pasaría del máximo del ${pct(maxSector)}.`;
  else if (exposure < 0.05) text += " Casi no tienes nada de este sector: te diversifica.";
  return { id: "sector", score: Math.round(score), text };
}

function valuationCriterion(c: NextBuyCandidate, cfg: typeof NEXT_BUY_CONFIG): Criterion {
  const v = c.valuation;
  if (!v) return { id: "valuation", score: null, text: isFund(c) ? "Sin historial de precios suficiente para compararlo con su media." : "Sin precio o sin historia suficiente para saber si está barata." };
  if (v.source === "trend") {
    const where = Math.abs(v.deviation) < 0.005 ? "justo en" : `un ${pct(Math.abs(v.deviation))} ${v.deviation < 0 ? "por debajo de" : "por encima de"}`;
    return {
      id: "valuation",
      score: Math.round(scale(v.deviation, cfg.fundTrend.expensive, cfg.fundTrend.cheap)),
      text: `Su precio está ${where} su media de ${PORTFOLIO_CONFIG.trendMonths} meses. Un ${c.kind === "etf" ? "ETF" : "ETC"} no tiene beneficios que valorar: solo se mira su precio.`,
    };
  }
  if (v.score === null || v.deviation === null) return { id: "valuation", score: null, text: "Sin historia suficiente para saber si está barata." };
  const word = v.verdict === "Barata" ? "Barata" : v.verdict === "Cara" ? "Cara" : "Precio justo";
  return {
    id: "valuation",
    score: Math.round(v.score),
    text: `${word}: cotiza un ${pct(Math.abs(v.deviation))} ${v.deviation < 0 ? "por debajo" : "por encima"} de lo que suele valer (media de sus múltiplos de 5 y 10 años).`,
  };
}

function cashCriterion(c: NextBuyCandidate, cfg: typeof NEXT_BUY_CONFIG): Criterion {
  if (!c.cash) return { id: "cash", score: null, text: `No aplica: un ${c.kind === "etf" ? "ETF" : "ETC"} no tiene estados financieros. Cuenta como neutro.` };
  const { fcfYield, operatingMargin, netMargin } = c.cash;
  const parts: { score: number; weight: number }[] = [];
  const texts: string[] = [];
  if (fcfYield !== null) {
    parts.push({ score: scale(fcfYield, 0, cfg.cash.fcfYieldGood), weight: cfg.cash.fcfWeight });
    texts.push(`Genera ${(fcfYield * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} € de caja libre al año por cada 100 € que vale`);
  }
  const margin = operatingMargin ?? (fcfYield === null ? netMargin : null);
  if (margin !== null) {
    parts.push({ score: scale(margin, 0, cfg.cash.marginGood), weight: 1 - cfg.cash.fcfWeight });
    texts.push(`de cada 100 € que vende le quedan ${Math.round(margin * 100)} € ${operatingMargin !== null ? "tras pagar todos los gastos del negocio" : "de beneficio neto"}`);
  }
  if (parts.length === 0) return { id: "cash", score: null, text: "Faltan la caja libre y los márgenes." };
  const w = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.score * p.weight, 0) / w;
  return { id: "cash", score: Math.round(score), text: `${texts.join("; ")}.`.replace(/^./, (m) => m.toUpperCase()) };
}

function growthCriterion(c: NextBuyCandidate, cfg: typeof NEXT_BUY_CONFIG): Criterion {
  const { multiYear, recent, recentPeriod } = c.growth;
  const g = cfg.growth;
  if (isFund(c)) {
    if (multiYear === null) return { id: "growth", score: null, text: "Sin años de precios suficientes para medir cuánto sube." };
    return {
      id: "growth",
      score: Math.round(scale(multiYear, g.bad, g.good)),
      text: `Su precio ha ${multiYear >= 0 ? "subido" : "bajado"} de media un ${pct(Math.abs(multiYear), 1)} al año en los últimos años. Es historia, no una promesa.`,
    };
  }
  const scores = [multiYear, recent].filter((x): x is number => x !== null).map((x) => scale(x, g.bad, g.good));
  if (scores.length === 0) return { id: "growth", score: null, text: "Faltan las ventas de varios periodos." };
  const texts: string[] = [];
  if (multiYear !== null) texts.push(`sus ventas ${multiYear >= 0 ? "crecen" : "caen"} un ${pct(Math.abs(multiYear), 1)} al año en los últimos ejercicios`);
  if (recent !== null) texts.push(`en el ${recentPeriod ?? "último periodo"} vendió un ${pct(Math.abs(recent))} ${recent >= 0 ? "más" : "menos"} que un año antes`);
  return { id: "growth", score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), text: `${texts.join(" y ")}.`.replace(/^./, (m) => m.toUpperCase()) };
}

/** Euros que caben en una posición sin pasar del máximo, con el total final de la cartera. */
function room(valueEur: number, finalTotal: number, max: number): number {
  return Math.max(0, max * finalTotal - valueEur);
}

/** Acciones que se compran con `eur` (enteras salvo que el bróker permita fracciones). */
function sharesFor(eurAmount: number, price: number, fractional: boolean): number {
  const raw = eurAmount / price;
  return fractional ? Math.floor(raw * 10_000) / 10_000 : Math.floor(raw + 1e-9);
}

export function nextBuy(
  candidates: NextBuyCandidate[],
  totalEur: number,
  amount: Amount,
  cfg = NEXT_BUY_CONFIG,
  maxPosition = PORTFOLIO_CONFIG.maxPosition,
  maxSector = PORTFOLIO_CONFIG.maxSector,
): NextBuyResult {
  const ranked: ScoredCandidate[] = candidates.map((c) => {
    const costEur = c.priceEur === null ? null : amount.mode === "eur" ? amount.value : amount.value * c.priceEur;
    const { criterion: balance, weightAfter } = balanceCriterion(c, totalEur, costEur ?? 0, maxPosition);
    const criteria = [balance, sectorCriterion(c, totalEur, costEur ?? 0, cfg, maxSector), valuationCriterion(c, cfg), cashCriterion(c, cfg), growthCriterion(c, cfg)];
    let total = criteria.reduce((s, k) => s + (k.score ?? cfg.missingScore) * cfg.weights[k.id], 0);
    const warnings = [...c.alerts];
    if (c.technical === "Alto") {
      total -= cfg.highRiskPenalty;
      warnings.push(`Riesgo técnico de largo plazo alto: resta ${cfg.highRiskPenalty} puntos.`);
    }
    let excluded: string | null = null;
    if (c.priceEur === null || c.valueEur === null) excluded = "No tiene precio: actualiza los precios para poder compararla.";
    else if (c.action === "Mantener — vigilar") excluded = `Está en «Mantener — vigilar»: ${c.alerts[0]?.replace(/\.$/, "").replace(/^./, (m) => m.toLowerCase()) ?? "tiene alertas serias"}.`;
    return { candidate: c, criteria, total: Math.round(clamp(total)), costEur, weightAfter, excluded, warnings };
  });
  ranked.sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded) || b.total - a.total || a.candidate.ticker.localeCompare(b.candidate.ticker));

  const eligible = ranked.filter((r) => !r.excluded);
  const winner = eligible[0] ?? null;
  const { plan, leftover, overCap } = winner ? allocate(eligible, totalEur, amount, maxPosition) : { plan: [], leftover: null, overCap: false };
  return { ranked, winner, plan, leftover, overCap, why: winner ? explain(winner, ranked) : [] };
}

function allocate(eligible: ScoredCandidate[], totalEur: number, amount: Amount, maxPosition: number): Pick<NextBuyResult, "plan" | "leftover" | "overCap"> {
  const winner = eligible[0]!;
  const w = winner.candidate;
  if (amount.mode === "shares") {
    const eurSpent = amount.value * w.priceEur!;
    const weightAfter = (w.valueEur! + eurSpent) / (totalEur + eurSpent);
    return { plan: [{ id: w.id, ticker: w.ticker, shares: amount.value, eur: eurSpent, weightAfter }], leftover: null, overCap: weightAfter > maxPosition };
  }

  const budget = amount.value;
  const finalTotal = totalEur + budget;
  const plan: Allocation[] = [];
  let remaining = budget;
  let cappedBy: string | null = null;
  for (const r of eligible) {
    if (remaining <= 0) break;
    const c = r.candidate;
    const fits = room(c.valueEur!, finalTotal, maxPosition);
    const target = Math.min(remaining, fits);
    if (fits < remaining) cappedBy ??= c.ticker;
    const shares = sharesFor(target, c.priceEur!, c.fractional);
    if (shares <= 0) continue;
    const spent = shares * c.priceEur!;
    remaining -= spent;
    plan.push({ id: c.id, ticker: c.ticker, shares, eur: spent, weightAfter: (c.valueEur! + spent) / finalTotal });
  }
  // Si todas pasarían del máximo, lo que queda va igualmente a la ganadora (sube su peso: se avisa)
  let overCap = false;
  if (cappedBy) {
    const shares = sharesFor(remaining, w.priceEur!, w.fractional);
    if (shares > 0) {
      const spent = shares * w.priceEur!;
      remaining -= spent;
      overCap = true;
      const prev = plan.find((a) => a.id === w.id);
      if (prev) {
        prev.shares = w.fractional ? Math.round((prev.shares + shares) * 10_000) / 10_000 : prev.shares + shares;
        prev.eur += spent;
        prev.weightAfter = (w.valueEur! + prev.eur) / finalTotal;
      } else plan.unshift({ id: w.id, ticker: w.ticker, shares, eur: spent, weightAfter: (w.valueEur! + spent) / finalTotal });
    }
  }
  const cheapest = Math.min(...eligible.map((r) => r.candidate.priceEur!));
  let leftover: NextBuyResult["leftover"] = null;
  if (remaining > 0.5) {
    const reason = plan.length === 0 && cheapest > budget ? `Con ${eur(budget)} no llega para una acción entera (la más barata cuesta ${eur(cheapest)}).` : "Es lo que sobra al comprar acciones enteras.";
    leftover = { eur: remaining, reason };
  }
  return { plan, leftover, overCap };
}

const BETTER: Record<CriterionId, string> = {
  balance: "pesa menos en tu cartera",
  sector: "te diversifica más de sector",
  valuation: "está más barata",
  cash: "genera más caja",
  growth: "crece más",
};

const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

/** Frases «por qué esta y no las otras»: dónde gana y dónde pierde frente a cada una. */
function explain(winner: ScoredCandidate, ranked: ScoredCandidate[], gap = 10): string[] {
  const out: string[] = [];
  const score = (r: ScoredCandidate, id: CriterionId) => r.criteria.find((k) => k.id === id)!.score;
  for (const other of ranked) {
    if (other === winner) continue;
    const o = other.candidate.ticker;
    if (other.excluded) {
      out.push(`${o} queda fuera: ${other.excluded.charAt(0).toLowerCase()}${other.excluded.slice(1)}`);
      continue;
    }
    const wins: string[] = [];
    const loses: string[] = [];
    for (const { id } of CRITERIA) {
      const a = score(winner, id);
      const b = score(other, id);
      if (a === null || b === null) continue;
      if (a - b >= gap) wins.push(BETTER[id]);
      else if (b - a >= gap) loses.push(BETTER[id]);
    }
    const head = `Frente a ${o} (${winner.total} puntos frente a ${other.total}): `;
    if (wins.length === 0 && loses.length === 0) out.push(`${head}están muy igualadas; gana por poco en la suma de los cinco criterios.`);
    else if (loses.length === 0) out.push(`${head}${winner.candidate.ticker} ${join(wins)}.`);
    else if (wins.length === 0) out.push(`${head}${o} ${join(loses)}, pero ${winner.candidate.ticker} compensa con el resto de criterios.`);
    else out.push(`${head}${winner.candidate.ticker} ${join(wins)}; ${o} ${join(loses)}.`);
  }
  return out;
}
