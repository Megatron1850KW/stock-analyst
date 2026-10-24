import { FileUp, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { DocumentRequestRow } from "@/db/repo";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ACCEPTED_FILES } from "@/platform/documents";
import { useUploadDocument } from "./queries";
import { UPLOAD_KINDS, type UploadKind } from "./upload";

const MAX_MB = 250;

function guessKind(r: DocumentRequestRow | null): UploadKind {
  if (!r) return "annual";
  if (/semestral/i.test(r.document_type)) return "half";
  if (/10-Q|trimestral/i.test(r.document_type)) return "quarter";
  return /10-K|20-F|anual/i.test(r.document_type) ? "annual" : "other";
}

/**
 * Subida de un informe: arrastrar y soltar o elegir archivo, qué periodo cubre
 * y listo. Se guarda en el Mac; la lectura de sus cifras llega con la IA.
 */
export function UploadPanel({ securityId, request, onClose }: { securityId: number; request: DocumentRequestRow | null; onClose: () => void }) {
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<UploadKind>(guessKind(request));
  const [periodEnd, setPeriodEnd] = useState(request?.period ?? "");
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useUploadDocument(securityId);

  function pick(f: File | undefined) {
    setLocalError(null);
    if (!f) return;
    if (!/\.(pdf|zip)$/i.test(f.name)) return setLocalError("Solo PDF o ZIP (paquete ESEF).");
    if (f.size > MAX_MB * 1024 * 1024) return setLocalError(`El archivo pasa de ${MAX_MB} MB.`);
    setFile(f);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  }
  const error = localError ?? (upload.error ? (upload.error instanceof Error ? upload.error.message : String(upload.error)) : null);

  return (
    <div className="rounded-[var(--radius-card)] border border-accent/40 bg-surface-raised p-5" role="region" aria-label="Subir informe">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-[16px] font-semibold">{request ? `Subir: ${request.document_type}` : "Subir un informe"}</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            PDF del informe o paquete ESEF (.zip). Se guarda solo en tu Mac. La lectura de sus cifras se hará con la IA cuando la activemos (fase 4).
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
          <X aria-hidden />
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors duration-150",
          dragging ? "border-accent bg-accent/8" : "border-border bg-bg",
        )}
      >
        <FileUp className="size-6 text-accent" aria-hidden />
        {file ? (
          <p className="text-[13px]">
            <span className="font-medium">{file.name}</span> <span className="text-muted">· {formatNumber(file.size / 1024 / 1024, 1)} MB</span>
          </p>
        ) : (
          <p className="text-[13px] text-muted">Arrastra aquí el archivo</p>
        )}
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          {file ? "Elegir otro" : "Elegir archivo…"}
        </Button>
        <input ref={inputRef} type="file" accept={ACCEPTED_FILES} className="sr-only" aria-label="Archivo del informe" onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[12.5px]" htmlFor={`${ids}-kind`}>
          <span className="mb-1 block text-muted">Tipo de informe</span>
          <Select id={`${ids}-kind`} value={kind} onChange={(e) => setKind(e.target.value as UploadKind)}>
            {UPLOAD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[12.5px]" htmlFor={`${ids}-end`}>
          <span className="mb-1 block text-muted">Cierre del periodo que cubre</span>
          <Input id={`${ids}-end`} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-negative-text">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={!file || !periodEnd || upload.isPending}
          onClick={() =>
            file && upload.mutate({ form: { securityId, kind, periodEnd, requestId: request?.id ?? null }, file }, { onSuccess: onClose })
          }
        >
          {upload.isPending ? "Guardando…" : "Guardar informe"}
        </Button>
      </div>
    </div>
  );
}
