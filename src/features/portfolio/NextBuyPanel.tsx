import { AlertTriangle, ShoppingCart, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CRITERIA, nextBuy, type Amount, type Criterion, type ScoredCandidate } from "@/domain/portfolio/next-buy";
import { NEXT_BUY_CONFIG } from "@/domain/scoring/config";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber, formatPercent, parseDecimal } from "@/lib/format";
import type { PortfolioView } from "./load";
import { nextBuyCandidate } from "./next-buy";
import { NextBuyAiSection } from "./NextBuyAi";

/**
 * «Qué compro hoy»: eliges hasta 3 posiciones de tu cartera y lo que quieres
 * gastar (en euros o en acciones); la app las compara frente a frente con los
 * cuatro criterios y dice cuál comprar, cuánto y por qué. Cálculo propio, sin IA.
 */

const SLOTS = 3;
const STORE_KEY = "next-buy:v1";

interface Saved {
  picks: (number | null)[];
  mode: Amount["mode"];
  raw: string;
}

function loadSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Saved | null;
    return s && Array.isArray(s.picks) ? s : null;
  } catch {
    return null;
  }
}

const tone = (s: number | null) => (s === null ? "neutral" : s >= 65 ? "positive" : s >= 40 ? "warning" : "negative");
const BAR = { positive: "bg-positive", warning: "bg-warning", negative: "bg-negative", neutral: "bg-muted/40" } as const;
const WORD = { positive: "Favorable", warning: "Regular", negative: "Desfavorable", neutral: "Sin dato" } as const;

function ScoreBar({ score, big, na }: { score: number | null; big?: boolean; na?: boolean }) {
  const t = tone(score);
  return (
    <div>
      <p className={cn("tabular", big ? "text-[22px] font-semibold font-serif leading-none" : "text-[13px]")}>
        <span className="font-semibold">{score === null ? "—" : score}</span>
        <span className="text-muted">/100</span>
        {!big && <span className="text-muted"> · {na ? "No aplica (neutro)" : WORD[t]}</span>}
      </p>
      <div className={cn("mt-1.5 rounded-full bg-surface", big ? "h-2" : "h-1.5")} aria-hidden>
        <div className={cn("h-full rounded-full", BAR[t])} style={{ width: `${score ?? 0}%` }} />
      </div>
    </div>
  );
}

function CriterionCell({ c }: { c: Criterion }) {
  return (
    <div className="space-y-1.5">
      <ScoreBar score={c.score} na={c.score === null && c.text.startsWith("No aplica")} />
      <p className="text-[12px] leading-snug text-muted">{c.text}</p>
    </div>
  );
}

function sharesText(n: number) {
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  return `${formatNumber(n, whole ? 0 : 4)} ${n === 1 ? "acción" : "acciones"}`;
}

export function NextBuyPanel({ view }: { view: PortfolioView }) {
  const options = useMemo(
    () => view.holdings.slice().sort((a, b) => a.row.ticker.localeCompare(b.row.ticker)),
    [view.holdings],
  );
  const saved = useMemo(loadSaved, []);
  const [picks, setPicks] = useState<(number | null)[]>(() => {
    const ok = (saved?.picks ?? []).map((id) => (id !== null && options.some((o) => o.row.id === id) ? id : null));
    return Array.from({ length: SLOTS }, (_, i) => ok[i] ?? null);
  });
  const [mode, setMode] = useState<Amount["mode"]>(saved?.mode ?? "eur");
  const [raw, setRaw] = useState(saved?.raw ?? "");

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ picks, mode, raw } satisfies Saved));
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [picks, mode, raw]);

  const value = parseDecimal(raw);
  const validAmount = value !== null && value > 0;
  const chosen = picks.filter((id): id is number => id !== null);
  const candidates = chosen.map((id) => options.find((o) => o.row.id === id)).filter((h) => !!h).map((h) => nextBuyCandidate(h, view));
  const result = candidates.length > 0 && validAmount ? nextBuy(candidates, view.portfolio.valueEur, { mode, value }) : null;
  // Columnas en el orden que elegiste, para no despistar
  const columns: ScoredCandidate[] = result ? candidates.map((c) => result.ranked.find((r) => r.candidate.id === c.id)!) : [];

  const setPick = (i: number, id: number | null) => setPicks((ps) => ps.map((p, j) => (j === i ? id : p)));

  return (
    <div className="space-y-5">
      <section aria-label="Qué quieres comparar" className="rounded-[var(--radius-card)] border border-border bg-surface-raised p-5 shadow-card">
        <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.1fr)]">
          {picks.map((id, i) => (
            <label key={i} className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-muted">Posición {i + 1}</span>
              <Select value={id ?? ""} onChange={(e) => setPick(i, e.target.value ? Number(e.target.value) : null)} aria-label={`Posición ${i + 1}`}>
                <option value="">Elige una posición…</option>
                {options.map((o) => (
                  <option key={o.row.id} value={o.row.id} disabled={picks.includes(o.row.id) && id !== o.row.id}>
                    {o.row.ticker} · {o.row.name}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          <div>
            <span className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-muted">
              <span id="nb-amount-label">Cuánto quieres comprar</span>
              <span role="radiogroup" aria-label="Unidad" className="inline-flex rounded-md border border-border bg-surface p-0.5">
                {(["eur", "shares"] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn("rounded px-2 py-0.5 text-[11.5px]", mode === m ? "bg-surface-raised font-medium text-text shadow-card" : "text-muted hover:text-text")}
                  >
                    {m === "eur" ? "Euros" : "Acciones"}
                  </button>
                ))}
              </span>
            </span>
            <div className="relative">
              <Input
                aria-labelledby="nb-amount-label"
                inputMode="decimal"
                placeholder={mode === "eur" ? "1.000" : "10"}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                aria-invalid={raw.trim() !== "" && !validAmount}
                className="pr-16 tabular"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-muted">{mode === "eur" ? "€" : "acciones"}</span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-muted">
          Compara con cuatro preguntas: si te equilibra la cartera (máximo 15 % por posición y 35 % por sector), si está barata, cuánto dinero genera y cuánto crece.
          {mode === "shares" && " En acciones, el coste de cada una es ese número de acciones a su precio de hoy."}
        </p>
      </section>

      {chosen.length === 0 && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border px-5 py-8 text-center text-[13px] text-muted">
          Elige hasta tres posiciones de tu cartera y cuánto quieres gastar: te diré cuál comprar hoy y por qué.
        </p>
      )}
      {chosen.length > 0 && !validAmount && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border px-5 py-8 text-center text-[13px] text-muted">
          Escribe {mode === "eur" ? "el importe en euros" : "el número de acciones"} que quieres comprar.
        </p>
      )}

      {result && (
        <>
          <Verdict result={result} mode={mode} />
          <ComparisonGrid columns={columns} winnerId={result.winner?.candidate.id ?? null} />
          <NextBuyAiSection view={view} result={result} amount={{ mode, value: value! }} />
          <p className="text-[11.5px] text-muted">
            Nota final = peso en cartera {pctW("balance")} + cara o barata {pctW("valuation")} + dinero que genera {pctW("cash")} + crecimiento {pctW("growth")}. Un dato que falta o no aplica cuenta como 50 (neutro).
            La comparativa es un cálculo propio con los informes y precios guardados en tu Mac, sin IA; la segunda opinión de Claude es opcional y va aparte. El crecimiento es el de los últimos años: es la mejor pista de lo que puede crecer, no una promesa; lo que dice cada empresa de su futuro está en el análisis de su ficha. {DISCLAIMER}
          </p>
        </>
      )}
    </div>
  );
}

const pctW = (id: keyof typeof NEXT_BUY_CONFIG.weights) => `(${Math.round(NEXT_BUY_CONFIG.weights[id] * 100)} %)`;

function Verdict({ result, mode }: { result: NonNullable<ReturnType<typeof nextBuy>>; mode: Amount["mode"] }) {
  const w = result.winner;
  if (!w) {
    return (
      <section className="rounded-[var(--radius-card)] border border-negative/40 bg-surface-raised p-5 shadow-card">
        <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-negative-text" aria-hidden /> Hoy no recomiendo comprar ninguna de estas</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">
          {result.ranked.map((r) => <li key={r.candidate.id}><span className="font-medium text-text">{r.candidate.ticker}</span>: {r.excluded}</li>)}
        </ul>
      </section>
    );
  }
  return (
    <section aria-label="Recomendación" className="rounded-[var(--radius-card)] border border-accent/40 bg-surface-raised p-5 shadow-card">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="min-w-[220px]">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-accent-text uppercase"><Trophy className="size-3.5" aria-hidden /> Compra hoy</p>
          <p className="mt-1 font-serif text-[30px] leading-none font-semibold tracking-tight">{w.candidate.ticker}</p>
          <p className="mt-1 max-w-[260px] truncate text-[12.5px] text-muted" title={w.candidate.name}>{w.candidate.name}</p>
          <p className="mt-2 text-[13px]"><span className="font-semibold tabular">{w.total}</span><span className="text-muted">/100 en la suma de los cuatro criterios</span></p>
        </div>
        <div className="min-w-[240px] flex-1">
          <p className="text-[12px] font-medium text-muted">Cuánto</p>
          <ul className="mt-1 space-y-1">
            {result.plan.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[14px]">
                <ShoppingCart className="size-3.5 text-accent-text" aria-hidden />
                <span><span className="font-semibold">{a.ticker}</span>: {sharesText(a.shares)} por <span className="font-semibold tabular">{formatCurrency(a.eur)}</span></span>
                <span className="text-[12px] text-muted">→ pesará un {formatPercent(a.weightAfter, 1)}</span>
              </li>
            ))}
          </ul>
          {result.plan.length > 1 && <p className="mt-1 text-[12px] text-muted">Se reparte porque todo en {result.plan[0]!.ticker} pasaría del 15 % de tu cartera.</p>}
          {result.overCap && (
            <p className="mt-1 flex gap-1.5 text-[12px] text-warning-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Ojo: con esta compra pasará del 15 % recomendado por posición. Ninguna de las que has elegido tiene sitio para todo el importe; si quieres equilibrar, prueba con otras posiciones o con menos dinero.
            </p>
          )}
          {result.leftover && <p className="mt-1 text-[12px] text-muted">Sin invertir: {formatCurrency(result.leftover.eur)}. {result.leftover.reason}</p>}
          {mode === "eur" && !w.candidate.fractional && <p className="mt-1 text-[11.5px] text-muted">Acciones enteras (tu bróker no ha permitido fracciones en esta posición). Precios de hoy, sin comisiones.</p>}
          {w.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {w.warnings.map((t) => <li key={t} className="flex gap-1.5 text-[12.5px] text-warning-text"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t}</li>)}
            </ul>
          )}
        </div>
      </div>
      {result.why.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-[12px] font-medium text-muted">Por qué {w.candidate.ticker} y no las otras</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">
            {result.why.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function ComparisonGrid({ columns, winnerId }: { columns: ScoredCandidate[]; winnerId: number | null }) {
  const head = "px-3 py-2 text-left text-[11.5px] font-medium text-muted";
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-card">
      <table className="w-full min-w-[720px] table-fixed border-collapse">
        <caption className="sr-only">Comparativa de las posiciones elegidas en los cuatro criterios</caption>
        <colgroup>
          <col className="w-[170px]" />
          {columns.map((c) => <col key={c.candidate.id} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={cn(head, "pl-5")}>Criterio</th>
            {columns.map((c) => (
              <th key={c.candidate.id} scope="col" className={cn("px-3 py-3 text-left align-bottom", c.candidate.id === winnerId && "bg-sand/30")}>
                <Link to={c.candidate.kind === "stock" ? `/watchlist/${c.candidate.id}` : "/portfolio"} className="font-serif text-[18px] font-semibold tracking-tight hover:underline">
                  {c.candidate.ticker}
                </Link>
                {c.candidate.id === winnerId && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent-text"><Trophy className="size-3" aria-hidden /> La elegida</span>}
                <p className="truncate text-[12px] font-normal text-muted" title={c.candidate.name}>{c.candidate.name}</p>
                <p className="text-[12px] font-normal text-muted tabular">
                  {c.candidate.priceEur !== null ? `${formatCurrency(c.candidate.priceEur)} por ${c.candidate.kind === "stock" ? "acción" : "participación"}` : "Sin precio"}
                  {c.costEur !== null && ` · compra: ${formatCurrency(c.costEur)}`}
                </p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CRITERIA.map((k) => (
            <tr key={k.id} className="border-b border-border align-top">
              <th scope="row" className="py-3 pr-3 pl-5 text-left font-normal">
                <span className="block text-[13.5px] font-medium">{k.question}</span>
                <span className="block text-[11.5px] text-muted">{k.label} · {Math.round(NEXT_BUY_CONFIG.weights[k.id] * 100)} %</span>
              </th>
              {columns.map((c) => (
                <td key={c.candidate.id} className={cn("px-3 py-3", c.candidate.id === winnerId && "bg-sand/30")}>
                  <CriterionCell c={c.criteria.find((x) => x.id === k.id)!} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="align-top">
            <th scope="row" className="py-3 pr-3 pl-5 text-left text-[13.5px] font-semibold">Nota final</th>
            {columns.map((c) => (
              <td key={c.candidate.id} className={cn("px-3 py-3", c.candidate.id === winnerId && "bg-sand/30")}>
                <ScoreBar score={c.total} big />
                {c.excluded && <p className="mt-1.5 flex gap-1.5 text-[12px] text-negative-text"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{c.excluded}</p>}
                {!c.excluded && c.warnings.map((t) => <p key={t} className="mt-1.5 text-[12px] text-warning-text">{t}</p>)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
