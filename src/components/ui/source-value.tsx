import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";

export interface SourceInfo {
  source: string;
  document?: string | null;
  documentUrl?: string | null;
  tag?: string | null;
  period?: string | null;
  fetchedAt?: string | null;
}

const fetchedFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });

/** Origen de una cifra (CLAUDE.md §2.2): fuente, documento, periodo y fecha de obtención. */
export function SourceDetails({ info }: { info: SourceInfo }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      <dt className="text-muted">Fuente</dt>
      <dd>{info.source}</dd>
      {info.document && (
        <>
          <dt className="text-muted">Documento</dt>
          <dd className="font-mono text-[11px]">{info.document}</dd>
        </>
      )}
      {info.tag && (
        <>
          <dt className="text-muted">Etiqueta</dt>
          <dd className="font-mono text-[11px] break-all">{info.tag}</dd>
        </>
      )}
      {info.period && (
        <>
          <dt className="text-muted">Periodo</dt>
          <dd>{info.period}</dd>
        </>
      )}
      {info.fetchedAt && (
        <>
          <dt className="text-muted">Obtenido</dt>
          <dd>{fetchedFmt.format(new Date(info.fetchedAt))}</dd>
        </>
      )}
    </dl>
  );
}

/** Una cifra con su origen al pasar el ratón o al enfocarla con el teclado. */
export function SourceValue({ info, children, className }: { info: SourceInfo; children: ReactNode; className?: string }) {
  return (
    <Tooltip content={<SourceDetails info={info} />}>
      <span tabIndex={0} className={`cursor-help underline decoration-border decoration-dotted underline-offset-4 ${className ?? ""}`}>
        {children}
      </span>
    </Tooltip>
  );
}
