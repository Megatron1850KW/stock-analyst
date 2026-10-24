import { useEffect } from "react";
import type { Settings } from "@/features/settings/schema";

/** Aplica el tema elegido en Ajustes; "system" sigue prefers-color-scheme. */
export function useTheme(theme: Settings["theme"] | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!theme || theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}
