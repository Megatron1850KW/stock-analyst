import type { Fundamentals, YearFundamentals } from "@/domain/fundamentals/metrics";
import { QUALITY_CONFIG } from "./config";
import type { DebtLevel } from "./debt-level";

/**
 * Puntuación de calidad / salud financiera (CLAUDE.md §8.2) y señales de
 * trampa de valor (§8.3). Determinista, con desglose y explicación de cada parte.
 */

export type QualityPartId = "growth" | "margins" | "cashConversion" | "debt" | "dilution" | "roe";

export interface QualityPart {
  id: QualityPartId;
  label: string;
  /** 0–100, o null si faltan datos. */
  score: number | null;
  /** Dato principal de la parte (crecimiento anual, margen, conversión…). */
  value: number | null;
  /** Frase en llano para la UI. */
  explanation: string;
}

export type TrapSignalId = "salesFalling" | "marginsDown" | "debtGrowing" | "fcfWeak" | "dilution";

export interface TrapSignal {
  id: TrapSignalId;
  label: string;
  /** true = se cumple; null = no hay datos para saberlo. */
  active: boolean | null;
  detail: string;
}

export interface QualityScore {
  score: number | null;
  parts: QualityPart[];
  signals: TrapSignal[];
  /** Señales que se cumplen. */
  activeSignals: number;
  note?: string;
}

type Cfg = typeof QUALITY_CONFIG;

const clamp = (x: number) => Math.min(100, Math.max(0, x));
/** 0 en `bad`, 100 en `good`, lineal entre medias (sirve también con bad > good). */
const scale = (x: number, bad: number, good: number) => clamp(((x - bad) / (good - bad)) * 100);
const pct = (x: number) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
const years = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);

/** Crecimiento anual compuesto entre dos valores positivos. */
function cagr(from: number | null | undefined, to: number | null | undefined, span: number): number | null {
  if (from == null || to == null || from <= 0 || to <= 0 || span < 0.9) return null;
  return (to / from) ** (1 / span) - 1;
}

/** Ejercicio de referencia hacia atrás (hasta `lookback` años) con el dato pedido. */
function base<T>(ys: YearFundamentals[], lookback: number, pick: (y: YearFundamentals) => T | null | undefined) {
  const last = ys.at(-1);
  if (!last) return null;
  for (let k = Math.min(lookback, ys.length - 1); k >= 1; k--) {
    const y = ys[ys.length - 1 - k]!;
    const v = pick(y);
    if (v !== null && v !== undefined) return { year: y, value: v, span: years(y.periodEnd, last.periodEnd) };
  }
  return null;
}

function growthPart(ys: YearFundamentals[], cfg: Cfg): QualityPart {
  const last = ys.at(-1);
  const rev = base(ys, cfg.lookbackYears, (y) => y.revenue?.value);
  const ni = base(ys, cfg.lookbackYears, (y) => y.netIncome?.value);
  const g = rev && last ? cagr(rev.value, last.revenue?.value, rev.span) : null;
  const gNi = ni && last ? cagr(ni.value, last.netIncome?.value, ni.span) : null;
  const scores = [g, gNi].filter((x): x is number => x !== null).map((x) => scale(x, cfg.growth.bad, cfg.growth.good));
  const label = "Crecimiento";
  if (g === null) return { id: "growth", label, score: null, value: null, explanation: "No hay ventas de varios ejercicios para medir el crecimiento." };
  return {
    id: "growth",
    label,
    score: scores.reduce((a, b) => a + b, 0) / scores.length,
    value: g,
    explanation:
      `Sus ventas crecen un ${pct(g)} al año` +
      (gNi !== null ? ` y su beneficio un ${pct(gNi)}` : " (el beneficio no se puede comparar: algún año fue negativo)") +
      ` en los últimos ${Math.round(rev!.span)} años.`,
  };
}

function marginsPart(current: Fundamentals, ys: YearFundamentals[], sym: string, cfg: Cfg): QualityPart {
  const label = "Márgenes";
  const level = current.operatingMargin.value ?? ys.at(-1)?.operatingMargin.value ?? null;
  if (level === null) {
    // Bancos y aseguradoras: no hay beneficio operativo; se mira el margen neto
    const net = current.netMargin?.value ?? ys.at(-1)?.netMargin?.value ?? null;
    if (net === null) return { id: "margins", label, score: null, value: null, explanation: "Falta el beneficio operativo para calcular el margen." };
    return {
      id: "margins",
      label,
      score: scale(net, cfg.margins.levelBad, cfg.margins.levelGood),
      value: net,
      explanation: `No publica beneficio operativo (pasa en bancos): de cada 100 ${sym} que ingresa, le quedan ${Math.round(net * 100)} ${sym} de beneficio neto.`,
    };
  }
  const last = ys.at(-1)?.operatingMargin.value ?? null;
  const ref = base(ys, cfg.lookbackYears, (y) => y.operatingMargin.value);
  const trend = last !== null && ref ? last - ref.value : null;
  const m = cfg.margins;
  const levelScore = scale(level, m.levelBad, m.levelGood);
  const score = trend === null ? levelScore : (levelScore + scale(trend, m.trendBad, m.trendGood)) / 2;
  const points = (x: number) => `${Math.abs(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} puntos`;
  return {
    id: "margins",
    label,
    score,
    value: level,
    explanation:
      `De cada 100 ${sym} que vende, le quedan ${Math.round(level * 100)} ${sym} de beneficio operativo` +
      (trend === null ? "." : Math.abs(trend) < 0.005 ? "; el margen está estable." : `; el margen ha ${trend > 0 ? "mejorado" : "empeorado"} ${points(trend)} en ${Math.round(ref!.span)} años.`),
  };
}

function cashPart(ys: YearFundamentals[], sym: string, cfg: Cfg): QualityPart {
  const label = "Conversión en caja";
  const recent = ys.slice(-cfg.lookbackYears).filter((y) => y.freeCashFlow.value !== null && y.netIncome);
  const fcf = recent.reduce((a, y) => a + y.freeCashFlow.value!, 0);
  const ni = recent.reduce((a, y) => a + y.netIncome!.value, 0);
  if (recent.length === 0) return { id: "cashConversion", label, score: null, value: null, explanation: "Faltan datos de caja libre." };
  if (ni <= 0) {
    return { id: "cashConversion", label, score: fcf > 0 ? 50 : 0, value: null, explanation: fcf > 0 ? "Genera caja aunque no tiene beneficios: no se puede medir la conversión." : "No tiene beneficios ni genera caja libre." };
  }
  const c = fcf / ni;
  return {
    id: "cashConversion",
    label,
    score: scale(c, cfg.cashConversion.bad, cfg.cashConversion.good),
    value: c,
    explanation: `Por cada 100 ${sym} de beneficio, entran ${Math.round(c * 100)} ${sym} de caja libre (suma de los últimos ${recent.length} ejercicios).`,
  };
}

function debtPart(level: DebtLevel | null, cfg: Cfg): QualityPart {
  const label = "Deuda";
  if (!level) return { id: "debt", label, score: null, value: null, explanation: "Faltan datos de deuda." };
  const text = { Baja: "Su deuda es baja o tiene más caja que deuda.", Moderada: "Su deuda es moderada.", Alta: "Su deuda es alta para la caja que genera." };
  return { id: "debt", label, score: cfg.debt[level], value: null, explanation: text[level] };
}

function sharesChange(ys: YearFundamentals[], cfg: Cfg): { perYear: number; span: number } | null {
  const last = ys.at(-1);
  const ref = base(ys, cfg.lookbackYears, (y) => y.shares?.value);
  const g = ref && last ? cagr(ref.value, last.shares?.value, ref.span) : null;
  return g === null ? null : { perYear: g, span: ref!.span };
}

function dilutionPart(ys: YearFundamentals[], cfg: Cfg): QualityPart {
  const label = "Acciones en circulación";
  const s = sharesChange(ys, cfg);
  if (!s) return { id: "dilution", label, score: null, value: null, explanation: "Falta el número de acciones de varios años." };
  const what =
    Math.abs(s.perYear) < 0.002
      ? "El número de acciones apenas cambia"
      : s.perYear > 0
        ? `Emite acciones nuevas: un ${pct(s.perYear)} más cada año, lo que reparte el beneficio entre más acciones`
        : `Recompra acciones: un ${pct(-s.perYear)} menos cada año, lo que reparte el beneficio entre menos acciones`;
  return { id: "dilution", label, score: scale(s.perYear, cfg.dilution.bad, cfg.dilution.good), value: s.perYear, explanation: `${what}.` };
}

/** Señales de trampa de valor (§8.3), por ejercicios anuales. */
export function trapSignals(ys: YearFundamentals[], current: Fundamentals, cfg: Cfg = QUALITY_CONFIG): TrapSignal[] {
  const t = cfg.trap;
  const at = (k: number) => ys[ys.length - 1 - k];
  const v = (k: number, pick: (y: YearFundamentals) => number | null | undefined) => {
    const y = at(k);
    const x = y ? pick(y) : null;
    return x ?? null;
  };

  const r0 = v(0, (y) => y.revenue?.value);
  const r1 = v(1, (y) => y.revenue?.value);
  const r3 = v(Math.min(3, ys.length - 1), (y) => y.revenue?.value);
  const salesFalling = r0 === null || r1 === null || r3 === null || ys.length < 2 ? null : r0 < r1 && r0 < r3;

  const ms = Array.from({ length: t.marginYearsDown + 1 }, (_, k) => v(k, (y) => y.operatingMargin.value));
  const marginsDown = ms.some((x) => x === null) ? null : ms.every((x, k) => k === ms.length - 1 || x! < ms[k + 1]!);

  const d0 = v(0, (y) => y.netDebt.value);
  const d2 = v(2, (y) => y.netDebt.value);
  const debtGrowing = d0 === null || d2 === null ? null : d0 > 0 && (d2 <= 0 || d0 > d2 * (1 + t.debtGrowth));

  const f0 = current.freeCashFlow.value ?? v(0, (y) => y.freeCashFlow.value);
  const f1 = v(1, (y) => y.freeCashFlow.value);
  const fcfWeak = f0 === null ? null : f0 <= 0 || (f1 !== null && f1 > 0 && f0 < f1 * (1 - t.fcfDrop));

  const s = sharesChange(ys, cfg);
  const dilution = s ? s.perYear > t.dilutionPerYear : null;

  return [
    { id: "salesFalling", label: "Ventas cayendo", active: salesFalling, detail: "Vende menos que el año anterior y que hace 3 años." },
    { id: "marginsDown", label: "Márgenes empeorando", active: marginsDown, detail: `El margen operativo ha bajado ${t.marginYearsDown} años seguidos.` },
    { id: "debtGrowing", label: "Deuda creciendo", active: debtGrowing, detail: `La deuda neta ha subido más de un ${Math.round(t.debtGrowth * 100)} % en 2 años.` },
    { id: "fcfWeak", label: "Caja libre negativa o en caída", active: fcfWeak, detail: `La caja libre es negativa o ha caído más de un ${Math.round(t.fcfDrop * 100)} % en un año.` },
    { id: "dilution", label: "Dilución relevante", active: dilution, detail: `Emite más de un ${Math.round(t.dilutionPerYear * 100)} % de acciones nuevas al año.` },
  ];
}

/**
 * Rentabilidad sobre el capital (beneficio ÷ patrimonio), media de los últimos
 * años. Solo cuenta en empresas sin caja libre medible (bancos, aseguradoras),
 * donde sustituye a la conversión en caja: es su forma de medir si el negocio rinde.
 */
function roePart(ys: YearFundamentals[], cfg: Cfg): QualityPart {
  const label = "Rentabilidad sobre el capital";
  const roes = ys
    .slice(-cfg.lookbackYears)
    .map((y) => {
      const ni = y.netIncome?.value;
      const eq = y.statement?.values.equity?.value;
      return ni != null && eq != null && eq > 0 ? ni / eq : null;
    })
    .filter((x): x is number => x !== null);
  if (roes.length === 0) return { id: "roe", label, score: null, value: null, explanation: "Falta el beneficio o el patrimonio." };
  const roe = roes.reduce((a, b) => a + b, 0) / roes.length;
  return {
    id: "roe",
    label,
    score: scale(roe, cfg.roe.bad, cfg.roe.good),
    value: roe,
    explanation: `Gana ${pct(roe)} al año sobre el dinero de sus accionistas (media de ${roes.length} años).`,
  };
}

/** `sym`: símbolo de la divisa de las cuentas, para las frases («100 $»). */
export function qualityScore(current: Fundamentals, ys: YearFundamentals[], debt: DebtLevel | null, sym = "€", cfg: Cfg = QUALITY_CONFIG): QualityScore {
  const parts = [growthPart(ys, cfg), marginsPart(current, ys, sym, cfg), cashPart(ys, sym, cfg), debtPart(debt, cfg), dilutionPart(ys, cfg)];
  // Sin beneficio operativo ni caja libre (bancos): la rentabilidad sobre el capital ocupa su lugar
  const noOperating = (current.operatingMargin.value ?? ys.at(-1)?.operatingMargin.value ?? null) === null;
  if (noOperating && parts.find((p) => p.id === "cashConversion")!.score === null) parts.push(roePart(ys, cfg));
  const signals = trapSignals(ys, current, cfg);
  const activeSignals = signals.filter((s) => s.active).length;
  const scored = parts.filter((p) => p.score !== null);
  if (scored.length < cfg.minParts) {
    return { score: null, parts, signals, activeSignals, note: "Faltan datos de varios ejercicios para puntuar la calidad." };
  }
  // Pesos repartidos entre las partes con dato
  const w = scored.reduce((a, p) => a + cfg.weights[p.id], 0);
  const score = scored.reduce((a, p) => a + p.score! * cfg.weights[p.id], 0) / w;
  return { score, parts, signals, activeSignals };
}

/** ¿Márgenes muy por encima de lo normal en esta empresa? Aviso para cíclicas en máximos. */
export function marginsAtPeak(current: Fundamentals, ys: YearFundamentals[], cfg: Cfg = QUALITY_CONFIG): boolean {
  const now = current.operatingMargin.value;
  const past = ys.slice(-cfg.peak.years).map((y) => y.operatingMargin.value).filter((x): x is number => x !== null);
  if (now === null || past.length < 3) return false;
  const sorted = [...past].sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return now - mid >= cfg.peak.minGap && (mid <= 0 || now >= mid * cfg.peak.ratio);
}
