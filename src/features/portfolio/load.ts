import type { Db } from "@/db/client";
import { listPortfolioSecurities, listTransactions, type PortfolioSecurityRow, type TransactionRow } from "@/db/portfolio-repo";
import { getFxRates, getPriceBars } from "@/db/repo";
import { FxTable } from "@/domain/portfolio/fx";
import { buildPortfolio, type Portfolio, type Position, type QuoteInfo, type SecurityInfo } from "@/domain/portfolio/positions";
import { recommend, trendFromCloses, type Recommendation, type Trend } from "@/domain/portfolio/recommendation";
import { buildScenarios, priceCagr, type GrowthInput, type Scenarios } from "@/domain/portfolio/scenarios";
import { sectorFromSic } from "@/domain/portfolio/sector";
import type { OpportunityVerdict } from "@/domain/scoring/peer-verdict";
import { priceStats, type PriceStats } from "@/domain/technical/price-range";
import { technicalRisk, type TechnicalRisk } from "@/domain/technical/risk";
import { loadPeerGroup } from "@/features/peers/load";
import type { Analysis } from "@/features/watchlist/analysis";
import { loadSecurityDetail } from "@/features/watchlist/load";
import { getFundProfiles, type FundProfileRow } from "./fund-profile";

/**
 * Todo lo de la pantalla «Mi Portfolio», calculado sin IA a partir de lo
 * guardado en tu Mac: operaciones, cotizaciones, tipos del BCE, análisis
 * deterministas de cada acción y fichas de ETFs.
 */

export interface Holding {
  position: Position;
  row: PortfolioSecurityRow;
  /** Acciones: análisis determinista (valoración, calidad, deuda). */
  analysis: Analysis | null;
  verdict: OpportunityVerdict | null;
  fund: FundProfileRow | null;
  trend: Trend | null;
  /** Riesgo técnico de largo plazo (§5.3). */
  technical: TechnicalRisk;
  /** Rango de 52 semanas y año en curso. */
  stats: PriceStats;
  recommendation: Recommendation;
  /** De dónde sale el sector mostrado. */
  sectorSource: "user" | "sic" | "factsheet" | null;
}

export interface PortfolioView {
  portfolio: Portfolio;
  holdings: Holding[];
  transactions: TransactionRow[];
  scenarios: Scenarios | null;
  today: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ETC o ETF de materias primas: no reparte por sectores ni países de empresas. */
export function isCommodity(kind: string, name: string, index: string | null): boolean {
  return kind === "etc" || /commodit|materias primas|rohstoff|\bgold\b|\boro\b/i.test(`${name} ${index ?? ""}`);
}

export async function loadPortfolio(db: Db, now = new Date()): Promise<PortfolioView> {
  const today = iso(now);
  const [rows, txs, rates, funds] = await Promise.all([listPortfolioSecurities(db), listTransactions(db), getFxRates(db), getFundProfiles(db)]);

  const sicSector = (r: PortfolioSecurityRow) => (r.sector ? null : sectorFromSic(r.sic));
  const securities: SecurityInfo[] = rows.map((r) => {
    const fund = funds.get(r.id)?.profile;
    const commodity = isCommodity(r.kind, r.name, fund?.index ?? null);
    return {
      id: r.id,
      ticker: r.ticker,
      name: r.name,
      kind: r.kind,
      currency: r.currency,
      sector: r.sector ?? sicSector(r),
      // Acciones de EE. UU. (no extranjeras): país EE. UU.
      // Materias primas (oro, cestas por swap): no tienen país; cuentan en el del domicilio del fondo
      country: r.country ?? (r.market === "US" && r.filer_type === "domestic" ? "US" : null) ?? (commodity && !fund?.countries.length ? fund?.domicile ?? null : null),
      commodity,
      breakdown: fund ? { sectors: fund.sectors, countries: fund.countries } : undefined,
    };
  });
  const quotes = new Map<number, QuoteInfo>();
  for (const r of rows) if (r.price !== null && r.price_date) quotes.set(r.id, { price: r.price, date: r.price_date, currency: r.price_currency ?? r.currency });

  const portfolio = buildPortfolio({
    securities,
    transactions: txs.map((t) => ({
      id: t.id,
      securityId: t.security_id,
      date: t.trade_date,
      type: t.type,
      quantity: t.quantity,
      price: t.price,
      currency: t.currency,
      fees: t.fees,
      fxRateToBase: t.fx_rate_to_base,
    })),
    quotes,
    fx: new FxTable(rates),
    today,
  });

  const sectorWeight = new Map(portfolio.bySector.map((e) => [e.key, e.weight]));
  const growth: GrowthInput[] = [];
  const holdings: Holding[] = [];
  for (const position of portfolio.positions) {
    const row = rows.find((r) => r.id === position.security.id)!;
    const fund = funds.get(row.id) ?? null;
    let analysis: Analysis | null = null;
    let verdict: OpportunityVerdict | null = null;
    let trend: Trend | null = null;
    let g: number | null = null;
    const monthly = await getPriceBars(db, row.id, "1mo");
    const technical = technicalRisk(monthly.slice(-120));
    const stats = priceStats(await getPriceBars(db, row.id, "1w"), position.price ? { value: position.price.price, date: position.price.date } : null);
    if (row.kind === "stock") {
      analysis = (await loadSecurityDetail(db, row.id)).analysis;
      verdict = analysis ? (await loadPeerGroup(db, row.id, analysis)).verdict : null;
      g = analysis?.quality.parts.find((p) => p.id === "growth")?.value ?? null;
    } else {
      trend = trendFromCloses(monthly.map((b) => b.close));
      g = priceCagr(monthly.slice(-120));
    }
    if (position.valueEur !== null) growth.push({ ticker: row.ticker, valueEur: position.valueEur, growth: g, basis: row.kind === "stock" ? "ventas" : "precio" });

    const sector = position.security.sector;
    const recommendation = recommend({
      kind: row.kind,
      weight: position.weight,
      // Un ETF con ficha ya está repartido entre sectores; sin sector conocido no se puede medir
      sector: sector && row.kind === "stock" ? { name: sector, weight: sectorWeight.get(sector) ?? 0 } : null,
      valuation: analysis?.valuation?.verdict ?? null,
      outcome: verdict?.outcome ?? null,
      quality: analysis?.quality.score ?? null,
      activeSignals: analysis?.quality.signals.filter((s) => s.active).map((s) => s.label) ?? [],
      debt: analysis?.debt ?? null,
      trend,
      technical: { level: technical.level, sentence: technical.sentence },
    });
    holdings.push({
      position,
      row,
      analysis,
      verdict,
      fund,
      trend,
      technical,
      stats,
      recommendation,
      sectorSource: row.sector ? ((row.sector_source as Holding["sectorSource"]) ?? "user") : sicSector(row) ? "sic" : null,
    });
  }

  return { portfolio, holdings, transactions: txs, scenarios: buildScenarios(growth), today };
}
