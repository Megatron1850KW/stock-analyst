import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, CircleMinus, FileUp, Pencil, Plus } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceValue } from "@/components/ui/source-value";
import { Tooltip } from "@/components/ui/tooltip";
import { providerLabel } from "@/data/prices/provider";
import { countryName } from "@/domain/portfolio/sector";
import type { Action } from "@/domain/portfolio/recommendation";
import { PORTFOLIO_CONFIG } from "@/domain/scoring/config";
import { OutcomeBadge } from "@/features/peers/PeerSection";
import { VerdictBadge } from "@/features/watchlist/ficha/Indicators";
import { qualityTone, qualityWord } from "@/features/watchlist/ficha/Quality";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { formatCurrency, formatNumber, formatPercent, SIN_DATO } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Holding } from "./load";

const KIND_LABEL = { stock: "Acción", etf: "ETF", etc: "ETC" } as const;
const ACTION_STYLE: Record<Action, { tone: "positive" | "neutral" | "warning"; Icon: typeof CircleCheck }> = {
  "Comprar más": { tone: "positive", Icon: CircleCheck },
  Mantener: { tone: "neutral", Icon: CircleMinus },
  "Mantener — vigilar": { tone: "warning", Icon: CircleAlert },
};

export function ActionBadge({ action, className }: { action: Action; className?: string }) {
  const { tone, Icon } = ACTION_STYLE[action];
  return (
    <Badge tone={tone} className={cn("text-[12px]", tone === "neutral" && "bg-sand/50 text-text", className)}>
      <Icon aria-hidden /> {action}
    </Badge>
  );
}

function Money({ value, signed }: { value: number | null; signed?: boolean }) {
  if (value === null) return <span className="text-muted">{SIN_DATO}</span>;
  const txt = formatCurrency(value, "EUR");
  return <span className={cn("tabular", signed && (value >= 0 ? "text-positive-text" : "text-negative-text"))}>{signed && value > 0 ? `+${txt}` : txt}</span>;
}

/** Peso de la posición frente al máximo recomendado (15 %). */
function WeightBar({ weight }: { weight: number | null }) {
  if (weight === null) return <p className="text-[12px] text-muted">Peso: {SIN_DATO}</p>;
  const max = PORTFOLIO_CONFIG.maxPosition;
  const scale = Math.max(max * 2, weight);
  const over = weight > max;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-muted">Peso en tu cartera</span>
        <span className={cn("font-medium tabular", over && "text-warning-text")}>{formatPercent(weight, 1)}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-surface" aria-hidden>
        <div className={cn("h-full rounded-full", over ? "bg-warning" : "bg-[var(--chart-1)]")} style={{ width: `${(weight / scale) * 100}%` }} />
        <div className="absolute -inset-y-1 w-px bg-muted/60" style={{ left: `${(max / scale) * 100}%` }} title={`Máximo recomendado: ${formatPercent(max, 0)}`} />
      </div>
      {over && <p className="mt-1 text-[11.5px] text-warning-text">Por encima del {formatPercent(max, 0)} recomendado</p>}
    </div>
  );
}

function StockFacts({ h }: { h: Holding }) {
  const a = h.analysis;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
      <div>
        <dt className="text-muted">¿Cara o barata?</dt>
        <dd className="mt-0.5">{a?.valuation?.verdict ? <VerdictBadge value={a.valuation.verdict} /> : <span className="text-muted">{SIN_DATO}</span>}</dd>
      </div>
      <div>
        <dt className="text-muted">Salud financiera</dt>
        <dd className={cn("mt-0.5 font-medium", { positive: "text-positive-text", warning: "text-warning-text", negative: "text-negative-text", neutral: "text-muted" }[qualityTone(a?.quality.score ?? null)])}>
          {qualityWord(a?.quality.score ?? null)}
          {a?.quality.score != null && <span className="font-normal text-muted tabular"> · {Math.round(a.quality.score)}/100</span>}
        </dd>
      </div>
      <div>
        <dt className="text-muted">Frente a la competencia</dt>
        <dd className="mt-0.5">{h.verdict?.outcome ? <OutcomeBadge outcome={h.verdict.outcome} /> : <span className="text-muted">{SIN_DATO}</span>}</dd>
      </div>
      <div>
        <dt className="text-muted">Deuda</dt>
        <dd className="mt-0.5">{a?.debt ? <VerdictBadge value={a.debt} /> : <span className="text-muted">{SIN_DATO}</span>}</dd>
      </div>
    </dl>
  );
}

function FundFacts({ h, onSheet }: { h: Holding; onSheet: () => void }) {
  const f = h.fund?.profile;
  const trendUp = h.trend ? h.trend.price >= h.trend.average : null;
  return (
    <div className="text-[12.5px]">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <dt className="text-muted">Tendencia de fondo</dt>
          <dd className="mt-0.5">
            {trendUp === null ? (
              <span className="text-muted">{SIN_DATO}</span>
            ) : (
              <Badge tone={trendUp ? "positive" : "negative"} className="text-[12px]">
                {trendUp ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />} {trendUp ? "Alcista" : "Bajista"}
              </Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Coste anual (TER)</dt>
          <dd className="mt-0.5 font-medium tabular">{f?.ter != null ? formatPercent(f.ter, 2) : <span className="font-normal text-muted">{SIN_DATO}</span>}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">{h.row.kind === "etc" ? "Materia prima" : "Índice"}</dt>
          <dd className="mt-0.5 truncate" title={f?.index ?? undefined}>{f?.index ?? <span className="text-muted">{SIN_DATO}</span>}</dd>
        </div>
      </dl>
      <Button variant="ghost" size="sm" className="mt-2 -ml-2.5" onClick={onSheet}>
        {f ? <Pencil aria-hidden /> : <FileUp aria-hidden />} {f ? "Ver ficha" : "Subir su ficha (PDF)"}
      </Button>
    </div>
  );
}

export function PositionCard({ h, onBuy, onSheet, onClassify }: { h: Holding; onBuy: () => void; onSheet: () => void; onClassify: () => void }) {
  const p = h.position;
  const r = h.recommendation;
  const ret = p.totalReturnPct;
  const sector = p.security.sector ?? (h.fund?.profile.sectors.length ? "Repartido (ver ficha)" : null);
  const country = p.security.country;
  return (
    <article className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card" aria-label={`${h.row.ticker}: ${r.action}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {h.row.kind === "stock" ? (
              <Link to={`/watchlist/${h.row.id}`} className="font-serif text-[20px] leading-none font-semibold tracking-tight hover:underline">{h.row.ticker}</Link>
            ) : (
              <span className="font-serif text-[20px] leading-none font-semibold tracking-tight">{h.row.ticker}</span>
            )}
            <Badge>{KIND_LABEL[h.row.kind]}</Badge>
          </div>
          <p className="mt-1 truncate text-[12px] text-muted" title={h.row.name}>{h.row.name}</p>
        </div>
        <Tooltip
          content={
            <div>
              <p className="font-medium">{r.action}</p>
              <ul className="mt-1 list-disc pl-4">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="mt-1.5 text-muted">Herramienta informativa, no constituye asesoramiento financiero.</p>
            </div>
          }
        >
          <span tabIndex={0}><ActionBadge action={r.action} /></span>
        </Tooltip>
      </header>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11.5px] text-muted">Valor hoy</p>
          <p className="font-serif text-[22px] leading-tight font-semibold tabular">
            {p.valueEur !== null ? formatCurrency(p.valueEur, "EUR") : <span className="text-[15px] font-normal text-muted">{SIN_DATO}</span>}
          </p>
          <p className="text-[11.5px] text-muted tabular">
            {formatNumber(p.shares, p.shares % 1 ? 4 : 0).replace(/(,\d*?)0+$/, "$1").replace(/,$/, "")} × {" "}
            {p.price ? (
              <SourceValue info={{ source: providerLabel(h.row.price_source ?? ""), period: `Cotización del ${p.price.date}`, fetchedAt: h.row.price_fetched_at }}>
                {formatCurrency(p.price.price, p.price.currency === "GBp" ? "GBP" : p.price.currency)}
              </SourceValue>
            ) : "sin precio"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11.5px] text-muted">Ganancia total</p>
          <p className="text-[15px] font-semibold"><Money value={p.totalReturnEur} signed /></p>
          <p className={cn("text-[12px] tabular", ret === null ? "text-muted" : ret >= 0 ? "text-positive-text" : "text-negative-text")}>
            {ret !== null ? signedPercent(ret) : SIN_DATO}
            {p.annualizedPct !== null && <span className="text-muted"> · {signedPercent(p.annualizedPct)}/año</span>}
          </p>
        </div>
      </div>

      <div className="mt-4"><WeightBar weight={p.weight} /></div>
      <div className="mt-4 border-t border-border pt-4">{h.row.kind === "stock" ? <StockFacts h={h} /> : <FundFacts h={h} onSheet={onSheet} />}</div>

      {r.alerts.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-warning/12 px-3 py-2 text-[12px] text-warning-text">
          {r.alerts.map((a) => <li key={a} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{a}</li>)}
        </ul>
      )}
      {p.problems.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[11.5px] text-muted">{p.problems.slice(0, 3).map((x) => <li key={x}>· {x}</li>)}</ul>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 pt-4 text-[11.5px] text-muted">
        <button type="button" onClick={onClassify} className="truncate text-left hover:text-text" title="Cambiar sector o país">
          {sector ?? <span className="text-warning-text">Sector: {SIN_DATO}</span>} · {country ? countryName(country) : <span className="text-warning-text">País: {SIN_DATO}</span>}
        </button>
        <Button variant="secondary" size="sm" onClick={onBuy}><Plus aria-hidden /> Operación</Button>
      </footer>
    </article>
  );
}
