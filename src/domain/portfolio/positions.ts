import { majorUnit, type FxTable } from "./fx";
import { xirr, type CashFlow } from "./xirr";

/**
 * Cartera en euros (CLAUDE.md §5.2), calculada solo con tus operaciones, la
 * última cotización y los tipos del BCE. Método del precio medio: cada venta
 * saca acciones al coste medio de las que tenías. Si falta un precio o un
 * tipo de cambio, el valor queda en «Sin dato» y se dice por qué.
 */

export type TxType = "buy" | "sell" | "dividend";

export interface Transaction {
  id: number;
  securityId: number;
  date: string;
  type: TxType;
  /** Acciones (en un dividendo, las que lo cobraron). */
  quantity: number;
  /** Precio por acción en `currency` (en un dividendo, el bruto por acción). */
  price: number;
  currency: string;
  /** Comisiones (en un dividendo, retenciones), en `currency`. */
  fees: number;
  /** Euros por unidad de `currency` que aplicó tu bróker, si lo apuntaste. */
  fxRateToBase: number | null;
}

export interface SecurityInfo {
  id: number;
  ticker: string;
  name: string;
  kind: "stock" | "etf" | "etc";
  currency: string;
  sector: string | null;
  country: string | null;
  /** ETC o ETF de materias primas: su sector es «Materias primas». */
  commodity?: boolean;
  /**
   * Reparto de un ETF por sectores y países según su ficha (pesos de 0 a 1).
   * Si existe, la exposición de la cartera «mira dentro» del fondo.
   */
  breakdown?: { sectors?: Share[]; countries?: Share[] };
}

export interface Share {
  key: string;
  weight: number;
}

export interface QuoteInfo {
  price: number;
  date: string;
  currency: string;
}

export interface Position {
  security: SecurityInfo;
  shares: number;
  /** Coste de las acciones que tienes, comisiones incluidas, en euros. */
  costEur: number;
  avgCostLocal: number | null;
  avgCostEur: number | null;
  valueEur: number | null;
  price: QuoteInfo | null;
  unrealizedEur: number | null;
  realizedEur: number;
  dividendsEur: number;
  /** Lo que llevas ganado o perdido en total (latente + realizado + dividendos). */
  totalReturnEur: number | null;
  /** Sobre todo lo que has invertido en ella. */
  totalReturnPct: number | null;
  /** Rentabilidad anual equivalente, según cuándo entró y salió cada euro. */
  annualizedPct: number | null;
  /** Peso sobre el valor de la cartera con precio. */
  weight: number | null;
  firstBuy: string | null;
  problems: string[];
}

export interface Exposure {
  key: string;
  valueEur: number;
  weight: number;
}

export interface Portfolio {
  positions: Position[];
  /** Posiciones cerradas (vendidas del todo): cuentan para lo realizado. */
  closed: Position[];
  valueEur: number;
  costEur: number;
  unrealizedEur: number;
  realizedEur: number;
  dividendsEur: number;
  totalReturnEur: number;
  annualizedPct: number | null;
  /** Posiciones abiertas sin valor (falta precio o tipo de cambio): no cuentan en el valor ni en el coste. */
  unvalued: number;
  bySector: Exposure[];
  byCountry: Exposure[];
  byCurrency: Exposure[];
  byKind: Exposure[];
}

const EPS = 1e-9;
const LAST = new Set(["Otros", "Sin dato"]);

export function buildPortfolio(input: {
  securities: SecurityInfo[];
  transactions: Transaction[];
  quotes: Map<number, QuoteInfo>;
  fx: FxTable;
  today: string;
}): Portfolio {
  const { fx, today } = input;
  const all: Position[] = [];
  const portfolioFlows: CashFlow[] = [];

  for (const security of input.securities) {
    const txs = input.transactions.filter((t) => t.securityId === security.id).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    if (txs.length === 0) continue;
    const problems: string[] = [];
    const flows: CashFlow[] = [];
    let shares = 0;
    let costEur = 0;
    let costLocal = 0;
    let invested = 0;
    let realizedEur = 0;
    let dividendsEur = 0;
    let fxMissing = false;

    for (const t of txs) {
      const rate = t.fxRateToBase ?? fx.eurPer(t.currency, t.date)?.value ?? null;
      const major = majorUnit(t.currency).factor;
      if (rate === null) {
        // Las acciones cuentan igual; lo que no se puede saber es su coste en euros
        fxMissing = true;
        problems.push(`Falta el tipo de cambio ${majorUnit(t.currency).currency}/EUR del ${t.date}.`);
        if (t.type === "buy") shares += t.quantity;
        if (t.type === "sell") shares -= Math.min(t.quantity, shares);
        continue;
      }
      // `rate` ya incluye el paso de peniques a libras; en moneda local se guarda en unidades mayores
      const gross = t.quantity * t.price;
      if (t.type === "buy") {
        const eur = (gross + t.fees) * rate;
        shares += t.quantity;
        costEur += eur;
        costLocal += (gross + t.fees) * major;
        invested += eur;
        flows.push({ date: t.date, amount: -eur });
      } else if (t.type === "sell") {
        if (t.quantity > shares + EPS) {
          problems.push(`El ${t.date} vendes ${t.quantity} acciones, pero solo tenías ${+shares.toFixed(6)}.`);
        }
        const sold = Math.min(t.quantity, shares);
        const share = shares > EPS ? sold / shares : 0;
        const proceeds = (gross - t.fees) * rate;
        realizedEur += proceeds - costEur * share;
        costEur -= costEur * share;
        costLocal -= costLocal * share;
        shares -= sold;
        flows.push({ date: t.date, amount: proceeds });
      } else {
        const eur = (gross - t.fees) * rate;
        dividendsEur += eur;
        flows.push({ date: t.date, amount: eur });
      }
    }
    if (shares < EPS) shares = 0;

    const quote = input.quotes.get(security.id) ?? null;
    let valueEur: number | null = null;
    if (shares > 0) {
      if (!quote) problems.push("Sin precio todavía.");
      else {
        const rate = fx.eurPer(quote.currency, today) ?? fx.eurPer(quote.currency, quote.date);
        if (!rate) problems.push(`Falta el tipo de cambio ${majorUnit(quote.currency).currency}/EUR de hoy.`);
        else valueEur = shares * quote.price * rate.value;
      }
    } else valueEur = 0;

    const unrealizedEur = valueEur === null ? null : valueEur - costEur;
    const totalReturnEur = unrealizedEur === null || fxMissing ? null : unrealizedEur + realizedEur + dividendsEur;
    const annualizedPct = valueEur === null || fxMissing ? null : xirr([...flows, ...(valueEur > 0 ? [{ date: today, amount: valueEur }] : [])]);
    if (!fxMissing && valueEur !== null) {
      portfolioFlows.push(...flows);
      if (valueEur > 0) portfolioFlows.push({ date: today, amount: valueEur });
    }
    all.push({
      security,
      shares,
      costEur,
      avgCostLocal: shares > 0 ? costLocal / shares : null,
      avgCostEur: shares > 0 ? costEur / shares : null,
      valueEur,
      price: quote,
      unrealizedEur,
      realizedEur,
      dividendsEur,
      totalReturnEur,
      totalReturnPct: totalReturnEur === null || invested <= 0 ? null : totalReturnEur / invested,
      annualizedPct,
      weight: null,
      firstBuy: txs.find((t) => t.type === "buy")?.date ?? null,
      problems,
    });
  }

  const positions = all.filter((p) => p.shares > 0);
  const closed = all.filter((p) => p.shares === 0);
  const valued = positions.filter((p) => p.valueEur !== null);
  const valueEur = valued.reduce((s, p) => s + p.valueEur!, 0);
  for (const p of valued) p.weight = valueEur > 0 ? p.valueEur! / valueEur : null;

  const group = (keyOf: (p: Position) => string, inside?: (p: Position) => Share[] | undefined): Exposure[] => {
    const m = new Map<string, number>();
    const add = (k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    for (const p of valued) {
      const parts = inside?.(p)?.filter((x) => x.weight > 0);
      if (!parts?.length) {
        add(keyOf(p), p.valueEur!);
        continue;
      }
      // Lo que la ficha no reparte (efectivo, redondeos) queda en «Otros»
      const total = parts.reduce((t, x) => t + x.weight, 0);
      const scale = total > 1 ? 1 / total : 1;
      for (const x of parts) add(x.key, p.valueEur! * x.weight * scale);
      if (total < 0.995) add("Otros", p.valueEur! * (1 - total));
    }
    return [...m.entries()]
      .map(([key, v]) => ({ key, valueEur: v, weight: valueEur > 0 ? v / valueEur : 0 }))
      // De mayor a menor; «Otros» y «Sin dato» al final
      .sort((a, b) => Number(LAST.has(a.key)) - Number(LAST.has(b.key)) || b.valueEur - a.valueEur);
  };
  const sum = (f: (p: Position) => number | null) => all.reduce((s, p) => s + (f(p) ?? 0), 0);

  return {
    positions: positions.sort((a, b) => (b.valueEur ?? -1) - (a.valueEur ?? -1)),
    closed,
    valueEur,
    // Solo las posiciones con valor, para que coste y valor sean comparables
    costEur: valued.reduce((s, p) => s + p.costEur, 0),
    unrealizedEur: sum((p) => (p.shares > 0 ? p.unrealizedEur : 0)),
    realizedEur: sum((p) => p.realizedEur),
    dividendsEur: sum((p) => p.dividendsEur),
    totalReturnEur: sum((p) => p.totalReturnEur),
    annualizedPct: xirr(portfolioFlows),
    unvalued: positions.length - valued.length,
    bySector: group(
      (p) =>
        p.security.sector ??
        (p.security.commodity || p.security.kind === "etc" ? "Materias primas" : p.security.kind === "etf" ? "ETF sin ficha" : "Sin dato"),
      (p) => p.security.breakdown?.sectors,
    ),
    byCountry: group((p) => p.security.country ?? "Sin dato", (p) => p.security.breakdown?.countries),
    byCurrency: group((p) => majorUnit(p.security.currency).currency),
    byKind: group((p) => p.security.kind),
  };
}
