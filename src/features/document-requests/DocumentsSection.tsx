import { ExternalLink, FileText, FolderOpen, Inbox, Sparkles, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocumentRequestRow, FactRow, FilingRow } from "@/db/repo";
import { BudgetExceededError } from "@/features/ai/budget";
import { formatDate, formatNumber } from "@/lib/format";
import { formLabel } from "@/features/watchlist/ficha/format";
import { openDocument } from "@/platform/documents";
import { monthText } from "./missing";
import { useDeleteUpload, useDismissRequest, useReadUpload } from "./queries";
import { UploadPanel } from "./UploadPanel";

function RequestCard({ r, name, onUpload, onDismiss }: { r: DocumentRequestRow; name: string; onUpload: () => void; onDismiss: () => void }) {
  return (
    <li className="rounded-xl border border-warning/40 bg-warning/6 p-4">
      <p className="text-[13.5px] leading-relaxed">
        Necesito el <strong>{r.document_type}</strong> de <strong>{name}</strong>
        {r.expected_date && <>, publicado aprox. en <strong>{monthText(r.expected_date)}</strong></>}. Formato preferido: <strong>{r.preferred_format ?? "PDF"}</strong>.
      </p>
      {r.where_to_find && <p className="mt-1 text-[12.5px] break-words text-muted" data-selectable>Dónde suele estar: {r.where_to_find}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onUpload}>
          <Upload aria-hidden /> Subir este informe
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          No lo tengo
        </Button>
      </div>
    </li>
  );
}

/** Informes usados en la ficha, subidos por el usuario y pendientes de conseguir. */
export function DocumentsSection({
  securityId,
  name,
  filings,
  requests,
  facts = [],
}: {
  securityId: number;
  name: string;
  filings: FilingRow[];
  requests: DocumentRequestRow[];
  facts?: FactRow[];
}) {
  const read = useReadUpload(securityId);
  const factsBy = new Map<number, { n: number; pdf: boolean }>();
  for (const f of facts) {
    const prev = factsBy.get(f.filing_id) ?? { n: 0, pdf: false };
    factsBy.set(f.filing_id, { n: prev.n + 1, pdf: prev.pdf || f.origin === "pdf-extraction" });
  }
  function readFiling(f: FilingRow, force = false) {
    read.mutate(
      { filing: f, force },
      {
        onError: (e) => {
          if (e instanceof BudgetExceededError && window.confirm(`${e.message} ¿Quieres leerlo de todos modos?`)) {
            read.mutate({ filing: f, force, allowOverBudget: true });
          }
        },
      },
    );
  }
  const [uploading, setUploading] = useState<{ request: DocumentRequestRow | null } | null>(null);
  const del = useDeleteUpload(securityId);
  const dismiss = useDismissRequest(securityId);
  const pending = requests.filter((r) => r.status === "pending");
  const uploads = filings.filter((f) => f.role === "upload");
  const core = filings.filter((f) => f.role === "core");
  const history = filings.filter((f) => f.role === "history");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-[13px] text-muted">
          La ficha usa {core.length} informes oficiales recientes ({core.some((f) => f.source === "filings.xbrl.org") ? "ESEF" : "SEC"}) y {history.length} anuales anteriores para la historia. Si falta alguno o no encuentra sus cifras,
          puedes subirlo tú.
        </p>
        {!uploading && (
          <Button variant="secondary" onClick={() => setUploading({ request: null })}>
            <Upload aria-hidden /> Subir informe
          </Button>
        )}
      </div>

      {uploading && <UploadPanel securityId={securityId} request={uploading.request} onClose={() => setUploading(null)} />}

      {pending.length > 0 && (
        <section aria-label="Documentos pendientes">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <Inbox className="size-4 text-warning-text" aria-hidden /> Documentos pendientes <Badge tone="warning">{pending.length}</Badge>
          </h3>
          <ul className="space-y-2">
            {pending.map((r) => (
              <RequestCard key={r.id} r={r} name={name} onUpload={() => setUploading({ request: r })} onDismiss={() => dismiss.mutate(r.id)} />
            ))}
          </ul>
        </section>
      )}

      {read.error && !(read.error instanceof BudgetExceededError) && (
        <p role="alert" className="text-[12.5px] text-negative-text">{read.error.message}</p>
      )}
      {read.data?.notes.map((n) => (
        <p key={n} className="text-[12.5px] text-muted">{n}</p>
      ))}
      {uploads.length > 0 && (
        <section aria-label="Informes subidos">
          <h3 className="mb-2 text-[13px] font-semibold">Informes subidos por ti</h3>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
            {uploads.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <FileText className="size-4 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{f.original_name ?? f.form_type}</p>
                  <p className="text-[11.5px] text-muted">
                    {formLabel(f.form_type)} · cierre {formatDate(f.period_end)}
                    {f.bytes ? ` · ${formatNumber(f.bytes / 1024 / 1024, 1)} MB` : ""} ·{" "}
                    {factsBy.get(f.id)
                      ? `${factsBy.get(f.id)!.n} cifras leídas${factsBy.get(f.id)!.pdf ? " por la IA (con su página)" : " del ESEF"}`
                      : "cifras sin leer"}
                  </p>
                </div>
                {!factsBy.get(f.id) && f.local_path && (
                  <Button size="sm" variant="secondary" disabled={read.isPending} onClick={() => readFiling(f)}>
                    <Sparkles aria-hidden />
                    {read.isPending && read.variables?.filing.id === f.id ? "Leyendo…" : f.local_path.toLowerCase().endsWith(".zip") ? "Leer cifras" : "Leer cifras con IA"}
                  </Button>
                )}
                {f.local_path && (
                  <Button size="sm" variant="ghost" onClick={() => void openDocument(f.local_path!)}>
                    <FolderOpen aria-hidden /> Abrir
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`Borrar ${f.original_name ?? "informe"}`}
                  onClick={() => {
                    if (window.confirm("¿Borrar este informe de tu Mac?")) del.mutate(f.id);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-[12.5px]">
        <summary className="cursor-pointer text-muted hover:text-text">Ver los informes oficiales que se usan ({core.length + history.length})</summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {[...core, ...history].map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent-text">
                {formLabel(f.form_type)} · cierre {formatDate(f.period_end)} <ExternalLink className="size-3" aria-hidden />
              </a>
              {f.role === "history" && <Badge>historia</Badge>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
