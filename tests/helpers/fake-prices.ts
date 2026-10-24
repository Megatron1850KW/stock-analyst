import type { PriceBar, PriceProvider, Split } from "@/data/prices/provider";

/**
 * Proveedor de precios FICTICIO para tests: cierres diarios (días laborables)
 * que suben de forma suave desde `from` hasta `to`, más un split 2×1 opcional.
 */
export function fakeDaily(from: string, to: string, start = 50, yearlyGrowth = 0.1): PriceBar[] {
  const bars: PriceBar[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  let k = 0;
  while (d.getTime() <= end) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const close = Math.round(start * Math.pow(1 + yearlyGrowth, k / 252) * 100) / 100;
      bars.push({ date: d.toISOString().slice(0, 10), open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 });
      k++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return bars;
}

export interface FakePriceOptions {
  price?: number;
  quoteDate?: string;
  historyTo?: string;
  splits?: Split[] | "error";
  calls?: string[];
}

export function fakePrices(opts: FakePriceOptions = {}): PriceProvider {
  const calls = opts.calls ?? [];
  return {
    id: "test",
    label: "Proveedor ficticio",
    quote: async (s) => {
      calls.push(`quote:${s}`);
      return { symbol: s, price: opts.price ?? 10.5, open: 10, high: 11, low: 9.9, volume: 5, date: opts.quoteDate ?? "2026-10-23" };
    },
    history: async (s, from) => {
      calls.push(`history:${s}:${from}`);
      return fakeDaily(from, opts.historyTo ?? "2026-10-23");
    },
    splits: async (s) => {
      calls.push(`splits:${s}`);
      if (opts.splits === "error") throw new Error("Restricted Endpoint");
      return opts.splits ?? [];
    },
  };
}
