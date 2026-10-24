import { Tooltip } from "@/components/ui/tooltip";
import type { PriceStats } from "@/domain/technical/price-range";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, SIN_DATO } from "@/lib/format";

/** Moneda para mostrar: las cotizaciones de Londres van en peniques. */
const money = (v: number, currency: string) => (currency === "GBp" ? `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} p` : formatCurrency(v, currency));

/**
 * Dónde está el precio de hoy en su rango de 52 semanas: barra de mínimo a
 * máximo con una marca, y la distancia al máximo en texto (nunca solo color).
 */
export function Range52({ stats, currency, className }: { stats: PriceStats; currency: string; className?: string }) {
  const r = stats.range52;
  if (!r) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  const pos = Math.round(r.position * 100);
  return (
    <Tooltip
      content={
        <div className="tabular">
          <p>Mínimo de 52 semanas: {money(r.low, currency)}</p>
          <p>Máximo de 52 semanas: {money(r.high, currency)}</p>
          <p className="mt-1 text-muted">Con velas semanales guardadas en tu Mac y la última cotización.</p>
        </div>
      }
    >
      <div tabIndex={0} className={cn("w-[130px] cursor-help outline-none", className)} aria-label={`Rango de 52 semanas: ${r.fromHigh >= -0.005 ? "en máximos" : `${signedPercent(r.fromHigh)} desde el máximo`}`}>
        <div className="relative h-1.5 rounded-full bg-sand/70" aria-hidden>
          <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-raised bg-accent" style={{ left: `${pos}%` }} />
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted tabular">{r.fromHigh >= -0.005 ? "En máximos del año" : `${signedPercent(r.fromHigh)} desde máx.`}</p>
      </div>
    </Tooltip>
  );
}

/** Subida o bajada en lo que va de año, con signo y color. */
export function YearToDate({ stats, currency }: { stats: PriceStats; currency: string }) {
  if (stats.ytd === null || !stats.ytdBase) return <span className="text-[12px] text-muted">{SIN_DATO}</span>;
  return (
    <Tooltip content={<span className="tabular">Frente al cierre de {money(stats.ytdBase.close, currency)} del {formatDate(stats.ytdBase.date)}.</span>}>
      <span tabIndex={0} className={cn("cursor-help font-medium tabular", stats.ytd >= 0 ? "text-positive-text" : "text-negative-text")}>
        {signedPercent(stats.ytd)}
      </span>
    </Tooltip>
  );
}
