import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Diálogo modal sobre el <dialog> nativo: atrapa el foco, cierra con Esc y lo
 * anuncia el lector de pantalla sin dependencias nuevas.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dialog-title"
      className={cn(
        "m-auto w-[min(560px,calc(100vw-32px))] rounded-[var(--radius-card)] border border-border bg-surface-raised p-0 text-text shadow-[0_24px_64px_-16px_rgba(0,0,0,0.35)] backdrop:bg-black/25",
        className,
      )}
    >
      {open && (
        <div className="px-6 pt-5 pb-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="font-serif text-[19px] font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-muted hover:bg-surface hover:text-text">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
