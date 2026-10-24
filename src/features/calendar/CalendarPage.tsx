import { BellRing, CalendarDays, Check, FileText, RefreshCw, Sparkles, X } from "lucide-react";
import { Link } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { EmptyState } from "@/app/EmptyState";
import { PageHeader } from "@/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { Tooltip } from "@/components/ui/tooltip";
import type { CalendarRow, NewReportRow } from "@/db/calendar-repo";
import { useSettings } from "@/features/settings/queries";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useCalendar, useCheckNow, useDismissReport, useProcessReport } from "./queries";

const DAY = 86_400_000;
const FREQ = { daily: "una vez al día", weekly: "una vez a la semana", manual: "solo cuando lo pidas" } as const;

const dayDiff = (iso: string) => Math.round((Date.parse(iso) - Date.parse(new Date().toISOString().slice(0, 10))) / DAY);

function whenText(iso: string): { text: string; tone: "neutral" | "warning" | "positive" } {
  const d = dayDiff(iso);
  if (d === 0) return { text: "Hoy", tone: "positive" };
  if (d === 1) return { text: "Mañana", tone: "positive" };
  if (d > 1) return { text: `En ${d} días`, tone: d <= 7 ? "positive" : "neutral" };
  return { text: `Debía salir hace ${-d} ${d === -1 ? "día" : "días"}`, tone: "warning" };
}

const parsePeriod = (r: CalendarRow): { label: string; basis: string } => {
  try {
    return JSON.parse(r.fiscal_period ?? "") as { label: string; basis: string };
  } catch {
    return { label: r.fiscal_period ?? "Resultados", basis: "" };
  }
};

function NewReportCard({ r }: { r: NewReportRow }) {
  const process = useProcessReport();
  const dismiss = useDismissReport();
  const busy = process.isPending || dismiss.isPending;
  return (
    <li className="rounded-[var(--radius-card)] border border-accent/40 bg-surface-raised p-5 shadow-card" aria-label={`${r.ticker}: ${r.label}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to={`/watchlist/${r.security_id}`} className="font-serif text-[20px] leading-none font-semibold tracking-tight hover:underline">{r.ticker}</Link>
            <Badge tone="positive"><BellRing aria-hidden /> Nuevo</Badge>
          </div>
          <p className="mt-1.5 text-[14px]">Ha salido el <strong>{r.label}</strong>.</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {r.name} · cierre {formatDate(r.period_end)}{r.filed_at ? ` · publicado el ${formatDate(r.filed_at)}` : ""} · {r.source === "sec-edgar" ? "SEC EDGAR" : "filings.xbrl.org"}
            {r.url && (
              <>
                {" · "}
                <ExternalLink href={r.url} className="inline-flex items-center gap-1 text-accent-text hover:underline"><FileText className="size-3" aria-hidden /> Ver el informe</ExternalLink>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => dismiss.mutate(r.id)} disabled={busy}><X aria-hidden /> Descartar</Button>
          <Button size="sm" onClick={() => process.mutate(r.id)} disabled={busy}>
            <Sparkles aria-hidden /> {process.isPending ? "Analizando…" : "Analizar ahora"}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] text-muted">Analizar vuelve a leer sus informes (sin coste) y escribe el análisis con IA, que sí tiene coste y respeta tu presupuesto mensual.</p>
      {process.error && <p role="alert" className="mt-2 text-[12.5px] text-negative-text">{process.error.message}</p>}
    </li>
  );
}

export function CalendarPage() {
  const { data, isError, isLoading } = useCalendar();
  const settings = useSettings().data;
  const check = useCheckNow();
  const fresh = data?.reports.filter((r) => r.status === "new") ?? [];
  const recent = data?.reports.filter((r) => r.status === "analyzed").slice(0, 5) ?? [];

  return (
    <div className="mx-auto max-w-[1080px] px-10 pt-4 pb-12">
      <PageHeader
        title="Calendario de resultados"
        subtitle="Cuándo publicará cada valor sus próximos resultados, y los informes nuevos que ya han salido."
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button variant="secondary" onClick={() => check.mutate()} disabled={check.isPending}>
              <RefreshCw className={cn(check.isPending && "animate-spin")} aria-hidden /> {check.isPending ? "Comprobando…" : "Comprobar ahora"}
            </Button>
            <span className="text-[11.5px] text-muted">
              {data?.lastCheck ? `Última comprobación: ${new Date(data.lastCheck).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}` : "Aún no se ha comprobado"}
            </span>
          </div>
        }
      />

      {check.data && (
        <p role="status" className="mb-6 rounded-lg bg-surface px-4 py-2.5 text-[13px]">
          He comprobado {check.data.checked.length} {check.data.checked.length === 1 ? "valor" : "valores"}:{" "}
          {check.data.found.length === 0 ? "no hay informes nuevos." : `${check.data.found.length} ${check.data.found.length === 1 ? "informe nuevo" : "informes nuevos"}.`}
          {check.data.problems.map((p) => <span key={p} className="mt-1 block text-warning-text">{p}</span>)}
        </p>
      )}
      {check.error && <p role="alert" className="mb-6 rounded-lg bg-negative/10 px-4 py-2.5 text-[13px] text-negative-text">{check.error.message}</p>}

      {isError ? (
        <EmptyState icon={CalendarDays} title="Solo en la app de escritorio" description="El calendario se calcula con los informes guardados en tu Mac." />
      ) : isLoading || !data ? (
        <div className="h-[240px] animate-pulse rounded-[var(--radius-card)] bg-surface" aria-busy />
      ) : (
        <div className="space-y-8">
          {fresh.length > 0 && (
            <section aria-label="Informes nuevos">
              <h2 className="mb-3 font-serif text-[19px] font-semibold">Informes nuevos</h2>
              <ul className="space-y-3">{fresh.map((r) => <NewReportCard key={r.id} r={r} />)}</ul>
            </section>
          )}

          <section aria-label="Próximos resultados">
            <h2 className="mb-3 font-serif text-[19px] font-semibold">Próximos resultados</h2>
            {data.rows.length === 0 ? (
              <EmptyState icon={CalendarDays} title="Sin fechas todavía" description="Añade acciones a tu watchlist o a tu cartera: la fecha de sus próximos resultados se estima con su historial de informes." />
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-surface text-[12px] text-muted">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Fecha</th>
                      <th className="px-3 py-2.5 font-medium">Valor</th>
                      <th className="px-3 py-2.5 font-medium">Informe</th>
                      <th className="px-5 py-2.5 font-medium">Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const p = parsePeriod(r);
                      const when = whenText(r.expected_date);
                      return (
                        <tr key={`${r.security_id}-${r.expected_date}`} className="border-t border-border">
                          <td className="px-5 py-3">
                            <div className="font-medium tabular">{formatDate(r.expected_date)}</div>
                            <div className={cn("text-[12px]", { positive: "text-positive-text", warning: "text-warning-text", neutral: "text-muted" }[when.tone])}>{when.text}</div>
                          </td>
                          <td className="px-3 py-3">
                            <Link to={`/watchlist/${r.security_id}`} className="font-semibold hover:text-accent-text">{r.ticker}</Link>
                            <div className="text-[12px] text-muted">{r.name}</div>
                          </td>
                          <td className="px-3 py-3">{p.label}</td>
                          <td className="px-5 py-3">
                            {r.source === "inferred" ? (
                              <Tooltip content={p.basis || "Fecha estimada con su historial de informes."}>
                                <span tabIndex={0} className="cursor-help"><Badge>Estimada</Badge></span>
                              </Tooltip>
                            ) : (
                              <Badge tone="positive"><Check aria-hidden /> Confirmada</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {recent.length > 0 && (
            <section aria-label="Analizados hace poco">
              <h2 className="mb-2 text-[13px] font-semibold text-muted">Analizados hace poco</h2>
              <ul className="space-y-1 text-[12.5px] text-muted">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Check className="mr-1 inline size-3.5 text-positive" aria-hidden />
                    <Link to={`/watchlist/${r.security_id}`} className="font-medium text-text hover:underline">{r.ticker}</Link> · {r.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[12px] leading-relaxed text-muted">
            La app comprueba {settings ? FREQ[settings.reportCheckFrequency] : "una vez al día"} si han salido informes de los valores con resultados recientes o próximos, en la SEC (EE. UU.) y en filings.xbrl.org (Europa), sin usar la IA.
            {" "}Al cerrar la ventana sigue en la barra de menús para poder avisarte. Si aparece uno nuevo, te avisa con una notificación de macOS
            {settings?.newReportAction === "auto" ? " y lo analiza sola." : " y tú decides si analizarlo."} Las fechas son estimaciones con el historial de cada empresa. {DISCLAIMER}
          </p>
        </div>
      )}
    </div>
  );
}
