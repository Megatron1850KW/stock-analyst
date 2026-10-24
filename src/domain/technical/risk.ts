import { TECHNICAL_CONFIG } from "@/domain/scoring/config";

/**
 * Riesgo técnico de largo plazo (CLAUDE.md §5.3), calculado solo con velas
 * mensuales y semanales: tendencia de fondo, caída desde máximos, soportes y
 * resistencias y volatilidad anual. Nunca intradía ni a una semana vista.
 */

export interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

export type Trend = "Alcista" | "Lateral" | "Bajista";
export type RiskLevel = "Bajo" | "Medio" | "Alto";

export interface Level {
  price: number;
  /** Mes en que se marcó por última vez. */
  date: string;
  /** Veces que el precio se giró en esa zona. */
  touches: number;
}

export interface TechnicalRisk {
  level: RiskLevel | null;
  points: number | null;
  /** Desglose de los puntos para la UI. */
  parts: { id: "trend" | "drawdown" | "volatility"; label: string; points: number; text: string }[];
  trend: Trend | null;
  price: number | null;
  /** Media de 10 meses actual y su variación en los últimos 3 meses. */
  ma: number | null;
  maSlope: number | null;
  /** Caída desde el máximo (0,2 = un 20 % por debajo). */
  drawdown: number | null;
  peak: { price: number; date: string } | null;
  maxDrawdown: { value: number; peakDate: string; troughDate: string } | null;
  /** Volatilidad anual y peor año (12 meses seguidos) de la historia. */
  volatility: number | null;
  worstYear: { value: number; endDate: string } | null;
  support: Level | null;
  resistance: Level | null;
  months: number;
  sentence: string;
}

type Cfg = typeof TECHNICAL_CONFIG;

/** Media simple de los `n` últimos valores hasta el índice `end` (incluido). */
function sma(xs: number[], n: number, end = xs.length - 1): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let k = end - n + 1; k <= end; k++) s += xs[k]!;
  return s / n;
}

/** Serie de la media móvil (null mientras no hay bastantes velas), para el gráfico. */
export function movingAverage(bars: Bar[], n: number): { date: string; value: number }[] {
  const closes = bars.map((b) => b.close);
  return bars.flatMap((b, i) => {
    const v = sma(closes, n, i);
    return v === null ? [] : [{ date: b.date, value: v }];
  });
}

export function trendOf(closes: number[], cfg: Cfg = TECHNICAL_CONFIG): { trend: Trend; ma: number; slope: number } | null {
  const ma = sma(closes, cfg.maPeriods);
  const before = sma(closes, cfg.maPeriods, closes.length - 1 - cfg.slopeLookback);
  if (ma === null || before === null || before <= 0) return null;
  const price = closes.at(-1)!;
  const slope = ma / before - 1;
  const trend: Trend =
    price > ma && slope > cfg.flatSlope ? "Alcista" : price < ma && slope < -cfg.flatSlope ? "Bajista" : "Lateral";
  return { trend, ma, slope };
}

/** Mayor caída de máximo a mínimo (con cierres). */
export function maxDrawdown(bars: Bar[]): TechnicalRisk["maxDrawdown"] {
  let peak = bars[0];
  let best: TechnicalRisk["maxDrawdown"] = null;
  for (const b of bars) {
    if (!peak || b.close > peak.close) peak = b;
    const dd = 1 - b.close / peak.close;
    if (dd > 0 && (!best || dd > best.value)) best = { value: dd, peakDate: peak.date, troughDate: b.date };
  }
  return best;
}

/** Desviación típica anualizada de las rentabilidades mensuales. */
export function annualVolatility(closes: number[]): number | null {
  const r: number[] = [];
  for (let k = 1; k < closes.length; k++) if (closes[k - 1]! > 0 && closes[k]! > 0) r.push(Math.log(closes[k]! / closes[k - 1]!));
  if (r.length < 12) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

/** Peor rentabilidad de 12 meses seguidos («un año malo»). */
export function worstYear(bars: Bar[]): TechnicalRisk["worstYear"] {
  let worst: TechnicalRisk["worstYear"] = null;
  for (let k = 12; k < bars.length; k++) {
    const v = bars[k]!.close / bars[k - 12]!.close - 1;
    if (!worst || v < worst.value) worst = { value: v, endDate: bars[k]!.date };
  }
  return worst;
}

/**
 * Soportes y resistencias de largo plazo: mínimos y máximos mensuales que no
 * se superaron en los `window` meses de cada lado. Las zonas cercanas se juntan.
 */
export function pivotLevels(bars: Bar[], cfg: Cfg = TECHNICAL_CONFIG): { supports: Level[]; resistances: Level[] } {
  const w = cfg.pivotWindow;
  const lows: Level[] = [];
  const highs: Level[] = [];
  const lo = (b: Bar) => b.low ?? b.close;
  const hi = (b: Bar) => b.high ?? b.close;
  for (let k = w; k < bars.length - w; k++) {
    const around = bars.slice(k - w, k + w + 1);
    if (around.every((b) => lo(b) >= lo(bars[k]!))) lows.push({ price: lo(bars[k]!), date: bars[k]!.date, touches: 1 });
    if (around.every((b) => hi(b) <= hi(bars[k]!))) highs.push({ price: hi(bars[k]!), date: bars[k]!.date, touches: 1 });
  }
  const merge = (xs: Level[]) => {
    const out: Level[] = [];
    for (const x of [...xs].sort((a, b) => a.price - b.price)) {
      const prev = out.at(-1);
      if (prev && x.price <= prev.price * (1 + cfg.mergeWithin)) {
        // La zona se queda con el precio medio ponderado y la fecha más reciente
        prev.price = (prev.price * prev.touches + x.price) / (prev.touches + 1);
        prev.touches += 1;
        if (x.date > prev.date) prev.date = x.date;
      } else out.push({ ...x });
    }
    return out;
  };
  return { supports: merge(lows), resistances: merge(highs) };
}

const pct = (x: number) => `${Math.round(x * 100).toLocaleString("es-ES")} %`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function pointsFor(value: number, steps: { above: number; points: number }[]): number {
  return steps.find((s) => value > s.above)?.points ?? 0;
}

/** Riesgo técnico a partir de velas mensuales (orden cronológico, ~10 años). */
export function technicalRisk(monthly: Bar[], cfg: Cfg = TECHNICAL_CONFIG): TechnicalRisk {
  const closes = monthly.map((b) => b.close);
  const empty: TechnicalRisk = {
    level: null, points: null, parts: [], trend: null, price: closes.at(-1) ?? null, ma: null, maSlope: null, drawdown: null, peak: null,
    maxDrawdown: null, volatility: null, worstYear: null, support: null, resistance: null, months: monthly.length,
    sentence: `Hacen falta al menos ${cfg.minMonths / 12} años de precios mensuales para valorar el riesgo técnico.`,
  };
  if (monthly.length < cfg.minMonths) return empty;

  const price = closes.at(-1)!;
  const t = trendOf(closes, cfg)!;
  const peakBar = monthly.reduce((p, b) => (Math.max(b.high ?? b.close, b.close) > Math.max(p.high ?? p.close, p.close) ? b : p));
  const peakPrice = Math.max(peakBar.high ?? peakBar.close, peakBar.close);
  const drawdown = Math.max(0, 1 - price / peakPrice);
  const vol = annualVolatility(closes)!;
  const worst = worstYear(monthly);
  const { supports, resistances } = pivotLevels(monthly, cfg);
  const support = supports.filter((s) => s.price < price).at(-1) ?? null;
  const resistance = resistances.find((r) => r.price > price) ?? null;

  const trendPoints = cfg.points.trend[t.trend];
  const ddPoints = pointsFor(drawdown, cfg.points.drawdown);
  const volPoints = pointsFor(vol, cfg.points.volatility);
  const points = trendPoints + ddPoints + volPoints;
  const level: RiskLevel = points >= cfg.highFrom ? "Alto" : points >= cfg.mediumFrom ? "Medio" : "Bajo";

  const trendText = { Alcista: "La tendencia de fondo es alcista", Lateral: "La tendencia de fondo es lateral", Bajista: "La tendencia de fondo es bajista" }[t.trend];
  const ddText = drawdown < 0.05 ? "está cerca de sus máximos" : `está un ${pct(drawdown)} por debajo de su máximo`;
  const volText = vol > cfg.points.volatility[0]!.above ? "se mueve mucho" : vol > cfg.points.volatility[1]!.above ? "se mueve bastante" : "se mueve poco";
  const worstText = worst && worst.value < 0 ? ` (en su peor año cayó un ${pct(-worst.value)})` : "";

  return {
    level,
    points,
    parts: [
      { id: "trend", label: "Tendencia de fondo", points: trendPoints, text: `${t.trend}: el precio está ${price >= t.ma ? "por encima" : "por debajo"} de su media de ${cfg.maPeriods} meses, que ${t.slope > cfg.flatSlope ? "sube" : t.slope < -cfg.flatSlope ? "baja" : "está plana"}.` },
      { id: "drawdown", label: "Caída desde máximos", points: ddPoints, text: drawdown < 0.05 ? `Cerca de su máximo de ${monthYear(peakBar.date)}.` : `Está un ${pct(drawdown)} por debajo de su máximo de ${monthYear(peakBar.date)}.` },
      { id: "volatility", label: "Volatilidad", points: volPoints, text: `En un año normal sube o baja en torno a un ${pct(vol)}${worstText}.` },
    ],
    trend: t.trend,
    price,
    ma: t.ma,
    maSlope: t.slope,
    drawdown,
    peak: { price: peakPrice, date: peakBar.date },
    maxDrawdown: maxDrawdown(monthly),
    volatility: vol,
    worstYear: worst,
    support,
    resistance,
    months: monthly.length,
    sentence: `${trendText}, ${ddText} y ${volText}${worstText}.`,
  };
}
