import { AlertTriangle, ArrowDownRight, ArrowLeft, ArrowUpRight, CandlestickChart, FileUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { countryName } from "@/domain/portfolio/sector";
import { FundSheetDialog } from "@/features/portfolio/FundSheetDialog";
import { RiskBadge } from "@/features/technical-risk/RiskBadge";
import { ActionBadge, WeightBar } from "@/features/portfolio/PositionCard";
import { Range52, YearToDate } from "@/features/prices/PriceStatsCells";
import { formatCurrency, formatDate, formatPercent, SIN_DATO } from "@/lib/format";
import type { WatchlistFund } from "./load-funds";
import { EXCHANGE_NAMES } from "./import-eu";
import { justEtfUrl } from "./import-fund";
import { useRemoveSecurity, useWatchlistFunds } from "./queries";

/** Precio de hoy frente a su media del último año, su rango y lo que va de año. */
function PriceSection({ f }: { f: WatchlistFund }) {
  const r = f.stats.range52;
  const above = r ? r.vsAverage >= 0 : false;
  return (
    <section aria-label="Precio del último año" className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <h2 className="font-serif text-[19px] font-semibold tracking-tight">Precio del último año</h2>
      {!f.price && <p className="mt-2 text-[13.5px] text-muted">Todavía no tiene precio. Pulsa «Actualizar precios» (⌘R).</p>}
      {f.price && !r && (
        <p className="mt-2 text-[13.5px] text-muted">Hoy cotiza a {formatCurrency(f.price.close, f.currency)}. Hacen falta al menos 40 semanas de precios para compararlo con su último año.</p>
      )}
      {f.price && r && (
        <>
          <p className="mt-2 flex items-start gap-2 text-[13.5px] leading-relaxed">
            {above ? <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden /> : <ArrowDownRight className="mt-0.5 size-4 shrink-0 text-positive-text" aria-hidden />}
            <span>
              Hoy cotiza a <strong className="tabular">{formatCurrency(f.price.close, f.currency)}</strong>,{" "}
              {Math.abs(r.vsAverage) < 0.005 ? (
                <>igual que su precio medio del último año</>
              ) : (
                <>
                  un <strong className="tabular">{formatPercent(Math.abs(r.vsAverage), 1)}</strong> {above ? "por encima" : "por debajo"} de su precio medio del último año
                </>
              )}{" "}
              (<span className="tabular">{formatCurrency(r.average, f.currency)}</span>).
            </span>
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <div>
              <dt className="text-muted">Rango de 52 semanas</dt>
              <dd className="mt-1"><Range52 stats={f.stats} currency={f.currency} /></dd>
              <dd className="mt-0.5 text-[11.5px] text-muted tabular">{formatCurrency(r.low, f.currency)} – {formatCurrency(r.high, f.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted">En lo que va de año</dt>
              <dd className="mt-1"><YearToDate stats={f.stats} currency={f.currency} /></dd>
            </div>
          </dl>
          <p className="mt-3 text-[11.5px] text-muted">Media de los cierres semanales de las últimas 52 semanas, guardados en tu Mac. Precio del {formatDate(f.price.date)}.</p>
        </>
      )}
    </section>
  );
}

/** Peso en tu cartera, cuánto puedes añadir sin pasar del máximo y la recomendación. */
function PortfolioSection({ f }: { f: WatchlistFund }) {
  const fit = f.fit;
  const label = f.kind === "etc" ? "ETC" : "ETF";
  return (
    <section aria-label="En tu cartera" className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-[19px] font-semibold tracking-tight">En tu cartera</h2>
        {fit && <ActionBadge action={fit.recommendation.action} label={!f.held && fit.recommendation.action === "Comprar más" ? "Comprar" : undefined} />}
      </div>
      {!fit && (
        <p className="mt-2 text-[13.5px] text-muted">
          Cuando registres tus operaciones en <Link to="/portfolio" className="underline underline-offset-2">Mi Portfolio</Link>, aquí verás cuánto pesa este {label}, cuánto puedes añadir sin desequilibrar tu cartera y si conviene comprar más.
        </p>
      )}
      {fit && (
        <>
          <div className="mt-3">
            {f.held ? <WeightBar weight={fit.weight} /> : <p className="text-[13px] text-muted">Aún no lo tienes en cartera.</p>}
          </div>
          {fit.roomEur > 0 && (
            <p className="mt-3 text-[13.5px] leading-relaxed">
              Puedes {f.held ? "añadir" : "comprar"} hasta <strong className="tabular">{formatCurrency(fit.roomEur, "EUR", 0)}</strong> sin que pase del {formatPercent(fit.maxPosition, 0)} de tu cartera ({formatCurrency(fit.totalEur, "EUR", 0)}).
            </p>
          )}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-muted">
            {fit.recommendation.reasons.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}

/** Ficha de un ETF/ETC de la watchlist (§5.5): sin estados financieros, solo su ficha, su coste y su tendencia. */
export function FundDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, isLoading } = useWatchlistFunds(id);
  const remove = useRemoveSecurity();
  const [sheet, setSheet] = useState(false);
  const f = data?.[0];

  if (isLoading) return <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface" />;
  if (!f) {
    return (
      <p className="text-muted">
        No encuentro este fondo. <Link to="/watchlist" className="underline">Volver a la watchlist</Link>
      </p>
    );
  }
  const p = f.profile;
  const label = f.kind === "etc" ? "ETC" : "ETF";
  const facts: [string, string | null][] = [
    ["Coste anual (TER)", p?.ter != null ? formatPercent(p.ter, 2) : null],
    [f.kind === "etc" ? "Materia prima" : "Índice que sigue", p?.index ?? null],
    ["Réplica", p?.replication ?? null],
    ["Domicilio", p?.domicile ? countryName(p.domicile) : null],
  ];

  return (
    <div className="mx-auto max-w-[960px] pb-10">
      <Link to="/watchlist" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden /> Watchlist
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-6 pb-6">
        <div>
          <h1 className="font-serif text-[32px] leading-tight font-semibold tracking-tight">
            {f.name} <span className="text-muted">· {f.ticker}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge>{label}</Badge>
            {f.isin && <span className="tabular" data-selectable>{f.isin}</span>}
            {f.exchange && <span>· {EXCHANGE_NAMES[f.exchange] ?? f.exchange}</span>}
            {f.price && <span>· {formatCurrency(f.price.close, f.currency)} ({formatDate(f.price.date)})</span>}
            {f.held && <Badge tone="positive">En tu cartera</Badge>}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (window.confirm(`¿Quitar ${f.ticker} de la watchlist?`)) remove.mutate(f.id, { onSuccess: () => navigate("/watchlist") });
          }}
        >
          <Trash2 aria-hidden /> Quitar
        </Button>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <section aria-label="Ficha del fondo" className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
          <h2 className="font-serif text-[19px] font-semibold tracking-tight">Su ficha</h2>
          {!p && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[13px] text-warning-text">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Me falta su ficha mensual o su KID (en PDF). Descárgala de{" "}
                {f.isin ? <ExternalLink href={justEtfUrl(f.isin)} className="font-medium underline underline-offset-2">su página de justETF</ExternalLink> : "justETF"}{" "}
                (apartado «Documentos») o de la web de la gestora, y súbela: la IA copiará su coste, qué sigue y en qué invierte.
              </span>
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v ?? <span className="font-normal text-muted">{SIN_DATO}</span>}</dd>
              </div>
            ))}
          </dl>
          <Button className="mt-4" variant={p ? "secondary" : "primary"} onClick={() => setSheet(true)}>
            <FileUp aria-hidden /> {p ? "Ver o corregir la ficha" : "Subir la ficha (PDF)"}
          </Button>
        </section>

        <section aria-label="Tendencia de largo plazo" className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-[19px] font-semibold tracking-tight">Tendencia de largo plazo</h2>
            <RiskBadge level={f.technical.level} />
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed">{f.technical.sentence}</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link to="/riesgo-tecnico"><CandlestickChart aria-hidden /> Ver sus velas</Link>
          </Button>
        </section>

        <PriceSection f={f} />
        <PortfolioSection f={f} />
      </div>

      <p className="mt-5 text-[12px] text-muted">
        Los {label} no tienen informes de empresa: no hay análisis de estados financieros. La recomendación solo mira el equilibrio de tu cartera y la tendencia de fondo del precio. {DISCLAIMER}
      </p>
      <FundSheetDialog h={sheet ? { row: { id: f.id, ticker: f.ticker, name: f.name, kind: f.kind, isin: f.isin }, fund: f.fund } : null} onClose={() => setSheet(false)} />
    </div>
  );
}
