import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Link, NavLink } from "react-router";
import { listNewReports } from "@/db/calendar-repo";
import { appDb } from "@/platform/database";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { inDesktopApp } from "@/platform/runtime";
import { AnimatedLogo } from "./AnimatedLogo";
import { SETTINGS_SECTION } from "./sections";

/** Barra superior: zona de arrastre de la ventana, marca (vuelve a la portada), Calendario y Ajustes. */
const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors duration-150",
    isActive ? "bg-accent/14 text-text" : "text-muted hover:bg-text/5 hover:text-text",
  );

/** Informes nuevos sin revisar (para el aviso junto a «Calendario»). */
function useFreshReports(): number {
  const { data } = useQuery({ queryKey: ["calendar", "fresh"], queryFn: async () => (await listNewReports(await appDb(), true)).length });
  return data ?? 0;
}

export function TopBar() {
  const Gear = SETTINGS_SECTION.icon;
  const fresh = useFreshReports();
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
        <NavLink to="/calendario" className={navClass}>
          <CalendarDays className="size-4" aria-hidden /> Calendario
          {fresh > 0 && (
            <span className="ml-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-white tabular" aria-label={`${fresh} informes nuevos`}>
              {fresh}
            </span>
          )}
        </NavLink>
        <NavLink
          to={SETTINGS_SECTION.path}
          className={navClass}
        >
          <Gear className="size-4" aria-hidden /> Ajustes
        </NavLink>
      </div>
    </header>
  );
}
