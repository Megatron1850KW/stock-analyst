import { useEffect } from "react";
import { useNavigate } from "react-router";
import { SECTIONS, SETTINGS_SECTION } from "./sections";

const TARGETS = [...SECTIONS, SETTINGS_SECTION];

/** ⌘1–⌘4 abren cada columna, ⌘0 vuelve a la portada y ⌘, abre Ajustes (convención de macOS). */
export function useShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const target = TARGETS.find((s) => s.shortcut === e.key);
      if (e.key === "0") {
        e.preventDefault();
        navigate("/");
      } else if (target) {
        e.preventDefault();
        navigate(target.path);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
