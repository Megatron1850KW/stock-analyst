import type { Db } from "@/db/client";
import { getPriceBars, listWatchlist } from "@/db/repo";
import { majorUnit } from "@/domain/portfolio/fx";
import type { Exposure } from "@/domain/portfolio/positions";
import { sectorFromSic } from "@/domain/portfolio/sector";
import { STARS_CONFIG } from "@/domain/scoring/config";
import {
  portfolioCorrelation,
  portfolioStar,
  watchlistStar,
  type HoldingCandidate,
  type MonthlyClose,
  type PortfolioMix,
  type PortfolioStars,
  type StarCandidate,
  type WatchlistStars,
} from "@/domain/scoring/stars";
import { technicalRisk } from "@/domain/technical/risk";
import { loadPeerGroup } from "@/features/peers/load";
import { loadPortfolio } from "@/features/portfolio/load";
import type { Analysis } from "@/features/watchlist/analysis";
import { loadSecurityDetail } from "@/features/watchlist/load";

/** Las dos estrellas (§5.4), calculadas sin IA ni red con lo guardado en tu Mac. */

export interface StarsView {
  watchlist: WatchlistStars;
  portfolio: PortfolioStars;
  /** Tu cartera tiene posiciones con valor (si no, el complemento no se puede medir). */
  hasPortfolio: boolean;
}

interface ClassRow {
  id: number;
  sector: string | null;
  sic: string | null;
  country: string | null;
  market: string | null;
  filer_type: string | null;
  currency: string;
}

const toRecord = (xs: Exposure[]) => Object.fromEntries(xs.filter((e) => e.key !== "Sin dato").map((e) => [e.key, e.weight]));

async function candidate(db: Db, id: number, ticker: string, name: string, cls: ClassRow | undefined, analysis: Analysis | null): Promise<Omit<StarCandidate, "correlation">> {
  const group = await loadPeerGroup(db, id, analysis);
  const monthly = (await getPriceBars(db, id, "1mo")).slice(-120);
  return {
    id,
    ticker,
    name,
    valuation: { verdict: analysis?.valuation?.verdict ?? null, score: analysis?.valuation?.score ?? null, deviation: analysis?.valuation?.deviation ?? null },
    peers: { verdict: group.comparison?.verdict ?? null, deviation: group.comparison?.deviation ?? null },
    quality: analysis?.quality.score ?? null,
    outcome: group.verdict.outcome,
    technical: technicalRisk(monthly).level,
    sector: cls ? (cls.sector ?? sectorFromSic(cls.sic)) : null,
    // Acciones de EE. UU. (no extranjeras): país EE. UU., como en la cartera
    country: cls ? (cls.country ?? (cls.market === "US" && cls.filer_type === "domestic" ? "US" : null)) : null,
    currency: majorUnit(cls?.currency ?? "EUR").currency,
  };
}

export async function loadStars(db: Db, now = new Date()): Promise<StarsView> {
  const [view, watch, classes] = await Promise.all([
    loadPortfolio(db, now),
    listWatchlist(db),
    db.select<ClassRow>("SELECT id, sector, sic, country, market, filer_type, currency FROM securities"),
  ]);
  const cls = new Map(classes.map((c) => [c.id, c]));
  const { portfolio, holdings } = view;
  const mix: PortfolioMix = { sector: toRecord(portfolio.bySector), country: toRecord(portfolio.byCountry), currency: toRecord(portfolio.byCurrency) };

  // Precios mensuales de los últimos años de cada posición, para la correlación
  const months = STARS_CONFIG.correlation.years * 12 + 1;
  const held: { id: number; weight: number; bars: MonthlyClose[] }[] = [];
  for (const h of holdings) {
    if (h.position.weight === null || h.position.weight <= 0) continue;
    held.push({ id: h.row.id, weight: h.position.weight, bars: (await getPriceBars(db, h.row.id, "1mo")).slice(-months) });
  }

  const watchCandidates: StarCandidate[] = [];
  for (const w of watch.filter((x) => x.kind === "stock")) {
    const analysis = (await loadSecurityDetail(db, w.id)).analysis;
    const c = await candidate(db, w.id, w.ticker, w.name, cls.get(w.id), analysis);
    const bars = (await getPriceBars(db, w.id, "1mo")).slice(-months);
    const heldWeight = held.find((h) => h.id === w.id)?.weight ?? null;
    watchCandidates.push({ ...c, heldWeight, correlation: portfolioCorrelation(bars, held.filter((h) => h.id !== w.id)) });
  }

  const holdingCandidates: HoldingCandidate[] = [];
  for (const h of holdings.filter((x) => x.row.kind === "stock")) {
    const c = await candidate(db, h.row.id, h.row.ticker, h.row.name, cls.get(h.row.id), h.analysis);
    holdingCandidates.push({ ...c, correlation: null, weight: h.position.weight });
  }

  return { watchlist: watchlistStar(watchCandidates, mix), portfolio: portfolioStar(holdingCandidates), hasPortfolio: held.length > 0 };
}
