import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, Eye, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { EmptyState } from "@/app/EmptyState";
import { PageHeader } from "@/app/PageHeader";
import { SECTIONS } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceValue } from "@/components/ui/source-value";
import { Tooltip } from "@/components/ui/tooltip";
import type { WatchlistRow } from "@/db/repo";
import { providerLabel } from "@/data/prices/provider";
import { lastRefreshKey, useRefreshPrices, type LastRefresh } from "@/features/prices/queries";
import { secUserAgent } from "@/features/settings/schema";
import { useSettings } from "@/features/settings/queries";
import { formatCurrency, SIN_DATO } from "@/lib/format";
import { inDesktopApp } from "@/platform/runtime";
import { EU_STEP_LABELS, EXCHANGE_NAMES } from "./import-eu";
import { IMPORT_STEP_LABELS, looksLikeIsin, type ImportStep } from "./import-us";
import { describeError, useAddTicker, useWatchlist } from "./queries";

const section = SECTIONS[0]!;
const STEPS = Object.keys(IMPORT_STEP_LABELS) as ImportStep[];
const timeFmt = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

function ImportProgress({ step, ticker, market }: { step: ImportStep; ticker: string; market: "US" | "EU" }) {
  const current = STEPS.indexOf(step);
  const labels = market === "EU" ? EU_STEP_LABELS : IMPORT_STEP_LABELS;
  return (
    <div role="status" className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
      <p className="mb-2 text-[13px] font-medium">Añadiendo {ticker}…</p>
      <ol className="flex flex-col gap-1.5">
        {STEPS.map((s, k) => (
          <li key={s} className={`flex items-center gap-2 text-[13px] ${k > current ? "text-muted/60" : k === current ? "text-text" : "text-muted"}`}>
            {k < current ? (
              <Check className="size-3.5 text-positive" aria-label="hecho" />
            ) : k === current ? (
              <Loader2 className="size-3.5 animate-spin text-accent" aria-label="en curso" />
            ) : (
              <span className="size-3.5 rounded-full border border-border" aria-hidden />
            )}
            {labels[s]}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PriceStatus() {
  const refresh = useRefreshPrices();
  const { data: last } = useQuery<LastRefresh | null>({ queryKey: lastRefreshKey, queryFn: () => null, enabled: false });
  const failed = last?.failed ?? [];
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted">
      {last && (
        <span>
          Precios de {last.provider} · {timeFmt.format(new Date(last.at))}
        </span>
      )}
      {failed.length > 0 && (
        <Tooltip content={<ul>{failed.map((f) => <li key={f.ticker}><b>{f.ticker}</b>: {f.message}</li>)}</ul>}>
          <span tabIndex={0}>
            <Badge tone="warning">
              <AlertTriangle aria-hidden /> {failed.length} sin precio
            </Badge>
          </span>
        </Tooltip>
      )}
      {refresh.error && <Badge tone="warning"><AlertTriangle aria-hidden /> {describeError(refresh.error)}</Badge>}
      <Button variant="secondary" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending || !inDesktopApp}>
        <RefreshCw className={refresh.isPending ? "animate-spin" : ""} aria-hidden /> Actualizar precios
        <kbd className="ml-1 font-sans text-[11px] text-muted">⌘R</kbd>
      </Button>
    </div>
  );
}

function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-surface text-[12px] text-muted">
          <tr>
            <th className="px-5 py-2.5 font-medium">Valor</th>
            <th className="px-3 py-2.5 font-medium">Bolsa</th>
            <th className="px-3 py-2.5 text-right font-medium">Precio</th>
            <th className="px-3 py-2.5 font-medium">Informes</th>
            <th className="px-3 py-2.5 font-medium">Datos</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => navigate(`/watchlist/${r.id}`)}
              className="cursor-pointer border-t border-border transition-colors duration-150 hover:bg-sand/25"
            >
              <td className="px-5 py-3">
                <Link to={`/watchlist/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-accent-text">
                  {r.ticker}
                </Link>
                <div className="text-[12px] text-muted">{r.name}</div>
              </td>
              <td className="px-3 py-3 text-muted">{(r.market === "EU" && r.exchange && EXCHANGE_NAMES[r.exchange]) || r.exchange || SIN_DATO}</td>
              <td className="px-3 py-3 text-right tabular" onClick={(e) => e.stopPropagation()}>
                {r.price != null ? (
                  <SourceValue
                    info={{
                      source: providerLabel(r.price_source),
                      period: `Cotización del ${r.price_date}`,
                      fetchedAt: r.price_fetched_at,
                    }}
                  >
                    {formatCurrency(r.price, r.currency)}
                  </SourceValue>
                ) : (
                  <span className="text-muted">{SIN_DATO}</span>
                )}
              </td>
              <td className="px-3 py-3 text-muted">
                {r.annual_count} anuales · {r.interim_count} {r.market === "EU" ? "intermedios" : "trimestrales"}
              </td>
              <td className="px-3 py-3">
                {r.gap_count > 0 ? (
                  <Badge tone="warning">{r.gap_count} sin dato</Badge>
                ) : (
                  <Badge tone="positive"><Check aria-hidden /> Completos</Badge>
                )}
              </td>
              <td className="pr-4 text-muted">
                <ChevronRight className="size-4" aria-hidden />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WatchlistPage() {
  const { data: settings } = useSettings();
  const list = useWatchlist();
  const add = useAddTicker();
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [hint, setHint] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const missingUa = settings ? !secUserAgent(settings) : false;

  // ⌘K: buscar/añadir ticker
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = value.trim().toUpperCase();
    if (!t) return;
    if (missingUa && !(looksLikeIsin(t) && !t.startsWith("US"))) {
      setHint("Para las acciones de EE. UU. la SEC exige tu nombre y email (Ajustes). Las europeas puedes añadirlas ya por su ISIN.");
      return;
    }
    setHint(undefined);
    setSubmitted(t);
    add.mutate(t, { onSuccess: () => setValue("") });
  }

  const rows = list.data ?? [];

  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <div className="relative w-[260px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                ref={inputRef}
                aria-label="Ticker o ISIN"
                placeholder="Ticker (AAPL) o ISIN (ES0148396007)"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={add.isPending || !inDesktopApp}
                className="pr-9 pl-8 uppercase placeholder:normal-case"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-sans text-[11px] text-muted">⌘K</kbd>
            </div>
            <Button type="submit" disabled={!value.trim() || add.isPending || !inDesktopApp}>
              <Plus aria-hidden /> Añadir
            </Button>
          </form>
        }
      />

      {missingUa && (
        <p className="mb-6 flex items-center gap-2 rounded-lg bg-warning/12 px-4 py-2.5 text-[13px] text-warning-text">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            La SEC exige identificarse con nombre y email.{" "}
            <Link to="/ajustes" className="font-medium underline underline-offset-2">Añádelos en Ajustes</Link> para buscar empresas de EE. UU. Las europeas puedes añadirlas por su ISIN.
          </span>
        </p>
      )}
      {hint && <p className="mb-6 rounded-lg bg-surface px-4 py-2.5 text-[13px] text-muted">{hint}</p>}
      {add.step && <ImportProgress step={add.step} ticker={submitted} market={add.market} />}
      {add.error && (
        <p role="alert" className="mb-6 flex items-start gap-2 rounded-lg bg-negative/10 px-4 py-2.5 text-[13px] text-negative-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {describeError(add.error)}
        </p>
      )}
      {add.data && !add.isPending && (
        <div role="status" className="mb-6 rounded-lg bg-positive/10 px-4 py-2.5 text-[13px] text-positive-text">
          <p className="flex items-center gap-2">
            <Check className="size-4" aria-hidden />
            <span>
              <b>{add.data.name}</b> añadida: {add.data.annual} informes anuales y {add.data.interim} {add.market === "EU" ? "intermedios" : "trimestrales"},{" "}
              {add.data.facts.toLocaleString("es-ES")} cifras guardadas.
              {add.data.requests > 0 && <> Te pido {add.data.requests === 1 ? "1 informe" : `${add.data.requests} informes`} en «Documentos pendientes».</>}
            </span>
          </p>
          {[...add.data.notes, ...add.data.priceErrors.map((m) => `Precio: ${m}`)].map((n) => (
            <p key={n} className="mt-1 pl-6 text-muted">{n}</p>
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <>
          <div className="mb-3 flex justify-end">
            <PriceStatus />
          </div>
          <WatchlistTable rows={rows} />
        </>
      ) : list.isError ? (
        <EmptyState
          icon={Eye}
          title="Solo en la app de escritorio"
          description="La watchlist se guarda en la base de datos de tu Mac. En esta vista previa del navegador no hay base de datos."
        />
      ) : list.isSuccess && !add.step ? (
        <EmptyState
          icon={Eye}
          title="Añade tu primer ticker"
          description="Escribe un ticker de EE. UU. (AAPL, MSFT…) o el ISIN de una acción europea (ES0148396007 para Inditex). La app buscará sus informes oficiales (SEC o ESEF) y guardará sus cifras con el origen de cada una."
        />
      ) : null}
    </div>
  );
}
