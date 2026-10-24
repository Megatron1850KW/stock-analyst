import { Check, ClipboardCopy, ExternalLink as ExternalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { cn } from "@/lib/cn";
import { describeApiError, type PreparedAnalysis } from "./equity-analysis";
import { approxTokens } from "./manual";
import { useSaveManual } from "./queries";

const textareaClass =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed text-text placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent-text">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

/**
 * Modo «Claude.ai manual»: copiar el texto preparado, pegarlo en claude.ai y
 * pegar aquí la respuesta, que se valida antes de guardarla.
 */
export function ManualAnalysisPanel({ securityId, prepared, text, onDone }: { securityId: number; prepared: PreparedAnalysis; text: string; onDone: () => void }) {
  const source = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState("");
  const save = useSaveManual(securityId);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Respaldo: seleccionar el texto y copiarlo a la antigua
      source.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  };

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface px-4 py-4" aria-label="Análisis con Claude.ai">
      <ol className="space-y-4">
        <Step n={1} title={`Copia el texto preparado (≈ ${approxTokens(text).toLocaleString("es-ES")} tokens)`}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void copy()}>
              {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />} {copied ? "Copiado" : "Copiar texto"}
            </Button>
            <span className="text-[12px] text-muted">Lleva las instrucciones, las cifras calculadas y extractos de sus dos últimos informes.</span>
          </div>
          <textarea ref={source} readOnly value={text} aria-label="Texto para Claude" rows={3} className={cn(textareaClass, "mt-2 resize-none text-muted")} />
        </Step>
        <Step n={2} title="Pégalo en una conversación nueva de claude.ai">
          <ExternalLink href="https://claude.ai/new" className="inline-flex items-center gap-1 text-[13px] text-accent-text hover:underline">
            Abrir claude.ai <ExternalIcon className="size-3.5" aria-hidden />
          </ExternalLink>
          <p className="mt-1 text-[12px] text-muted">Vale el plan gratuito. Espera a que termine de responder y copia su respuesta entera con el botón «Copiar» de su mensaje.</p>
        </Step>
        <Step n={3} title="Pega aquí su respuesta">
          <textarea
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              save.reset();
            }}
            aria-label="Respuesta de Claude"
            placeholder='{"modelo_negocio": "…", …}'
            rows={6}
            className={textareaClass}
          />
          {save.error && (
            <p role="alert" className="mt-2 text-[12.5px] text-negative-text">
              {describeApiError(save.error)}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={!answer.trim() || save.isPending} onClick={() => save.mutate({ prepared, answer }, { onSuccess: onDone })}>
              Guardar análisis
            </Button>
            <Button size="sm" variant="ghost" onClick={onDone}>
              Cancelar
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] text-muted">La app comprueba que la respuesta tenga todos los apartados antes de guardarla. Si falta algo, te dice qué.</p>
        </Step>
      </ol>
    </div>
  );
}
