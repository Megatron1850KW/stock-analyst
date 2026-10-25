import { CandlestickChart } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { EmptyState } from "@/app/EmptyState";
import { PageHeader } from "@/app/PageHeader";
import { SECTIONS } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { providerLabel } from "@/data/prices/provider";
import { TECHNICAL_CONFIG } from "@/domain/scoring/config";
import { formatDate, formatMonthYear, formatNumber, formatPercent, SIN_DATO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CandleChart } from "./CandleChart";
import type { RiskRow } from "./load";
import { useCandles, useTechnicalRisk } from "./queries";
import { RiskBadge } from "./RiskBadge";

const section = SECTIONS[2]!;
const KIND = { stock: "Acción", etf: "ETF", etc: "ETC" } as const;

function Detail({ row }: { row: RiskRow }) {
  const [interval, setIv] = useState<"1mo" | "1w">("1mo");
  const candles = useCandles(row.id, interval);
  const r = row.risk;
  const cur = row.currency === "GBp" ? "GBp" : row.currency;
  const money = (v: number) => `${formatNumber(v, v >= 1000 ? 0 : 2)} ${cur}`;
  const facts: [string, string, string][] = [
    ["Media de 10 meses", r.ma !== null ? money(r.ma) : SIN_DATO, r.maSlope !== null ? `${r.maSlope >= 0 ? "sube" : "baja"} un ${formatPercent(Math.abs(r.maSlope), 1)} en 3 meses` : ""],
    ["Caída desde máximos", r.drawdown !== null ? formatPercent(r.drawdown, 0) : SIN_DATO, r.peak ? `máximo ${money(r.peak.price)} (${formatMonthYear(r.peak.date)})` : ""],
    ["Mayor caída de la historia", r.maxDrawdown ? formatPercent(r.maxDrawdown.value, 0) : SIN_DATO, r.maxDrawdown ? `de ${formatMonthYear(r.maxDrawdown.peakDate)} a ${formatMonthYear(r.maxDrawdown.troughDate)}` : ""],
    ["Cuánto se mueve en un año", r.volatility !== null ? `±${formatPercent(r.volatility, 0)}` : SIN_DATO, "volatilidad anual (desviación típica)"],
    ["Su peor año", r.worstYear ? formatPercent(r.worstYear.value, 0) : SIN_DATO, r.worstYear ? `12 meses hasta ${formatMonthYear(r.worstYear.endDate)}` : ""],
    ["Soporte más cercano", r.support ? money(r.support.price) : "Ninguno por debajo", r.support ? `${formatPercent(1 - r.support.price / r.price!, 0)} por debajo · ${r.support.touches > 1 ? `${r.support.touches} giros` : "1 giro"}, el último en ${formatMonthYear(r.support.date)}` : ""],
    ["Resistencia más cercana", r.resistance ? money(r.resistance.price) : "En máximos", r.resistance ? `${formatPercent(r.resistance.price / r.price! - 1, 0)} por encima · ${r.resistance.touches > 1 ? `${r.resistance.touches} giros` : "1 giro"}, el último en ${formatMonthYear(r.resistance.date)}` : ""],
  ];
  return (
    <section aria-label={`Riesgo técnico de ${row.ticker}`} className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-[22px] leading-none font-semibold tracking-tight">{row.kind === "stock" ? row.ticker : row.name}</h2>
            <RiskBadge level={r.level} />
            {r.trend && <Badge>Tendencia {r.trend.toLowerCase()}</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] text-muted tabular">{row.kind === "stock" ? row.name : row.isin && row.isin !== row.ticker ? `${row.ticker} : ${row.isin}` : row.ticker}</p>
        </div>
        <div role="tablist" aria-label="Velas" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {([["1mo", "Mensuales · 10 años"], ["1w", "Semanales · 5 años"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={interval === id} onClick={() => setIv(id)} className={cn("h-7 rounded-md px-3 text-[12.5px]", interval === id ? "bg-surface-raised font-medium shadow-card" : "text-muted hover:text-text")}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <p className="mt-3 text-[14px] leading-relaxed">{r.sentence}</p>
      <div className="mt-4">
        {candles.data && candles.data.length > 0 ? (
          <CandleChart bars={candles.data} interval={interval} currency={row.currency} support={r.support} resistance={r.resistance} />
        ) : (
          <div className="flex h-[340px] items-center justify-center rounded-lg bg-surface text-[13px] text-muted">{candles.isLoading ? "Cargando velas…" : "Sin histórico de precios guardado."}</div>
        )}
      </div>
      {r.level && (
        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1.2fr]">
          <div>
            <h3 className="mb-2 text-[13px] font-medium">Por qué este semáforo</h3>
            <ul className="space-y-2 text-[12.5px]">
              {r.parts.map((p) => (
                <li key={p.id} className="flex gap-2">
                  <span className={cn("mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular", p.points === 0 ? "bg-positive/12 text-positive-text" : p.points === 1 ? "bg-warning/15 text-warning-text" : "bg-negative/12 text-negative-text")}>
                    +{p.points}
                  </span>
                  <span><b className="font-medium">{p.label}.</b> {p.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-muted">
              {r.points} puntos: de 0 a {TECHNICAL_CONFIG.mediumFrom - 1} riesgo bajo, de {TECHNICAL_CONFIG.mediumFrom} a {TECHNICAL_CONFIG.highFrom - 1} medio, {TECHNICAL_CONFIG.highFrom} o más alto.
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-2">
            {facts.map(([label, value, hint]) => (
              <div key={label}>
                <dt className="text-muted">{label}</dt>
                <dd><span className="font-medium tabular">{value}</span>{hint && <span className="block text-[11.5px] text-muted">{hint}</span>}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-muted">
        Precios de {row.source ? providerLabel(row.source) : SIN_DATO}{row.lastDate && <> hasta el {formatDate(row.lastDate)}</>}, ajustados por splits. Solo largo plazo: sin gráficos intradía ni previsiones a una semana.
      </p>
    </section>
  );
}

export function TechnicalRiskPage() {
  const { data: rows, isLoading, isError } = useTechnicalRisk();
  const [selected, setSelected] = useState<number | null>(null);
  const current = rows?.find((r) => r.id === selected) ?? rows?.find((r) => r.risk.level) ?? rows?.[0] ?? null;
  const count = (lvl: string) => rows?.filter((r) => r.risk.level === lvl).length ?? 0;

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={section.title} subtitle={section.subtitle} />
      {isLoading && <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface" />}
      {isError && <EmptyState icon={CandlestickChart} title="Solo en la app de escritorio" description="Los precios se guardan en la base de datos de tu Mac. En esta vista previa del navegador no hay base de datos." />}
      {rows && rows.length === 0 && (
        <EmptyState
          icon={CandlestickChart}
          title="Aún no hay valores que revisar"
          description="Cuando tengas valores en la watchlist o en la cartera, aquí verás sus velas mensuales de 10 años y un semáforo de riesgo (bajo, medio o alto) explicado en una frase. Nada de gráficos intradía."
        >
          <Button asChild><Link to="/watchlist">Ir a la watchlist</Link></Button>
        </EmptyState>
      )}
      {rows && rows.length > 0 && current && (
        <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
          <div>
            <p className="mb-2 text-[12.5px] text-muted">
              {count("Alto")} alto · {count("Medio")} medio · {count("Bajo")} bajo{rows.some((r) => !r.risk.level) && ` · ${rows.filter((r) => !r.risk.level).length} sin datos`}
            </p>
            <ul aria-label="Tus valores por riesgo técnico" className="space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    aria-current={r.id === current.id}
                    className={cn(
                      "w-full rounded-xl border bg-surface-raised px-4 py-3 text-left transition-colors duration-150",
                      r.id === current.id ? "border-accent/60 shadow-card" : "border-border hover:border-accent/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("font-serif font-semibold tracking-tight", r.kind === "stock" ? "text-[16px]" : "truncate text-[14px]")} title={r.name}>{r.kind === "stock" ? r.ticker : r.name}</span>
                      <RiskBadge level={r.risk.level} />
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                      <span className="truncate">{r.kind === "stock" ? r.name : r.isin && r.isin !== r.ticker ? `${r.ticker} : ${r.isin}` : r.ticker}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{KIND[r.kind]}{r.inPortfolio ? " en cartera" : ""}</span>
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug">{r.risk.sentence}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <Detail key={current.id} row={current} />
        </div>
      )}
      {rows && rows.length > 0 && <p className="mt-5 text-[11.5px] text-muted">Riesgo técnico: cómo se ha comportado el precio en los últimos años, no si la empresa es buena o está barata. {DISCLAIMER}</p>}
    </div>
  );
}
