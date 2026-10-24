import { AlertTriangle, CircleAlert, CircleCheck, CircleMinus, Plus, RefreshCw, Sparkles, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import type { Outcome } from "@/domain/scoring/peer-verdict";
import { median } from "@/domain/valuation/multiples";
import { BudgetExceededError } from "@/features/ai/budget";
import { describeApiError } from "@/features/ai/equity-analysis";
import { VerdictBadge } from "@/features/watchlist/ficha/Indicators";
import { qualityTone, qualityWord } from "@/features/watchlist/ficha/Quality";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatNumber, formatPercent, SIN_DATO } from "@/lib/format";
import type { PeerCompareRow, PeerGroup } from "./load";
import { useAddPeer, useFindingPeers, useFindPeers, usePeerGroup, useRemovePeer } from "./queries";

export const OUTCOME_STYLE: Record<Outcome, { tone: "positive" | "negative" | "warning"; Icon: typeof CircleCheck }> = {
  Oportunidad: { tone: "positive", Icon: CircleCheck },
  "Trampa de valor": { tone: "negative", Icon: AlertTriangle },
  Justa: { tone: "warning", Icon: CircleMinus },
  Cara: { tone: "negative", Icon: CircleAlert },
};

export function OutcomeBadge({ outcome, className }: { outcome: Outcome; className?: string }) {
  const { tone, Icon } = OUTCOME_STYLE[outcome];
  return (
    <Badge tone={tone} className={cn("text-[12px]", className)}>
      <Icon aria-hidden /> {outcome}
    </Badge>
  );
}

/* ---------- Gráfico: dónde queda la empresa entre sus competidores ---------- */

interface StripSpec {
  title: string;
  /** Frase que explica en qué dirección es mejor. */
  hint: string;
  value: (r: PeerCompareRow) => number | null;
  format: (v: number) => string;
  better: "low" | "high";
}

const STRIPS: StripSpec[] = [
  { title: "¿Cuántos años de beneficios pagas?", hint: "Menos es más barata", value: (r) => (r.pe !== null && r.pe > 0 ? r.pe : null), format: (v) => `${formatNumber(v, 1)} años`, better: "low" },
  { title: "Caja libre por cada 100 que pagas", hint: "Más es mejor", value: (r) => r.fcfYield, format: (v) => formatNumber(v * 100, 1), better: "high" },
  { title: "¿Cuánto crecen sus ventas?", hint: "Más es mejor", value: (r) => r.growth, format: (v) => signedPercent(v), better: "high" },
  { title: "Nota de calidad", hint: "Más es mejor (0–100)", value: (r) => r.quality, format: (v) => `${Math.round(v)}/100`, better: "high" },
];

function PeerStrip({ spec, rows }: { spec: StripSpec; rows: PeerCompareRow[] }) {
  const points = rows.map((r) => ({ r, v: spec.value(r) })).filter((p): p is { r: PeerCompareRow; v: number } => p.v !== null && Number.isFinite(p.v));
  const target = points.find((p) => p.r.isTarget);
  const peerMedian = median(points.filter((p) => !p.r.isTarget).map((p) => p.v));
  if (points.length < 2) {
    return (
      <div>
        <p className="text-[13px] font-medium">{spec.title}</p>
        <p className="mt-2 text-[12px] text-muted">{SIN_DATO}: hacen falta al menos dos empresas con este dato.</p>
      </div>
    );
  }
  const values = points.map((p) => p.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const leftLabel = spec.better === "low" ? "Más barata" : "Peor";
  const rightLabel = spec.better === "low" ? "Más cara" : "Mejor";

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">{spec.title}</span>
        {target && <span className="font-mono text-[12px] font-semibold tabular">{spec.format(target.v)}</span>}
      </figcaption>
      <div className="relative mt-6 h-6">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" aria-hidden />
        {peerMedian !== null && (
          <Tooltip content={`Mediana de los competidores: ${spec.format(peerMedian)}`}>
            <div className="absolute top-0 h-6 w-3 -translate-x-1/2 cursor-default" style={{ left: `${x(peerMedian)}%` }}>
              <div className="mx-auto h-full w-0.5 rounded bg-muted/60" />
            </div>
          </Tooltip>
        )}
        {points
          .filter((p) => !p.r.isTarget)
          .map((p) => (
            <Tooltip key={p.r.id} content={`${p.r.ticker} · ${p.r.name}: ${spec.format(p.v)}`}>
              <button
                type="button"
                aria-label={`${p.r.ticker}: ${spec.format(p.v)}`}
                className="absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
                style={{ left: `${x(p.v)}%` }}
              >
                <span className="size-2.5 rounded-full bg-muted/70 ring-2 ring-surface-raised" />
              </button>
            </Tooltip>
          ))}
        {target && (
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(target.v)}%` }}>
            <span className="absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 text-[10.5px] font-semibold whitespace-nowrap text-accent-text">
              {target.r.ticker}
            </span>
            <span className="block size-3.5 rounded-full bg-accent ring-2 ring-surface-raised" aria-hidden />
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted" aria-hidden>
        <span>← {leftLabel}</span>
        <span>{spec.hint}</span>
        <span>{rightLabel} →</span>
      </div>
    </figure>
  );
}

/* ---------- Tabla ---------- */

const QUALITY_TEXT = { positive: "text-positive-text", warning: "text-warning-text", negative: "text-negative-text", neutral: "text-muted" } as const;

const multiple = (v: number | null) => (v === null ? SIN_DATO : v > 0 ? formatNumber(v, 1) : "Negativo");

function DebtText({ r }: { r: PeerCompareRow }) {
  if (!r.debt.level) return <span className="text-muted">{SIN_DATO}</span>;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <VerdictBadge value={r.debt.level} />
      <span className="text-[11px] text-muted">{r.debt.netCash ? "Más caja que deuda" : r.debt.years !== null ? `${formatNumber(r.debt.years, 1)} años de caja` : ""}</span>
    </span>
  );
}

function PeerTable({ group, onRemove, removing }: { group: PeerGroup; onRemove: (id: number) => void; removing: boolean }) {
  const peers = group.rows.filter((r) => !r.isTarget);
  const med = (f: (r: PeerCompareRow) => number | null) => median(peers.map(f).filter((v): v is number => v !== null && Number.isFinite(v)));
  const cells = (r: PeerCompareRow) => [
    r.pe === null && r.lossMaking ? "Pérdidas" : multiple(r.pe),
    multiple(r.evEbit),
    r.fcfYield === null ? SIN_DATO : formatPercent(r.fcfYield, 1),
    r.growth === null ? SIN_DATO : signedPercent(r.growth),
    r.operatingMargin === null ? SIN_DATO : formatPercent(Math.abs(r.operatingMargin) < 0.005 ? 0 : r.operatingMargin, 0),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <caption className="sr-only">Comparativa con competidores</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] text-muted">
            <th className="py-2 pr-3 font-medium">Empresa</th>
            <th className="px-3 py-2 text-right font-medium" title="Precio ÷ beneficio (PER)">Años de beneficios</th>
            <th className="px-3 py-2 text-right font-medium" title="Valor de empresa ÷ beneficio operativo (EV/EBIT)">EV/EBIT</th>
            <th className="px-3 py-2 text-right font-medium" title="Caja libre ÷ capitalización">Caja libre / precio</th>
            <th className="px-3 py-2 text-right font-medium">Ventas</th>
            <th className="px-3 py-2 text-right font-medium">Margen op.</th>
            <th className="px-3 py-2 font-medium">Deuda</th>
            <th className="px-3 py-2 font-medium">Calidad</th>
            <th className="px-3 py-2 font-medium">Vs. su historia</th>
            <th className="py-2 pl-3" />
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => (
            <tr key={r.id} className={cn("border-b border-border/60 align-top", r.isTarget && "bg-accent/6")}>
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2">
                  {r.isTarget ? (
                    <span className="font-semibold">{r.ticker}</span>
                  ) : r.inWatchlist ? (
                    <Link to={`/watchlist/${r.id}`} className="font-semibold underline-offset-2 hover:underline">
                      {r.ticker}
                    </Link>
                  ) : (
                    <span className="font-semibold">{r.ticker}</span>
                  )}
                  {r.isTarget && <Badge tone="accent">Esta empresa</Badge>}
                </div>
                <p className="max-w-[220px] truncate text-[11.5px] text-muted" title={r.name}>
                  {r.name}
                </p>
                {r.reason && <p className="max-w-[220px] text-[11.5px] leading-snug text-muted">{r.reason}</p>}
                {r.missing && <p className="text-[11.5px] text-warning-text">{r.missing}</p>}
              </td>
              {cells(r).map((c, i) => (
                <td key={i} className={cn("px-3 py-2.5 text-right font-mono text-[12.5px] whitespace-nowrap tabular", (c === SIN_DATO || c === "Pérdidas") && "font-sans text-[12px] text-muted")}>
                  {c}
                </td>
              ))}
              <td className="px-3 py-2.5">
                <DebtText r={r} />
              </td>
              <td className="px-3 py-2.5">
                {r.quality === null ? (
                  <span className="text-[12px] whitespace-nowrap text-muted">{SIN_DATO}</span>
                ) : (
                  <span className={cn("font-mono text-[12.5px] tabular", QUALITY_TEXT[qualityTone(r.quality)])}>{Math.round(r.quality)}</span>
                )}
                <span className="block text-[11px] text-muted">{r.quality === null ? "" : qualityWord(r.quality)}</span>
              </td>
              <td className="px-3 py-2.5">{r.historyVerdict ? <VerdictBadge value={r.historyVerdict} /> : <span className="text-[12px] text-muted">{SIN_DATO}</span>}</td>
              <td className="py-2.5 pl-3 text-right">
                {!r.isTarget && (
                  <Button size="sm" variant="ghost" aria-label={`Quitar ${r.ticker} de los competidores`} disabled={removing} onClick={() => onRemove(r.id)}>
                    <X aria-hidden />
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {peers.length >= 2 && (
            <tr className="text-[12px] text-muted">
              <td className="py-2.5 pr-3 font-medium">Mediana competidores</td>
              {[med((r) => (r.pe !== null && r.pe > 0 ? r.pe : null)), med((r) => (r.evEbit !== null && r.evEbit > 0 ? r.evEbit : null))].map((v, i) => (
                <td key={i} className={cn("px-3 py-2.5 text-right whitespace-nowrap", v !== null && "font-mono tabular")}>{v === null ? SIN_DATO : formatNumber(v, 1)}</td>
              ))}
              {[med((r) => r.fcfYield), med((r) => r.growth), med((r) => r.operatingMargin)].map((v, i) => (
                <td key={i} className={cn("px-3 py-2.5 text-right whitespace-nowrap", v !== null && "font-mono tabular")}>
                  {v === null ? SIN_DATO : i === 1 ? signedPercent(v) : formatPercent(v, i === 0 ? 1 : 0)}
                </td>
              ))}
              <td />
              <td className="px-3 py-2.5 whitespace-nowrap">{(() => { const q = med((r) => r.quality); return q === null ? SIN_DATO : <span className="font-mono tabular">{Math.round(q)}</span>; })()}</td>
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Sección ---------- */

function headline(group: PeerGroup): string | null {
  const c = group.comparison;
  if (!c || c.deviation === null) return null;
  const n = c.peersWithData;
  const pct = formatPercent(Math.abs(c.deviation), 0);
  if (Math.abs(c.deviation) < 0.02) return `Frente a sus ${n} competidores con datos, se paga más o menos lo mismo por cada euro de beneficio y de caja.`;
  return `Frente a sus ${n} competidores con datos, hoy pagas un ${pct} ${c.deviation < 0 ? "menos" : "más"} por cada euro de beneficio y de caja (mediana de sus múltiplos).`;
}

function AddPeerForm({ securityId }: { securityId: number }) {
  const add = useAddPeer(securityId);
  const [ticker, setTicker] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) add.mutate(ticker, { onSuccess: () => setTicker("") });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`peer-${securityId}`} className="text-[12.5px] text-muted">
        Añadir competidor
      </label>
      <Input id={`peer-${securityId}`} value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker (INTC) o ISIN europeo" className="w-[220px]" />
      <Button size="sm" variant="secondary" type="submit" disabled={add.isPending || !ticker.trim()}>
        <Plus aria-hidden /> {add.isPending ? "Descargando sus datos…" : "Añadir"}
      </Button>
      {add.error && <p role="alert" className="w-full text-[12.5px] text-negative-text">{add.error instanceof Error ? add.error.message : String(add.error)}</p>}
    </form>
  );
}

export function PeerSection({ securityId }: { securityId: number }) {
  const { data: group, isLoading } = usePeerGroup(securityId);
  const find = useFindPeers(securityId);
  const finding = useFindingPeers(securityId);
  const remove = useRemovePeer(securityId);
  const budget = find.error instanceof BudgetExceededError ? find.error : null;

  if (isLoading || !group) return <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface" />;
  const hasPeers = group.peers.length > 0;
  const proposal = group.proposal;
  const line = headline(group);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-6 shadow-card">
      {/* Veredicto */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[72ch]">
          <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">¿Oportunidad o trampa?</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {group.verdict.outcome ? <OutcomeBadge outcome={group.verdict.outcome} className="text-[13px]" /> : <Badge>{SIN_DATO}</Badge>}
            {group.comparison?.verdict && (
              <span className="text-[12.5px] text-muted">
                Frente a la competencia: <VerdictBadge value={group.comparison.verdict} />
              </span>
            )}
          </div>
          <p className="mt-2 text-[14px] leading-relaxed">{group.verdict.reason}</p>
          {group.verdict.caution && (
            <p className="mt-2 flex gap-2 rounded-lg bg-warning/8 px-3 py-2 text-[13px] leading-relaxed">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden /> {group.verdict.caution}
            </p>
          )}
          {line && <p className="mt-1 text-[13px] text-muted">{line}</p>}
          {group.comparison?.note && hasPeers && <p className="mt-1 text-[12.5px] text-warning-text">{group.comparison.note}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {(proposal || hasPeers) && (
            <Button size="sm" variant="ghost" onClick={() => find.mutate({ force: true })} disabled={finding}>
              <RefreshCw className={finding ? "animate-spin" : ""} aria-hidden /> Proponer de nuevo con IA
            </Button>
          )}
        </div>
      </div>

      {finding && (
        <div role="status" className="mt-5 space-y-2">
          <p className="text-[13px] text-muted">Buscando competidores y descargando sus informes oficiales…</p>
          <div className="h-3 w-3/4 animate-pulse rounded bg-surface" />
        </div>
      )}
      {budget && (
        <div role="alert" className="mt-4 rounded-xl border border-warning/40 bg-warning/6 px-4 py-3 text-[13px]">
          <p>
            Este mes llevas {formatCurrency(budget.spentEur)} de tu presupuesto de {formatCurrency(budget.budgetEur)}. Buscar competidores costaría unos{" "}
            {formatCurrency(budget.estimateEur, "EUR", 3)}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => find.mutate({ force: hasPeers, allowOverBudget: true })}>Buscar igualmente</Button>
            <Button size="sm" variant="ghost" onClick={() => find.reset()}>Cancelar</Button>
          </div>
        </div>
      )}
      {find.error && !budget && <p role="alert" className="mt-4 text-[13px] text-negative-text">{describeApiError(find.error)}</p>}
      {find.data && find.data.failed.length > 0 && (
        <p role="status" className="mt-3 text-[12.5px] text-warning-text">
          No se pudieron cargar: {find.data.failed.map((f) => `${f.ticker} (${f.message})`).join("; ")}.
        </p>
      )}

      {!hasPeers && !finding && (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-5 py-5">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Users className="size-4 text-muted" aria-hidden /> Aún no tiene competidores con los que compararla
          </p>
          <p className="max-w-[70ch] text-[13px] text-muted">
            La IA propone una sola vez los 3–4 más parecidos (con el modelo barato, cuesta menos de un céntimo); la app comprueba que existen y descarga sus cifras oficiales. Luego puedes quitar o añadir los que quieras.
          </p>
          <Button onClick={() => find.mutate({})}>
            <Sparkles aria-hidden /> Buscar competidores con IA
          </Button>
          <AddPeerForm securityId={securityId} />
        </div>
      )}

      {hasPeers && (
        <>
          <div className="mt-7 grid gap-x-10 gap-y-7 md:grid-cols-2" aria-label="Posición frente a los competidores">
            {STRIPS.map((s) => (
              <PeerStrip key={s.title} spec={s} rows={group.rows} />
            ))}
          </div>
          <p className="mt-3 flex items-center gap-3 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full bg-accent" aria-hidden /> Esta empresa</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-muted/70" aria-hidden /> Competidores</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-muted/60" aria-hidden /> Mediana de los competidores</span>
          </p>
          <div className="mt-6">
            <PeerTable group={group} onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />
          </div>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-border pt-4">
            <AddPeerForm securityId={securityId} />
            <p className="max-w-[52ch] text-[11.5px] text-muted">
              {proposal
                ? `Lista propuesta por la IA el ${formatDate(proposal.createdAt)}${proposal.costEur !== null ? ` (coste ${formatCurrency(proposal.costEur, "EUR", proposal.costEur < 0.01 ? 4 : 2)})` : ""} y comprobada en los registros oficiales (SEC o ESEF). `
                : ""}
              Las cifras de la tabla son cálculos propios con los informes oficiales de cada empresa. Los competidores no entran en tu watchlist; su precio se actualiza como mucho una vez por semana.
              {proposal?.stored?.rejected.length ? ` Descartados: ${proposal.stored.rejected.map((r) => `${r.ticker} (${r.why.charAt(0).toLowerCase()}${r.why.slice(1).replace(/\.$/, "")})`).join(", ")}.` : ""}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
