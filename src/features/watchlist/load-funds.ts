import type { Db } from "@/db/client";
import { getPriceBars } from "@/db/repo";
import { trendFromCloses } from "@/domain/portfolio/recommendation";
import { technicalRisk, type TechnicalRisk } from "@/domain/technical/risk";
import { getFundProfiles, type FundProfileRow } from "@/features/portfolio/fund-profile";
import type { FundLine } from "@/features/portfolio/FundsTable";

/** ETF/ETC de la watchlist con su ficha (si la hay), tendencia y riesgo técnico, todo de datos guardados. */
export interface WatchlistFund extends FundLine {
  isin: string | null;
  exchange: string | null;
  currency: string;
  fund: FundProfileRow | null;
  technical: TechnicalRisk;
  price: { close: number; date: string } | null;
  held: boolean;
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
  const out: WatchlistFund[] = [];
  for (const r of rows) {
    const monthly = await getPriceBars(db, r.id, "1mo");
    const daily = (await getPriceBars(db, r.id, "1d")).at(-1);
    const fund = profiles.get(r.id) ?? null;
    out.push({
      id: r.id, ticker: r.ticker, name: r.name, kind: r.kind, isin: r.isin, exchange: r.exchange, currency: r.currency,
      profile: fund?.profile ?? null, fund,
      trend: trendFromCloses(monthly.map((b) => b.close)),
      technical: technicalRisk(monthly.slice(-120)),
      price: daily ? { close: daily.close, date: daily.date } : null,
      position: null, recommendation: null, held: r.held === 1,
    });
  }
  return out;
}
