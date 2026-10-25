import type { Db } from "@/db/client";
import { PORTFOLIO_CONFIG } from "@/domain/scoring/config";
import { getPriceBars } from "@/db/repo";
import { recommend, roomToMaxEur, trendFromCloses, type Recommendation } from "@/domain/portfolio/recommendation";
import { priceStats, type PriceStats } from "@/domain/technical/price-range";
import { technicalRisk, type TechnicalRisk } from "@/domain/technical/risk";
import { getFundProfiles, type FundProfileRow } from "@/features/portfolio/fund-profile";
import type { FundLine } from "@/features/portfolio/FundsTable";
import { loadPortfolio } from "@/features/portfolio/load";

/** Encaje en tu cartera (solo si has registrado operaciones). */
export interface PortfolioFit {
  /** Valor de toda la cartera en € (posiciones con precio). */
  totalEur: number;
  /** Valor y peso de este fondo en la cartera (0 si no lo tienes). */
  valueEur: number;
  weight: number;
  /** Cuánto se puede añadir sin pasar del peso máximo por posición. */
  roomEur: number;
  maxPosition: number;
  recommendation: Recommendation;
}

/** ETF/ETC de la watchlist con su ficha (si la hay), tendencia y riesgo técnico, todo de datos guardados. */
export interface WatchlistFund extends FundLine {
  isin: string | null;
  exchange: string | null;
  currency: string;
  fund: FundProfileRow | null;
  technical: TechnicalRisk;
  price: { close: number; date: string } | null;
  held: boolean;
  /** Rango y media de 52 semanas y lo que va de año. */
  stats: PriceStats;
  fit: PortfolioFit | null;
}

interface Row {
  id: number;
  ticker: string;
  name: string;
  kind: string;
  isin: string | null;
  exchange: string | null;
  currency: string;
  held: number;
}

export async function loadWatchlistFunds(db: Db, only?: number): Promise<WatchlistFund[]> {
  const rows = await db.select<Row>(
    `SELECT id, ticker, name, kind, isin, exchange, currency, (id IN (SELECT security_id FROM transactions)) AS held
     FROM securities WHERE in_watchlist = 1 AND kind != 'stock' ${only ? "AND id = ?" : ""} ORDER BY ticker`,
    only ? [only] : [],
  );
  const profiles = await getFundProfiles(db);
  const [tx] = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM transactions");
  const portfolio = (tx?.n ?? 0) > 0 ? await loadPortfolio(db) : null;
  const out: WatchlistFund[] = [];
  for (const r of rows) {
    const monthly = await getPriceBars(db, r.id, "1mo");
    const daily = (await getPriceBars(db, r.id, "1d")).at(-1);
    const fund = profiles.get(r.id) ?? null;
    const trend = trendFromCloses(monthly.map((b) => b.close));
    const technical = technicalRisk(monthly.slice(-120));
    const stats = priceStats(await getPriceBars(db, r.id, "1w"), daily ? { value: daily.close, date: daily.date } : null);
    let fit: PortfolioFit | null = null;
    if (portfolio && portfolio.portfolio.valueEur > 0) {
      const holding = portfolio.holdings.find((h) => h.row.id === r.id);
      const totalEur = portfolio.portfolio.valueEur;
      const valueEur = holding?.position.valueEur ?? 0;
      fit = {
        totalEur,
        valueEur,
        weight: valueEur / totalEur,
        roomEur: roomToMaxEur(totalEur, valueEur),
        maxPosition: PORTFOLIO_CONFIG.maxPosition,
        // Si ya lo tienes, la misma recomendación que en Mi Portfolio; si no, la que tendría con peso 0
        recommendation:
          holding?.recommendation ??
          recommend({
            kind: r.kind === "etc" ? "etc" : "etf",
            weight: 0,
            sector: null,
            valuation: null,
            outcome: null,
            quality: null,
            activeSignals: [],
            debt: null,
            trend,
            technical: { level: technical.level, sentence: technical.sentence },
          }),
      };
    }
    out.push({
      id: r.id, ticker: r.ticker, name: r.name, kind: r.kind, isin: r.isin, exchange: r.exchange, currency: r.currency,
      profile: fund?.profile ?? null, fund,
      trend,
      technical,
      price: daily ? { close: daily.close, date: daily.date } : null,
      position: null, recommendation: null, held: r.held === 1,
      stats,
      fit,
    });
  }
  return out;
}
