import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { AnimatedLogo } from "./AnimatedLogo";
import { ColumnArt } from "./ColumnArt";
import { SECTIONS } from "./sections";

const today = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Portada: logo animado en el centro y las 4 secciones como columnas verticales. */
export function HomePage() {
  return (
    <div className="flex min-h-full flex-col px-8 pb-6">
      <div className="flex flex-col items-center pt-4 pb-10 text-center">
        <AnimatedLogo className="size-[148px] drop-shadow-[0_10px_24px_rgba(181,96,63,0.25)]" />
        <h1 className="mt-6 font-serif text-[40px] leading-none font-semibold tracking-tight">Agente Financiero</h1>
        <p className="mt-3 text-[15px] text-muted">Tu analista personal de acciones europeas y americanas</p>
        <p className="mt-1 text-[12px] text-muted/80 first-letter:uppercase">{today.format(new Date())}</p>
      </div>

      <nav aria-label="Secciones" className="grid flex-1 grid-cols-4 gap-4">
        {SECTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.path}
              to={s.path}
              className="group relative flex min-h-[300px] flex-col rounded-[20px] border border-border bg-surface-raised p-6 shadow-card transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-accent/60 hover:shadow-[0_12px_28px_-12px_rgba(181,96,63,0.35)]"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-[12px] text-muted tabular">0{i + 1}</span>
                <ArrowUpRight className="size-4 text-muted transition-colors duration-200 group-hover:text-accent" aria-hidden />
              </div>
              <div className="mt-8 flex size-11 items-center justify-center rounded-xl bg-sand/60">
                <Icon className="size-5 text-accent-text" aria-hidden />
              </div>
              <h2 className="mt-4 font-serif text-[22px] leading-tight font-semibold tracking-tight">{s.label}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{s.blurb}</p>
              <div className="mt-auto pt-6">
                <ColumnArt index={i} />
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted">
                  <span>Llega en la fase {s.phase}</span>
                  <kbd className="font-sans">⌘{s.shortcut}</kbd>
                </div>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
