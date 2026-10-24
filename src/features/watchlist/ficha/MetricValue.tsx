import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { Input, Metric } from "@/domain/fundamentals/metrics";
import type { Sourced } from "@/domain/fundamentals/statements";
import { formatDate, SIN_DATO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { formatInput, formatMetric } from "./format";

function sourceText(s: Sourced): string {
  const period = s.periodStart ? `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` : `a ${formatDate(s.periodEnd)}`;
  return `${s.filing.form_type} ${s.filing.accession_no}${s.fromComparative ? " (comparativa)" : ""} · ${period}`;
}

/** Desglose de un cálculo: fórmula, piezas con su documento y aclaraciones. */
export function MetricBreakdown({ metric }: { metric: Metric }) {
  return (
    <div className="space-y-1.5">
      <p className="font-medium">{metric.label}</p>
      {metric.formula && <p className="text-muted">{metric.formula}</p>}
      {metric.inputs.length > 0 && (
        <ul className="space-y-1">
          {metric.inputs.map((i: Input, k) => (
            <li key={k}>
              <span className="tabular">{formatInput(i)}</span> · {i.label}
              {i.sources.slice(0, 3).map((s, j) => (
                <span key={j} className="block font-mono text-[10.5px] text-muted">
                  {sourceText(s)}
                </span>
              ))}
              {i.note && <span className="block text-[11px] text-muted">{i.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {metric.note && <p className="text-[11px] text-muted">{metric.note}</p>}
      <p className="text-[10.5px] text-muted">Cálculo propio a partir de SEC EDGAR (XBRL).</p>
    </div>
  );
}

/** Cifra calculada con su origen al pasar el ratón o enfocarla (CLAUDE.md §2.2). */
export function MetricValue({ metric, children, className, unit }: { metric: Metric; children?: ReactNode; className?: string; unit?: string }) {
  const empty = metric.value === null;
  return (
    <Tooltip content={<MetricBreakdown metric={metric} />}>
      <span
        tabIndex={0}
        className={cn(
          "cursor-help tabular underline decoration-border decoration-dotted underline-offset-4",
          empty && "text-muted/80",
          className,
        )}
      >
        {children ?? (empty ? SIN_DATO : formatMetric(metric, unit))}
      </span>
    </Tooltip>
  );
}

/** Cifra oficial (sin cálculo) presentada como métrica para reutilizar el tooltip. */
export function inputAsMetric(i: Input | null, label: string, kind: Metric["kind"] = "money"): Metric {
  return i
    ? { label, kind, value: i.value, formula: i.note ?? "Cifra publicada", inputs: [i] }
    : { label, kind, value: null, formula: "", inputs: [], note: "No aparece en los informes." };
}
