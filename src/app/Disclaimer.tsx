export const DISCLAIMER = "Herramienta informativa, no constituye asesoramiento financiero.";

export function Disclaimer() {
  return (
    <footer className="shrink-0 border-t border-border px-10 py-2.5 text-[11px] text-muted">
      {DISCLAIMER}
    </footer>
  );
}
