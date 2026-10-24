/**
 * Respuestas FICTICIAS con el formato de Alpha Vantage (GLOBAL_QUOTE,
 * TIME_SERIES_*_ADJUSTED y SYMBOL_SEARCH) para los tests. Cifras inventadas.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Últimos días de mes (mensual) o viernes (semanal) desde 2015 hasta octubre de 2026. */
function dates(interval: "weekly" | "monthly"): string[] {
  const out: string[] = [];
  if (interval === "monthly") {
    for (let y = 2015; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === 2026 && m > 10) break;
        out.push(iso(new Date(Date.UTC(y, m, 0))));
      }
    }
    return out;
  }
  const d = new Date(Date.UTC(2015, 0, 2));
  while (d <= new Date(Date.UTC(2026, 9, 23))) {
    out.push(iso(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/**
 * Serie que sube un 8 % al año, con un dividendo del 1 % cada seis velas (que
 * mueve el cierre ajustado) y, si se pide, un split en una fecha.
 */
export function avSeriesJson(interval: "weekly" | "monthly", opts: { split?: { date: string; ratio: number }; start?: number } = {}): string {
  const ds = dates(interval);
  const perYear = interval === "weekly" ? 52 : 12;
  const series: Record<string, Record<string, string>> = {};
  // Factor de ajuste por dividendos acumulado desde el final (como lo publica Alpha Vantage)
  let divFactor = 1;
  const rows: { date: string; real: number; div: number }[] = [];
  ds.forEach((date, k) => {
    const fair = (opts.start ?? 30) * 1.08 ** (k / perYear);
    const split = opts.split && date >= opts.split.date ? opts.split.ratio : 1;
    rows.push({ date, real: fair / split, div: k % 6 === 5 ? 0.01 : 0 });
  });
  const splitFactorAfter = (date: string) => (opts.split && date < opts.split.date ? opts.split.ratio : 1);
  for (let k = rows.length - 1; k >= 0; k--) {
    const r = rows[k]!;
    const adjusted = (r.real / splitFactorAfter(r.date)) * divFactor;
    series[r.date] = {
      "1. open": (r.real * 0.99).toFixed(4),
      "2. high": (r.real * 1.03).toFixed(4),
      "3. low": (r.real * 0.97).toFixed(4),
      "4. close": r.real.toFixed(4),
      "5. adjusted close": adjusted.toFixed(4),
      "6. volume": "100000",
      "7. dividend amount": (r.real * r.div).toFixed(4),
    };
    if (r.div) divFactor *= 1 - r.div;
  }
  const key = interval === "weekly" ? "Weekly Adjusted Time Series" : "Monthly Adjusted Time Series";
  return JSON.stringify({ "Meta Data": { "1. Information": "Ficticio", "2. Symbol": "FTX.MC" }, [key]: series });
}

export function avQuoteJson(symbol: string, price: number): string {
  return JSON.stringify({
    "Global Quote": {
      "01. symbol": symbol, "02. open": String(price), "03. high": String(price), "04. low": String(price), "05. price": String(price),
      "06. volume": "1000", "07. latest trading day": "2026-10-23", "08. previous close": String(price), "09. change": "0", "10. change percent": "0%",
    },
  });
}

export function avSearchJson(): string {
  const m = (symbol: string, name: string, region: string, currency: string) => ({
    "1. symbol": symbol, "2. name": name, "3. type": "Equity", "4. region": region, "5. marketOpen": "09:00", "6. marketClose": "17:30",
    "7. timezone": "UTC+01", "8. currency": currency, "9. matchScore": "1.0000",
  });
  return JSON.stringify({
    bestMatches: [
      m("FTX.LON", "Fortex Mining plc", "United Kingdom", "GBX"),
      m("FTX.DEX", "Ficticia Textil SA", "XETRA", "EUR"),
      m("FTX.MC", "Ficticia Textil SA", "Spain/Madrid", "EUR"),
      m("FMD.PA", "Ficticia Moda SE", "Paris", "EUR"),
    ],
  });
}
