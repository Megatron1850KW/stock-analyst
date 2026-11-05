import { companyExposure, nextFundBuys, type NextBuyCandidate, type NextBuyResult } from "@/domain/portfolio/fund-next-buy";
import { holdingLabel } from "@/domain/portfolio/holdings";
import { countryName } from "@/domain/portfolio/sector";
import { FUND_NEXT_BUY_PROMPT } from "@/features/ai/prompts";
import type { FundLine } from "./FundsTable";
import type { PortfolioView } from "./load";

/** De la tabla de fondos y tu cartera a la propuesta «¿Qué comprar después?», sin IA. */
export function fundNextBuy(funds: FundLine[], view: PortfolioView | null): NextBuyResult {
  const p = view?.portfolio;
  const totalEur = p?.valueEur ?? 0;
  const candidates: NextBuyCandidate[] = funds.map((f) => ({
    id: f.id,
    ticker: f.ticker,
    name: f.name,
    kind: f.kind,
    commodity: f.commodity,
    valuation: f.valuation,
    technical: f.technicalLevel,
    sectors: f.profile?.sectors ?? [],
    countries: f.profile?.countries ?? [],
    holdings: f.profile?.holdings ?? [],
    heldEur: view?.holdings.find((h) => h.row.id === f.id)?.position.valueEur ?? 0,
  }));
  const companies = companyExposure(
    (view?.holdings ?? []).map((h) => ({ valueEur: h.position.valueEur, kind: h.row.kind, name: h.row.name, holdings: h.fund?.profile.holdings ?? [] })),
    totalEur,
  );
  return nextFundBuys(candidates, { totalEur, bySector: p?.bySector ?? [], byCountry: p?.byCountry ?? [], companies });
}

const pct = (x: number) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
const eur = (x: number) => `${Math.round(x).toLocaleString("es-ES")} €`;
const list = (xs: { name: string; weight: number }[], n: number) => (xs.length ? xs.slice(0, n).map((x) => `${x.name} ${pct(x.weight)}`).join("; ") : "sin dato");

/** Texto que se pega en claude.ai: instrucciones versionadas + datos ya calculados (nada de documentos). */
export function buildFundNextBuyPrompt(funds: FundLine[], view: PortfolioView | null, result: NextBuyResult): string {
  const p = view?.portfolio;
  const cartera = p && p.valueEur > 0
    ? [
        `Valor total: ${eur(p.valueEur)}`,
        "Posiciones:",
        ...(view!.holdings.map((h) => `- ${h.row.ticker} (${h.row.name}, ${h.row.kind.toUpperCase()}): ${h.position.valueEur !== null ? eur(h.position.valueEur) : "sin dato"}${h.position.weight !== null ? ` · ${pct(h.position.weight)}` : ""}`)),
        `Sectores (mirando dentro de los fondos): ${p.bySector.map((e) => `${e.key} ${pct(e.weight)}`).join("; ")}`,
        `Países: ${p.byCountry.map((e) => `${countryName(e.key)} ${pct(e.weight)}`).join("; ")}`,
        `Divisas: ${p.byCurrency.map((e) => `${e.key} ${pct(e.weight)}`).join("; ")}`,
      ]
    : ["Sin operaciones registradas todavía."];
  const fondos = funds.flatMap((f) => {
    const pr = f.profile;
    const v = f.valuation;
    return [
      `### ${f.ticker} · ${f.name} (${f.kind.toUpperCase()}${f.isin ? `, ${f.isin}` : ""})`,
      `- Índice: ${pr?.index ?? "sin dato"} · Coste anual: ${pr?.ter != null ? pct(pr.ter) : "sin dato"}${pr?.asOf ? ` · Ficha a ${pr.asOf}` : ""}`,
      `- Mayores posiciones: ${f.commodity && !pr?.holdings.length ? "no aplica (materia prima)" : list((pr?.holdings ?? []).map((h) => ({ name: holdingLabel(h.name), weight: h.weight })), 10)}`,
      `- Países: ${f.commodity && !pr?.countries.length ? "no aplica" : list((pr?.countries ?? []).map((c) => ({ name: countryName(c.key), weight: c.weight })), 8)}`,
      `- Sectores: ${f.commodity && !pr?.sectors.length ? "materias primas" : list((pr?.sectors ?? []).map((s) => ({ name: s.key, weight: s.weight })), 8)}`,
      `- ¿Cara o barata?: ${v?.verdict ? `${v.verdict}. ${v.sentence}` : v?.sentence ?? "sin dato"}`,
      `- Tendencia de fondo (precio frente a su media de 10 meses): ${f.trend ? (f.trend.price >= f.trend.average ? "alcista" : "bajista") : "sin dato"} · Riesgo técnico de largo plazo: ${f.technicalLevel ?? "sin dato"}`,
      `- En tu cartera: ${f.position?.weight != null ? pct(f.position.weight) : "no lo tienes"}`,
      "",
    ];
  });
  const propuesta = result.ranking.map((r, i) =>
    r.score !== null
      ? `${i + 1}. ${r.candidate.ticker}: ${r.score}/100 (precio ${r.valuation}/100, aporte a la cartera ${r.complement?.score ?? "sin dato"}/100). ${r.reasons.join(" ")}`
      : `- ${r.candidate.ticker}: no opta. ${r.excluded}`,
  );
  return [
    FUND_NEXT_BUY_PROMPT.text,
    "",
    "## Datos",
    "",
    "<cartera>",
    ...cartera,
    "</cartera>",
    "",
    "<fondos>",
    ...fondos,
    "</fondos>",
    "",
    "<propuesta_app>",
    ...propuesta,
    "</propuesta_app>",
  ].join("\n");
}
