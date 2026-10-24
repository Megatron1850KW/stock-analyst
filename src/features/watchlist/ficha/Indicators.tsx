import { CircleAlert, CircleCheck, CircleMinus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, Cell, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import type { Metric } from "@/domain/fundamentals/metrics";
import { DEBT_CONFIG, VALUATION_CONFIG } from "@/domain/scoring/config";
import type { DebtLevel } from "@/domain/scoring/debt-level";
import type { Verdict } from "@/domain/scoring/valuation-score";
import { MULTIPLES } from "@/domain/valuation/multiples";
import { formatMillions, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Analysis } from "../analysis";
import { currencySymbol, formatKind, signedPercent } from "./format";
import { MetricValue } from "./MetricValue";

function IndicatorCard({ question, answer, children, footer }: { question: string; answer: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <h2 className="font-serif text-[18px] font-semibold tracking-tight">{question}</h2>
      <div className="mt-1.5 min-h-[44px] text-[13.5px] leading-relaxed text-text">{answer}</div>
      <div className="mt-4 flex-1">{children}</div>
      {footer && <div className="mt-3 text-[11.5px] leading-relaxed text-muted">{footer}</div>}
    </section>
  );
}

const TONE = { Barata: "positive", Justa: "warning", Cara: "negative", Baja: "positive", Moderada: "warning", Alta: "negative" } as const;
const ICON = { positive: CircleCheck, warning: CircleMinus, negative: CircleAlert } as const;

export function VerdictBadge({ value, className }: { value: Verdict | DebtLevel; className?: string }) {
  const tone = TONE[value];
  const Icon = ICON[tone];
  return (
    <Badge tone={tone} className={cn("text-[12px]", className)}>
      <Icon aria-hidden /> {value}
    </Badge>
  );
}

/* ---------- ¿Cara o barata? ---------- */

const GAUGE_RANGE = 0.5; // la aguja llega al tope con ±50 % frente a su historia

function Gauge({ deviation, verdict }: { deviation: number | null; verdict: Verdict | null }) {
  const r = 80;
  const cx = 100;
  const cy = 92;
  const angle = (d: number) => Math.PI * (1 - (Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, d)) + GAUGE_RANGE) / (2 * GAUGE_RANGE));
  const point = (a: number, rad = r) => [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const;
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(angle(from));
    const [x2, y2] = point(angle(to));
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  // Pequeño hueco entre zonas
  const gap = 0.012;
  const zones = [
    { from: -GAUGE_RANGE, to: VALUATION_CONFIG.cheapBelow - gap, color: "var(--positive)", label: "Barata" },
    { from: VALUATION_CONFIG.cheapBelow + gap, to: VALUATION_CONFIG.expensiveAbove - gap, color: "var(--warning)", label: "Justa" },
    { from: VALUATION_CONFIG.expensiveAbove + gap, to: GAUGE_RANGE, color: "var(--negative)", label: "Cara" },
  ] as const;
  const needle = deviation === null ? null : point(angle(deviation), r - 18);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 104" className="w-full max-w-[240px]" role="img" aria-label={verdict ? `Termómetro de valoración: ${verdict}` : "Termómetro de valoración sin dato"}>
        {zones.map((z) => (
          <path key={z.label} d={arc(z.from, z.to)} stroke={z.color} strokeWidth={14} fill="none" strokeLinecap="butt" opacity={verdict && verdict !== z.label ? 0.35 : 1} />
        ))}
        {needle && (
          <>
            <line x1={cx} y1={cy} x2={needle[0]} y2={needle[1]} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={5} fill="var(--text)" stroke="var(--surface-raised)" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="mt-1 grid w-full max-w-[240px] grid-cols-3 text-center text-[11.5px]">
        {zones.map((z) => (
          <span key={z.label} className={verdict === z.label ? "font-semibold text-text" : "text-muted"}>
            {z.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const VERDICT_TEXT: Record<Verdict, string> = {
  Barata: "Está más barata que de costumbre.",
  Justa: "Está en su precio habitual.",
  Cara: "Está más cara que de costumbre.",
};

/** «18 años», «1 año», «0,6 años». */
export function yearsText(v: number): string {
  const n = formatNumber(v, v < 10 ? 1 : 0).replace(/,0$/, "");
  return `${n} ${n === "1" ? "año" : "años"}`;
}

export function ValuationIndicator({ a }: { a: Analysis }) {
  const v = a.valuation;
  // Se explica con el primer múltiplo que tenga valor actual y media de 5 (o 10) años
  // Se explica con el primer múltiplo que tenga valor actual y media de 5 (o 10) años
  const usable = v?.comparisons.filter((x) => x.current !== null && (x.fiveYears.median ?? x.tenYears.median) !== null) ?? [];
  const c = usable[0];
  // Si otro múltiplo apunta claramente en sentido contrario, se dice (no se esconde)
  const side = (d: number | null) => (d === null ? 0 : d < VALUATION_CONFIG.cheapBelow ? -1 : d > VALUATION_CONFIG.expensiveAbove ? 1 : 0);
  const contrary = c ? usable.slice(1).find((x) => side(x.deviation) !== 0 && side(x.deviation) === -side(c.deviation)) : undefined;
  const clause = (x: NonNullable<typeof c>) => {
    const m = a.multiples![x.id];
    const ref = x.fiveYears.median !== null ? { years: 5, value: x.fiveYears.median } : { years: 10, value: x.tenYears.median! };
    return (
      <>
        <MetricValue metric={m} className="font-semibold">
          {yearsText(m.value!)}
        </MetricValue>{" "}
        de {MULTIPLES[x.id].label.replace(/^Años de /, "")} (su media de {ref.years} años es{" "}
        <strong className="tabular">{formatNumber(ref.value, ref.value < 10 ? 1 : 0)}</strong>)
      </>
    );
  };
  let answer: ReactNode;
  if (!a.price) answer = <span className="text-muted">Sin precio todavía: añade la clave del proveedor de precios en Ajustes y pulsa ⌘R.</span>;
  else if (!v?.verdict || !c || !a.multiples) answer = <span className="text-muted">{v?.note ?? "Sin datos suficientes para valorarla."}</span>;
  else
    answer = (
      <>
        Hoy pagas {clause(c)}
        {contrary && <>, pero {clause(contrary)}</>}. {contrary ? `En conjunto, ${VERDICT_TEXT[v.verdict].charAt(0).toLowerCase()}${VERDICT_TEXT[v.verdict].slice(1)}` : VERDICT_TEXT[v.verdict]}
      </>
    );
  return (
    <IndicatorCard
      question="¿Cara o barata?"
      answer={answer}
      footer={
        v?.verdict ? (
          <>
            <VerdictBadge value={v.verdict} className="mr-1.5" /> Frente a su propia historia (umbral ±{formatNumber(VALUATION_CONFIG.expensiveAbove * 100, 0)} %). Puntuación {v.score}/100.
          </>
        ) : undefined
      }
    >
      <Gauge deviation={v?.deviation ?? null} verdict={v?.verdict ?? null} />
    </IndicatorCard>
  );
}

/* ---------- ¿Genera caja? ---------- */

function ChartTip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]">
      <p className="mb-0.5 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="tabular">
          <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: p.color }} aria-hidden />
          {p.name}: {formatMillions(p.value * 1e6, unit)}
        </p>
      ))}
    </div>
  );
}

const axisTick = { fontSize: 11, fill: "var(--text-muted)" };

export function CashIndicator({ a }: { a: Analysis }) {
  const unit = a.current.revenue?.unit ?? "USD";
  const data = a.years.slice(-10).map((y) => ({ year: y.periodEnd.slice(0, 4), fcf: y.freeCashFlow.value === null ? null : y.freeCashFlow.value / 1e6 }));
  const y = a.multiples?.fcfYield;
  const fcf = a.current.freeCashFlow;
  const sym = currencySymbol(a.price?.currency ?? unit);
  let answer: ReactNode;
  if (fcf.value !== null && fcf.value <= 0)
    answer = (
      <>
        Ahora mismo <strong>no genera caja libre</strong>: en los últimos doce meses gastó <MetricValue metric={fcf}>{formatMillions(-fcf.value, unit)}</MetricValue> más de lo que le dejó su negocio.
      </>
    );
  else if (y && y.value !== null)
    answer = (
      <>
        Por cada <strong>100 {sym}</strong> que pagas por la empresa, genera{" "}
        <MetricValue metric={y} className="font-semibold">
          {formatNumber(y.value * 100, 1)} {sym}
        </MetricValue>{" "}
        de caja libre al año.
      </>
    );
  else if (fcf.value !== null)
    answer = (
      <>
        En los últimos doce meses generó <MetricValue metric={fcf} className="font-semibold" /> de caja libre.
      </>
    );
  else answer = <span className="text-muted">{fcf.note ?? "Sin dato de caja libre."}</span>;
  return (
    <IndicatorCard question="¿Genera caja?" answer={answer} footer="Caja libre de cada ejercicio: lo que le queda tras pagar sus operaciones y sus inversiones.">
      <div className="h-[132px]" aria-label="Caja libre por año" role="img">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
            <XAxis dataKey="year" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval="preserveStartEnd" />
            <YAxis hide />
            <ChartTooltip cursor={{ fill: "var(--surface)" }} content={<ChartTip unit={unit} />} />
            <Bar dataKey="fcf" name="Caja libre" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.year} fill={d.fcf !== null && d.fcf < 0 ? "var(--negative)" : "var(--chart-1)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </IndicatorCard>
  );
}

/* ---------- ¿Tiene mucha deuda? ---------- */

const DEBT_SCALE = DEBT_CONFIG.highAboveYears * 1.5; // la barra llega hasta 6 años

export function DebtIndicator({ a }: { a: Analysis }) {
  const { debtYears, netDebt, freeCashFlow } = a.current;
  const unit = a.current.revenue?.unit ?? "USD";
  const level = a.debt;
  let answer: ReactNode;
  let marker: number | null = null;
  if (netDebt.value !== null && netDebt.value <= 0) {
    marker = 0;
    answer = (
      <>
        Tiene <strong>más caja que deuda</strong>: <MetricValue metric={netDebt}>{formatMillions(-netDebt.value, unit)}</MetricValue> de caja neta.
      </>
    );
  } else if (debtYears.value !== null) {
    marker = debtYears.value;
    answer = (
      <>
        Podría pagar toda su deuda en{" "}
        <MetricValue metric={debtYears} className="font-semibold">
          {formatKind(debtYears.value, "years")}
        </MetricValue>{" "}
        con la caja que genera.
      </>
    );
  } else if (level === "Alta") {
    marker = DEBT_SCALE;
    answer = (
      <>
        Debe <MetricValue metric={netDebt}>{formatMillions(netDebt.value!, unit)}</MetricValue> (neto) y ahora mismo no genera caja libre para pagarlo.
      </>
    );
  } else answer = <span className="text-muted">{debtYears.note ?? netDebt.note ?? freeCashFlow.note ?? "Sin dato de deuda."}</span>;

  const segments: { label: DebtLevel; from: number; to: number; color: string }[] = [
    { label: "Baja", from: 0, to: DEBT_CONFIG.lowBelowYears, color: "var(--positive)" },
    { label: "Moderada", from: DEBT_CONFIG.lowBelowYears, to: DEBT_CONFIG.highAboveYears, color: "var(--warning)" },
    { label: "Alta", from: DEBT_CONFIG.highAboveYears, to: DEBT_SCALE, color: "var(--negative)" },
  ];
  const pct = (x: number) => `${(Math.min(x, DEBT_SCALE) / DEBT_SCALE) * 100}%`;
  return (
    <IndicatorCard
      question="¿Tiene mucha deuda?"
      answer={answer}
      footer={
        level ? (
          <>
            <VerdictBadge value={level} className="mr-1.5" /> Años de caja libre para pagar la deuda neta: Baja &lt; {DEBT_CONFIG.lowBelowYears}, Alta &gt; {DEBT_CONFIG.highAboveYears}.
          </>
        ) : undefined
      }
    >
      <div className="pt-6" role="img" aria-label={level ? `Nivel de deuda: ${level}` : "Nivel de deuda sin dato"}>
        <div className="relative">
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
            {segments.map((s) => (
              <div key={s.label} style={{ width: pct(s.to - s.from), background: s.color, opacity: level && level !== s.label ? 0.35 : 1 }} />
            ))}
          </div>
          {marker !== null && (
            <div className="absolute -top-1.5 h-6 w-[3px] -translate-x-1/2 rounded-full bg-text ring-2 ring-surface-raised" style={{ left: `clamp(2px, ${pct(marker)}, calc(100% - 2px))` }} />
          )}
        </div>
        <div className="mt-2 flex text-[11.5px]">
          {segments.map((s) => (
            <span key={s.label} style={{ width: pct(s.to - s.from) }} className={level === s.label ? "font-semibold text-text" : "text-muted"}>
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </IndicatorCard>
  );
}

/* ---------- ¿Crece? ---------- */

function growthSentence(m: Metric, what: string, basis: "quarter" | "year"): ReactNode {
  if (m.value === null) return null;
  const when = basis === "quarter" ? "que hace un año (último trimestre)" : "que el año anterior";
  return (
    <>
      {what}{" "}
      <MetricValue metric={m} className="font-semibold">
        un {signedPercent(m.value).replace(/^[+−]/, "")} {m.value >= 0 ? "más" : "menos"}
      </MetricValue>{" "}
      {when}.
    </>
  );
}

export function GrowthIndicator({ a }: { a: Analysis }) {
  const unit = a.current.revenue?.unit ?? "USD";
  const data = a.years.slice(-10).map((y) => ({
    year: y.periodEnd.slice(0, 4),
    ventas: y.revenue ? y.revenue.value / 1e6 : null,
    beneficio: y.netIncome ? y.netIncome.value / 1e6 : null,
  }));
  const rev = growthSentence(a.growth.revenue, "Vende", a.growth.basis);
  const ni = growthSentence(a.growth.netIncome, "Gana", a.growth.basis);
  const up = (a.growth.revenue.value ?? 0) >= 0;
  return (
    <IndicatorCard
      question="¿Crece?"
      answer={rev ? <>{rev} {ni && <span className="text-muted">{ni}</span>}</> : <span className="text-muted">{a.growth.revenue.note ?? "Sin datos de ventas comparables."}</span>}
      footer={
        <span className="flex items-center gap-3">
          {up ? <TrendingUp className="size-3.5 text-positive-text" aria-hidden /> : <TrendingDown className="size-3.5 text-negative-text" aria-hidden />}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3 rounded bg-chart-1" aria-hidden /> Ventas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3 rounded bg-chart-2" aria-hidden /> Beneficio neto
          </span>
          <span>· por ejercicio</span>
        </span>
      }
    >
      <div className="h-[132px]" aria-label="Ventas y beneficio por año" role="img">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
            <XAxis dataKey="year" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} interval="preserveStartEnd" />
            <YAxis hide domain={["auto", "auto"]} />
            <ChartTooltip cursor={{ stroke: "var(--chart-grid)" }} content={<ChartTip unit={unit} />} />
            <Line dataKey="ventas" name="Ventas" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 0 }} activeDot={{ r: 4, stroke: "var(--surface-raised)", strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="beneficio" name="Beneficio neto" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 0 }} activeDot={{ r: 4, stroke: "var(--surface-raised)", strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </IndicatorCard>
  );
}
