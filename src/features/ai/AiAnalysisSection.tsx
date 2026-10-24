import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, CircleMinus, FileText, History, RefreshCw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { DISCLAIMER } from "@/app/Disclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AI_MODELS } from "@/features/settings/schema";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SECTION_LABELS } from "@/domain/reports/sections";
import { BudgetExceededError, describeApiError, type AnalysisDocument, type StoredAnalysis } from "./equity-analysis";
import { useAiAnalysis, useAnalysisRunning, useRunAnalysis } from "./queries";
import { approxSnapshot, sinceAnalysis, snapshotOf } from "./since";
import type { Analysis } from "@/features/watchlist/analysis";
import { isKnownCitation, type Cita, type EquityAnalysis } from "./schema";

const POSTURA = {
  Interesante: { tone: "positive", Icon: CircleCheck },
  Neutral: { tone: "warning", Icon: CircleMinus },
  Precaución: { tone: "negative", Icon: CircleAlert },
} as const;
const GRAVEDAD = { alta: "negative", media: "warning", baja: "neutral" } as const;

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const modelLabel = (id: string) => AI_MODELS.find((m) => m.id === id)?.label ?? id;

/** «10-K 2025» / «10-Q jun 2026» para nombrar un informe. */
function docLabel(d: AnalysisDocument | undefined, id: string): string {
  if (!d) return id;
  return d.form.startsWith("10-Q") || d.form.startsWith("6-K") ? `${d.form} ${formatDate(d.periodEnd).replace(/^\d+ /, "")}` : `${d.form} ${d.periodEnd.slice(0, 4)}`;
}

/** Etiqueta visual obligatoria para todo lo que redacta la IA (CLAUDE.md §2.3). */
export function AiLabel({ className }: { className?: string }) {
  return (
    <Badge tone="accent" className={cn("text-[11.5px]", className)}>
      <Sparkles aria-hidden /> Análisis IA
    </Badge>
  );
}

function Citation({ cita, docs }: { cita: Cita; docs: AnalysisDocument[] }) {
  const known = isKnownCitation(cita, docs.map((d) => d.id));
  const doc = docs.find((d) => d.id === cita.documento);
  const label = cita.documento === "resumen" ? "Cifras calculadas" : docLabel(doc, cita.documento);
  return (
    <Tooltip
      content={
        <div className="space-y-1">
          {known ? (
            <p>
              <span className="text-muted">Fuente: </span>
              {cita.documento === "resumen" ? "cifras calculadas por la app" : `${doc?.form} · nº ${cita.documento}`}
              {cita.seccion && ` · ${cita.seccion}`}
            </p>
          ) : (
            <p className="text-warning-text">La IA citó un documento que no se le dio ({cita.documento}). Compruébalo antes de fiarte.</p>
          )}
          {cita.texto && <p className="italic">«{cita.texto}»</p>}
        </div>
      }
    >
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[11px] text-muted hover:bg-surface hover:text-text",
          !known && "text-warning-text",
        )}
      >
        <FileText className="size-3" aria-hidden />
        {known ? label : "Cita sin verificar"}
      </button>
    </Tooltip>
  );
}

function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </div>
  );
}

function AnalysisBody({ a, docs }: { a: EquityAnalysis; docs: AnalysisDocument[] }) {
  const { tone, Icon } = POSTURA[a.veredicto.postura];
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Block title="Veredicto">
          <Badge tone={tone} className="mb-2 text-[12px]">
            <Icon aria-hidden /> {a.veredicto.postura}
          </Badge>
          <p className="text-[14px] leading-relaxed">{a.veredicto.resumen}</p>
        </Block>
        <Block title="Modelo de negocio">
          <p className="text-[13.5px] leading-relaxed">{a.modelo_negocio}</p>
        </Block>
        <Block title="Lo que espera la empresa">
          <p className="text-[13.5px] leading-relaxed">{a.outlook.resumen}</p>
          {a.outlook.guidance.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {a.outlook.guidance.map((g, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-muted">·</span>
                  <span>
                    {g.texto} <Citation cita={g.cita} docs={docs} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
      <div className="space-y-6">
        <Block title="Puntos clave">
          <ul className="space-y-2 text-[13.5px]">
            {a.puntos_clave.map((p, i) => (
              <li key={i} className="flex gap-2 rounded-lg bg-surface px-3 py-2">
                <span className="font-mono text-[11px] text-muted tabular">{i + 1}</span>
                {p}
              </li>
            ))}
          </ul>
        </Block>
        {a.datos_no_encontrados.length > 0 && (
          <Block title="Lo que no ha encontrado">
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-muted">
              {a.datos_no_encontrados.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </Block>
        )}
      </div>
      <Block title="Catalizadores">
        <ul className="space-y-2.5">
          {a.catalizadores.map((c, i) => (
            <li key={i} className="border-l-2 border-positive/50 pl-3 text-[13px]">
              <p className="font-medium">{c.titulo}</p>
              <p className="text-muted">
                {c.detalle} <Citation cita={c.cita} docs={docs} />
              </p>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Riesgos">
        <ul className="space-y-2.5">
          {a.riesgos.map((r, i) => (
            <li key={i} className="border-l-2 border-negative/50 pl-3 text-[13px]">
              <p className="flex items-start justify-between gap-2 font-medium">
                {r.titulo}{" "}
                <Badge tone={GRAVEDAD[r.gravedad]} className="mt-0.5 shrink-0 whitespace-nowrap">
                  Gravedad {r.gravedad}
                </Badge>
              </p>
              <p className="text-muted">
                {r.detalle} <Citation cita={r.cita} docs={docs} />
              </p>
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function SourcesNote({ stored }: { stored: StoredAnalysis }) {
  return (
    <ul className="space-y-0.5 text-[11.5px] text-muted">
      {stored.documents.map((d) => (
        <li key={d.id}>
          {docLabel(d, d.id)} (nº {d.id}):{" "}
          {d.error
            ? `no se pudo leer (${d.error})`
            : d.sections.map((s) => `${lowerFirst(SECTION_LABELS[s.section])}${s.truncated ? " (recortado)" : ""}`).join(", ")}
        </li>
      ))}
    </ul>
  );
}

/** Informe más reciente guardado, para avisar si la IA aún no lo ha leído. */
export interface NewestReport {
  id: string;
  form: string;
  periodEnd: string;
}

/**
 * Precio y valoración de hoy frente a los del día del análisis. Es un cálculo
 * propio: la IA no se vuelve a llamar por mucho que cambie el precio.
 */
function SinceStrip({ stored, createdAt, current, newest }: { stored: StoredAnalysis; createdAt: string; current: Analysis; newest?: NewestReport | null }) {
  const now = snapshotOf(current);
  const then = stored.snapshot ?? (now.price ? approxSnapshot(current.monthly, createdAt, now.price.currency) : null);
  const unread = newest && !stored.documents.some((d) => d.id === newest.id) ? newest : null;
  if (!then && !unread) return null;
  const s = then ? sinceAnalysis(then, now) : null;
  const up = (s?.priceChange ?? 0) >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const money = (p: { value: number; currency: string }) => formatCurrency(p.value, p.currency);

  return (
    <div role="note" aria-label="Cambios desde el análisis" className="mt-5 rounded-xl border border-border bg-surface px-4 py-3 text-[13px]">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
        <History className="size-3.5" aria-hidden /> Desde este análisis ({formatDate(createdAt)})
      </p>
      <ul className="mt-1.5 space-y-1">
        {s && s.priceChange !== null && s.then.price && s.now.price && (
          <li className="flex items-start gap-1.5">
            <Arrow className={cn("mt-0.5 size-3.5 shrink-0", s.bigMove ? "text-warning-text" : "text-muted")} aria-hidden />
            {Math.abs(s.priceChange) < 0.0005 ? (
              <span>El precio no ha cambiado (<span className="tabular">{money(s.now.price)}</span>).</span>
            ) : <span>
              El precio ha {up ? "subido" : "bajado"} un <strong className="tabular">{formatPercent(Math.abs(s.priceChange))}</strong> (de{" "}
              <span className="tabular">{money(s.then.price)}</span>
              {s.then.approx ? ", cierre de ese mes," : ""} a <span className="tabular">{money(s.now.price)}</span> el {formatDate(s.now.price.date)}).
            </span>}
          </li>
        )}
        {s && s.now.verdict && (
          <li className="pl-5">
            {s.verdictChanged
              ? <>Frente a su historia ha pasado de <strong>{s.then.verdict}</strong> a <strong>{s.now.verdict}</strong>.</>
              : s.then.verdict
                ? <>Frente a su historia sigue <strong>{s.now.verdict}</strong>.</>
                : <>Hoy está <strong>{s.now.verdict}</strong> frente a su historia.</>}
          </li>
        )}
        {unread && (
          <li className="flex items-start gap-1.5 text-warning-text">
            <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Hay un informe más reciente ({docLabel({ id: unread.id, form: unread.form, periodEnd: unread.periodEnd, filedAt: null, url: null, sections: [] }, unread.id)}) que la IA aún no ha leído.
          </li>
        )}
      </ul>
      <p className="mt-2 text-[12px] text-muted">
        {s?.suggestRefresh || unread
          ? "El texto de abajo se escribió con los datos de entonces. Si quieres actualizarlo, pulsa «Re-analizar»; la app no lo hace sola."
          : "Las cifras y los indicadores de arriba ya están al día. El cambio es pequeño, así que no hace falta pagar un análisis nuevo."}
      </p>
    </div>
  );
}

export function AiAnalysisSection({ securityId, current, newest }: { securityId: number; current?: Analysis | null; newest?: NewestReport | null }) {
  const { data, isLoading } = useAiAnalysis(securityId);
  const run = useRunAnalysis(securityId);
  const running = useAnalysisRunning(securityId);
  const budget = run.error instanceof BudgetExceededError ? run.error : null;
  const stored = data?.stored ?? null;

  const action = (
    <Button
      variant={stored ? "secondary" : "primary"}
      onClick={() => run.mutate({ force: !!stored })}
      disabled={running}
    >
      {stored ? <RefreshCw className={running ? "animate-spin" : ""} aria-hidden /> : <Sparkles aria-hidden />}
      {stored ? "Re-analizar" : "Analizar con IA"}
    </Button>
  );

  return (
    <section aria-labelledby="analisis-ia" className="rounded-[var(--radius-card)] border border-accent/25 bg-surface-raised p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="analisis-ia" className="font-serif text-[21px] font-semibold tracking-tight">
              Qué opina el analista
            </h2>
            <AiLabel />
          </div>
          <p className="mt-1 max-w-[70ch] text-[12.5px] text-muted">
            {data?.row
              ? `Redactado por ${modelLabel(stored?.servedModel ?? data.row.model)} el ${formatDate(data.row.created_at)} a partir de los informes oficiales y de las cifras calculadas arriba. Coste: ${formatCurrency(data.row.cost_eur ?? 0, "EUR", (data.row.cost_eur ?? 0) < 0.01 ? 3 : 2)}${stored?.costApprox ? " (aprox.)" : ""}.`
              : "La IA lee el último informe anual y el último trimestral y redacta el negocio, lo que espera la empresa, catalizadores, riesgos y un veredicto. Solo se ejecuta cuando tú lo pides o sale un informe nuevo."}
          </p>
        </div>
        {action}
      </div>

      {running && (
        <div role="status" className="mt-5 space-y-2">
          <p className="text-[13px] text-muted">Leyendo los informes y redactando el análisis. Puede tardar un par de minutos…</p>
          {[80, 95, 60].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded bg-surface" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}

      {budget && (
        <div role="alert" className="mt-5 rounded-xl border border-warning/40 bg-warning/6 px-4 py-3 text-[13px]">
          <p>
            Este mes llevas {formatCurrency(budget.spentEur)} de tu presupuesto de {formatCurrency(budget.budgetEur)}. Este análisis costaría unos{" "}
            {formatCurrency(budget.estimateEur, "EUR", 2)}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => run.mutate({ force: !!stored, allowOverBudget: true })}>
              Analizar igualmente
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run.reset()}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {run.error && !budget && (
        <p role="alert" className="mt-4 text-[13px] text-negative-text">
          {describeApiError(run.error)}
        </p>
      )}

      {isLoading && <div className="mt-5 h-24 animate-pulse rounded-xl bg-surface" />}
      {data && !stored && !running && (
        <p className="mt-5 text-[13px] text-negative-text">El análisis guardado no se puede leer. Pulsa «Re-analizar».</p>
      )}
      {stored && !running && data && current && <SinceStrip stored={stored} createdAt={data.row.created_at} current={current} newest={newest} />}
      {stored && !running && (
        <div className="mt-6">
          <AnalysisBody a={stored.analysis} docs={stored.documents} />
          <div className="mt-6 border-t border-border pt-3">
            <SourcesNote stored={stored} />
            <p className="mt-2 text-[11.5px] text-muted">
              Texto generado por IA a partir de los informes: puede contener errores. Las cifras de esta ficha son cálculos propios, no de la IA. {DISCLAIMER}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
