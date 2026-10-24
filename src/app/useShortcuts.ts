import { useEffect } from "react";
import { useNavigate } from "react-router";
import { SECTIONS, SETTINGS_SECTION } from "./sections";

/** ⌘1–⌘4 cambian de sección y ⌘, abre Ajustes (convención de macOS). */
export function useShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const target = [...SECTIONS, SETTINGS_SECTION].find((s) => s.shortcut === e.key);
      if (target) {
        e.preventDefault();
        navigate(target.path);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
