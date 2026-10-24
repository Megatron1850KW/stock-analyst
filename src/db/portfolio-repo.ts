import type { Db } from "./client";

/** Operaciones de la cartera (CLAUDE.md §5.2). */

export interface TransactionInput {
  securityId: number;
  date: string;
  type: "buy" | "sell" | "dividend";
  quantity: number;
  price: number;
  currency: string;
  fees: number;
  fxRateToBase: number | null;
  broker: string | null;
  notes: string | null;
}

export interface TransactionRow {
  id: number;
  security_id: number;
  trade_date: string;
  type: "buy" | "sell" | "dividend";
  quantity: number;
  price: number;
  currency: string;
  fees: number;
  fx_rate_to_base: number | null;
  broker: string | null;
  notes: string | null;
  ticker: string;
  name: string;
  kind: "stock" | "etf" | "etc";
}

export async function insertTransaction(db: Db, t: TransactionInput): Promise<number> {
  const r = await db.execute(
    `INSERT INTO transactions (security_id, trade_date, type, quantity, price, currency, fees, fx_rate_to_base, broker, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.securityId, t.date, t.type, t.quantity, t.price, t.currency, t.fees, t.fxRateToBase, t.broker, t.notes],
  );
  return r.lastInsertId!;
}

export async function deleteTransaction(db: Db, id: number): Promise<void> {
  await db.execute("DELETE FROM transactions WHERE id = ?", [id]);
}

export function listTransactions(db: Db): Promise<TransactionRow[]> {
  return db.select(
    `SELECT t.id, t.security_id, t.trade_date, t.type, t.quantity, t.price, t.currency, t.fees, t.fx_rate_to_base, t.broker, t.notes,
       COALESCE(s.ticker, s.isin) AS ticker, s.name, s.kind
     FROM transactions t JOIN securities s ON s.id = t.security_id
     ORDER BY t.trade_date DESC, t.id DESC`,
  );
}

export interface PortfolioSecurityRow {
  id: number;
  ticker: string;
  name: string;
  isin: string | null;
  kind: "stock" | "etf" | "etc";
  market: string | null;
  exchange: string | null;
  currency: string;
  sector: string | null;
  sector_source: string | null;
  country: string | null;
  filer_type: string | null;
  sic: string | null;
  in_watchlist: number;
  price: number | null;
  price_date: string | null;
  price_currency: string | null;
  price_source: string | null;
  price_fetched_at: string | null;
}

/** Valores con alguna operación, con su última cotización. */
export function listPortfolioSecurities(db: Db): Promise<PortfolioSecurityRow[]> {
  return db.select(
    `SELECT s.id, COALESCE(s.ticker, s.isin) AS ticker, s.name, s.isin, s.kind, s.market, s.exchange, s.currency, s.sector, s.sector_source,
       s.country, s.filer_type, s.sic, s.in_watchlist,
       p.close AS price, p.date AS price_date, p.currency AS price_currency, p.source AS price_source, p.fetched_at AS price_fetched_at
     FROM securities s
     LEFT JOIN prices p ON p.security_id = s.id AND p.interval = '1d'
       AND p.date = (SELECT MAX(date) FROM prices WHERE security_id = s.id AND interval = '1d')
     WHERE s.id IN (SELECT security_id FROM transactions)
     ORDER BY s.ticker`,
  );
}

/** Sector y país que indicas tú (no hay dato oficial gratuito para Europa). */
export async function setSecurityClassification(db: Db, id: number, c: { sector: string | null; country: string | null }): Promise<void> {
  await db.execute(
    "UPDATE securities SET sector = ?, sector_source = CASE WHEN ? IS NULL THEN NULL ELSE 'user' END, country = ?, updated_at = ? WHERE id = ?",
    [c.sector, c.sector, c.country, new Date().toISOString(), id],
  );
}

export interface FundSecurityInput {
  isin: string;
  figi: string | null;
  ticker: string;
  name: string;
  exchange: string | null;
  currency: string;
  kind: "etf" | "etc";
  /** Darlo de alta también en la watchlist. */
  watchlist?: boolean;
}

/** Alta de un ETF o ETC (por ISIN). Solo va a la watchlist si se pide: no tiene informes que analizar. */
export async function upsertFundSecurity(db: Db, f: FundSecurityInput): Promise<number> {
  const existing = await db.select<{ id: number }>("SELECT id FROM securities WHERE isin = ?", [f.isin]);
  if (existing[0]) {
    await db.execute(
      "UPDATE securities SET ticker = ?, name = ?, exchange = ?, currency = ?, figi = ?, kind = ?, market = 'EU', in_watchlist = MAX(in_watchlist, ?), updated_at = ? WHERE id = ?",
      [f.ticker, f.name, f.exchange, f.currency, f.figi, f.kind, f.watchlist ? 1 : 0, new Date().toISOString(), existing[0].id],
    );
    return existing[0].id;
  }
  await db.execute(
    "INSERT INTO securities (isin, figi, ticker, name, exchange, currency, kind, market, in_watchlist) VALUES (?, ?, ?, ?, ?, ?, ?, 'EU', ?)",
    [f.isin, f.figi, f.ticker, f.name, f.exchange, f.currency, f.kind, f.watchlist ? 1 : 0],
  );
  return (await db.select<{ id: number }>("SELECT id FROM securities WHERE isin = ?", [f.isin]))[0]!.id;
}
