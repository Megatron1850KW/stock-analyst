import { ExternalLink as ExternalIcon, FileText, FolderOpen, Inbox, Sparkles, Trash2, Upload } from "lucide-react";
import { ExternalLink } from "@/components/ui/external-link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { DocumentRequestRow, FactRow, FilingRow } from "@/db/repo";
import { BudgetExceededError } from "@/features/ai/budget";
import { formatDate, formatNumber } from "@/lib/format";
import { formLabel } from "@/features/watchlist/ficha/format";
import { ClaudeAiSteps } from "@/features/ai/ManualAnalysisPanel";
import { useSettings } from "@/features/settings/queries";
import { openDocument, revealDocument } from "@/platform/documents";
import { monthText } from "./missing";
import { useDeleteUpload, useDismissRequest, useManualPdfPrompt, useReadUpload, useSaveManualPdf } from "./queries";
import { UploadPanel } from "./UploadPanel";

/** Las direcciones web de la solicitud se pueden pulsar (se abren en tu navegador). */
function Linkified({ text }: { text: string }) {
  return text.split(/(https:\/\/[^\s)]+)/).map((part, i) =>
    i % 2 ? <ExternalLink key={i} href={part} className="underline underline-offset-2 hover:text-accent-text">{part}</ExternalLink> : part,
  );
}

function RequestCard({ r, name, onUpload, onDismiss }: { r: DocumentRequestRow; name: string; onUpload: () => void; onDismiss: () => void }) {
  return (
    <li className="rounded-xl border border-warning/40 bg-warning/6 p-4">
      <p className="text-[13.5px] leading-relaxed">
        Necesito el <strong>{r.document_type}</strong> de <strong>{name}</strong>
        {r.expected_date && <>, publicado aprox. en <strong>{monthText(r.expected_date)}</strong></>}. Formato preferido: <strong>{r.preferred_format ?? "PDF"}</strong>.
      </p>
      {r.where_to_find && <p className="mt-1 text-[12.5px] break-words text-muted" data-selectable>Dónde suele estar: <Linkified text={r.where_to_find} /></p>}
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

/** Un ZIP ESEF se lee sin IA ni coste: se puede volver a leer cuando mejora la lectura. */
const isZip = (f: { local_path: string | null }) => !!f.local_path?.toLowerCase().endsWith(".zip");

/** Modo manual: cifras de un PDF con claude.ai (adjuntando el PDF) y pegando la respuesta. */
function ManualPdfPanel({ securityId, filing, onDone }: { securityId: number; filing: FilingRow; onDone: () => void }) {
  const prompt = useManualPdfPrompt(securityId);
  const save = useSaveManualPdf(securityId);
  const { mutate } = prompt;
  useEffect(() => mutate(filing.id), [mutate, filing.id]);
  if (prompt.error) return <p role="alert" className="text-[12.5px] text-negative-text">{prompt.error.message}</p>;
  if (!prompt.data) return <div className="h-24 animate-pulse rounded-xl bg-surface" aria-busy />;
  return (
    <ClaudeAiSteps
      label={`Leer ${filing.original_name ?? "PDF"} con Claude.ai`}
      text={prompt.data}
      textHint="Lleva las instrucciones y la lista de cifras que necesita la app."
      attach={
        <p className="mt-1 text-[12.5px]">
          Adjunta el PDF con el botón <strong>+</strong> de claude.ai o arrastrándolo.{" "}
          <button type="button" className="text-accent-text hover:underline" onClick={() => filing.local_path && void revealDocument(filing.local_path)}>
            Mostrar el PDF en el Finder
          </button>
          . Si tiene cientos de páginas, puede que el plan gratuito no lo lea entero: en ese caso, guarda solo las páginas de los estados financieros.
        </p>
      }
      saving={save.isPending}
      error={save.error}
      onSave={(answer) => save.mutate({ filingId: filing.id, answer }, { onSuccess: onDone })}
      onCancel={onDone}
    />
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
          if (e instanceof BudgetExceededError) setOverBudget({ filing: f, force, message: e.message });
        },
      },
    );
  }
  const [overBudget, setOverBudget] = useState<{ filing: FilingRow; force: boolean; message: string } | null>(null);
  const [toDelete, setToDelete] = useState<FilingRow | null>(null);
  const [uploading, setUploading] = useState<{ request: DocumentRequestRow | null } | null>(null);
  const [manualPdf, setManualPdf] = useState<number | null>(null);
  const aiMode = useSettings().data?.aiMode ?? "manual";
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
                {!isZip(f) && aiMode === "manual" && f.local_path && (
                  <Button size="sm" variant="secondary" disabled={manualPdf === f.id} onClick={() => setManualPdf(f.id)}>
                    <Sparkles aria-hidden /> {factsBy.get(f.id) ? "Volver a leer con Claude.ai" : "Leer con Claude.ai"}
                  </Button>
                )}
                {(isZip(f) || (!factsBy.get(f.id) && aiMode === "api")) && f.local_path && (
                  <Button size="sm" variant="secondary" disabled={read.isPending} onClick={() => readFiling(f, !!factsBy.get(f.id))}>
                    <Sparkles aria-hidden />
                    {read.isPending && read.variables?.filing.id === f.id
                      ? "Leyendo…"
                      : isZip(f)
                        ? factsBy.get(f.id) ? "Volver a leer" : "Leer cifras"
                        : "Leer cifras con IA"}
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
                  onClick={() => setToDelete(f)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          {manualPdf !== null &&
            (() => {
              const f = uploads.find((u) => u.id === manualPdf);
              return f ? (
                <div className="mt-3">
                  <ManualPdfPanel key={f.id} securityId={securityId} filing={f} onDone={() => setManualPdf(null)} />
                </div>
              ) : null;
            })()}
        </section>
      )}

      <details className="text-[12.5px]">
        <summary className="cursor-pointer text-muted hover:text-text">Ver los informes oficiales que se usan ({core.length + history.length})</summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {[...core, ...history].map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <ExternalLink href={f.url ?? undefined} className="inline-flex items-center gap-1 hover:text-accent-text">
                {formLabel(f.form_type)} · cierre {formatDate(f.period_end)} <ExternalIcon className="size-3" aria-hidden />
              </ExternalLink>
              {f.role === "history" && <Badge>historia</Badge>}
            </li>
          ))}
        </ul>
      </details>

      <ConfirmDialog
        open={toDelete !== null}
        title="¿Borrar este informe de tu Mac?"
        description={toDelete?.original_name ?? undefined}
        confirmLabel="Borrar"
        pending={del.isPending}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSettled: () => setToDelete(null) })}
      />
      <ConfirmDialog
        open={overBudget !== null}
        title="Presupuesto de IA superado"
        description={overBudget ? `${overBudget.message} ¿Quieres leerlo de todos modos?` : undefined}
        confirmLabel="Leer de todos modos"
        onClose={() => setOverBudget(null)}
        onConfirm={() => {
          if (overBudget) read.mutate({ filing: overBudget.filing, force: overBudget.force, allowOverBudget: true });
          setOverBudget(null);
        }}
      />
    </div>
  );
}
