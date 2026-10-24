import { NavLink } from "react-router";
import { cn } from "@/lib/cn";
import { SECTIONS, SETTINGS_SECTION, type Section } from "./sections";

function NavItem({ section }: { section: Section }) {
  const Icon = section.icon;
  return (
    <NavLink
      to={section.path}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150",
          isActive ? "bg-accent/14 font-medium text-text" : "text-muted hover:bg-text/5 hover:text-text",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("size-4", isActive ? "text-accent" : "text-muted group-hover:text-text")} aria-hidden />
          <span className="flex-1">{section.label}</span>
          <kbd className="font-sans text-[11px] text-muted/70 opacity-0 transition-opacity group-hover:opacity-100">
            ⌘{section.shortcut}
          </kbd>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-border bg-sidebar backdrop-blur-xl">
      {/* Zona de arrastre de la ventana (barra de título superpuesta de macOS) */}
      <div data-tauri-drag-region className="h-12 shrink-0" />
      <div className="flex items-center gap-2.5 px-4 pb-5">
        <img src="/icon.svg" alt="" className="size-7" />
        <div className="leading-tight">
          <p className="font-serif text-[15px] font-semibold tracking-tight">Agente Financiero</p>
          <p className="text-[11px] text-muted">Tu analista personal</p>
        </div>
      </div>
      <nav aria-label="Secciones" className="flex flex-1 flex-col gap-0.5 px-2.5">
        {SECTIONS.map((s) => (
          <NavItem key={s.path} section={s} />
        ))}
      </nav>
      <div className="px-2.5 pb-3">
        <NavItem section={SETTINGS_SECTION} />
      </div>
    </aside>
  );
}
