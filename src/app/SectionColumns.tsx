import { NavLink, Outlet, useLocation } from "react-router";
import { cn } from "@/lib/cn";
import { SECTIONS } from "./sections";

/**
 * Las secciones como columnas verticales: la activa se despliega y las demás
 * quedan como franjas estrechas con el título en vertical.
 */
export function SectionColumns() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Secciones" className="flex h-full gap-3 px-5 pb-4">
      {SECTIONS.map((s, i) => {
        const active = pathname.startsWith(s.path);
        const Icon = s.icon;
        return (
          <div
            key={s.path}
            className={cn(
              "min-w-0 overflow-hidden rounded-[20px] border transition-[flex-grow,flex-basis,background-color] duration-200 ease-out",
              active ? "grow basis-0 border-border bg-surface-raised shadow-card" : "grow-0 basis-[60px] border-transparent bg-surface hover:bg-sand/50",
            )}
          >
            {active ? (
              <section aria-label={s.label} className="h-full overflow-y-auto px-10 pt-7 pb-10">
                <p className="mb-2 flex items-center gap-2 text-[12px] text-muted">
                  <span className="font-mono tabular">0{i + 1}</span>
                  <span aria-hidden>·</span>
                  <Icon className="size-3.5 text-accent" aria-hidden />
                  {s.label}
                </p>
                <Outlet />
              </section>
            ) : (
              <NavLink
                to={s.path}
                aria-label={s.label}
                className="flex h-full w-[60px] flex-col items-center gap-4 py-5 text-muted transition-colors duration-150 hover:text-text"
              >
                <span className="font-mono text-[11px] tabular">0{i + 1}</span>
                <Icon className="size-4 text-accent" aria-hidden />
                <span className="rotate-180 font-serif text-[15px] font-semibold tracking-tight whitespace-nowrap text-text [writing-mode:vertical-rl]">
                  {s.label}
                </span>
                <kbd className="mt-auto font-sans text-[11px]">⌘{s.shortcut}</kbd>
              </NavLink>
            )}
          </div>
        );
      })}
    </nav>
  );
}
