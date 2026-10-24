import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { MULTIPLES, type MultipleId } from "@/domain/valuation/multiples";
import { formatDate, formatNumber, SIN_DATO } from "@/lib/format";
import type { Analysis } from "../analysis";
import { currencySymbol, signedPercent } from "./format";
import { MetricValue } from "./MetricValue";

const axisTick = { fontSize: 11, fill: "var(--text-muted)" };

function Tip({ active, payload, label, word }: { active?: boolean; payload?: { value: number }[]; label?: string; word: string }) {
  if (!active || !payload?.length || payload[0]!.value == null) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]">
      <p className="font-medium">{label ? formatDate(label).replace(/^\d+ /, "") : ""}</p>
      <p className="tabular">
        {formatNumber(payload[0]!.value, 1)} años de {word}
      </p>
    </div>
  );
}

/** Múltiplo elegido para el gráfico: el primero con historia suficiente. */
export function chartMultiple(a: Analysis): MultipleId | null {
  return a.valuation?.comparisons.find((c) => c.fiveYears.points > 0 && c.current !== null)?.id ?? null;
}

/** Valoración frente a su propia historia (§5.1.4): múltiplos y precio vs. rango histórico. */
export function ValuationHistory({ a }: { a: Analysis }) {
  const v = a.valuation;
  const id = chartMultiple(a);
  if (!v || !a.multiples) {
    return <p className="text-[13px] text-muted">Hace falta el histórico de precios para comparar con su historia. Se descarga al añadir el valor si hay proveedor de precios en Ajustes.</p>;
  }
  const word = id ? MULTIPLES[id].label.replace(/^Años de /, "") : "";
  const cmp = id ? v.comparisons.find((c) => c.id === id)! : null;
  const data = id ? a.history.map((p) => ({ date: p.date, value: p[id] })) : [];
  // Una marca por año (enero), sin repetir
  const yearTicks = data.filter((d) => d.date.slice(5, 7) === "01").map((d) => d.date);
  const range = v.range10 ?? v.range5;
  const sym = currencySymbol(a.price?.currency ?? "USD");
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5">
        <h3 className="font-serif text-[15px] font-semibold">{id ? `${MULTIPLES[id].label}, mes a mes` : "Sin serie histórica"}</h3>
        {id && <p className="mt-0.5 text-[12px] text-muted">{MULTIPLES[id].plain} Cada mes usa el último informe anual publicado entonces.</p>}
        {id && (
          <div className="mt-3 h-[200px]" role="img" aria-label={`Evolución de ${MULTIPLES[id].label}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} ticks={yearTicks} tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={24} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} domain={[0, "auto"]} />
                <ChartTooltip cursor={{ stroke: "var(--chart-grid)" }} content={<Tip word={word} />} />
                {cmp?.fiveYears.median != null && (
                  <ReferenceLine y={cmp.fiveYears.median} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: `Media 5 años: ${formatNumber(cmp.fiveYears.median, 0)}`, position: "insideTopLeft", fontSize: 11, fill: "var(--text-muted)" }} />
                )}
                {cmp?.current != null && (
                  <ReferenceLine y={cmp.current} stroke="var(--chart-1)" strokeDasharray="2 3" label={{ value: `Hoy: ${formatNumber(cmp.current, 0)}`, position: "insideBottomRight", fontSize: 11, fill: "var(--text)" }} />
                )}
                <Line dataKey="value" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <table className="w-full text-[13px]">
          <thead className="text-[11.5px] text-muted">
            <tr>
              <th className="pb-1.5 text-left font-medium" />
              <th className="pb-1.5 text-right font-medium">Hoy</th>
              <th className="pb-1.5 text-right font-medium">Media 5 años</th>
              <th className="pb-1.5 text-right font-medium">Media 10 años</th>
            </tr>
          </thead>
          <tbody>
            {v.comparisons.map((c) => (
              <tr key={c.id} className="border-t border-border/60">
                <td className="py-2 pr-2">{MULTIPLES[c.id].label}</td>
                <td className="py-2 text-right">
                  <MetricValue metric={a.multiples![c.id]}>{c.current === null ? SIN_DATO : formatNumber(c.current, 1)}</MetricValue>
                </td>
                <td className="py-2 text-right tabular">
                  {c.fiveYears.median === null ? <span className="text-muted/80">{SIN_DATO}</span> : formatNumber(c.fiveYears.median, 1)}
                  {c.deviation5 !== null && <span className="block text-[11px] text-muted">{signedPercent(c.deviation5)}</span>}
                </td>
                <td className="py-2 text-right tabular">
                  {c.tenYears.median === null ? <span className="text-muted/80">{SIN_DATO}</span> : formatNumber(c.tenYears.median, 1)}
                  {c.deviation10 !== null && <span className="block text-[11px] text-muted">{signedPercent(c.deviation10)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11.5px] leading-relaxed text-muted">
          Medianas mensuales; hacen falta al menos 24 meses con dato (5 años) o 60 (10 años). Un múltiplo con pérdidas o caja negativa no cuenta.
        </p>
        {range && a.price && (
          <div>
            <p className="text-[13px]">
              Precio hoy frente a sus últimos {range.months / 12} años
            </p>
            <div className="relative mt-3 h-2 rounded-full bg-surface" role="img" aria-label={`El precio está al ${Math.round(range.position * 100)} % de su rango`}>
              <div className="absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-full bg-text ring-2 ring-surface-raised" style={{ left: `${range.position * 100}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11.5px] tabular text-muted">
              <span>Mín. {formatNumber(range.min, 2)} {sym}</span>
              <span className="text-text">Hoy {formatNumber(a.price.value, 2)} {sym}</span>
              <span>Máx. {formatNumber(range.max, 2)} {sym}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
