import type { Db } from "@/db/client";
import { getPeerProposal, listPeers, type PeerRow, type PeerSource } from "@/db/peers-repo";
import type { DebtLevel } from "@/domain/scoring/debt-level";
import { marginsAtPeak } from "@/domain/scoring/quality-score";
import { comparePeers, opportunityVerdict, type Comparable, type OpportunityVerdict, type PeerComparison } from "@/domain/scoring/peer-verdict";
import type { Verdict } from "@/domain/scoring/valuation-score";
import type { Analysis } from "@/features/watchlist/analysis";
import { loadSecurityDetail } from "@/features/watchlist/load";
import { parseStoredPeers, type StoredPeerProposal } from "./propose";

/** Una fila de la tabla de competidores (la propia empresa va primero). */
export interface PeerCompareRow {
  id: number;
  ticker: string;
  name: string;
  isTarget: boolean;
  source: PeerSource | null;
  reason: string | null;
  inWatchlist: boolean;
  /** Beneficio de los últimos 12 meses negativo: el PER no tiene sentido. */
  lossMaking?: boolean;
  /** Sin informes o sin análisis guardado: la fila sale vacía con el motivo. */
  missing?: string;
  price: { value: number; currency: string; date: string } | null;
  pe: number | null;
  pfcf: number | null;
  evEbit: number | null;
  fcfYield: number | null;
  growth: number | null;
  operatingMargin: number | null;
  debt: { level: DebtLevel | null; netCash: boolean; years: number | null };
  quality: number | null;
  historyVerdict: Verdict | null;
}

export interface PeerGroup {
  peers: PeerRow[];
  proposal: { stored: StoredPeerProposal | null; createdAt: string; costEur: number | null } | null;
  rows: PeerCompareRow[];
  comparison: PeerComparison | null;
  verdict: OpportunityVerdict;
}

export function compareRow(a: Analysis | null, base: Pick<PeerCompareRow, "id" | "ticker" | "name" | "isTarget" | "source" | "reason" | "inWatchlist">): PeerCompareRow {
  if (!a) {
    return { ...base, missing: "Sin datos guardados", price: null, pe: null, pfcf: null, evEbit: null, fcfYield: null, growth: null, operatingMargin: null, debt: { level: null, netCash: false, years: null }, quality: null, historyVerdict: null };
  }
  const m = a.multiples;
  const netDebt = a.current.netDebt.value;
  return {
    ...base,
    price: a.price ? { value: a.price.value, currency: a.price.currency, date: a.price.date } : null,
    pe: m?.pe.value ?? null,
    pfcf: m?.pfcf.value ?? null,
    evEbit: m?.evEbit.value ?? null,
    fcfYield: m?.fcfYield.value ?? null,
    growth: a.growth.revenue.value,
    operatingMargin: a.current.operatingMargin.value,
    debt: { level: a.debt, netCash: netDebt !== null && netDebt <= 0, years: netDebt !== null && netDebt > 0 ? a.current.debtYears.value : null },
    quality: a.quality.score,
    historyVerdict: a.valuation?.verdict ?? null,
    lossMaking: (a.current.netIncome?.value ?? 1) <= 0,
    missing: a.price ? undefined : "Sin precio",
  };
}

const comparable = (r: PeerCompareRow): Comparable => ({ ticker: r.ticker, multiples: { pe: r.pe, pfcf: r.pfcf, evEbit: r.evEbit }, quality: r.quality });

export async function loadPeerGroup(db: Db, securityId: number, target?: Analysis | null): Promise<PeerGroup> {
  const [peers, proposalRow, own] = await Promise.all([
    listPeers(db, securityId),
    getPeerProposal(db, securityId),
    target === undefined ? loadSecurityDetail(db, securityId) : Promise.resolve(null),
  ]);
  const analysis = target === undefined ? (own?.analysis ?? null) : target;
  const [security] = await db.select<{ ticker: string; name: string; in_watchlist: number }>("SELECT ticker, name, in_watchlist FROM securities WHERE id = ?", [securityId]);

  const targetRow = compareRow(analysis, {
    id: securityId,
    ticker: security?.ticker ?? "",
    name: security?.name ?? "",
    isTarget: true,
    source: null,
    reason: null,
    inWatchlist: !!security?.in_watchlist,
  });
  const peerRows = await Promise.all(
    peers.map(async (p) =>
      compareRow((await loadSecurityDetail(db, p.peer_id)).analysis, {
        id: p.peer_id,
        ticker: p.ticker,
        name: p.name,
        isTarget: false,
        source: p.source,
        reason: p.reason,
        inWatchlist: !!p.in_watchlist,
      }),
    ),
  );

  const comparison = peerRows.length ? comparePeers(comparable(targetRow), peerRows.map(comparable)) : null;
  const active = analysis?.quality.signals.filter((s) => s.active).map((s) => s.label) ?? [];
  return {
    peers,
    proposal: proposalRow ? { stored: parseStoredPeers(proposalRow.result_json), createdAt: proposalRow.created_at, costEur: proposalRow.cost_eur } : null,
    rows: [targetRow, ...peerRows],
    comparison,
    verdict: opportunityVerdict({
      history: analysis?.valuation?.verdict ?? null,
      peers: comparison,
      activeSignals: active,
      peakMargins: analysis ? marginsAtPeak(analysis.current, analysis.years) : false,
    }),
  };
}
