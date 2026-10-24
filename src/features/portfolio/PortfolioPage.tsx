import { AlertTriangle, Plus, Trash2, WalletCards } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DISCLAIMER } from "@/app/Disclaimer";
import { EmptyState } from "@/app/EmptyState";
import { PageHeader } from "@/app/PageHeader";
import { SECTIONS } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { Exposure, Portfolio } from "@/domain/portfolio/positions";
import type { Scenarios } from "@/domain/portfolio/scenarios";
import { countryName } from "@/domain/portfolio/sector";
import { PORTFOLIO_CONFIG, SCENARIO_CONFIG } from "@/domain/scoring/config";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { formatCurrency, formatDate, formatNumber, formatPercent, SIN_DATO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inDesktopApp } from "@/platform/runtime";
import { ClassificationDialog } from "./ClassificationDialog";
import { FundSheetDialog } from "./FundSheetDialog";
import type { Holding, PortfolioView } from "./load";
import { PositionCard } from "./PositionCard";
import { useDeleteTransaction, usePortfolio } from "./queries";
import { TransactionDialog } from "./TransactionDialog";

const section = SECTIONS[1]!;

/* ---------- Resumen ---------- */

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface-raised px-5 py-4 shadow-card">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn("mt-1 font-serif text-[24px] leading-tight font-semibold tabular", tone === "positive" && "text-positive-text", tone === "negative" && "text-negative-text")}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

const signedEur = (v: number) => `${v > 0 ? "+" : ""}${formatCurrency(v, "EUR")}`;

export function PortfolioSummary({ p }: { p: Portfolio }) {
  const invested = p.costEur;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Valor de tu cartera" value={formatCurrency(p.valueEur, "EUR")} sub={p.unvalued > 0 ? (p.unvalued === 1 ? "1 posición sin precio no cuenta" : `${p.unvalued} posiciones sin precio no cuentan`) : `${p.positions.length} posiciones`} />
      <Stat label="Te costó lo que tienes hoy" value={formatCurrency(invested, "EUR")} sub={p.unvalued > 0 ? "Precio medio con comisiones, sin las posiciones sin precio" : "Precio medio de compra, con comisiones"} />
      <Stat
        label="Ganancia total"
        value={signedEur(p.totalReturnEur)}
        tone={p.totalReturnEur >= 0 ? "positive" : "negative"}
        sub={`Latente ${signedEur(p.unrealizedEur)} · ventas ${signedEur(p.realizedEur)} · dividendos ${formatCurrency(p.dividendsEur, "EUR")}`}
      />
      <Stat
        label="Rentabilidad anual equivalente"
        value={p.annualizedPct !== null ? signedPercent(p.annualizedPct) : SIN_DATO}
        tone={p.annualizedPct === null ? undefined : p.annualizedPct >= 0 ? "positive" : "negative"}
        sub={p.annualizedPct !== null ? "Tiene en cuenta cuándo entró cada euro" : "Hace falta al menos un mes de historia"}
      />
    </div>
  );
}

/* ---------- Composición ---------- */

type Dim = "positions" | "sector" | "country" | "currency";
const DIMS: { id: Dim; label: string }[] = [
  { id: "positions", label: "Posiciones" },
  { id: "sector", label: "Sector" },
  { id: "country", label: "País" },
  { id: "currency", label: "Divisa" },
];

/** Barras horizontales (magnitud, una sola serie): el largo es el peso; la línea vertical, el máximo recomendado. */
function Composition({ view }: { view: PortfolioView }) {
  const [dim, setDim] = useState<Dim>("positions");
  const p = view.portfolio;
  const items: Exposure[] =
    dim === "positions" ? p.positions.filter((x) => x.weight !== null).map((x) => ({ key: x.security.ticker, valueEur: x.valueEur!, weight: x.weight! }))
    : dim === "sector" ? p.bySector
    : dim === "country" ? p.byCountry.map((e) => ({ ...e, key: countryName(e.key) }))
    : p.byCurrency;
  const limit = dim === "positions" ? PORTFOLIO_CONFIG.maxPosition : dim === "sector" ? PORTFOLIO_CONFIG.maxSector : null;
  const scale = Math.max(...items.map((i) => i.weight), limit ?? 0, 0.01);
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-[18px] font-semibold tracking-tight">¿Dónde está tu dinero?</h2>
        <div role="tablist" aria-label="Agrupar por" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {DIMS.map((d) => (
            <button key={d.id} role="tab" aria-selected={dim === d.id} onClick={() => setDim(d.id)} className={cn("h-7 rounded-md px-3 text-[12.5px]", dim === d.id ? "bg-surface-raised font-medium shadow-card" : "text-muted hover:text-text")}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="space-y-2" aria-label={`Peso por ${DIMS.find((d) => d.id === dim)!.label.toLowerCase()}`}>
        {items.map((i) => {
          const over = limit !== null && i.weight > limit && i.key !== "Sin dato";
          return (
            <li key={i.key}>
              <Tooltip content={<span><b>{i.key}</b>: {formatCurrency(i.valueEur, "EUR")} ({formatPercent(i.weight, 1)})</span>}>
                <div tabIndex={0} className="grid grid-cols-[minmax(0,150px)_1fr_56px] items-center gap-3 rounded-md text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <span className={cn("truncate", i.key === "Sin dato" && "text-muted")}>{i.key}</span>
                  <span className="relative h-3" aria-hidden>
                    <span className={cn("absolute inset-y-0 left-0 rounded-r-[4px]", over ? "bg-warning" : "bg-[var(--chart-1)]", i.key === "Sin dato" && "bg-muted/35")} style={{ width: `${(i.weight / scale) * 100}%` }} />
                    {limit !== null && <span className="absolute -inset-y-1 w-px bg-muted/70" style={{ left: `${(limit / scale) * 100}%` }} />}
                  </span>
                  <span className={cn("text-right tabular", over && "font-medium text-warning-text")}>{formatPercent(i.weight, 1)}</span>
                </div>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11.5px] text-muted">
        {limit !== null && <>La línea vertical marca el máximo recomendado ({formatPercent(limit, 0)}). </>}
        {dim !== "positions" && "Los ETFs con ficha se reparten según su contenido."}
      </p>
    </section>
  );
}

/* ---------- Escenarios ---------- */

const SCENARIO_LABEL = { prudente: "Prudente", base: "Base", optimista: "Optimista" } as const;

function ScenariosPanel({ s, valueEur }: { s: Scenarios | null; valueEur: number }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[18px] font-semibold tracking-tight">Si todo sigue como hasta ahora…</h2>
        <Badge tone="warning" className="shrink-0 whitespace-nowrap">Escenarios, no predicciones</Badge>
      </div>
      {!s ? (
        <p className="mt-3 text-[13px] text-muted">Hace falta el crecimiento de al menos una posición (ventas de varios años o {SCENARIO_CONFIG.minPriceYears} años de precios) para dibujar escenarios.</p>
      ) : (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Cuánto valdrían tus {formatCurrency(valueEur, "EUR", 0)} dentro de {s.years} años si cada posición creciera al ritmo de su historia: sus ventas (acciones) o su precio (ETFs y ETCs). Sin aportaciones ni retiradas.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {s.scenarios.map((x) => (
              <div key={x.id} className={cn("rounded-lg border px-4 py-3", x.id === "base" ? "border-accent/40 bg-sand/25" : "border-border")}>
                <p className="text-[12px] text-muted">{SCENARIO_LABEL[x.id]}</p>
                <p className="mt-0.5 font-serif text-[20px] font-semibold tabular">{formatCurrency(x.valueEur, "EUR", 0)}</p>
                <p className="text-[12px] text-muted tabular">{signedPercent(x.rate)} al año</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            Prudente = la mitad del ritmo histórico; optimista = 1,5 veces. Cada ritmo se limita entre {formatPercent(SCENARIO_CONFIG.floor, 0)} y +{formatPercent(SCENARIO_CONFIG.cap, 0)} al año.
            {s.missing.length > 0 && <> Sin historia suficiente (cuentan como 0 %): {s.missing.join(", ")}.</>} El pasado no garantiza el futuro.
          </p>
        </>
      )}
    </section>
  );
}

/* ---------- Operaciones ---------- */

const TYPE_LABEL = { buy: "Compra", sell: "Venta", dividend: "Dividendo" } as const;

function Transactions({ view }: { view: PortfolioView }) {
  const del = useDeleteTransaction();
  const [confirm, setConfirm] = useState<number | null>(null);
  return (
    <section>
      <h2 className="mb-3 font-serif text-[18px] font-semibold tracking-tight">Tus operaciones</h2>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="text-[12px] text-muted">
            <tr className="border-b border-border">
              <th className="px-5 py-2.5 font-medium">Fecha</th>
              <th className="px-3 py-2.5 font-medium">Operación</th>
              <th className="px-3 py-2.5 font-medium">Valor</th>
              <th className="px-3 py-2.5 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2.5 text-right font-medium">Precio</th>
              <th className="px-3 py-2.5 text-right font-medium">Comisiones</th>
              <th className="px-3 py-2.5 font-medium">Bróker</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {view.transactions.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-5 py-2.5 tabular">{formatDate(t.trade_date)}</td>
                <td className="px-3 py-2.5"><Badge tone={t.type === "buy" ? "accent" : t.type === "sell" ? "neutral" : "positive"}>{TYPE_LABEL[t.type]}</Badge></td>
                <td className="px-3 py-2.5"><span className="font-medium">{t.ticker}</span> <span className="text-muted">{t.name}</span></td>
                <td className="px-3 py-2.5 text-right tabular">{formatNumber(t.quantity, t.quantity % 1 ? 4 : 0)}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatNumber(t.price, 2)} {t.currency}</td>
                <td className="px-3 py-2.5 text-right tabular">{t.fees ? `${formatNumber(t.fees, 2)} ${t.currency}` : "—"}</td>
                <td className="px-3 py-2.5 text-muted">{t.broker ?? "—"}</td>
                <td className="pr-4 text-right">
                  {confirm === t.id ? (
                    <Button size="sm" variant="danger" onClick={() => del.mutate({ id: t.id, securityId: t.security_id }, { onSettled: () => setConfirm(null) })}>Borrar</Button>
                  ) : (
                    <Button size="sm" variant="ghost" aria-label={`Borrar operación de ${t.ticker} del ${formatDate(t.trade_date)}`} onClick={() => setConfirm(t.id)}><Trash2 aria-hidden /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Página ---------- */

/** ⌘N: nueva operación (CLAUDE.md §9). */
function useNewShortcut(open: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

export function VisionBoard({ view, onBuy, onSheet, onClassify }: { view: PortfolioView; onBuy: (h: Holding) => void; onSheet: (h: Holding) => void; onClassify: (h: Holding) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {view.holdings.map((h) => (
        <PositionCard key={h.row.id} h={h} onBuy={() => onBuy(h)} onSheet={() => onSheet(h)} onClassify={() => onClassify(h)} />
      ))}
    </div>
  );
}

export function PortfolioPage() {
  const { data: view, isLoading, isError } = usePortfolio();
  const [dialog, setDialog] = useState<{ input: string } | null>(null);
  const [sheet, setSheet] = useState<Holding | null>(null);
  const [classify, setClassify] = useState<Holding | null>(null);
  useNewShortcut(useCallback(() => inDesktopApp && setDialog({ input: "" }), []));
  const holdings = view?.holdings ?? [];
  // Refresca el holding abierto cuando cambian los datos (p. ej. tras leer la ficha)
  const sheetNow = sheet ? (holdings.find((h) => h.row.id === sheet.row.id) ?? sheet) : null;
  const withoutSector = holdings.filter((h) => h.row.kind === "stock" && !h.position.security.sector).length;

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={
          <Button onClick={() => setDialog({ input: "" })} disabled={!inDesktopApp}>
            <Plus aria-hidden /> Nueva operación <kbd className="ml-1 font-sans text-[11px] opacity-80">⌘N</kbd>
          </Button>
        }
      />
      {isLoading && <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface" />}
      {isError && (
        <EmptyState icon={WalletCards} title="Solo en la app de escritorio" description="Tu cartera se guarda en la base de datos de tu Mac. En esta vista previa del navegador no hay base de datos." />
      )}
      {view && view.transactions.length === 0 && (
        <EmptyState
          icon={WalletCards}
          title="Registra tu primera operación"
          description="Apunta tus compras de acciones, ETFs y ETCs con fecha, cantidad, precio y comisiones. Verás tu rentabilidad en euros, el peso de cada posición y una recomendación de Comprar más o Mantener."
        >
          <Button onClick={() => setDialog({ input: "" })} disabled={!inDesktopApp}><Plus aria-hidden /> Nueva operación</Button>
        </EmptyState>
      )}
      {view && view.transactions.length > 0 && (
        <div className="space-y-6">
          <PortfolioSummary p={view.portfolio} />
          {withoutSector > 0 && (
            <p className="flex items-center gap-2 rounded-lg bg-warning/12 px-4 py-2.5 text-[13px] text-warning-text">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {withoutSector === 1 ? "Una acción no tiene" : `${withoutSector} acciones no tienen`} sector: pulsa «Sector: Sin dato» en su tarjeta para indicarlo y medir la concentración por sector.
            </p>
          )}
          <VisionBoard view={view} onBuy={(h) => setDialog({ input: h.row.ticker })} onSheet={setSheet} onClassify={setClassify} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Composition view={view} />
            <ScenariosPanel s={view.scenarios} valueEur={view.portfolio.valueEur} />
          </div>
          <Transactions view={view} />
          <p className="text-[11.5px] text-muted">
            Importes en euros con los tipos de referencia del BCE del día de cada operación (o el de tu bróker si lo indicaste). Recomendación: valoración, salud financiera, competencia y peso en tu cartera (máximo {formatPercent(PORTFOLIO_CONFIG.maxPosition, 0)} por posición y {formatPercent(PORTFOLIO_CONFIG.maxSector, 0)} por sector). {DISCLAIMER}
          </p>
        </div>
      )}
      <TransactionDialog open={!!dialog} onClose={() => setDialog(null)} holdings={holdings} preset={dialog ?? undefined} />
      <FundSheetDialog h={sheetNow} onClose={() => setSheet(null)} />
      <ClassificationDialog h={classify} onClose={() => setClassify(null)} />
    </div>
  );
}
