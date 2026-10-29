import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

/**
 * Confirmación dentro de la app. Sustituye a window.confirm, que el WebView de
 * macOS en Tauri no muestra y devuelve siempre «no».
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} className="w-[min(440px,calc(100vw-32px))]">
      {error && <p role="alert" className="mb-3 text-[13px] text-negative-text">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" className="bg-negative text-white hover:bg-negative/90" disabled={pending} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
