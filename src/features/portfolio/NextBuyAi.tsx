import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, CircleSlash, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClaudeClient } from "@/data/claude/client";
import type { Amount, NextBuyResult } from "@/domain/portfolio/next-buy";
import { AiLabel } from "@/features/ai/AiAnalysisSection";
import { BudgetExceededError } from "@/features/ai/budget";
import { describeApiError } from "@/features/ai/equity-analysis";
import { requireApiKey } from "@/features/ai/mode";
import { cachedNextBuyAi, runNextBuyAi, type NextBuyAiInput, type StoredNextBuyAi } from "@/features/ai/next-buy-ai";
import { aiSpendKey } from "@/features/ai/queries";
import { useSettings } from "@/features/settings/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { appDb } from "@/platform/database";
import type { PortfolioView } from "./load";

/**
 * Segunda opinión de Claude en «Comparo tu cositas». Opcional: nunca se llama sola,
 * solo al pulsar el botón, y con los mismos datos se reutiliza la respuesta
 * guardada (no se paga dos veces).
 */

function inputOf(view: PortfolioView, result: NextBuyResult, amount: Amount): NextBuyAiInput {
  const funds = new Map(view.holdings.filter((h) => h.fund).map((h) => [h.row.id, h.fund!]));
  return { result, amount, totalEur: view.portfolio.valueEur, funds };
}

export function NextBuyAiSection({ view, result, amount }: { view: PortfolioView; result: NextBuyResult; amount: Amount }) {
  const qc = useQueryClient();
  const mode = useSettings().data?.aiMode ?? "manual";
  const ids = result.ranked.map((r) => r.candidate.id).sort((a, b) => a - b);
  const queryKey = ["next-buy-ai", ids, amount.mode, amount.value, view.portfolio.valueEur] as const;
  const saved = useQuery({
    queryKey,
    queryFn: async () => {
      return cachedNextBuyAi(await appDb(), inputOf(view, result, amount));
    },
  });
  const run = useMutation({
    mutationFn: async ({ allowOverBudget }: { allowOverBudget?: boolean }) => {
      const settings = await requireApiKey();
      return runNextBuyAi(
        { db: await appDb(), client: createClaudeClient(), model: settings.aiModelAnalysis, budgetEur: settings.aiMonthlyBudgetEur },
        inputOf(view, result, amount),
        { allowOverBudget },
      );
    },
    onSuccess: (s) => {
      qc.setQueryData(queryKey, s);
      void qc.invalidateQueries({ queryKey: aiSpendKey });
    },
  });
  const budget = run.error instanceof BudgetExceededError ? run.error : null;
  const opinion = saved.data ?? null;
  const tooFew = result.ranked.length < 2;

  if (mode === "off") return null;
  return (
    <section aria-labelledby="nb-ai" className="rounded-[var(--radius-card)] border border-accent/25 bg-surface-raised p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="nb-ai" className="font-serif text-[19px] font-semibold tracking-tight">Segunda opinión de Claude</h2>
            <AiLabel />
            <span className="text-[11.5px] text-muted">Opcional</span>
          </div>
          <p className="mt-1 max-w-[72ch] text-[12.5px] text-muted">
            {tooFew
              ? "Elige al menos dos posiciones para pedirla."
              : "Claude lee esta comparativa y lo que ya tienes guardado de cada posición (su último análisis, lo que espera la empresa y sus riesgos; la ficha de los ETFs) y te dice cuál compraría y por qué. Usa la API de Claude: cuesta unos céntimos cada vez. Con los mismos datos no se vuelve a pagar."}
          </p>
        </div>
        {!tooFew && (
          <Button variant={opinion ? "secondary" : "primary"} onClick={() => run.mutate({})} disabled={run.isPending || !!opinion}>
            {run.isPending ? <RefreshCw className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {run.isPending ? "Pensando…" : opinion ? "Ya la tienes" : "Pedir opinión a Claude"}
          </Button>
        )}
      </div>

      {run.isPending && (
        <div role="status" className="mt-4 space-y-2">
          <p className="text-[13px] text-muted">Claude está comparando las posiciones. Tarda menos de un minuto…</p>
          {[85, 70].map((w) => <div key={w} className="h-3 animate-pulse rounded bg-surface" style={{ width: `${w}%` }} />)}
        </div>
      )}
      {budget && (
        <div role="alert" className="mt-4 rounded-xl border border-warning/40 bg-warning/6 px-4 py-3 text-[13px]">
          <p>
            Este mes llevas {formatCurrency(budget.spentEur)} de tu presupuesto de {formatCurrency(budget.budgetEur)}. Esta opinión costaría unos {formatCurrency(budget.estimateEur, "EUR", 2)}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => run.mutate({ allowOverBudget: true })}>Pedirla igualmente</Button>
            <Button size="sm" variant="ghost" onClick={() => run.reset()}>Cancelar</Button>
          </div>
        </div>
      )}
      {run.error && !budget && <p role="alert" className="mt-4 text-[13px] text-negative-text">{describeApiError(run.error)}</p>}

      {opinion && <Opinion opinion={opinion} appPick={result.winner?.candidate.ticker ?? null} />}
    </section>
  );
}

function Opinion({ opinion, appPick }: { opinion: StoredNextBuyAi; appPick: string | null }) {
  const o = opinion.result;
  const agrees = o.eleccion === appPick;
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl bg-sand/30 px-4 py-3">
        <p className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-muted">Claude compraría</span>
          <span className="font-serif text-[20px] font-semibold tracking-tight">{o.eleccion}</span>
          <span className={agrees ? "inline-flex items-center gap-1 text-[12px] text-positive-text" : "inline-flex items-center gap-1 text-[12px] text-warning-text"}>
            {agrees ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleSlash className="size-3.5" aria-hidden />}
            {agrees ? "Coincide con la app" : `No coincide con la app (${appPick ?? "ninguna"})`}
          </span>
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed">{o.resumen}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {o.posiciones.map((p) => (
          <article key={p.ticker} aria-label={`Opinión sobre ${p.ticker}`} className="rounded-xl border border-border p-4">
            <p className="font-serif text-[16px] font-semibold">{p.ticker}</p>
            <p className="mt-2 text-[11.5px] font-medium text-positive-text">A favor</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12.5px]">{p.a_favor.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-[11.5px] font-medium text-negative-text">En contra</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12.5px]">{p.en_contra.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-[11.5px] font-medium text-muted">Lo que se espera que crezca</p>
            <p className="mt-0.5 text-[12.5px]">{p.crecimiento_esperado}</p>
          </article>
        ))}
      </div>

      <p className="text-[13px]"><span className="font-medium">Sobre el reparto: </span>{o.reparto}</p>
      {o.avisos.length > 0 && (
        <ul className="space-y-1">
          {o.avisos.map((t) => <li key={t} className="flex gap-1.5 text-[12.5px] text-warning-text"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t}</li>)}
        </ul>
      )}
      <p className="text-[11.5px] text-muted">
        Análisis IA del {formatDate(opinion.createdAt)} ({opinion.model}). Coste: {formatCurrency(opinion.costEur, "EUR", opinion.costEur < 0.01 ? 3 : 2)}{opinion.costApprox ? " (aprox.)" : ""}. Si cambian los precios o eliges otras posiciones, puedes pedir otra.
      </p>
    </div>
  );
}
