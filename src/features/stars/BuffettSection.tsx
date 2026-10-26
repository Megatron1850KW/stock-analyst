import { ArrowRight, Check, Minus, X } from "lucide-react";
import { Link } from "react-router";
import { Tooltip } from "@/components/ui/tooltip";
import type { BuffettCriterion, BuffettPick, BuffettRow } from "@/domain/scoring/buffett";
import { buffettReasons } from "@/domain/scoring/buffett";
import { BUFFETT_CONFIG } from "@/domain/scoring/config";
import { cn } from "@/lib/cn";
import { formatPercent, SIN_DATO } from "@/lib/format";
import { BUFFETT_TITLE, BuffettGlyph } from "./BuffettMark";

const COLUMNS: { id: BuffettCriterion["id"]; short: string }[] = [
  { id: "consistency", short: "Beneficios" },
  { id: "roe", short: "ROE" },
  { id: "moat", short: "Márgenes" },
  { id: "debt", short: "Deuda" },
  { id: "cash", short: "Caja" },
  { id: "dilution", short: "Acciones" },
  { id: "price", short: "Precio" },
];

function BuffettCard({ which, data, subtitle }: { which: keyof typeof BUFFETT_TITLE; data: BuffettPick; subtitle: string }) {
  return (
    <section aria-label={`Criterio Buffett: ${which === "watchlist" ? "watchlist" : "mi portfolio"}`} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface-raised p-6 shadow-card">
      <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">{which === "watchlist" ? "Watchlist" : "Mi Portfolio"}</p>
      <h2 className="mt-1 font-serif text-[20px] leading-tight font-semibold tracking-tight">{which === "watchlist" ? "Lo que Buffett compraría hoy" : "De lo tuyo, de qué compraría más"}</h2>
      <p className="mt-1 text-[12.5px] text-muted">{subtitle}</p>
      {data.picks.length ? (
        <ul className="mt-5 space-y-4">
          {data.picks.map((r) => (
            <li key={r.input.id} className="flex gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-klein/10" aria-hidden>
                <BuffettGlyph className="size-5 text-[19px]" />
              </span>
              <div className="min-w-0">
                <Link to={`/watchlist/${r.input.id}`} className="font-serif text-[22px] leading-none font-semibold tracking-tight hover:underline">{r.input.ticker}</Link>
                <p className="mt-1 truncate text-[12.5px] text-muted">{r.input.name}</p>
                <ul className="mt-2 space-y-1 text-[13.5px] leading-snug">
                  {buffettReasons(r).map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-klein" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-lg bg-surface px-4 py-3 text-[13px] text-muted">{data.note}</p>
      )}
      {data.picks[0] && (
        <Link to={`/watchlist/${data.picks[0].input.id}`} className="mt-auto inline-flex items-center gap-1 pt-5 text-[13px] font-medium text-klein hover:underline">
          Ver la ficha de {data.picks[0].input.ticker} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function Mark({ c }: { c: BuffettCriterion | undefined }) {
  if (!c) return <span className="text-muted">{SIN_DATO}</span>;
  const [Icon, tone, word] = c.pass === true ? [Check, "text-positive-text", "Cumple"] : c.pass === false ? [X, "text-negative-text", "No cumple"] : [Minus, "text-muted", "Sin dato"];
  return (
    <Tooltip content={<span><strong>{c.label}.</strong> {c.text}</span>}>
      <span role="img" tabIndex={0} className={cn("inline-flex cursor-help rounded outline-none focus-visible:ring-2 focus-visible:ring-klein", tone)} aria-label={`${c.label}: ${word}`}>
        <Icon className="size-4" aria-hidden />
      </span>
    </Tooltip>
  );
}

function BuffettTable({ title, intro, data }: { title: string; intro: string; data: BuffettPick }) {
  if (data.ranking.length === 0) return null;
  return (
    <section aria-label={title} className="rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <header className="px-5 pt-5">
        <h3 className="font-serif text-[17px] font-semibold">{title}</h3>
        <p className="mt-1 max-w-[80ch] text-[12.5px] text-muted">{intro}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="mt-3 w-full min-w-[760px] text-[13px]">
          <thead className="text-left text-[11.5px] text-muted">
            <tr>
              <th className="px-5 py-2 font-medium">Acción</th>
              {COLUMNS.map((c) => <th key={c.id} className="px-2 py-2 text-center font-medium">{c.short}</th>)}
              <th className="px-3 py-2 text-right font-medium">Caja por 100 €</th>
              <th className="px-5 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.ranking.map((r: BuffettRow) => (
              <tr key={r.input.id} className="border-t border-border">
                <td className="px-5 py-2.5">
                  <Link to={`/watchlist/${r.input.id}`} className="font-semibold hover:text-accent-text">{r.input.ticker}</Link>
                  {r.buy && <BuffettGlyph className="ml-1.5 align-[-2px]" />}
                </td>
                {COLUMNS.map((c) => <td key={c.id} className="px-2 py-2.5 text-center"><Mark c={r.criteria.find((x) => x.id === c.id)} /></td>)}
                <td className="px-3 py-2.5 text-right tabular">{r.input.ownerYield === null ? SIN_DATO : `${(r.input.ownerYield * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} €`}</td>
                <td className="px-5 py-2.5 text-[12.5px]">
                  {r.buy ? <span className="font-medium text-klein">Lleva la «B»</span> : <span className="text-muted">Cumple {r.passed} de {r.criteria.length}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cfg = BUFFETT_CONFIG;
const CRITERIA_TEXT =
  `Los siete criterios, todos obligatorios: beneficios todos los años (los últimos ${cfg.profitYears}); ` +
  `rentabilidad sobre el capital de al menos un ${formatPercent(cfg.minRoe, 0)}; margen bruto de al menos un ${formatPercent(cfg.minGrossMargin, 0)} (u operativo del ${formatPercent(cfg.minOperatingMargin, 0)} si no publica bruto), señal de una ventaja duradera; ` +
  `caja neta o deuda pagable en ${cfg.maxDebtYears} años; convertir en caja libre al menos el ${formatPercent(cfg.minCashConversion, 0)} del beneficio; ` +
  `no emitir más de un ${formatPercent(cfg.maxDilution, 0)} de acciones al año; y precio sensato: no «Cara» frente a su historia y al menos ${cfg.minOwnerYield * 100} € de caja libre al año por cada 100 € que pagas. ` +
  "Si falta un dato, no se marca: Buffett no compra lo que no entiende.";

/** Criterio Buffett «B», a continuación de las estrellas: complementa, no sustituye. */
export function BuffettSection({ data }: { data: { watchlist: BuffettPick; portfolio: BuffettPick } }) {
  return (
    <section aria-label="Criterio Buffett" className="space-y-6 pt-4">
      <header>
        <h2 className="flex items-center gap-2 font-serif text-[24px] font-semibold tracking-tight">
          <BuffettGlyph className="size-6 text-[22px]" /> Criterio Buffett
        </h2>
        <p className="mt-1 max-w-[80ch] text-[13px] text-muted">
          Complementa a las estrellas. Marca con una «B» las acciones que hoy compraría Warren Buffett según los criterios que repite en sus cartas a los accionistas: un negocio excelente, con poca deuda, a un precio sensato. Pueden ser una, varias o ninguna.
        </p>
      </header>
      <div className="grid gap-5 md:grid-cols-2">
        <BuffettCard which="watchlist" data={data.watchlist} subtitle="De tu watchlist: las que cumplen todos sus criterios, de más barata a menos." />
        <BuffettCard which="portfolio" data={data.portfolio} subtitle="De lo que ya tienes: las que cumplen todos sus criterios y en las que ampliaría." />
      </div>
      <BuffettTable
        title="Cómo se elige la siguiente compra según Buffett"
        intro={`${CRITERIA_TEXT} Si varias los cumplen, van primero las que más caja generan por cada 100 € de precio.`}
        data={data.watchlist}
      />
      <BuffettTable
        title="Cómo se elige la más barata de tu cartera según Buffett"
        intro="Las mismas siete pruebas sobre tus acciones. De las que las cumplen, la más barata es la que más caja libre genera por cada 100 € que pagarías hoy (lo que Buffett llama «rentabilidad del dueño»). Los ETFs y ETCs no optan: no tienen estados financieros."
        data={data.portfolio}
      />
    </section>
  );
}
