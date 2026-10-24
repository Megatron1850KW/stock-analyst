import logoUrl from "@/assets/logo-animado.svg";
import { cn } from "@/lib/cn";

/** Logo con animación de bolsa (SVG local; se queda quieto con "reducir movimiento"). */
export function AnimatedLogo({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  return <img src={logoUrl} alt={decorative ? "" : "Stock Analisis"} className={cn("select-none", className)} draggable={false} />;
}
