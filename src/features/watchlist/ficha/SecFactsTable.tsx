import { ExternalLink as ExternalIcon } from "lucide-react";
import { ExternalLink } from "@/components/ui/external-link";
import { SourceValue } from "@/components/ui/source-value";
import { Tooltip } from "@/components/ui/tooltip";
import type { FactRow, FilingRow } from "@/db/repo";
import { CONCEPTS, type ConceptDef } from "@/domain/fundamentals/concepts";
import { ownPeriodFact } from "@/domain/fundamentals/period-value";
import { formatDate, formatMillions, formatMonthYear, formatNumber, SIN_DATO } from "@/lib/format";
import { formLabel, sourceLabel } from "./format";

/** Cifras tal como vienen en los informes oficiales (SEC o ESEF), sin cálculos. */
const GROUPS: { title: string; from: string }[] = [
  { title: "Cuenta de resultados", from: "revenue" },
  { title: "Flujo de caja", from: "operating_cash_flow" },
  { title: "Balance", from: "cash" },
  { title: "Acciones", from: "shares_outstanding" },
];

function formatFact(def: ConceptDef, f: FactRow): string {
  if (def.kind === "money") return formatMillions(f.value, f.unit);
  if (def.kind === "perShare") return `${formatNumber(f.value, 2)} ${f.unit.split("/")[0] === "USD" ? "$" : f.unit.split("/")[0]}`;
  return `${formatNumber(f.value / 1e6, 0)} M`;
}

function periodText(f: FactRow): string {
  return f.period_start ? `${formatDate(f.period_start)} – ${formatDate(f.period_end)}` : `A ${formatDate(f.period_end)}`;
}

export function SecFactsTable({ filings, facts }: { filings: FilingRow[]; facts: FactRow[] }) {
  const annual = filings.filter((f) => f.period_type === "annual");
  const cols = [...annual, ...filings.filter((f) => f.period_type === "interim")];
  // Línea que separa anuales de trimestrales
  const divider = (k: number) => (k > 0 && k === annual.length ? "border-l border-border" : "");
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead className="bg-surface text-[12px] text-muted">
          <tr>
            <th className="sticky left-0 bg-surface px-5 py-2.5 text-left font-medium">Concepto</th>
            {cols.map((f, k) => (
              <th
                key={f.id}
                className={`px-3 py-2.5 text-right font-medium whitespace-nowrap ${divider(k)}`}
              >
                <Tooltip
                  content={
                    <span>
                      {f.form_type} · cierre {formatDate(f.period_end)}
                      <br />
                      Presentado {f.filed_at ? formatDate(f.filed_at) : SIN_DATO}
                      <br />
                      <span className="font-mono text-[11px]">{f.accession_no}</span>
                    </span>
                  }
                >
                  <ExternalLink href={f.url ?? undefined} className="inline-flex items-center gap-1 hover:text-accent-text">
                    <span className="text-text">{f.form_type}</span> {formatMonthYear(f.period_end)}
                    <ExternalIcon className="size-3" aria-hidden />
                  </ExternalLink>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        {GROUPS.map((g, gi) => {
          const start = CONCEPTS.findIndex((c) => c.id === g.from);
          const end = gi + 1 < GROUPS.length ? CONCEPTS.findIndex((c) => c.id === GROUPS[gi + 1]!.from) : CONCEPTS.length;
          return (
            <tbody key={g.title}>
              <tr>
                <th colSpan={cols.length + 1} className="border-t border-border bg-bg px-5 pt-4 pb-1.5 text-left font-serif text-[14px] font-semibold">
                  {g.title}
                </th>
              </tr>
              {CONCEPTS.slice(start, end).map((def) => (
                <tr key={def.id} className="border-t border-border/60">
                  <td className="sticky left-0 bg-surface-raised px-5 py-2 whitespace-nowrap">{def.label}</td>
                  {cols.map((filing, k) => {
                    const own = ownPeriodFact(facts, filing, def.id);
                    return (
                      <td key={filing.id} className={`px-3 py-2 text-right tabular whitespace-nowrap ${divider(k)}`}>
                        {own ? (
                          <SourceValue
                            info={{
                              source: own.fact.page ? "Extraída de PDF por la IA (revísala si algo no cuadra)" : sourceLabel(filing.source),
                              document: own.fact.page ? `PDF subido por ti · página ${own.fact.page}` : `${formLabel(filing.form_type)} · ${filing.accession_no}`,
                              tag: own.fact.source_tag,
                              period: periodText(own.fact) + (own.cumulative ? " (acumulado del año)" : ""),
                              fetchedAt: own.fact.fetched_at,
                            }}
                          >
                            {formatFact(def, own.fact)}
                            {own.cumulative && <sup className="ml-0.5 text-muted">a</sup>}
                          </SourceValue>
                        ) : (
                          <span className="text-muted/70">{SIN_DATO}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
