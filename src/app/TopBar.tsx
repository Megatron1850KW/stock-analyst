import { Link, NavLink } from "react-router";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { inDesktopApp } from "@/platform/runtime";
import { AnimatedLogo } from "./AnimatedLogo";
import { SETTINGS_SECTION } from "./sections";

/** Barra superior: zona de arrastre de la ventana, marca (vuelve a la portada) y Ajustes. */
export function TopBar() {
  const Gear = SETTINGS_SECTION.icon;
  return (
    <header data-tauri-drag-region className="flex h-14 shrink-0 items-center justify-between gap-4 pr-5 pl-24">
      <Link to="/" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-text/5" aria-label="Portada">
        <AnimatedLogo decorative className="size-6" />
        <span className="font-serif text-[15px] font-semibold tracking-tight">Stock Analisis</span>
      </Link>
      <div className="flex items-center gap-2">
        {!inDesktopApp && (
          <Badge tone="warning" title="Los ajustes y claves se guardan solo en memoria">
            Vista previa en navegador
          </Badge>
        )}
        <NavLink
          to={SETTINGS_SECTION.path}
          className={({ isActive }) =>
            cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors duration-150",
              isActive ? "bg-accent/14 text-text" : "text-muted hover:bg-text/5 hover:text-text",
            )
          }
        >
          <Gear className="size-4" aria-hidden /> Ajustes
        </NavLink>
      </div>
    </header>
  );
}
