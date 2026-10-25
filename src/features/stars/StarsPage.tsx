import { ArrowRight, Star as StarIcon } from "lucide-react";
import { Link } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { EmptyState } from "@/app/EmptyState";
import { PageHeader } from "@/app/PageHeader";
import { SECTIONS } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { PORTFOLIO_CONFIG, STARS_CONFIG } from "@/domain/scoring/config";
import type { PortfolioStarRow, PortfolioStars, Star, WatchlistStarRow, WatchlistStars } from "@/domain/scoring/stars";
import { qualityTone } from "@/features/watchlist/ficha/Quality";
import { signedPercent } from "@/features/watchlist/ficha/format";
import { cn } from "@/lib/cn";
import { formatPercent, SIN_DATO } from "@/lib/format";
import { BuffettSection } from "./BuffettSection";
import { useStars } from "./queries";
import { STAR_TITLE } from "./StarMark";

const section = SECTIONS[3]!;
const TEXT = { positive: "text-positive-text", warning: "text-warning-text", negative: "text-negative-text", neutral: "text-muted" } as const;

function StarCard({ which, star, note, subtitle }: { which: keyof typeof STAR_TITLE; star: Star | null; note?: string; subtitle: string }) {
  const title = STAR_TITLE[which];
  return (
    <section aria-label={title} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface-raised p-6 shadow-card">
      <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">{which === "watchlist" ? "Watchlist" : "Mi Portfolio"}</p>
      <h2 className="mt-1 font-serif text-[20px] leading-tight font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-[12.5px] text-muted">{subtitle}</p>
      {star ? (
        <>
          <div className="mt-5 flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sand/60" aria-hidden>
              <StarIcon className="size-5 fill-accent text-accent" />
            </span>
            <div className="min-w-0">
              <Link to={`/watchlist/${star.id}`} className="font-serif text-[26px] leading-none font-semibold tracking-tight hover:underline">
                {star.ticker}
              </Link>
              <p className="mt-1 truncate text-[12.5px] text-muted">{star.name}</p>
            </div>
          </div>
          <p className="mt-5 text-[12px] font-medium text-muted">Por qué tiene la estrella</p>
          <ul className="mt-2 space-y-2 text-[14px] leading-snug">
            {star.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          {star.caution && <p className="mt-4 rounded-lg bg-warning/12 px-3 py-2 text-[12.5px] text-warning-text">{star.caution}</p>}
          <Link to={`/watchlist/${star.id}`} className="mt-auto inline-flex items-center gap-1 pt-5 text-[13px] font-medium text-accent-text hover:underline">
            Ver su ficha <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <p className="mt-5 rounded-lg bg-surface px-4 py-3 text-[13px] text-muted">{note}</p>
      )}
    </section>
  );
}

const Score = ({ value, suffix = "/100" }: { value: number | null; suffix?: string }) =>
  value === null ? <span className="text-muted">{SIN_DATO}</span> : <span className="tabular">{value}<span className="text-muted">{suffix}</span></span>;

const Quality = ({ value }: { value: number | null }) => (
  <span className={cn("tabular", TEXT[qualityTone(value)])}>{value === null ? SIN_DATO : Math.round(value)}</span>
);

function WatchRanking({ data, hasPortfolio }: { data: WatchlistStars; hasPortfolio: boolean }) {
  if (data.ranking.length === 0) return null;
  const w = STARS_CONFIG.complementWeights;
  return (
    <section aria-label="Cómo se elige la mejor siguiente compra" className="rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <header className="px-5 pt-5">
        <h3 className="font-serif text-[17px] font-semibold">Cómo se elige la mejor siguiente compra</h3>
        <p className="mt-1 max-w-[80ch] text-[12.5px] text-muted">
          Puntuación = valoración × calidad × complemento de tu cartera. El complemento mira si aporta un sector ({Math.round(w.sector * 100)} %), un país ({Math.round(w.country * 100)} %) y una divisa ({Math.round(w.currency * 100)} %) que te faltan, y si su precio se mueve distinto de tu cartera ({Math.round(w.correlation * 100)} %, correlación de {STARS_CONFIG.correlation.years} años).
          {" "}Se descartan las trampas de valor, las caras, las de calidad menor de {STARS_CONFIG.minQuality} y las de riesgo técnico alto.
          {!hasPortfolio && " Aún no tienes posiciones con valor: el complemento cuenta como completo."}
        </p>
      </header>
      <table className="mt-3 w-full text-[13px]">
        <thead className="text-left text-[11.5px] text-muted">
          <tr>
            <th className="px-5 py-2 font-medium">Acción</th>
            <th className="px-3 py-2 text-right font-medium">Valoración</th>
            <th className="px-3 py-2 text-right font-medium">Calidad</th>
            <th className="px-3 py-2 text-right font-medium">Complemento</th>
            <th className="px-3 py-2 text-right font-medium">Puntuación</th>
            <th className="px-5 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {data.ranking.map((r: WatchlistStarRow) => {
            const starred = data.star?.id === r.candidate.id;
            return (
              <tr key={r.candidate.id} className="border-t border-border">
                <td className="px-5 py-2.5">
                  <Link to={`/watchlist/${r.candidate.id}`} className="font-semibold hover:text-accent-text">{r.candidate.ticker}</Link>
                  {starred && <StarIcon className="ml-1.5 inline size-3.5 fill-accent text-accent align-[-2px]" aria-label="Con estrella" />}
                </td>
                <td className="px-3 py-2.5 text-right"><Score value={r.valuation} /></td>
                <td className="px-3 py-2.5 text-right"><Quality value={r.candidate.quality} /></td>
                <td className="px-3 py-2.5 text-right">
                  {r.complement ? (
                    <Tooltip
                      content={
                        r.complement.parts.length ? (
                          <ul className="space-y-0.5">
                            {r.complement.parts.map((p) => <li key={p.id}><span className="tabular">{p.score}</span> · {p.text}</li>)}
                          </ul>
                        ) : (
                          "Tu cartera está vacía: cualquier acción la diversifica."
                        )
                      }
                    >
                      <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-4"><Score value={r.complement.score} /></span>
                    </Tooltip>
                  ) : (
                    <Score value={null} />
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold"><Score value={r.score} /></td>
                <td className="px-5 py-2.5 text-[12.5px]">
                  {r.excluded ? <span className="text-muted">{r.excluded}</span> : starred ? <Badge tone="positive">Estrella</Badge> : <span className="text-muted">Opta</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const Discount = ({ value }: { value: number | null }) =>
  value === null ? <span className="text-muted">{SIN_DATO}</span> : <span className={cn("tabular", value < 0 ? "text-positive-text" : "text-muted")}>{signedPercent(value)}</span>;

function PortfolioRanking({ data }: { data: PortfolioStars }) {
  if (data.ranking.length === 0) return null;
  return (
    <section aria-label="Cómo se elige la más barata de tu cartera" className="rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <header className="px-5 pt-5">
        <h3 className="font-serif text-[17px] font-semibold">Cómo se elige la más barata de tu cartera</h3>
        <p className="mt-1 max-w-[80ch] text-[12.5px] text-muted">
          Descuento = media de cuánto están sus múltiplos (precio/beneficio, precio/caja libre y EV/EBIT) por debajo de su propia historia y de sus competidores.
          Gana la de mayor descuento con calidad de al menos {STARS_CONFIG.minQuality} y sin señales de trampa de valor; hace falta un descuento mínimo del {formatPercent(STARS_CONFIG.minDiscount, 0)}.
          Los ETFs y ETCs no optan: no tienen estados financieros.
        </p>
      </header>
      <table className="mt-3 w-full text-[13px]">
        <thead className="text-left text-[11.5px] text-muted">
          <tr>
            <th className="px-5 py-2 font-medium">Acción</th>
            <th className="px-3 py-2 text-right font-medium">Vs. su historia</th>
            <th className="px-3 py-2 text-right font-medium">Vs. competencia</th>
            <th className="px-3 py-2 text-right font-medium">Descuento</th>
            <th className="px-3 py-2 text-right font-medium">Calidad</th>
            <th className="px-3 py-2 text-right font-medium">Peso</th>
            <th className="px-5 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {data.ranking.map((r: PortfolioStarRow) => {
            const starred = data.star?.id === r.candidate.id;
            const over = r.candidate.weight !== null && r.candidate.weight > PORTFOLIO_CONFIG.maxPosition;
            return (
              <tr key={r.candidate.id} className="border-t border-border">
                <td className="px-5 py-2.5">
                  <Link to={`/watchlist/${r.candidate.id}`} className="font-semibold hover:text-accent-text">{r.candidate.ticker}</Link>
                  {starred && <StarIcon className="ml-1.5 inline size-3.5 fill-accent text-accent align-[-2px]" aria-label="Con estrella" />}
                </td>
                <td className="px-3 py-2.5 text-right"><Discount value={r.candidate.valuation.deviation} /></td>
                <td className="px-3 py-2.5 text-right"><Discount value={r.candidate.peers.deviation} /></td>
                <td className="px-3 py-2.5 text-right font-semibold"><Discount value={r.discount} /></td>
                <td className="px-3 py-2.5 text-right"><Quality value={r.candidate.quality} /></td>
                <td className={cn("px-3 py-2.5 text-right tabular", over && "text-warning-text")}>{r.candidate.weight === null ? SIN_DATO : formatPercent(r.candidate.weight, 1)}</td>
                <td className="px-5 py-2.5 text-[12.5px]">
                  {r.excluded ? <span className="text-muted">{r.excluded}</span> : starred ? <Badge tone="positive">Estrella</Badge> : <span className="text-muted">Opta</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function StarsPage() {
  const { data, isError, isLoading } = useStars();
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader title={section.title} subtitle={section.subtitle} />
      {isError ? (
        <EmptyState icon={StarIcon} title="Solo en la app de escritorio" description="Las estrellas se calculan con los datos guardados en tu Mac. En esta vista previa del navegador no hay base de datos." />
      ) : isLoading || !data ? (
        <div className="grid gap-5 md:grid-cols-2" aria-busy>
          {[0, 1].map((i) => <div key={i} className="h-[300px] animate-pulse rounded-[var(--radius-card)] bg-surface" />)}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <StarCard which="watchlist" star={data.watchlist.star} note={data.watchlist.note} subtitle="De tu watchlist: buena valoración y calidad, y lo que más le falta a tu cartera." />
            <StarCard which="portfolio" star={data.portfolio.star} note={data.portfolio.note} subtitle="De lo que ya tienes: la que, si la comprases hoy, saldría más barata por sus fundamentales." />
          </div>
          <p className="text-[12px] text-muted">Cálculo determinista con tus datos guardados, sin IA. Se actualiza solo al cambiar precios, informes o tu cartera. {DISCLAIMER}</p>
          <WatchRanking data={data.watchlist} hasPortfolio={data.hasPortfolio} />
          <PortfolioRanking data={data.portfolio} />
          <BuffettSection data={data.buffett} />
        </div>
      )}
    </div>
  );
}
