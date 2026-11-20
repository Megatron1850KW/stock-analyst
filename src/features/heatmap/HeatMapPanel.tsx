import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Tooltip } from "@/components/ui/tooltip";
import { sectorFromSic } from "@/domain/portfolio/sector";
import {
  heatIntensity,
  squarifyGroups,
  type Group,
  type PlacedGroup,
} from "@/domain/heatmap/treemap";
import type { PortfolioView } from "@/features/portfolio/load";
import { signedPercent } from "@/features/watchlist/ficha/format";
import type { WatchlistItem } from "@/features/watchlist/queries";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate } from "@/lib/format";

/**
 * Pestaña «Heat Map»: dos mapas de calor al estilo de los de bolsa. Cada
 * cuadro es un valor; su color y su cifra, cuánto ha subido o bajado su precio
 * en 6 meses. Todo sale de las velas semanales ya guardadas en tu Mac y de la
 * última cotización: no se pide nada nuevo a ningún proveedor.
 */

export interface HeatTile {
  id: number;
  ticker: string;
  name: string;
  kind: "stock" | "etf" | "etc";
  /** Variación de 6 meses (0,12 = +12 %), en la divisa en que cotiza. */
  change: number | null;
  price: { value: number; currency: string; date: string } | null;
  base: { date: string; close: number } | null;
  /** Solo cartera: valor de la posición en euros. */
  valueEur?: number;
}

const FUNDS = "ETFs y ETCs";
const NO_SECTOR = "Sin sector";

/** Cartera: un cuadro por posición, de área proporcional a su valor en euros, agrupados por sector. */
export function portfolioGroups(view: PortfolioView): Group<HeatTile>[] {
  const tiles = view.holdings
    .filter((h) => h.position.valueEur !== null && h.position.valueEur > 0)
    .map((h) => ({
      sector:
        h.row.kind === "stock"
          ? (h.position.security.sector ?? NO_SECTOR)
          : FUNDS,
      tile: {
        id: h.row.id,
        ticker: h.row.ticker,
        name: h.row.name,
        kind: h.row.kind,
        change: h.stats.sixMonths,
        price: h.position.price
          ? {
              value: h.position.price.price,
              currency: h.position.price.currency,
              date: h.position.price.date,
            }
          : null,
        base: h.stats.sixMonthsBase,
        valueEur: h.position.valueEur!,
      } satisfies HeatTile,
    }));
  return groupBy(
    tiles.map((t) => ({
      sector: t.sector,
      tile: t.tile,
      size: t.tile.valueEur,
    })),
  );
}

/**
 * Watchlist: todas las acciones que sigues, con cuadros del mismo tamaño
 * (en una lista corta, por capitalización las pequeñas no se verían, y cada una
 * está en su divisa), agrupadas por sector.
 */
export function watchlistGroups(items: WatchlistItem[]): Group<HeatTile>[] {
  return groupBy(
    items
      .filter((w) => w.kind === "stock")
      .map((w) => ({
        sector: w.sector ?? sectorFromSic(w.sic) ?? NO_SECTOR,
        size: 1,
        tile: {
          id: w.id,
          ticker: w.ticker,
          name: w.name,
          kind: w.kind,
          change: w.stats.sixMonths,
          price:
            w.price !== null && w.price_date
              ? { value: w.price, currency: w.currency, date: w.price_date }
              : null,
          base: w.stats.sixMonthsBase,
        } satisfies HeatTile,
      })),
  );
}

function groupBy(
  list: { sector: string; size: number; tile: HeatTile }[],
): Group<HeatTile>[] {
  const map = new Map<string, Group<HeatTile>>();
  for (const { sector, size, tile } of list) {
    const g = map.get(sector) ?? { name: sector, items: [] };
    g.items.push({ item: tile, size });
    map.set(sector, g);
  }
  return [...map.values()];
}

/* ---------- Colores ---------- */

// Fijos en claro y oscuro, como los mapas de bolsa; texto blanco con contraste AA
const NEUTRAL = "#5e5a54";
const UP = "#2c7a3a";
const DOWN = "#a63a27";

export function tileColor(change: number | null): string {
  const t = heatIntensity(change);
  if (t === null) return "#8a867e";
  const pct = Math.round(Math.abs(t) * 100);
  return `color-mix(in oklab, ${t >= 0 ? UP : DOWN} ${pct}%, ${NEUTRAL})`;
}

const LEGEND = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];

function Legend() {
  return (
    <div
      className="flex items-center gap-1"
      aria-label="Escala de colores: de −30 % o menos (rojo) a +30 % o más (verde)"
    >
      {LEGEND.map((v) => (
        <span
          key={v}
          className="rounded px-2 py-0.5 text-[11px] font-medium text-white tabular"
          style={{ background: tileColor(v) }}
        >
          {v === 0 ? "0 %" : `${v > 0 ? "+" : "−"}${Math.abs(v * 100)} %`}
        </span>
      ))}
    </div>
  );
}

/* ---------- Mapa ---------- */

const HEADER = 20;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const money = (v: number, currency: string) =>
  currency === "GBp"
    ? `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} p`
    : formatCurrency(v, currency);

function TileTooltip({ t, total }: { t: HeatTile; total?: number }) {
  return (
    <div className="tabular">
      <p className="font-medium">{t.name}</p>
      {t.valueEur !== undefined && (
        <p>
          Tu posición: {formatCurrency(t.valueEur, "EUR")}
          {total
            ? ` (${(t.valueEur / total).toLocaleString("es-ES", { style: "percent", maximumFractionDigits: 1 })} de la cartera)`
            : ""}
        </p>
      )}
      {t.change !== null && t.base && t.price ? (
        <>
          <p>
            Hoy ({formatDate(t.price.date)}):{" "}
            {money(t.price.value, t.price.currency)}
          </p>
          <p>
            Hace 6 meses (semana del {formatDate(t.base.date)}):{" "}
            {money(t.base.close, t.price.currency)}
          </p>
          <p
            className={cn(
              "font-medium",
              t.change >= 0 ? "text-positive-text" : "text-negative-text",
            )}
          >
            {signedPercent(t.change)} en 6 meses
          </p>
        </>
      ) : (
        <p className="text-muted">
          Sin dato: faltan la cotización de hoy o las velas semanales de hace 6
          meses.
        </p>
      )}
    </div>
  );
}

function Cell({
  t,
  x,
  y,
  w,
  h,
  total,
  onOpen,
}: {
  t: HeatTile;
  x: number;
  y: number;
  w: number;
  h: number;
  total?: number;
  onOpen: () => void;
}) {
  const big = Math.min(w, h);
  const tickerSize = Math.max(
    10,
    Math.min(30, big / 3.6, w / (t.ticker.length * 0.68)),
  );
  const showPct = h >= tickerSize * 2.1 && w >= 38;
  const label = `${t.ticker}: ${t.change === null ? "sin dato" : `${signedPercent(t.change)} en 6 meses`}`;
  return (
    <Tooltip content={<TileTooltip t={t} total={total} />}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className="absolute flex flex-col items-center justify-center overflow-hidden border border-black/25 text-white transition-[filter] duration-150 outline-none hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white"
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: tileColor(t.change),
        }}
      >
        {big >= 18 && (
          <span
            className="leading-none font-semibold tracking-tight"
            style={{ fontSize: tickerSize }}
          >
            {t.ticker}
          </span>
        )}
        {showPct && (
          <span
            className="mt-1 leading-none font-medium tabular opacity-95"
            style={{ fontSize: Math.max(10, tickerSize * 0.55) }}
          >
            {t.change === null ? "Sin dato" : signedPercent(t.change)}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

export function HeatMap({
  title,
  groups,
  height,
  note,
  empty,
}: {
  title: string;
  groups: Group<HeatTile>[];
  height: number;
  note: string;
  empty: string;
}) {
  const [ref, width] = useWidth();
  const navigate = useNavigate();
  const placed: PlacedGroup<HeatTile>[] =
    width > 0
      ? squarifyGroups(
          groups,
          { x: 0, y: 0, w: width, h: height },
          { header: HEADER, gap: 1 },
        )
      : [];
  const total =
    groups
      .flatMap((g) => g.items)
      .reduce((a, b) => a + (b.item.valueEur ?? 0), 0) || undefined;
  const count = groups.reduce((a, g) => a + g.items.length, 0);
  const open = (t: HeatTile) =>
    navigate(
      t.kind === "stock" ? `/watchlist/${t.id}` : `/watchlist/fondo/${t.id}`,
    );

  return (
    <section
      aria-label={title}
      className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-4 shadow-card"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-[20px] leading-none font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-muted">{note}</p>
        </div>
        <Legend />
      </div>
      <div ref={ref} className="w-full">
        {count === 0 ? (
          <p className="rounded-lg bg-surface px-4 py-10 text-center text-[13px] text-muted">
            {empty}
          </p>
        ) : (
          <div
            className="relative w-full overflow-hidden rounded-lg bg-[#2b2926]"
            style={{ height }}
          >
            {placed.map((g) => (
              <div key={g.name}>
                <div
                  className="absolute truncate px-1.5 text-[11px] leading-[20px] font-semibold tracking-wide text-white/90 uppercase"
                  style={{ left: g.x, top: g.y, width: g.w, height: HEADER }}
                  title={g.name}
                >
                  {g.name}
                </div>
                {g.cells.map((c) => (
                  <Cell
                    key={c.item.id}
                    t={c.item}
                    x={c.x}
                    y={c.y}
                    w={c.w}
                    h={c.h}
                    total={total}
                    onOpen={() => open(c.item)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function HeatMapPanel({
  portfolio,
  watchlist,
}: {
  portfolio: PortfolioView | null;
  watchlist: WatchlistItem[];
}) {
  return (
    <div className="space-y-5">
      <HeatMap
        title="Mi cartera"
        groups={portfolio ? portfolioGroups(portfolio) : []}
        height={460}
        note="El tamaño de cada cuadro es lo que vale tu posición en euros. El color y la cifra: cuánto ha subido o bajado su precio en 6 meses."
        empty="Cuando registres tus operaciones en Mi Portfolio, aquí verás tu cartera en un mapa de calor."
      />
      <HeatMap
        title="Lista de seguimiento"
        groups={watchlistGroups(watchlist)}
        height={400}
        note="Todas las acciones que sigues, con cuadros del mismo tamaño y agrupadas por sector. El color y la cifra: su precio hoy frente a hace 6 meses."
        empty="Añade acciones a tu watchlist para verlas aquí."
      />
    </div>
  );
}
