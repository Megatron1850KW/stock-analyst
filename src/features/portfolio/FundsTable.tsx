import { FundName } from "./FundName";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { companyKey, holdingLabel } from "@/domain/portfolio/holdings";
import { countryName } from "@/domain/portfolio/sector";
import type { Verdict } from "@/domain/scoring/valuation-score";
import type { RiskLevel } from "@/domain/technical/risk";
import { FUND_VALUATION_CONFIG } from "@/domain/scoring/config";
import type { FundValuation } from "@/domain/valuation/fund-valuation";
import { VerdictBadge } from "@/features/watchlist/ficha/Indicators";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatPercent, SIN_DATO } from "@/lib/format";
import type { Trend } from "@/domain/portfolio/recommendation";
import type { FundProfile } from "./fund-profile";
import { isCommodity, type Holding } from "./load";
import { ActionBadge } from "./PositionCard";
import { useHoldingTickers } from "./holding-tickers";

/** Un ETF/ETC en la tabla: de tu cartera (con valor y recomendación) o solo de tu watchlist. */
export interface FundLine {
  id: number;
  ticker: string;
  name: string;
  isin: string | null;
  kind: string;
  profile: FundProfile | null;
  trend: Trend | null;
  /** Precio frente a su tendencia de largo plazo. */
  valuation: FundValuation | null;
  /** ETC o fondo de materias primas: sin empresas, sectores ni países. */
  commodity: boolean;
  technicalLevel: RiskLevel | null;
  position: { valueEur: number | null; weight: number | null } | null;
  recommendation: Holding["recommendation"] | null;
}

export const fundLineOf = (h: Holding): FundLine => ({
  id: h.row.id, ticker: h.row.ticker, name: h.row.name, isin: h.row.isin, kind: h.row.kind, profile: h.fund?.profile ?? null,
  trend: h.trend, valuation: h.fundValuation, commodity: isCommodity(h.row.kind, h.row.name, h.fund?.profile.index ?? null),
  technicalLevel: h.technical.level, position: h.position, recommendation: h.recommendation,
});

/** Acción que sigues con su veredicto, para mirar dentro de los fondos. */
export interface FollowedStock {
  ticker: string;
  name: string;
  verdict: Verdict | null;
}

const NoSheet = () => (
  <Tooltip content="Sube su ficha mensual (factsheet) desde Mi Portfolio o desde su página en la watchlist.">
    <span tabIndex={0} className="cursor-help text-[12px] text-muted underline decoration-dotted underline-offset-4">Sin ficha</span>
  </Tooltip>
);

const Commodity = ({ what }: { what: string }) => (
  <Tooltip content={`Un ETC o un fondo de materias primas no invierte en empresas: no tiene ${what}. Sigue el precio de la materia prima.`}>
    <span tabIndex={0} className="cursor-help text-[12px] text-muted underline decoration-dotted underline-offset-4">No aplica</span>
  </Tooltip>
);

const source = (f: FundProfile, field: string) =>
  `Ficha del fondo${f.asOf ? ` a ${formatDate(f.asOf)}` : ""}${f.pages[field] ? `, página ${f.pages[field]}` : ""}.`;

/** Lista corta de pesos con barra: las `n` mayores y el resto en «Otros». */
function Shares({ items, n, label, f, field }: { items: { name: string; full?: string; weight: number }[]; n: number; label: string; f: FundProfile; field: string }) {
  const top = items.slice(0, n);
  const rest = items.slice(n).reduce((t, x) => t + x.weight, 0);
  const max = Math.max(...top.map((x) => x.weight), 0.0001);
  return (
    <Tooltip
      content={
        <div>
          <p className="font-medium">{label}</p>
          <ul className="mt-1 tabular">
            {items.map((x) => (
              <li key={x.full ?? x.name} className="flex justify-between gap-4"><span>{x.full && x.full !== x.name ? `${x.name} · ${x.full}` : x.name}</span><span>{formatPercent(x.weight, 1)}</span></li>
            ))}
          </ul>
          <p className="mt-1 text-muted">{source(f, field)}</p>
        </div>
      }
    >
      <ul tabIndex={0} aria-label={label} className="w-[150px] space-y-[3px] text-[12px] leading-tight">
        {top.map((x) => (
          <li key={x.full ?? x.name} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
            <span className="truncate" title={x.full ?? x.name}>{x.name}</span>
            <span className="text-muted tabular">{formatPercent(x.weight, 1)}</span>
            <span aria-hidden className="col-span-2 h-[3px] rounded-full bg-surface">
              <span className="block h-full rounded-full bg-accent/70" style={{ width: `${(x.weight / max) * 100}%` }} />
            </span>
          </li>
        ))}
        {rest > 0.0005 && <li className="text-[11.5px] text-muted tabular">Resto: {formatPercent(rest, 1)}</li>}
      </ul>
    </Tooltip>
  );
}

function HoldingsCell({ h, tickers }: { h: FundLine; tickers: Map<string, string> }) {
  const f = h.profile;
  if (h.commodity && !f?.holdings.length) return <Commodity what="posiciones en empresas" />;
  if (!f) return <NoSheet />;
  if (!f.holdings.length) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  // El ticker si se conoce («AMD»); si no, el nombre completo
  const items = f.holdings.map((x) => ({ name: tickers.get(x.name) ?? holdingLabel(x.name), full: holdingLabel(x.name), weight: x.weight }));
  const top5 = f.holdings.slice(0, 5).reduce((t, x) => t + x.weight, 0);
  return (
    <div>
      <Shares items={items} n={5} label={`Mayores posiciones de ${h.ticker}`} f={f} field="holdings" />
      <p className="mt-1 text-[11.5px] text-muted">Las 5 mayores: {formatPercent(top5, 1)} del fondo</p>
    </div>
  );
}

function BreakdownCell({ h, field }: { h: FundLine; field: "countries" | "sectors" }) {
  const f = h.profile;
  const list = f?.[field] ?? [];
  if (h.commodity && !list.length) return <Commodity what={field === "countries" ? "reparto por países" : "reparto por sectores"} />;
  if (!f) return <NoSheet />;
  if (!list.length) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  const items = list.map((x) => ({ name: field === "countries" ? countryName(x.key) : x.key, weight: x.weight }));
  return <Shares items={items} n={4} label={field === "countries" ? `Países de ${h.ticker}` : `Sectores de ${h.ticker}`} f={f} field={field} />;
}

const RANGE = 0.5;
const TONE_BG = { Barata: "bg-positive", Justa: "bg-warning", Cara: "bg-negative" } as const;

/** Lo que dicen tus fichas de las posiciones del fondo que sigues como acción. */
function lookThrough(h: FundLine, stocks: FollowedStock[]) {
  const byKey = new Map(stocks.map((s) => [companyKey(s.name), s]));
  const seen = new Set<string>();
  const out: { ticker: string; verdict: Verdict; weight: number }[] = [];
  for (const x of h.profile?.holdings.slice(0, 10) ?? []) {
    const s = byKey.get(companyKey(x.name));
    if (s?.verdict && !seen.has(s.ticker)) {
      seen.add(s.ticker);
      out.push({ ticker: s.ticker, verdict: s.verdict, weight: x.weight });
    } else if (s?.verdict) out.find((o) => o.ticker === s.ticker)!.weight += x.weight;
  }
  return out;
}

/** «¿Cara o barata?» de un fondo: su precio frente a su tendencia de largo plazo (centro). */
function ValuationCell({ h, stocks }: { h: FundLine; stocks: FollowedStock[] }) {
  const v = h.valuation;
  const inside = lookThrough(h, stocks);
  const insideLine = inside.length > 0 && (
    <Tooltip
      content={
        <div>
          <p>Posiciones del fondo que sigues como acción, con el veredicto de su ficha (sus beneficios frente a su historia):</p>
          <ul className="mt-1 tabular">
            {inside.map((x) => <li key={x.ticker}>{x.ticker} ({formatPercent(x.weight, 1)} del fondo): {x.verdict}</li>)}
          </ul>
        </div>
      }
    >
      <p tabIndex={0} className="mt-1 cursor-help text-[11.5px] text-muted underline decoration-dotted underline-offset-4">
        Dentro: {inside.map((x) => `${x.ticker} ${x.verdict.toLowerCase()}`).join(", ")}
      </p>
    </Tooltip>
  );
  if (!v || v.deviation === null || !v.verdict) {
    return (
      <div className="w-[136px]">
        <Tooltip content={v?.sentence ?? "Sin precios guardados. Pulsa «Actualizar precios»."}>
          <span tabIndex={0} className="cursor-help text-[12px] text-muted underline decoration-dotted underline-offset-4">{SIN_DATO}</span>
        </Tooltip>
        {insideLine}
      </div>
    );
  }
  const pos = (Math.max(-RANGE, Math.min(RANGE, v.deviation)) + RANGE) / (2 * RANGE);
  const band = (FUND_VALUATION_CONFIG.expensiveAbove - FUND_VALUATION_CONFIG.cheapBelow) / (2 * RANGE);
  return (
    <div className="w-[136px]">
      <Tooltip content={<><p>{v.sentence}</p><p className="mt-1 text-muted">Cálculo propio con sus cierres mensuales. Un fondo no tiene beneficios propios con historia: se compara su precio con su tendencia de largo plazo.</p></>}>
        <div tabIndex={0} className="cursor-help">
          <div className="flex items-center justify-between gap-2">
            <VerdictBadge value={v.verdict} />
            <span className="font-mono text-[11px] text-muted tabular">{v.score}/100</span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-surface" aria-hidden>
            <div className="absolute inset-y-0 bg-warning/20" style={{ left: `${(0.5 - band / 2) * 100}%`, width: `${band * 100}%` }} />
            <div className="absolute inset-y-[-3px] left-1/2 w-px bg-muted/50" />
            <div className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-raised", TONE_BG[v.verdict])} style={{ left: `${pos * 100}%` }} />
          </div>
          <p className="mt-1 text-[11.5px] text-muted">{signedPercent(v.deviation)} vs. su tendencia de {Math.floor(v.months / 12)} años</p>
        </div>
      </Tooltip>
      {insideLine}
    </div>
  );
}

/** ETFs y ETCs frente a frente (§5.5): qué llevan dentro, si están caros, tendencia y peso. Sin estados financieros. */
export function FundsTable({ holdings, stocks = [] }: { holdings: FundLine[]; stocks?: FollowedStock[] }) {
  const tickers = useHoldingTickers(holdings).data ?? new Map<string, string>();
  const head = "px-3 py-2 text-left text-[11.5px] font-medium text-muted";
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <table className="w-full min-w-[1100px] border-collapse text-[13px]">
        <caption className="sr-only">ETFs y ETCs que sigues</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${head} pl-5`}>Fondo</th>
            <th scope="col" className={head}>Qué sigue · coste</th>
            <th scope="col" className={head}>5 mayores posiciones</th>
            <th scope="col" className={head}>Países</th>
            <th scope="col" className={head}>Sectores</th>
            <th scope="col" className={head}>¿Cara o barata?</th>
            <th scope="col" className={head}>Tendencia de fondo</th>
            <th scope="col" className={head}>En tu cartera</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const f = h.profile;
            const up = h.trend ? h.trend.price >= h.trend.average : null;
            return (
              <tr key={h.id} className="border-b border-border align-top last:border-0">
                <th scope="row" className="py-3 pr-3 pl-5 text-left font-normal">
                  <FundName name={h.name} ticker={h.ticker} isin={h.isin} kind={h.kind} className="max-w-[170px]" />
                </th>
                <td className="max-w-[150px] px-3 py-3">
                  <p className="line-clamp-2 text-[12.5px]" title={f?.index ?? undefined}>{f?.index ?? <span className="text-muted">{SIN_DATO}</span>}</p>
                  <p className="mt-0.5 text-[12px] text-muted tabular">{f?.ter != null ? `${formatPercent(f.ter, 2)} al año` : "Coste: sin dato"}</p>
                </td>
                <td className="px-3 py-3"><HoldingsCell h={h} tickers={tickers} /></td>
                <td className="px-3 py-3"><BreakdownCell h={h} field="countries" /></td>
                <td className="px-3 py-3"><BreakdownCell h={h} field="sectors" /></td>
                <td className="px-3 py-3"><ValuationCell h={h} stocks={stocks} /></td>
                <td className="px-3 py-3">
                  {up === null ? (
                    <span className="text-muted">{SIN_DATO}</span>
                  ) : (
                    <Badge tone={up ? "positive" : "negative"} className="text-[12px]">
                      {up ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />} {up ? "Alcista" : "Bajista"}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-3">
                  <p className="text-[12.5px] tabular">
                    {!h.position ? (
                      <span className="text-muted">En tu watchlist</span>
                    ) : h.position.valueEur !== null ? (
                      formatCurrency(h.position.valueEur, "EUR", 0)
                    ) : (
                      <span className="text-muted">{SIN_DATO}</span>
                    )}
                    {h.position?.weight != null && <span className="text-muted"> · {formatPercent(h.position.weight, 1)}</span>}
                  </p>
                  {h.recommendation && (
                    <Tooltip content={<ul className="list-disc pl-4">{h.recommendation.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}>
                      <span tabIndex={0} className="mt-1.5 inline-block"><ActionBadge action={h.recommendation.action} /></span>
                    </Tooltip>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
