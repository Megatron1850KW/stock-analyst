import { NEXT_BUY_CONFIG, PORTFOLIO_CONFIG } from "@/domain/scoring/config";
import type { FundValuation } from "@/domain/valuation/fund-valuation";
import type { RiskLevel } from "@/domain/technical/risk";
import { countryName } from "./sector";
import { companyKey, holdingLabel } from "./holdings";
import type { Exposure, Share } from "./positions";
import { roomToMaxEur } from "./recommendation";

/**
 * «¿Qué comprar después?» entre tus ETFs y ETCs (CLAUDE.md §5.5 y §8.4), sin IA.
 * Cada fondo se puntúa con dos partes de 0 a 100:
 * - Valoración: su precio frente a su tendencia de largo plazo.
 * - Aporte a tu cartera: cuánto de sus sectores, países y grandes empresas
 *   no tienes ya (mirando dentro de tus fondos). Si empujaría aún más un sector
 *   que ya pasa del 35 %, el aporte se reduce a la mitad.
 * No optan los que ya pesan más del 15 %, los caros, los de riesgo técnico alto
 * y los que no tienen historia suficiente para saber si están caros.
 */

export interface NextBuyCandidate {
  id: number;
  ticker: string;
  name: string;
  kind: string;
  commodity: boolean;
  valuation: FundValuation | null;
  technical: RiskLevel | null;
  /** Reparto de su ficha (pesos 0–1). Vacíos si no tiene ficha. */
  sectors: Share[];
  countries: Share[];
  holdings: { name: string; weight: number }[];
  /** Lo que ya tienes de él en € (0 si solo está en tu watchlist). */
  heldEur: number;
}

export interface NextBuyPortfolio {
  totalEur: number;
  bySector: Exposure[];
  byCountry: Exposure[];
  /** Peso (0–1) de cada empresa en tu cartera, mirando dentro de los fondos (clave de `companyKey`). */
  companies: Map<string, number>;
}

export interface NextBuyPart {
  id: "sectors" | "countries" | "companies";
  label: string;
  /** 0–100: 100 = todo lo que aporta es nuevo para tu cartera. */
  score: number;
  text: string;
}

export interface NextBuyRow {
  candidate: NextBuyCandidate;
  valuation: number | null;
  complement: { score: number; parts: NextBuyPart[]; push: string | null } | null;
  score: number | null;
  /** Cuánto puedes añadir sin pasar del 15 %. */
  roomEur: number;
  weight: number;
  excluded: string | null;
  reasons: string[];
}

export interface NextBuyResult {
  ranking: NextBuyRow[];
  picks: NextBuyRow[];
  note?: string;
}

type Cfg = typeof NEXT_BUY_CONFIG;
const pct = (x: number) => `${Math.round(Math.abs(x) * 100).toLocaleString("es-ES")} %`;
const IGNORED = new Set(["Otros", "Sin dato", "ETF sin ficha"]);

/** Parte de un fondo que ya está en tu cartera: Σ min(peso en el fondo, peso en tu cartera), normalizado a lo que reparte la ficha. */
function overlap(fund: Share[], mix: Map<string, number>): number | null {
  const parts = fund.filter((s) => !IGNORED.has(s.key) && s.weight > 0);
  const total = parts.reduce((t, s) => t + s.weight, 0);
  if (total <= 0) return null;
  return parts.reduce((t, s) => t + Math.min(s.weight / total, mix.get(s.key) ?? 0), 0);
}

/** Sectores y países de un fondo; un ETC o fondo de materias primas cuenta entero como «Materias primas». */
export function fundSectors(c: Pick<NextBuyCandidate, "sectors" | "commodity">): Share[] {
  return c.sectors.length ? c.sectors : c.commodity ? [{ key: "Materias primas", weight: 1 }] : [];
}

/** Peso de cada empresa en tu cartera: acciones directas + lo que llevan dentro tus fondos (sus mayores posiciones). */
export function companyExposure(
  positions: { valueEur: number | null; kind: string; name: string; holdings: { name: string; weight: number }[] }[],
  totalEur: number,
): Map<string, number> {
  const m = new Map<string, number>();
  if (totalEur <= 0) return m;
  const add = (name: string, eur: number) => {
    const k = companyKey(name);
    if (k) m.set(k, (m.get(k) ?? 0) + eur / totalEur);
  };
  for (const p of positions) {
    if (!p.valueEur) continue;
    if (p.kind === "stock") add(p.name, p.valueEur);
    else for (const h of p.holdings) add(h.name, p.valueEur * h.weight);
  }
  return m;
}

export function complementOf(c: NextBuyCandidate, p: NextBuyPortfolio, cfg: Cfg = NEXT_BUY_CONFIG, maxSector = PORTFOLIO_CONFIG.maxSector) {
  if (p.totalEur <= 0) return null;
  const sectorMix = new Map(p.bySector.map((e) => [e.key, e.weight]));
  const countryMix = new Map(p.byCountry.map((e) => [e.key, e.weight]));
  const parts: NextBuyPart[] = [];
  const sectors = fundSectors(c);
  const so = overlap(sectors, sectorMix);
  if (so !== null) {
    const top = sectors.find((s) => !IGNORED.has(s.key));
    parts.push({
      id: "sectors",
      label: "Sectores nuevos",
      score: Math.round(100 * (1 - so)),
      text: so < 0.3 ? `Reparte en sectores que apenas tienes${top ? ` (sobre todo ${top.key})` : ""}.` : `Sus sectores ya los tienes en buena parte (coinciden en un ${pct(so)}).`,
    });
  }
  // Materias primas sin país: no cuenta esta parte
  const co = c.commodity && !c.countries.length ? null : overlap(c.countries, countryMix);
  if (co !== null) {
    const top = c.countries.find((s) => !IGNORED.has(s.key));
    parts.push({
      id: "countries",
      label: "Países nuevos",
      score: Math.round(100 * (1 - co)),
      text: co < 0.3 ? `Aporta países que apenas tienes${top ? ` (sobre todo ${countryName(top.key)})` : ""}.` : `Sus países ya los tienes en buena parte (coinciden en un ${pct(co)}).`,
    });
  }
  const hs = c.holdings.filter((h) => h.weight > 0);
  const hTotal = hs.reduce((t, h) => t + h.weight, 0);
  if (hTotal > 0) {
    const shared = hs.filter((h) => (p.companies.get(companyKey(h.name)) ?? 0) > 0);
    const sharedW = shared.reduce((t, h) => t + h.weight, 0) / hTotal;
    parts.push({
      id: "companies",
      label: "Empresas nuevas",
      score: Math.round(100 * (1 - sharedW)),
      text: shared.length === 0
        ? "Ninguna de sus mayores posiciones está ya en tu cartera."
        : `Ya tienes ${shared.length} de sus ${hs.length} mayores posiciones (${shared.slice(0, 3).map((h) => holdingLabel(h.name)).join(", ")}${shared.length > 3 ? "…" : ""}).`,
    });
  }
  if (!parts.length) return null;
  const total = parts.reduce((t, x) => t + cfg.complementWeights[x.id], 0);
  let score = parts.reduce((t, x) => t + x.score * cfg.complementWeights[x.id], 0) / total;
  // ¿Empujaría aún más un sector que ya pasa del máximo?
  let push: string | null = null;
  const heavy = sectors.find((s) => !IGNORED.has(s.key) && s.weight >= cfg.pushSectorFrom && (sectorMix.get(s.key) ?? 0) > maxSector);
  if (heavy) {
    push = `Subiría aún más tu peso en ${heavy.key}, que ya es del ${pct(sectorMix.get(heavy.key)!)} (máximo recomendado ${pct(maxSector)}).`;
    score *= cfg.pushPenalty;
  }
  return { score: Math.round(score), parts, push };
}

function exclusion(c: NextBuyCandidate, weight: number, maxPosition: number): string | null {
  if (weight > maxPosition) return `Ya pesa un ${pct(weight)} de tu cartera (máximo recomendado ${pct(maxPosition)}).`;
  if (!c.valuation || c.valuation.verdict === null) return c.valuation?.sentence ?? "Sin precios guardados para saber si está cara.";
  if (c.valuation.verdict === "Cara") return "Hoy está cara frente a su tendencia de largo plazo.";
  if (c.technical === "Alto") return "Riesgo técnico de largo plazo alto: mejor esperar a que se estabilice.";
  return null;
}

export function nextFundBuys(candidates: NextBuyCandidate[], p: NextBuyPortfolio, cfg: Cfg = NEXT_BUY_CONFIG, maxPosition = PORTFOLIO_CONFIG.maxPosition): NextBuyResult {
  const ranking: NextBuyRow[] = candidates.map((c) => {
    const weight = p.totalEur > 0 ? c.heldEur / p.totalEur : 0;
    const valuation = c.valuation?.score ?? null;
    const complement = complementOf(c, p, cfg);
    const excluded = exclusion(c, weight, maxPosition);
    const score =
      excluded || valuation === null
        ? null
        : complement
          ? Math.round(valuation * cfg.weights.valuation + complement.score * cfg.weights.complement)
          : valuation;
    const reasons: string[] = [];
    if (c.valuation?.verdict && c.valuation.deviation !== null) {
      reasons.push(
        c.valuation.verdict === "Barata"
          ? `Un ${pct(c.valuation.deviation)} por debajo de su tendencia de largo plazo: más barato que de costumbre.`
          : Math.abs(c.valuation.deviation) < 0.005
            ? "A un precio habitual: justo en su tendencia de largo plazo."
            : `A un precio habitual: un ${pct(c.valuation.deviation)} ${c.valuation.deviation > 0 ? "por encima" : "por debajo"} de su tendencia.`,
      );
    }
    if (complement) {
      if (complement.push) reasons.push(complement.push);
      const best = [...complement.parts].sort((a, b) => b.score - a.score)[0];
      if (best) reasons.push(best.text);
    } else if (p.totalEur <= 0) reasons.push("Tu cartera está vacía: cualquier fondo la diversifica.");
    else reasons.push("Sin ficha del fondo: no se puede ver qué aporta a tu cartera.");
    return { candidate: c, valuation, complement, score, roomEur: roomToMaxEur(p.totalEur, c.heldEur, maxPosition), weight, excluded, reasons };
  });
  ranking.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.candidate.ticker.localeCompare(b.candidate.ticker));
  const picks = ranking.filter((r) => r.score !== null).slice(0, cfg.top);
  return {
    ranking,
    picks,
    note: candidates.length === 0 ? "Añade ETFs o ETCs a tu watchlist o a tu cartera." : picks.length === 0 ? "Ninguno de tus fondos cumple hoy los mínimos (precio no caro, menos del 15 % de tu cartera y riesgo técnico no alto)." : undefined,
  };
}
