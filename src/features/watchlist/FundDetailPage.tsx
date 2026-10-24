import { AlertTriangle, ArrowLeft, CandlestickChart, FileUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { countryName } from "@/domain/portfolio/sector";
import { FundSheetDialog } from "@/features/portfolio/FundSheetDialog";
import { RiskBadge } from "@/features/technical-risk/RiskBadge";
import { formatCurrency, formatDate, formatPercent, SIN_DATO } from "@/lib/format";
import { EXCHANGE_NAMES } from "./import-eu";
import { justEtfUrl } from "./import-fund";
import { useRemoveSecurity, useWatchlistFunds } from "./queries";

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
      </div>

      <p className="mt-5 text-[12px] text-muted">
        Los {label} no tienen informes de empresa: no hay análisis de estados financieros. La recomendación de comprar más o mantener solo se da para lo que tienes en cartera. {DISCLAIMER}
      </p>
      <FundSheetDialog h={sheet ? { row: { id: f.id, ticker: f.ticker, name: f.name, kind: f.kind, isin: f.isin }, fund: f.fund } : null} onClose={() => setSheet(false)} />
    </div>
  );
}
