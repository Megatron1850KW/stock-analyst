import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleAlert, CircleCheck, CircleMinus, Layers, Plus, Sparkles, WalletCards } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { AnimatedLogo } from "@/app/AnimatedLogo";
import { DISCLAIMER } from "@/app/Disclaimer";
import { EmptyState } from "@/app/EmptyState";
import { SECTIONS } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { listLatestAnalyses } from "@/db/ai-repo";
import { listWatchlist } from "@/db/repo";
import { VALUATION_CONFIG } from "@/domain/scoring/config";
import { parseStored } from "@/features/ai/equity-analysis";
import { loadSecurityDetail } from "@/features/watchlist/load";
import { VerdictBadge, yearsText } from "@/features/watchlist/ficha/Indicators";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { formatCurrency, formatNumber, formatPercent, SIN_DATO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { appDb } from "@/platform/database";
import { comparisonRow, highlights, sortRows, SORT_LABELS, type ComparisonRow, type Highlight, type SortKey } from "./rows";

export const comparisonKey = ["comparison"] as const;

function useComparison() {
  return useQuery({
    queryKey: comparisonKey,
    queryFn: async () => {
      const db = await appDb();
      const [list, analyses] = await Promise.all([listWatchlist(db), listLatestAnalyses(db)]);
      const ai = new Map(analyses.map((r) => [r.security_id, { stored: parseStored(r), createdAt: r.created_at }]));
      const rows = await Promise.all(list.map(async (w) => comparisonRow(await loadSecurityDetail(db, w.id), ai.get(w.id) ?? null)));
      return rows.filter((r): r is ComparisonRow => !!r);
    },
  });
}

const today = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/* ---------- Celdas visuales ---------- */

const RANGE = 0.5;
const TONE_BG = { Barata: "bg-positive", Justa: "bg-warning", Cara: "bg-negative" } as const;

/** Dónde está el precio frente a su media histórica: centro = su media; izquierda = más barata. */
function ValuationCell({ r }: { r: ComparisonRow }) {
  const { deviation, verdict, score } = r.valuation;
  if (deviation === null || !verdict) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  const pos = (Math.max(-RANGE, Math.min(RANGE, deviation)) + RANGE) / (2 * RANGE);
  const band = (VALUATION_CONFIG.expensiveAbove - VALUATION_CONFIG.cheapBelow) / (2 * RANGE);
  return (
    <div className="w-[168px]">
      <div className="flex items-center justify-between gap-2">
        <VerdictBadge value={verdict} />
        <span className="font-mono text-[11px] text-muted tabular">{score !== null ? `${score}/100` : ""}</span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-surface" aria-hidden>
        {/* Zona «Justa» alrededor de su media */}
        <div className="absolute inset-y-0 bg-warning/20" style={{ left: `${(0.5 - band / 2) * 100}%`, width: `${band * 100}%` }} />
        <div className="absolute inset-y-[-3px] left-1/2 w-px bg-muted/50" />
        <div
          className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-raised", TONE_BG[verdict])}
          style={{ left: `${pos * 100}%` }}
        />
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        {signedPercent(deviation)} vs. su media
      </p>
    </div>
  );
}

function CashCell({ r }: { r: ComparisonRow }) {
  if (r.fcfYield === null) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  const v = r.fcfYield;
  const width = Math.max(0, Math.min(1, v / 0.1));
  return (
    <div className="w-[132px]">
      <p className="text-[13px]">
        <span className="font-semibold tabular">{formatNumber(v * 100, 1)} €</span>
        <span className="text-muted"> de cada 100 €</span>
      </p>
      <div className="mt-1.5 h-1.5 rounded-full bg-surface" aria-hidden>
        <div className={cn("h-full rounded-full", v > 0 ? "bg-[var(--chart-1)]" : "bg-negative")} style={{ width: `${v > 0 ? width * 100 : 100}%` }} />
      </div>
    </div>
  );
}

function DebtCell({ r }: { r: ComparisonRow }) {
  if (!r.debt.level) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  return (
    <div>
      <VerdictBadge value={r.debt.level} />
      <p className="mt-1 text-[11.5px] text-muted">
        {r.debt.netCash ? "Más caja que deuda" : r.debt.years !== null ? `${yearsText(r.debt.years)} para pagarla` : "Sin caja libre para pagarla"}
      </p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) => (max === min ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4));
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(" ");
  const last = values.at(-1)!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={y(last)} r={2.5} fill="var(--chart-1)" />
    </svg>
  );
}

function GrowthCell({ r }: { r: ComparisonRow }) {
  const g = r.growth.value;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-[64px]">
        {g === null ? (
          <span className="text-[12px] text-muted">{SIN_DATO}</span>
        ) : (
          <p className={cn("flex items-center gap-0.5 text-[14px] font-semibold tabular", g >= 0 ? "text-positive-text" : "text-negative-text")}>
            {g >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {signedPercent(g)}
          </p>
        )}
        <p className="text-[11px] text-muted">{r.growth.basis === "quarter" ? "último trimestre" : "último año"}</p>
      </div>
      <Sparkline values={r.revenue} />
    </div>
  );
}

const POSTURA = {
  Interesante: { tone: "positive", Icon: CircleCheck },
  Neutral: { tone: "warning", Icon: CircleMinus },
  Precaución: { tone: "negative", Icon: CircleAlert },
} as const;

function AiCell({ r }: { r: ComparisonRow }) {
  if (!r.ai) return <span className="text-[12px] text-muted">Sin analizar</span>;
  const { tone, Icon } = POSTURA[r.ai.postura];
  return (
    <Badge tone={tone} className="text-[12px]" title="Análisis IA">
      <Sparkles aria-hidden />
      <Icon aria-hidden /> {r.ai.postura}
    </Badge>
  );
}

/* ---------- Destacados ---------- */

const HIGHLIGHT_TEXT: Record<Highlight["key"], { title: string; text: (r: ComparisonRow) => string }> = {
  cheapest: {
    title: "La más barata frente a su historia",
    text: (r) => `Cotiza un ${formatPercent(Math.abs(r.valuation.deviation!), 0)} ${r.valuation.deviation! < 0 ? "por debajo" : "por encima"} de lo que suele valer.`,
  },
  cash: { title: "La que más caja genera", text: (r) => `Genera ${formatNumber(r.fcfYield! * 100, 1)} € de caja libre al año por cada 100 € que vale.` },
  debt: {
    title: "La menos endeudada",
    text: (r) => (r.debt.netCash ? "Tiene más caja que deuda." : `Pagaría su deuda en ${yearsText(r.debt.years ?? 0)}.`),
  },
  growth: { title: "La que más crece", text: (r) => `Vende un ${formatPercent(Math.abs(r.growth.value!), 0)} ${r.growth.value! >= 0 ? "más" : "menos"} que hace un año.` },
};

function HighlightCard({ h }: { h: Highlight }) {
  const t = HIGHLIGHT_TEXT[h.key];
  return (
    <Link
      to={`/watchlist/${h.row.id}`}
      className="group rounded-[var(--radius-card)] border border-border bg-surface-raised p-4 shadow-card transition-colors duration-150 hover:border-accent/50"
    >
      <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">{t.title}</p>
      <p className="mt-1.5 font-serif text-[22px] leading-none font-semibold tracking-tight">{h.row.ticker}</p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{t.text(h.row)}</p>
    </Link>
  );
}

/* ---------- Página ---------- */

type Tab = "watchlist" | "portfolio" | "etf";

function Tabs({ tab, onChange, counts }: { tab: Tab; onChange: (t: Tab) => void; counts: { watchlist: number } }) {
  const items: { id: Tab; label: ReactNode }[] = [
    { id: "watchlist", label: <>Acciones <span className="text-muted tabular">{counts.watchlist}</span></> },
    { id: "etf", label: "ETFs y ETCs" },
    { id: "portfolio", label: "Mi cartera" },
  ];
  return (
    <div role="tablist" aria-label="Qué comparar" className="inline-flex rounded-xl border border-border bg-surface p-1">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={tab === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "h-8 rounded-lg px-3.5 text-[13px] transition-colors duration-150",
            tab === it.id ? "bg-surface-raised font-medium text-text shadow-card" : "text-muted hover:text-text",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const navigate = useNavigate();
  const head = "px-3 py-2 text-left text-[11.5px] font-medium text-muted";
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <table className="w-full min-w-[920px] border-collapse">
        <caption className="sr-only">Comparativa de fundamentales de las acciones que sigues</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={cn(head, "pl-5")}>Valor</th>
            <th scope="col" className={head}>¿Cara o barata?</th>
            <th scope="col" className={head}>¿Genera caja?</th>
            <th scope="col" className={head}>¿Tiene mucha deuda?</th>
            <th scope="col" className={head}>¿Crece? (ventas)</th>
            <th scope="col" className={head}>Margen operativo</th>
            <th scope="col" className={head}>Analista</th>
            <th scope="col" className="w-8"><span className="sr-only">Abrir</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => navigate(`/watchlist/${r.id}`)}
              className="cursor-pointer border-b border-border align-middle transition-colors duration-150 last:border-0 hover:bg-surface/60"
            >
              <th scope="row" className="py-3.5 pr-3 pl-5 text-left font-normal">
                <Link to={`/watchlist/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-serif text-[17px] font-semibold tracking-tight hover:underline">
                  {r.ticker}
                </Link>
                <p className="max-w-[200px] truncate text-[12px] text-muted" title={r.name}>{r.name}</p>
                <p className="text-[12px] tabular">{r.price ? formatCurrency(r.price.value, r.price.currency) : <span className="text-muted">Sin precio</span>}</p>
              </th>
              <td className="px-3 py-3"><ValuationCell r={r} /></td>
              <td className="px-3 py-3"><CashCell r={r} /></td>
              <td className="px-3 py-3"><DebtCell r={r} /></td>
              <td className="px-3 py-3"><GrowthCell r={r} /></td>
              <td className="px-3 py-3 text-[13px] tabular">
                {r.operatingMargin === null ? <span className="text-muted">{SIN_DATO}</span> : formatPercent(r.operatingMargin, 0)}
              </td>
              <td className="px-3 py-3"><AiCell r={r} /></td>
              <td className="pr-4"><ChevronRight className="size-4 text-muted" aria-hidden /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Portada: comparativa visual de fundamentales de todo lo que sigues (y, más adelante, de tu cartera). */
export function ComparisonPage() {
  const { data: rows, isLoading } = useComparison();
  const [tab, setTab] = useState<Tab>("watchlist");
  const [sort, setSort] = useState<SortKey>("cheapest");
  const sorted = rows ? sortRows(rows, sort) : [];
  const tops = rows ? highlights(rows) : [];

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2 pb-6">
        <div className="flex items-center gap-4">
          <AnimatedLogo className="size-[64px] drop-shadow-[0_6px_16px_rgba(181,96,63,0.25)]" />
          <div>
            <h1 className="font-serif text-[30px] leading-none font-semibold tracking-tight">Comparativa</h1>
            <p className="mt-1.5 text-[13px] text-muted">
              Tus valores frente a frente, con las mismas cuatro preguntas de cada ficha.{" "}
              <span className="first-letter:uppercase">{today.format(new Date())}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Tabs tab={tab} onChange={setTab} counts={{ watchlist: rows?.length ?? 0 }} />
          <Button asChild variant="secondary">
            <Link to="/watchlist"><Plus aria-hidden /> Añadir ticker</Link>
          </Button>
        </div>
      </header>

      {tab === "watchlist" && (
        <>
          {isLoading && <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface" />}
          {rows && rows.length === 0 && (
            <EmptyState icon={Plus} title="Añade tu primer ticker" description="En cuanto sigas dos o más acciones, aquí las verás comparadas: si están caras o baratas, cuánta caja generan, su deuda y su crecimiento.">
              <Button asChild><Link to="/watchlist">Ir a la watchlist</Link></Button>
            </EmptyState>
          )}
          {rows && rows.length > 0 && (
            <>
              {tops.length > 0 && (
                <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Destacados">
                  {tops.map((h) => <HighlightCard key={h.key} h={h} />)}
                </div>
              )}
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="text-[12.5px] text-muted">
                  Cálculos propios con los informes oficiales; la columna «Analista» es <span className="font-medium text-accent-text">Análisis IA</span>. Pulsa una fila para ver la ficha.
                </p>
                <label className="flex items-center gap-2 text-[12.5px] text-muted">
                  Ordenar por
                  <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 w-auto text-[13px]">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
                  </Select>
                </label>
              </div>
              <ComparisonTable rows={sorted} />
              <p className="mt-3 text-[11.5px] text-muted">
                «¿Cara o barata?»: el punto marca el precio frente a la media de sus múltiplos de 5 y 10 años (centro); la franja ámbar es el rango «Justa» (±15 %). {DISCLAIMER}
              </p>
            </>
          )}
        </>
      )}
      {tab === "etf" && (
        <EmptyState
          icon={Layers}
          title="ETFs y ETCs"
          description="No tienen informes de empresa: se compararán por coste (TER), qué índice o materia prima siguen, diversificación, solapamiento con tu cartera y tendencia de largo plazo."
          upcoming="Llega con la cartera (fase 7)"
        />
      )}
      {tab === "portfolio" && (
        <EmptyState
          icon={WalletCards}
          title="Mi cartera"
          description="Cuando registres tus operaciones verás aquí tus posiciones con esta misma comparativa, más su rentabilidad en euros, su peso y la recomendación de comprar más o mantener."
          upcoming="Llega en la fase 7"
        />
      )}

      <nav aria-label="Secciones" className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.path} to={s.path} className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 transition-colors duration-150 hover:border-accent/50">
              <span className="flex size-9 items-center justify-center rounded-lg bg-sand/60"><Icon className="size-4 text-accent-text" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{s.label}</span>
                <span className="block truncate text-[11.5px] text-muted">{s.phase <= 4 ? s.title : `Llega en la fase ${s.phase}`}</span>
              </span>
              <kbd className="ml-auto font-sans text-[11px] text-muted">⌘{s.shortcut}</kbd>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
