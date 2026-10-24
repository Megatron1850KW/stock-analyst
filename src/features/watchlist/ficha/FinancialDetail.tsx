import type { Fundamentals, Metric, YearFundamentals } from "@/domain/fundamentals/metrics";
import { cn } from "@/lib/cn";
import type { Analysis } from "../analysis";
import { inputAsMetric, MetricValue } from "./MetricValue";

interface Row {
  label: string;
  hint?: string;
  pick: (f: Fundamentals) => Metric;
  pickYear?: (y: YearFundamentals) => Metric;
  strong?: boolean;
}

const ROWS: { group: string; rows: Row[] }[] = [
  {
    group: "Crecimiento",
    rows: [
      { label: "Ventas", pick: (f) => inputAsMetric(f.revenue, "Ventas"), strong: true },
      { label: "Crecimiento de ventas", pick: () => none, pickYear: (y) => y.revenueGrowth },
      { label: "Beneficio neto", pick: (f) => inputAsMetric(f.netIncome, "Beneficio neto"), strong: true },
      { label: "Crecimiento del beneficio", pick: () => none, pickYear: (y) => y.netIncomeGrowth },
    ],
  },
  {
    group: "Márgenes",
    rows: [
      { label: "Margen bruto", hint: "Lo que queda de cada venta tras pagar lo que cuesta fabricar o dar el servicio.", pick: (f) => f.grossMargin },
      { label: "Margen operativo", hint: "Lo que queda tras todos los gastos del negocio, antes de intereses e impuestos.", pick: (f) => f.operatingMargin },
      { label: "Margen neto", hint: "Lo que queda al final para el accionista.", pick: (f) => f.netMargin },
    ],
  },
  {
    group: "Caja",
    rows: [
      { label: "Caja de las operaciones", pick: (f) => inputAsMetric(f.operatingCashFlow, "Caja de las operaciones") },
      { label: "Inversión (capex)", pick: (f) => inputAsMetric(f.capex, "Inversión (capex)") },
      { label: "Caja libre", pick: (f) => f.freeCashFlow, strong: true },
      { label: "Conversión del beneficio en caja", hint: "Caja libre por cada euro de beneficio. Cerca o por encima de 100 % es sano.", pick: (f) => f.cashConversion },
    ],
  },
  {
    group: "Deuda",
    rows: [
      { label: "Deuda financiera", pick: (f) => f.grossDebt },
      { label: "Caja e inversiones a corto", pick: (f) => f.cash },
      { label: "Deuda neta", hint: "Negativa = tiene más caja que deuda.", pick: (f) => f.netDebt, strong: true },
      { label: "Años para pagarla con su caja libre", pick: (f) => f.debtYears },
    ],
  },
];

const none: Metric = { label: "", kind: "percent", value: null, formula: "", inputs: [] };

/** Detalle financiero determinista: ejercicios completos + últimos doce meses. */
export function FinancialDetail({ a }: { a: Analysis }) {
  const years = a.years.slice(-6);
  const unit = a.current.revenue?.unit;
  const ttmEnd = a.current.revenue?.sources.map((x) => x.periodEnd).sort().at(-1);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-raised">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead className="bg-surface text-[12px] text-muted">
          <tr>
            <th className="sticky left-0 bg-surface px-5 py-2.5 text-left font-medium">Ejercicio</th>
            {years.map((y) => (
              <th key={y.periodEnd} className="px-3 py-2.5 text-right font-medium">
                {y.periodEnd.slice(0, 4)}
              </th>
            ))}
            <th className="border-l border-border px-3 py-2.5 text-right font-medium text-text">
              Últimos 12 meses
              {ttmEnd && <span className="block text-[10.5px] font-normal text-muted">hasta {ttmEnd.slice(0, 7)}</span>}
            </th>
          </tr>
        </thead>
        {ROWS.map((g) => (
          <tbody key={g.group}>
            <tr>
              <th colSpan={years.length + 2} className="border-t border-border bg-bg px-5 pt-4 pb-1.5 text-left font-serif text-[14px] font-semibold">
                {g.group}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.label} className="border-t border-border/60">
                <td className="sticky left-0 bg-surface-raised px-5 py-2">
                  <span className={cn(r.strong && "font-medium")}>{r.label}</span>
                  {r.hint && <span className="block max-w-[260px] text-[11px] leading-snug text-muted">{r.hint}</span>}
                </td>
                {years.map((y) => {
                  const m = r.pickYear ? r.pickYear(y) : r.pick(y);
                  return (
                    <td key={y.periodEnd} className="px-3 py-2 text-right whitespace-nowrap">
                      <MetricValue metric={m} unit={unit} />
                    </td>
                  );
                })}
                <td className={cn("border-l border-border px-3 py-2 text-right whitespace-nowrap", r.strong && "font-medium")}>
                  {r.pickYear ? <span className="text-muted/70">—</span> : <MetricValue metric={r.pick(a.current)} unit={unit} />}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
