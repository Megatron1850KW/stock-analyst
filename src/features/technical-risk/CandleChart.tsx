import { CandlestickSeries, ColorType, createChart, LineSeries, LineStyle, PriceScaleMode, type CandlestickData, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BarRow } from "@/db/repo";
import { movingAverage, type Level } from "@/domain/technical/risk";
import { formatDate, formatMonthYear, formatNumber } from "@/lib/format";

/**
 * Velas de largo plazo con TradingView Lightweight Charts (Apache 2.0):
 * mensuales o semanales, con la media de fondo y los soportes/resistencias.
 * Colores de los tokens del tema; se repinta al cambiar de claro a oscuro.
 */

function subscribeTheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", cb);
  return () => {
    obs.disconnect();
    mq.removeEventListener("change", cb);
  };
}
const themeKey = () => `${document.documentElement.getAttribute("data-theme") ?? ""}|${window.matchMedia("(prefers-color-scheme: dark)").matches}`;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const toTime = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) / 1000) as UTCTimestamp;
const fromTime = (t: Time) => new Date((t as number) * 1000).toISOString().slice(0, 10);

export interface CandleChartProps {
  bars: BarRow[];
  interval: "1mo" | "1w";
  currency: string;
  support: Level | null;
  resistance: Level | null;
}

export function CandleChart({ bars, interval, currency, support, resistance }: CandleChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useSyncExternalStore(subscribeTheme, themeKey);
  const [hover, setHover] = useState<{ date: string; open: number; high: number; low: number; close: number; ma: number | null } | null>(null);
  const maPeriods = interval === "1mo" ? 10 : 40;
  const cur = currency === "GBp" ? "GBp" : currency;
  const money = (v: number) => `${formatNumber(v, v >= 1000 ? 0 : 2)} ${cur}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || bars.length === 0) return;
    const text = token("--text-muted");
    const grid = token("--chart-grid");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: grid } },
      // Escala logarítmica: en 10 años una subida del 10 % ocupa lo mismo a 50 que a 500
      rightPriceScale: { borderVisible: false, mode: PriceScaleMode.Logarithmic },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      localization: { locale: "es-ES", priceFormatter: (p: number) => formatNumber(p, p >= 1000 ? 0 : 2), timeFormatter: (t: Time) => formatMonthYear(fromTime(t)) },
      handleScroll: false,
      handleScale: false,
    });
    const up = token("--positive");
    const down = token("--negative");
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
      priceLineVisible: false, lastValueVisible: true,
    });
    candles.setData(
      bars.map((b) => ({ time: toTime(b.date), open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close })),
    );
    const maData = movingAverage(bars, maPeriods);
    const ma = chart.addSeries(LineSeries, { color: token("--chart-2"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ma.setData(maData.map((p) => ({ time: toTime(p.date), value: p.value })));
    for (const [lvl, title] of [[support, "Soporte"], [resistance, "Resistencia"]] as const) {
      if (lvl) candles.createPriceLine({ price: lvl.price, color: text, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title });
    }
    chart.timeScale().fitContent();
    const maByDate = new Map(maData.map((p) => [p.date, p.value]));
    chart.subscribeCrosshairMove((param) => {
      const d = (param.time ? param.seriesData.get(candles) : undefined) as CandlestickData | undefined;
      if (!d || d.open === undefined) return setHover(null);
      const date = fromTime(param.time!);
      setHover({ date, open: d.open, high: d.high, low: d.low, close: d.close, ma: maByDate.get(date) ?? null });
    });
    return () => chart.remove();
  }, [bars, maPeriods, support, resistance, theme]);

  const last = bars.at(-1);
  const shown = hover ?? (last ? { date: last.date, open: last.open ?? last.close, high: last.high ?? last.close, low: last.low ?? last.close, close: last.close, ma: null } : null);
  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted tabular" aria-live="polite">
        {shown && (
          <span>
            <span className="text-text">{interval === "1mo" ? formatMonthYear(shown.date) : `Semana del ${formatDate(shown.date)}`}</span> · apertura {money(shown.open)} · máx. {money(shown.high)} · mín. {money(shown.low)} · cierre{" "}
            <span className="font-medium text-text">{money(shown.close)}</span>
            {shown.ma !== null && <> · media {money(shown.ma)}</>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--chart-2)]" aria-hidden /> Media de {interval === "1mo" ? "10 meses" : "40 semanas"}</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-muted" aria-hidden /> Soporte / resistencia</span>
        </span>
      </div>
      <div ref={ref} className="h-[340px] w-full" role="img" aria-label={`Velas ${interval === "1mo" ? "mensuales" : "semanales"} con su media de largo plazo`} />
      <figcaption className="sr-only">Gráfico de velas; usa la tabla de indicadores para los valores.</figcaption>
    </figure>
  );
}
