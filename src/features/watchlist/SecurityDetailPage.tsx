import { AlertTriangle, ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceValue } from "@/components/ui/source-value";
import { AiAnalysisSection } from "@/features/ai/AiAnalysisSection";
import { analysisFilings } from "@/features/ai/equity-analysis";
import { DocumentsSection } from "@/features/document-requests/DocumentsSection";
import { formatCurrency } from "@/lib/format";
import { PeerSection } from "@/features/peers/PeerSection";
import { ExpertDetail } from "./ficha/ExpertDetail";
import { FinancialDetail } from "./ficha/FinancialDetail";
import { CashIndicator, DebtIndicator, GrowthIndicator, ValuationIndicator, VerdictBadge } from "./ficha/Indicators";
import { QualitySection } from "./ficha/Quality";
import { SecFactsTable } from "./ficha/SecFactsTable";
import { ValuationHistory } from "./ficha/ValuationHistory";
import { EXCHANGE_NAMES } from "./import-eu";
import { describeError, useAddTicker, useRemoveSecurity, useSecurityDetail } from "./queries";

function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section className="mt-10" aria-labelledby={id}>
      <h2 id={id} className="font-serif text-[21px] font-semibold tracking-tight">
        {title}
      </h2>
      {description && <p className="mt-1 mb-4 max-w-[75ch] text-[13px] leading-relaxed text-muted">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </section>
  );
}

export function SecurityDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, isLoading, error } = useSecurityDetail(id);
  const remove = useRemoveSecurity();
  const reimport = useAddTicker();

  if (isLoading) return <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface" />;
  if (error || !data?.security || !data.analysis) {
    return (
      <p className="text-muted">
        No encuentro este valor. <Link to="/watchlist" className="underline">Volver a la watchlist</Link>
      </p>
    );
  }
  const { security: s, filings, facts, analysis: a, requests } = data;
  const core = filings.filter((f) => f.role === "core");
  const pending = requests.filter((r) => r.status === "pending").length;
  const latest = analysisFilings(filings).sort((x, y) => y.period_end.localeCompare(x.period_end))[0];
  const newestReport = latest ? { id: latest.accession_no, form: latest.form_type, periodEnd: latest.period_end } : null;

  return (
    <div className="mx-auto max-w-[1120px] pb-10">
      <Link to="/watchlist" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden /> Watchlist
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-6 pb-2">
        <div>
          <h1 className="font-serif text-[32px] leading-tight font-semibold tracking-tight">
            {s.name} <span className="text-muted">· {s.ticker}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            {s.exchange && <Badge>{s.market === "EU" ? (EXCHANGE_NAMES[s.exchange] ?? s.exchange) : s.exchange}</Badge>}
            {s.sic_description && <Badge>{s.sic_description}</Badge>}
            {s.cik && <Badge>CIK {s.cik}</Badge>}
            {s.isin && <Badge>ISIN {s.isin}</Badge>}
            {s.market === "EU" && <Badge tone="accent">Informes ESEF (NIIF)</Badge>}
            {s.filer_type === "foreign" && <Badge tone="accent">Emisor extranjero</Badge>}
            {s.reporting_currency && s.reporting_currency !== s.currency && <Badge tone="accent">Cuentas en {s.reporting_currency}</Badge>}
            {pending > 0 && (
              <a href="#informes">
                <Badge tone="warning">{pending} documento{pending > 1 ? "s" : ""} pendiente{pending > 1 ? "s" : ""}</Badge>
              </a>
            )}
          </div>
        </div>
        <div className="flex items-end gap-5">
          {a.price && (
            <div className="text-right">
              <SourceValue
                info={{ source: a.price.source, period: `Cierre del ${a.price.date}`, fetchedAt: a.price.fetchedAt }}
                className="font-serif text-[26px] font-semibold tabular"
              >
                {formatCurrency(a.price.value, a.price.currency)}
              </SourceValue>
              <div className="mt-1 flex justify-end">{a.valuation?.verdict && <VerdictBadge value={a.valuation.verdict} />}</div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => reimport.mutate(s.market === "EU" && s.isin ? s.isin : s.ticker)} disabled={reimport.isPending}>
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
        </div>
      </header>
      {reimport.error && <p role="alert" className="mb-4 text-[13px] text-negative-text">{describeError(reimport.error)}</p>}

      {a.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-xl border border-warning/40 bg-warning/6 px-4 py-3 text-[12.5px]" aria-label="Avisos">
          {a.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Resumen en cuatro preguntas">
        <ValuationIndicator a={a} />
        <CashIndicator a={a} />
        <DebtIndicator a={a} />
        <GrowthIndicator a={a} />
      </div>
      <p className="mt-3 text-[11.5px] text-muted">
        Cálculos propios a partir de los informes oficiales; pasa el ratón por una cifra para ver de dónde sale. {DISCLAIMER}
      </p>

      <div className="mt-10">
        <AiAnalysisSection securityId={s.id} current={a} newest={newestReport} />
      </div>

      <Section
        id="competencia"
        title="Frente a la competencia"
        description="Lo que pagas por esta empresa y lo bueno que es su negocio, comparado con sus 3–4 competidores más parecidos. Con eso y su historia se decide si es una oportunidad o una posible trampa de valor."
      >
        <PeerSection securityId={s.id} />
      </Section>

      <Section
        id="calidad"
        title="¿Es un buen negocio?"
        description="Nota de 0 a 100 calculada con sus informes: si crece, si sus márgenes aguantan, si el beneficio se convierte en caja, cuánta deuda tiene y si reparte el beneficio entre más acciones."
      >
        <QualitySection q={a.quality} />
      </Section>

      <Section
        id="valoracion"
        title="Valoración frente a su propia historia"
        description="Lo que pagas hoy por cada euro de beneficio o de caja, comparado con lo que se ha pagado de normal por esta misma empresa en los últimos 5 y 10 años."
      >
        <ValuationHistory a={a} />
      </Section>

      <Section
        id="financieros"
        title="Detalle financiero"
        description="Ejercicios completos y últimos doce meses (último anual más lo que va de año). Cifras en millones."
      >
        <FinancialDetail a={a} />
      </Section>

      <Section id="informes" title="Informes">
        <DocumentsSection
          securityId={s.id}
          name={`${s.name} (${s.ticker}${s.isin ? ` · ${s.isin}` : ""})`}
          filings={filings}
          requests={requests}
          facts={facts}
        />
      </Section>

      <div className="mt-10">
        <ExpertDetail a={a}>
          <div>
            <h3 className="mb-1 text-[13px] font-semibold">Cifras tal como aparecen en los informes {s.market === "EU" ? "ESEF" : "de la SEC"}</h3>
            <p className="mb-3 text-[12px] text-muted">
              <sup>a</sup> Acumulado desde el inicio del año fiscal: el informe trimestral no da la cifra del trimestre aislado. Importes en millones.
            </p>
            <SecFactsTable filings={[...core, ...filings.filter((f) => f.role === "upload" && facts.some((x) => x.filing_id === f.id))]} facts={facts} />
          </div>
        </ExpertDetail>
      </div>
    </div>
  );
}
