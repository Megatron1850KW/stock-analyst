import { Outlet } from "react-router";
import { useSettings } from "@/features/settings/queries";
import { Disclaimer } from "./Disclaimer";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./useShortcuts";
import { useTheme } from "./useTheme";

export function AppLayout() {
  const { data: settings } = useSettings();
  useTheme(settings?.theme);
  useShortcuts();

  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <Disclaimer />
    </div>
  );
}
