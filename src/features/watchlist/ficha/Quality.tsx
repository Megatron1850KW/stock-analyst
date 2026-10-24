import { AlertTriangle, CircleCheck, CircleHelp } from "lucide-react";
import type { QualityScore } from "@/domain/scoring/quality-score";
import { cn } from "@/lib/cn";
import { SIN_DATO } from "@/lib/format";

/** Tono de una nota 0–100: verde desde 65, ámbar desde 40, rojo por debajo. */
export function qualityTone(score: number | null): "positive" | "warning" | "negative" | "neutral" {
  if (score === null) return "neutral";
  return score >= 65 ? "positive" : score >= 40 ? "warning" : "negative";
}

export const qualityWord = (score: number | null) => (score === null ? SIN_DATO : score >= 65 ? "Buena" : score >= 40 ? "Regular" : "Floja");

const BAR = { positive: "bg-positive", warning: "bg-warning", negative: "bg-negative", neutral: "bg-muted/40" } as const;
const TEXT = { positive: "text-positive-text", warning: "text-warning-text", negative: "text-negative-text", neutral: "text-muted" } as const;

/** Salud financiera (§8.2) con su desglose y las señales de trampa de valor (§8.3). */
export function QualitySection({ q }: { q: QualityScore }) {
  const tone = qualityTone(q.score);
  return (
    <div className="grid gap-6 rounded-[var(--radius-card)] border border-border bg-surface-raised p-6 shadow-card md:grid-cols-[200px_1fr_1fr]">
      <div>
        <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Nota de calidad</p>
        <p className={cn("mt-1 font-serif text-[44px] leading-none font-semibold tabular", TEXT[tone])}>
          {q.score === null ? "—" : Math.round(q.score)}
          <span className="text-[16px] text-muted">/100</span>
        </p>
        <p className={cn("mt-1 text-[13px] font-medium", TEXT[tone])}>{qualityWord(q.score)}</p>
        {q.note && <p className="mt-2 text-[12px] text-muted">{q.note}</p>}
      </div>

      <ul className="space-y-3" aria-label="Desglose de la nota">
        {q.parts.map((p) => {
          const t = qualityTone(p.score);
          return (
            <li key={p.id}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium">{p.label}</span>
                <span className="font-mono text-[11.5px] text-muted tabular">{p.score === null ? SIN_DATO : `${Math.round(p.score)}/100`}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface" aria-hidden>
                <div className={cn("h-full rounded-full", BAR[t])} style={{ width: `${p.score ?? 0}%` }} />
              </div>
              <p className="mt-1 text-[12px] leading-snug text-muted">{p.explanation}</p>
            </li>
          );
        })}
      </ul>

      <div>
        <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Señales de deterioro</p>
        <p className="mt-1 text-[12px] text-muted">Con 2 o más, una acción barata puede ser una trampa de valor.</p>
        <ul className="mt-3 space-y-2" aria-label="Señales de trampa de valor">
          {q.signals.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-[13px]">
              {s.active === null ? (
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              ) : s.active ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-negative-text" aria-hidden />
              ) : (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-positive-text" aria-hidden />
              )}
              <span>
                <span className={cn("font-medium", s.active && "text-negative-text")}>{s.label}</span>
                <span className="text-muted">: {s.active === null ? "sin datos para saberlo" : s.active ? "sí" : "no"}</span>
                {s.active && <span className="block text-[12px] text-muted">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
