import { Check, ClipboardCopy, Compass, ExternalLink as ExternalIcon, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import type { NextBuyRow } from "@/domain/portfolio/fund-next-buy";
import { NEXT_BUY_CONFIG, PORTFOLIO_CONFIG } from "@/domain/scoring/config";
import { approxTokens } from "@/features/ai/manual";
import { VerdictBadge } from "@/features/watchlist/ficha/Indicators";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { FundLine } from "./FundsTable";
import type { PortfolioView } from "./load";
import { buildFundNextBuyPrompt, fundNextBuy } from "./next-buy";

function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-muted">
      <span className="w-[122px] shrink-0">{label}</span>
      <span aria-hidden className="h-1.5 flex-1 rounded-full bg-surface">
        {value !== null && <span className="block h-full rounded-full bg-accent/70" style={{ width: `${value}%` }} />}
      </span>
      <span className="w-[42px] text-right font-mono tabular">{value !== null ? `${value}/100` : "—"}</span>
    </div>
  );
}

function PickCard({ r, rank }: { r: NextBuyRow; rank: number }) {
  const c = r.candidate;
  return (
    <article aria-label={`${rank}.º ${c.ticker}`} className={cn("flex flex-col rounded-xl border bg-surface-raised p-4", rank === 1 ? "border-accent/60" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-accent-text">{rank === 1 ? "Primera opción" : `${rank}.ª opción`}</p>
          <p className="mt-0.5 font-serif text-[18px] leading-tight font-semibold tracking-tight">{c.ticker}</p>
          <p className="truncate text-[12px] text-muted" title={c.name}>{c.name}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[20px] leading-none font-semibold tabular">{r.score}</p>
          <p className="text-[11px] text-muted">de 100</p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <Meter label="Precio vs. tendencia" value={r.valuation} />
        <Meter label="Aporte a tu cartera" value={r.complement?.score ?? null} />
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-[12.5px] leading-snug">
        {r.reasons.map((x) => <li key={x}>{x}</li>)}
      </ul>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[12px]">
        {c.valuation?.verdict && <VerdictBadge value={c.valuation.verdict} />}
        <span className="text-muted">
          {r.weight > 0 ? `Hoy pesa un ${formatPercent(r.weight, 1)}. ` : "No lo tienes. "}
          {r.roomEur > 0 ? `Caben hasta ${formatCurrency(r.roomEur, "EUR", 0)} sin pasar del ${formatPercent(PORTFOLIO_CONFIG.maxPosition, 0)}.` : ""}
        </span>
      </div>
    </article>
  );
}

/** Segunda opinión en claude.ai: se copia un texto con los datos ya calculados, sin coste ni clave. */
function ClaudeAiOpinion({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ref.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  };
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px]">
          <Sparkles className="size-4 text-accent-text" aria-hidden />
          <span><span className="font-medium">Segunda opinión con claude.ai</span> <span className="text-muted">· Análisis IA, opcional y sin coste: copias el texto y lo pegas en una conversación nueva.</span></span>
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => { void copy(); setOpen(true); }}>
            {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />} {copied ? "Copiado" : "Copiar texto para claude.ai"}
          </Button>
          <ExternalLink href="https://claude.ai/new" className="inline-flex items-center gap-1 text-[13px] text-accent-text hover:underline">
            Abrir claude.ai <ExternalIcon className="size-3.5" aria-hidden />
          </ExternalLink>
        </div>
      </div>
      {open && (
        <>
          <textarea ref={ref} readOnly value={text} aria-label="Texto para claude.ai" rows={4} className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed text-muted" />
          <p className="mt-1 text-[11.5px] text-muted">
            ≈ {approxTokens(text).toLocaleString("es-ES")} tokens: cabe de sobra en el plan gratuito. Lleva tu cartera, las fichas de los fondos y la propuesta de la app; nada de documentos. Su respuesta es una opinión: no se guarda ni cambia nada en la app.
          </p>
        </>
      )}
    </div>
  );
}

/** «¿Qué comprar después?»: la propuesta determinista ponderando tu cartera, y la opción de pedir opinión en claude.ai. */
export function FundsNextBuy({ funds, view }: { funds: FundLine[]; view: PortfolioView | null }) {
  const result = useMemo(() => fundNextBuy(funds, view), [funds, view]);
  const text = useMemo(() => buildFundNextBuyPrompt(funds, view, result), [funds, view, result]);
  const others = result.ranking.filter((r) => !result.picks.includes(r));
  return (
    <section aria-labelledby="next-buy-title" className="mt-6 rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="next-buy-title" className="flex items-center gap-2 font-serif text-[21px] font-semibold tracking-tight">
            <Compass className="size-5 text-accent-text" aria-hidden /> ¿Qué fondo comprar después?
          </h2>
          <p className="mt-1 max-w-[760px] text-[12.5px] text-muted">
            Cálculo propio, sin IA: {Math.round(NEXT_BUY_CONFIG.weights.valuation * 100)} % si el precio está bajo frente a su tendencia y {Math.round(NEXT_BUY_CONFIG.weights.complement * 100)} % lo que aporta a tu cartera
            (sectores, países y empresas que aún no tienes, mirando dentro de tus fondos). No optan los caros, los de riesgo técnico alto ni los que ya pesan más del {formatPercent(PORTFOLIO_CONFIG.maxPosition, 0)}.
          </p>
        </div>
        {!view?.portfolio.valueEur && <Badge tone="warning">Sin cartera registrada: solo cuenta el precio</Badge>}
      </div>

      {result.picks.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {result.picks.map((r, i) => <PickCard key={r.candidate.id} r={r} rank={i + 1} />)}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[13px]">{result.note}</p>
      )}

      {others.length > 0 && (
        <details className="mt-3 text-[12.5px]">
          <summary className="cursor-pointer text-muted hover:text-text">El resto de tus fondos ({others.length})</summary>
          <ul className="mt-2 space-y-1">
            {others.map((r) => (
              <li key={r.candidate.id}>
                <span className="font-medium">{r.candidate.ticker}</span>
                <span className="text-muted"> · {r.score !== null ? `${r.score}/100. ${r.reasons.join(" ")}` : `No opta: ${r.excluded}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ClaudeAiOpinion text={text} />
    </section>
  );
}
