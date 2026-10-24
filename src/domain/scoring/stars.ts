import type { RiskLevel } from "@/domain/technical/risk";
import { PORTFOLIO_CONFIG, STARS_CONFIG, VALUATION_CONFIG } from "./config";
import type { Outcome } from "./peer-verdict";
import type { Verdict } from "./valuation-score";

/**
 * Estrellas ⭐ (CLAUDE.md §5.4 y §8.5), deterministas y con desglose:
 * - Watchlist: la mejor siguiente compra = valoración × calidad × complemento
 *   de tu cartera (sector, país y divisa que te faltan y precios que no se
 *   mueven a la par que lo que ya tienes).
 * - Cartera: la posición que hoy, si la comprases, saldría más barata frente a
 *   su historia y a la competencia, con una calidad mínima.
 * Cada estrella lleva 2 o 3 razones en llano.
 */

export interface StarCandidate {
  id: number;
  ticker: string;
  name: string;
  /** Valoración frente a su historia (§8.1): score 0–100 (100 = muy barata) y desviación (−0,2 = un 20 % por debajo). */
  valuation: { verdict: Verdict | null; score: number | null; deviation: number | null };
  /** Desviación de sus múltiplos frente a la mediana de competidores. */
  peers: { verdict: Verdict | null; deviation: number | null };
  quality: number | null;
  outcome: Outcome | null;
  technical: RiskLevel | null;
  sector: string | null;
  country: string | null;
  /** Divisa en unidades mayores (GBP, no GBp). */
  currency: string;
  /** Correlación media (ponderada por peso) de sus precios mensuales con tus posiciones. */
  correlation: number | null;
  /** Watchlist: peso que ya tiene en tu cartera, si la tienes. */
  heldWeight?: number | null;
}

export interface PortfolioMix {
  /** Pesos de 0 a 1 en tu cartera. Vacíos si no tienes posiciones con valor. */
  sector: Record<string, number>;
  country: Record<string, number>;
  currency: Record<string, number>;
}

export type ComplementPartId = "sector" | "country" | "currency" | "correlation";

export interface ComplementPart {
  id: ComplementPartId;
  label: string;
  /** 0–100: 100 = aporta lo que a tu cartera le falta. */
  score: number;
  text: string;
}

export interface WatchlistStarRow {
  candidate: StarCandidate;
  /** Valoración 0–100 (historia y, si la hay, competencia). */
  valuation: number | null;
  complement: { score: number; parts: ComplementPart[] } | null;
  /** valoración × calidad × complemento, 0–100. null si no opta. */
  score: number | null;
  /** Por qué no opta a la estrella. */
  excluded: string | null;
}

export interface Star {
  id: number;
  ticker: string;
  name: string;
  /** 2 o 3 razones en llano. */
  reasons: string[];
  /** Algo a vigilar que no quita la estrella. */
  caution?: string;
}

export interface WatchlistStars {
  star: Star | null;
  /** Todas las candidatas, de mejor a peor (las excluidas al final). */
  ranking: WatchlistStarRow[];
  /** Por qué no hay estrella, si no la hay. */
  note?: string;
}

type Cfg = typeof STARS_CONFIG;

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const pct = (x: number) => `${Math.round(Math.abs(x) * 100).toLocaleString("es-ES")} %`;
const corrText = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 2, minimumFractionDigits: 1 });
const isEmpty = (r: Record<string, number>) => Object.keys(r).length === 0;

/** Puntuación 0–100 de una desviación frente a la competencia, con la misma escala que la de su historia. */
const peerScore = (deviation: number) => clamp(50 - (deviation / VALUATION_CONFIG.fullScaleDeviation) * 50);

export function valuationPoints(c: StarCandidate): number | null {
  const parts = [c.valuation.score, c.peers.deviation === null ? null : peerScore(c.peers.deviation)].filter((x): x is number => x !== null);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
}

/**
 * Cuánto complementa a tu cartera (0–100). Las partes sin dato no cuentan y el
 * resto se reparte su peso. Con la cartera vacía todo complementa.
 */
export function complement(c: StarCandidate, mix: PortfolioMix, cfg: Cfg = STARS_CONFIG): { score: number; parts: ComplementPart[] } {
  const parts: ComplementPart[] = [];
  const share = (id: "sector" | "country" | "currency", key: string | null, label: string, name: (k: string) => string) => {
    if (!key || isEmpty(mix[id])) return;
    const w = mix[id][key] ?? 0;
    const score = Math.round(100 * (1 - Math.min(1, w / cfg.fullAt[id])));
    parts.push({
      id,
      label,
      score,
      text: w === 0 ? `Aporta ${name(key)}, que no tienes en tu cartera.` : `${name(key)} ya pesa un ${pct(w)} de tu cartera.`,
    });
  };
  share("sector", c.sector, "Sector", (k) => `el sector ${k}`);
  share("country", c.country, "País", (k) => k);
  share("currency", c.currency, "Divisa", (k) => `el ${k}`);
  if (c.correlation !== null) {
    const { low, high } = cfg.correlation;
    const score = Math.round(clamp(100 * (high - c.correlation) / (high - low)));
    parts.push({
      id: "correlation",
      label: "Se mueve distinto",
      score,
      text:
        score >= 70
          ? `Su precio se mueve poco a la par que tu cartera (correlación ${corrText(c.correlation)}).`
          : `Su precio se mueve bastante a la par que tu cartera (correlación ${corrText(c.correlation)}).`,
    });
  }
  if (parts.length === 0) return { score: 100, parts };
  const weight = (p: ComplementPart) => cfg.complementWeights[p.id];
  const total = parts.reduce((a, p) => a + weight(p), 0);
  return { score: Math.round(parts.reduce((a, p) => a + p.score * weight(p), 0) / total), parts };
}

function exclusion(c: StarCandidate, valuation: number | null, cfg: Cfg): string | null {
  if (valuation === null) return "Sin valoración: falta el precio o historia suficiente.";
  if (c.quality === null) return "Faltan datos para medir su calidad.";
  if (c.outcome === "Trampa de valor") return "Posible trampa de valor.";
  if (c.quality < cfg.minQuality) return `Calidad baja (${Math.round(c.quality)} de 100; se exige ${cfg.minQuality}).`;
  if (c.valuation.verdict === "Cara" || c.outcome === "Cara") return "Hoy está cara.";
  if (c.technical === "Alto") return "Riesgo técnico de largo plazo alto.";
  return null;
}

function valuationReason(c: StarCandidate): string | null {
  const h = c.valuation.deviation;
  const p = c.peers.deviation;
  if (h !== null && h < 0 && p !== null && p < 0) return `Más barata que de costumbre (un ${pct(h)}) y que sus competidores (un ${pct(p)}).`;
  if (h !== null && h < 0) return `Un ${pct(h)} más barata que su media histórica.`;
  if (p !== null && p < 0) return `Un ${pct(p)} más barata que sus competidores.`;
  if (c.valuation.verdict === "Justa") return "A un precio justo frente a su historia.";
  return null;
}

export function watchlistStar(candidates: StarCandidate[], mix: PortfolioMix, cfg: Cfg = STARS_CONFIG, maxPosition = PORTFOLIO_CONFIG.maxPosition): WatchlistStars {
  const ranking: WatchlistStarRow[] = candidates.map((candidate) => {
    const valuation = valuationPoints(candidate);
    const comp = complement(candidate, mix, cfg);
    const excluded = exclusion(candidate, valuation, cfg);
    const score = excluded || valuation === null || candidate.quality === null ? null : Math.round((valuation * candidate.quality * comp.score) / 10_000);
    return { candidate, valuation, complement: comp, score, excluded };
  });
  ranking.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.candidate.ticker.localeCompare(b.candidate.ticker));

  const best = ranking[0];
  if (!best || best.score === null) {
    return {
      star: null,
      ranking,
      note: candidates.length === 0 ? "Añade acciones a tu watchlist para ver cuál complementa mejor tu cartera." : "Ninguna acción de tu watchlist cumple hoy los mínimos (precio, calidad y sin trampa de valor).",
    };
  }
  const c = best.candidate;
  const reasons = [valuationReason(c), `Buena salud financiera: ${Math.round(c.quality!)} de 100.`];
  const topPart = [...(best.complement?.parts ?? [])].sort((a, b) => b.score - a.score)[0];
  reasons.push(
    isEmpty(mix.sector) && isEmpty(mix.country) && isEmpty(mix.currency)
      ? "Tu cartera está vacía: cualquier acción la diversifica."
      : topPart && topPart.score >= 60
        ? topPart.text
        : "Es la que mejor encaja con tu cartera de las que pasan los mínimos.",
  );
  const caution = c.heldWeight != null && c.heldWeight > maxPosition ? `Ojo: ya pesa un ${pct(c.heldWeight)} de tu cartera; ampliar la concentraría más.` : undefined;
  return { star: { id: c.id, ticker: c.ticker, name: c.name, reasons: reasons.filter((r): r is string => !!r).slice(0, 3), caution }, ranking };
}

/* ---------- Cartera ---------- */

export interface HoldingCandidate extends StarCandidate {
  /** Peso en tu cartera (0–1). */
  weight: number | null;
}

export interface PortfolioStarRow {
  candidate: HoldingCandidate;
  /** Media de la desviación frente a su historia y frente a la competencia (negativo = más barata). */
  discount: number | null;
  excluded: string | null;
}

export interface PortfolioStars {
  star: Star | null;
  ranking: PortfolioStarRow[];
  note?: string;
}

export function portfolioStar(holdings: HoldingCandidate[], cfg: Cfg = STARS_CONFIG, maxPosition = PORTFOLIO_CONFIG.maxPosition): PortfolioStars {
  const ranking: PortfolioStarRow[] = holdings.map((candidate) => {
    const devs = [candidate.valuation.deviation, candidate.peers.deviation].filter((x): x is number => x !== null);
    const discount = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : null;
    let excluded: string | null = null;
    if (discount === null) excluded = "Sin valoración: falta el precio o historia suficiente.";
    else if (candidate.quality === null) excluded = "Faltan datos para medir su calidad.";
    else if (candidate.outcome === "Trampa de valor") excluded = "Posible trampa de valor.";
    else if (candidate.quality < cfg.minQuality) excluded = `Calidad baja (${Math.round(candidate.quality)} de 100; se exige ${cfg.minQuality}).`;
    else if (discount > -cfg.minDiscount) excluded = "Hoy no está más barata que de costumbre.";
    return { candidate, discount, excluded };
  });
  ranking.sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded) || (a.discount ?? Infinity) - (b.discount ?? Infinity) || a.candidate.ticker.localeCompare(b.candidate.ticker));

  const best = ranking[0];
  if (!best || best.excluded) {
    return {
      star: null,
      ranking,
      note: holdings.length === 0 ? "Apunta tus operaciones de acciones para ver cuál está hoy más barata." : "Ninguna de tus acciones está hoy claramente más barata que de costumbre con buena calidad.",
    };
  }
  const c = best.candidate;
  const reasons = [valuationReason(c) ?? `Un ${pct(best.discount!)} más barata de lo habitual.`, `Calidad de ${Math.round(c.quality!)} de 100: no parece una trampa de valor.`];
  if (c.outcome === "Oportunidad") reasons.push("Barata frente a su historia y a la competencia con igual o mejor calidad: oportunidad.");
  const caution =
    c.weight !== null && c.weight > maxPosition
      ? `Ojo: ya pesa un ${pct(c.weight)} de tu cartera; ampliar la concentraría más.`
      : c.technical === "Alto"
        ? "Ojo: su riesgo técnico de largo plazo es alto; puede seguir bajando antes de estabilizarse."
        : undefined;
  return { star: { id: c.id, ticker: c.ticker, name: c.name, reasons: reasons.slice(0, 3), caution }, ranking };
}

/* ---------- Correlación ---------- */

export interface MonthlyClose {
  date: string;
  close: number;
}

function monthlyReturns(bars: MonthlyClose[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    if (prev > 0) out.set(bars[i]!.date.slice(0, 7), bars[i]!.close / prev - 1);
  }
  return out;
}

/** Correlación de Pearson de las rentabilidades mensuales en los meses comunes; null con pocos meses. */
export function correlation(a: MonthlyClose[], b: MonthlyClose[], minMonths = STARS_CONFIG.correlation.minMonths): number | null {
  const ra = monthlyReturns(a);
  const rb = monthlyReturns(b);
  const pairs: [number, number][] = [];
  for (const [m, x] of ra) {
    const y = rb.get(m);
    if (y !== undefined) pairs.push([x, y]);
  }
  if (pairs.length < minMonths) return null;
  const mean = (i: 0 | 1) => pairs.reduce((s, p) => s + p[i], 0) / pairs.length;
  const mx = mean(0);
  const my = mean(1);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Correlación media con tus posiciones, ponderada por su peso. Las que no tienen bastante historia no cuentan. */
export function portfolioCorrelation(candidate: MonthlyClose[], holdings: { weight: number; bars: MonthlyClose[] }[], minMonths?: number): number | null {
  let sum = 0;
  let total = 0;
  for (const h of holdings) {
    const c = correlation(candidate, h.bars, minMonths);
    if (c === null || h.weight <= 0) continue;
    sum += c * h.weight;
    total += h.weight;
  }
  return total > 0 ? sum / total : null;
}
