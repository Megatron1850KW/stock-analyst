import { ArrowLeft, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceValue } from "@/components/ui/source-value";
import { Tooltip } from "@/components/ui/tooltip";
import type { FactRow, FilingRow } from "@/db/repo";
import { CONCEPTS, type ConceptDef } from "@/domain/fundamentals/concepts";
import { ownPeriodFact } from "@/domain/fundamentals/period-value";
import { formatDate, formatMillions, formatMonthYear, formatNumber, SIN_DATO } from "@/lib/format";
import { describeError, useAddTicker, useRemoveSecurity, useSecurityDetail } from "./queries";

const GROUPS: { title: string; from: string }[] = [
  { title: "Cuenta de resultados", from: "revenue" },
  { title: "Flujo de caja", from: "operating_cash_flow" },
  { title: "Balance", from: "cash" },
  { title: "Acciones", from: "shares_outstanding" },
];

function formatFact(def: ConceptDef, f: FactRow): string {
  if (def.kind === "money") return formatMillions(f.value, f.unit);
  if (def.kind === "perShare") return `${formatNumber(f.value, 2)} ${f.unit.split("/")[0] === "USD" ? "$" : f.unit.split("/")[0]}`;
  return `${formatNumber(f.value / 1e6, 0)} M`;
}

function periodText(f: FactRow): string {
  return f.period_start ? `${formatDate(f.period_start)} – ${formatDate(f.period_end)}` : `A ${formatDate(f.period_end)}`;
}

function FactsTable({ filings, facts }: { filings: FilingRow[]; facts: FactRow[] }) {
  const annual = filings.filter((f) => f.period_type === "annual");
  const cols = [...annual, ...filings.filter((f) => f.period_type === "interim")];
  // Línea que separa anuales de trimestrales
  const divider = (k: number) => (k > 0 && k === annual.length ? "border-l border-border" : "");
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead className="bg-surface text-[12px] text-muted">
          <tr>
            <th className="sticky left-0 bg-surface px-5 py-2.5 text-left font-medium">Concepto</th>
            {cols.map((f, k) => (
              <th
                key={f.id}
                className={`px-3 py-2.5 text-right font-medium whitespace-nowrap ${divider(k)}`}
              >
                <Tooltip
                  content={
                    <span>
                      {f.form_type} · cierre {formatDate(f.period_end)}
                      <br />
                      Presentado {f.filed_at ? formatDate(f.filed_at) : SIN_DATO}
                      <br />
                      <span className="font-mono text-[11px]">{f.accession_no}</span>
                    </span>
                  }
                >
                  <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent-text">
                    <span className="text-text">{f.form_type}</span> {formatMonthYear(f.period_end)}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        {GROUPS.map((g, gi) => {
          const start = CONCEPTS.findIndex((c) => c.id === g.from);
          const end = gi + 1 < GROUPS.length ? CONCEPTS.findIndex((c) => c.id === GROUPS[gi + 1]!.from) : CONCEPTS.length;
          return (
            <tbody key={g.title}>
              <tr>
                <th colSpan={cols.length + 1} className="border-t border-border bg-bg px-5 pt-4 pb-1.5 text-left font-serif text-[14px] font-semibold">
                  {g.title}
                </th>
              </tr>
              {CONCEPTS.slice(start, end).map((def) => (
                <tr key={def.id} className="border-t border-border/60">
                  <td className="sticky left-0 bg-surface-raised px-5 py-2 whitespace-nowrap">{def.label}</td>
                  {cols.map((filing, k) => {
                    const own = ownPeriodFact(facts, filing, def.id);
                    return (
                      <td key={filing.id} className={`px-3 py-2 text-right tabular whitespace-nowrap ${divider(k)}`}>
                        {own ? (
                          <SourceValue
                            info={{
                              source: "SEC EDGAR (XBRL)",
                              document: `${filing.form_type} · ${filing.accession_no}`,
                              tag: own.fact.source_tag,
                              period: periodText(own.fact) + (own.cumulative ? " (acumulado del año)" : ""),
                              fetchedAt: own.fact.fetched_at,
                            }}
                          >
                            {formatFact(def, own.fact)}
                            {own.cumulative && <sup className="ml-0.5 text-muted">a</sup>}
                          </SourceValue>
                        ) : (
                          <span className="text-muted/70">{SIN_DATO}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export function SecurityDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, isLoading, error } = useSecurityDetail(id);
  const remove = useRemoveSecurity();
  const reimport = useAddTicker();

  if (isLoading) return <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface" />;
  if (error || !data?.security) {
    return (
      <p className="text-muted">
        No encuentro este valor. <Link to="/watchlist" className="underline">Volver a la watchlist</Link>
      </p>
    );
  }
  const { security: s, filings, facts } = data;

  return (
    <div className="mx-auto max-w-[1080px]">
      <Link to="/watchlist" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden /> Watchlist
      </Link>
      <header className="flex items-end justify-between gap-6 pb-6">
        <div>
          <h1 className="font-serif text-[30px] leading-tight font-semibold tracking-tight">
            {s.name} <span className="text-muted">· {s.ticker}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            {s.exchange && <Badge>{s.exchange}</Badge>}
            {s.sic_description && <Badge>{s.sic_description}</Badge>}
            <Badge>CIK {s.cik}</Badge>
            {s.filer_type === "foreign" && <Badge tone="accent">Emisor extranjero</Badge>}
            {s.reporting_currency && s.reporting_currency !== s.currency && <Badge tone="accent">Cuentas en {s.reporting_currency}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => reimport.mutate(s.ticker)} disabled={reimport.isPending}>
            <RefreshCw className={reimport.isPending ? "animate-spin" : ""} aria-hidden /> Volver a descargar
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm(`¿Quitar ${s.ticker} de la watchlist?`)) remove.mutate(s.id, { onSuccess: () => navigate("/watchlist") });
            }}
          >
            <Trash2 aria-hidden /> Quitar
          </Button>
        </div>
      </header>
      {reimport.error && <p role="alert" className="mb-4 text-[13px] text-negative-text">{describeError(reimport.error)}</p>}

      <p className="mb-4 max-w-[70ch] text-[13px] leading-relaxed text-muted">
        Cifras tal como aparecen en los informes oficiales de la SEC. Pasa el ratón por cualquier número para ver de qué documento sale.
        La ficha con los indicadores visuales llega en la fase 3.
      </p>
      <FactsTable filings={filings} facts={facts} />
      <p className="mt-3 text-[12px] text-muted">
        <sup>a</sup> Acumulado desde el inicio del año fiscal: el informe trimestral no da la cifra del trimestre aislado. Importes en millones.
      </p>
    </div>
  );
}
