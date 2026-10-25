import type { Db } from "@/db/client";
import { getPriceBars, getPriceHistoryMeta, type BarRow } from "@/db/repo";
import { technicalRisk, type TechnicalRisk } from "@/domain/technical/risk";

/** Riesgo técnico de todo lo que sigues o tienes (watchlist + cartera), sin IA ni red. */

export interface RiskRow {
  id: number;
  ticker: string;
  name: string;
  isin: string | null;
  kind: "stock" | "etf" | "etc";
  currency: string;
  inWatchlist: boolean;
  inPortfolio: boolean;
  risk: TechnicalRisk;
  source: string | null;
  lastDate: string | null;
}

export async function listTrackedSecurities(db: Db) {
  return db.select<{ id: number; ticker: string; name: string; isin: string | null; kind: RiskRow["kind"]; currency: string; in_watchlist: number; held: number }>(
    `SELECT id, COALESCE(ticker, isin) AS ticker, name, isin, kind, currency, in_watchlist,
       (id IN (SELECT security_id FROM transactions)) AS held
     FROM securities WHERE in_watchlist = 1 OR id IN (SELECT security_id FROM transactions)
     ORDER BY ticker`,
  );
}

export async function riskFor(db: Db, id: number): Promise<{ monthly: BarRow[]; risk: TechnicalRisk }> {
  const monthly = (await getPriceBars(db, id, "1mo")).slice(-120);
  return { monthly, risk: technicalRisk(monthly) };
}

const ORDER = { Alto: 0, Medio: 1, Bajo: 2 } as const;

export async function loadTechnicalRisk(db: Db): Promise<RiskRow[]> {
  const rows = await listTrackedSecurities(db);
  const out: RiskRow[] = [];
  for (const r of rows) {
    const [{ risk }, meta] = await Promise.all([riskFor(db, r.id), getPriceHistoryMeta(db, r.id)]);
    out.push({
      id: r.id,
      ticker: r.ticker,
      name: r.name,
      isin: r.isin,
      kind: r.kind,
      currency: r.currency,
      inWatchlist: r.in_watchlist === 1,
      inPortfolio: r.held === 1,
      risk,
      source: meta?.source ?? null,
      lastDate: meta?.last_date ?? null,
    });
  }
  // Primero lo más arriesgado; sin semáforo, al final
  return out.sort((a, b) => (a.risk.level ? ORDER[a.risk.level] : 3) - (b.risk.level ? ORDER[b.risk.level] : 3) || a.ticker.localeCompare(b.ticker));
}

/** Velas para el gráfico: mensuales de 10 años o semanales de 5. */
export async function loadCandles(db: Db, id: number, interval: "1mo" | "1w"): Promise<BarRow[]> {
  const bars = await getPriceBars(db, id, interval);
  return interval === "1mo" ? bars.slice(-120) : bars.slice(-260);
}
