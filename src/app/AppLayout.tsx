import { Outlet } from "react-router";
import { useSettings } from "@/features/settings/queries";
import { inDesktopApp } from "@/platform/runtime";
import { Disclaimer } from "./Disclaimer";
import { Sidebar } from "./Sidebar";
import { useShortcuts } from "./useShortcuts";
import { useTheme } from "./useTheme";

export function AppLayout() {
  const { data: settings } = useSettings();
  useTheme(settings?.theme);
  useShortcuts();

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <div data-tauri-drag-region className="h-12 shrink-0" />
        {!inDesktopApp && (
          <p className="mx-10 mb-4 rounded-lg bg-sand/50 px-3 py-2 text-[12px] text-muted">
            Vista previa en navegador: los ajustes y claves se guardan solo en memoria.
          </p>
        )}
        <main className="flex-1 overflow-y-auto px-10 pb-12">
          <Outlet />
        </main>
        <Disclaimer />
      </div>
    </div>
  );
}
