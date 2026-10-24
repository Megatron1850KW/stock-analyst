import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Fila de formulario estilo Ajustes de macOS: etiqueta y ayuda a la izquierda, control a la derecha. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,300px)] items-start gap-6 border-t border-border py-3.5 first:border-t-0", className)}>
      <div className="pt-1.5">
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</p>}
      </div>
      <div>
        {children}
        {error && (
          <p role="alert" className="mt-1 text-[12px] text-negative-text">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
