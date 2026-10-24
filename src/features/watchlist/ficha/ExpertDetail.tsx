import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Metric } from "@/domain/fundamentals/metrics";
import { VALUATION_CONFIG } from "@/domain/scoring/config";
import { MULTIPLES } from "@/domain/valuation/multiples";
import { formatNumber, formatPercent, SIN_DATO } from "@/lib/format";
import type { Analysis } from "../analysis";
import { MetricValue } from "./MetricValue";

interface ExpertRow {
  technical: string;
  plain: string;
  metric: Metric | null;
  /** Formato propio (múltiplos sin «años»). */
  render?: (m: Metric) => string;
}

const times = (m: Metric) => (m.value === null ? SIN_DATO : `${formatNumber(m.value, 1)}×`);

/** Ratios técnicos con su nombre y explicación (§6: solo en esta sección plegable). */
export function ExpertDetail({ a, children }: { a: Analysis; children?: ReactNode }) {
  const m = a.multiples;
  const f = a.current;
  const rows: ExpertRow[] = [
    { technical: MULTIPLES.pe.technical, plain: MULTIPLES.pe.plain, metric: m?.pe ?? null, render: times },
    { technical: MULTIPLES.pfcf.technical, plain: MULTIPLES.pfcf.plain, metric: m?.pfcf ?? null, render: times },
    { technical: MULTIPLES.evEbit.technical, plain: MULTIPLES.evEbit.plain, metric: m?.evEbit ?? null, render: times },
    { technical: "FCF yield", plain: "Caja libre de 12 meses entre lo que vale la empresa en bolsa.", metric: m?.fcfYield ?? null },
    { technical: "Capitalización", plain: "Precio por acción × acciones diluidas.", metric: m?.marketCap ?? null },
    { technical: "Deuda neta / FCF", plain: "Años de caja libre para devolver la deuda neta.", metric: f.debtYears },
    { technical: "Margen bruto · operativo (EBIT) · neto", plain: "Últimos 12 meses.", metric: null },
    { technical: "Conversión de caja (FCF / beneficio neto)", plain: "Calidad del beneficio: cuánto se convierte en caja.", metric: f.cashConversion },
  ];
  const v = a.valuation;
  return (
    <details className="group rounded-[var(--radius-card)] border border-border bg-surface-raised">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-serif text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted transition-transform duration-150 group-open:rotate-90" aria-hidden />
        Detalle para expertos
        <span className="font-sans text-[12px] font-normal text-muted">ratios técnicos, puntuación y cifras de la SEC</span>
      </summary>
      <div className="space-y-6 border-t border-border px-5 pt-4 pb-6">
        <table className="w-full text-[13px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.technical} className="border-t border-border/60 first:border-t-0">
                <td className="py-2 pr-4 align-top">
                  <span className="font-medium">{r.technical}</span>
                  <span className="block text-[11.5px] text-muted">{r.plain}</span>
                </td>
                <td className="py-2 text-right align-top whitespace-nowrap">
                  {r.metric ? (
                    <MetricValue metric={r.metric}>{r.render ? r.render(r.metric) : undefined}</MetricValue>
                  ) : (
                    <span className="tabular">
                      <MetricValue metric={f.grossMargin} /> · <MetricValue metric={f.operatingMargin} /> · <MetricValue metric={f.netMargin} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {v && (
          <div className="rounded-xl bg-surface p-4 text-[12.5px] leading-relaxed">
            <p className="font-medium">Puntuación de valoración: {v.score ?? SIN_DATO}/100</p>
            <p className="text-muted">
              {formatPercent(VALUATION_CONFIG.weights.multiples, 0)} múltiplos frente a su historia ({v.parts.multiples ?? SIN_DATO}/100: desviación típica (mediana entre múltiplos){" "}
              {v.deviation === null ? SIN_DATO : formatPercent(v.deviation, 1)}, ±{formatPercent(VALUATION_CONFIG.fullScaleDeviation, 0)} lleva a 0 o 100) y{" "}
              {formatPercent(VALUATION_CONFIG.weights.priceRange, 0)} posición del precio en su rango de 10 años ({v.parts.priceRange ?? SIN_DATO}/100). Barata por debajo de{" "}
              {formatPercent(VALUATION_CONFIG.cheapBelow, 0)}, cara por encima de +{formatPercent(VALUATION_CONFIG.expensiveAbove, 0)}.
            </p>
          </div>
        )}
        {children}
      </div>
    </details>
  );
}
