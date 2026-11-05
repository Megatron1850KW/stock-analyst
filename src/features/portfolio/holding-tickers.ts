import { useQuery } from "@tanstack/react-query";
import { getAppState, setAppState } from "@/db/calendar-repo";
import type { Db } from "@/db/client";
import { tauriSecClient } from "@/data/sec-edgar/client";
import type { TickersExchange } from "@/data/sec-edgar/schemas";
import { companyKey, holdingId, tickerFor, tickerIndex, type ListedCompany } from "@/domain/portfolio/holdings";
import { secUserAgent } from "@/features/settings/schema";
import { appDb } from "@/platform/database";
import { loadSettings } from "@/platform/settings-store";
import type { FundLine } from "./FundsTable";

/**
 * Ticker de cada posición de los fondos («Advanced Micro Devices» → «AMD»).
 * Primero se buscan entre las acciones que ya tienes guardadas; luego en la
 * lista oficial de tickers de la SEC, que se pide solo cuando aparece una
 * posición nueva (una ficha nueva). El resultado, también «sin ticker», se
 * guarda en tu Mac para no volver a pedirlo. Si no hay ticker seguro, se
 * muestra el nombre completo.
 */

const STATE_KEY = "holding_tickers";
type Cache = Record<string, string | null>;

function listed(t: TickersExchange): ListedCompany[] {
  const col = (f: string) => t.fields.indexOf(f);
  const [c, n, k, e] = [col("cik"), col("name"), col("ticker"), col("exchange")];
  return t.data.map((r) => ({ cik: String(r[c]), name: String(r[n] ?? ""), ticker: String(r[k] ?? ""), exchange: r[e] == null ? null : String(r[e]) }));
}

export async function resolveHoldingTickers(db: Db, names: string[], fetchTickers: (() => Promise<TickersExchange>) | null): Promise<Map<string, string>> {
  let cache: Cache = {};
  try {
    cache = JSON.parse((await getAppState(db, STATE_KEY)) ?? "{}") as Cache;
  } catch {
    cache = {};
  }
  // Acciones que ya sigues: su ticker manda (también las europeas)
  const own = new Map<string, string>();
  for (const s of await db.select<{ ticker: string; name: string }>("SELECT ticker, name FROM securities WHERE kind = 'stock'")) {
    const k = companyKey(s.name);
    if (k && !own.has(k)) own.set(k, s.ticker);
  }
  // Con clase (GOOGL/GOOG) se pregunta siempre a la SEC; sin clase basta con tu acción guardada
  const missing = [...new Set(names.map(holdingId))].filter((id) => {
    const [k, cls] = id.split("|");
    return !(id in cache) && !(own.has(k!) && !cls);
  });
  if (missing.length && fetchTickers) {
    try {
      const index = tickerIndex(listed(await fetchTickers()));
      for (const name of names) {
        const id = holdingId(name);
        if (missing.includes(id)) cache[id] = tickerFor(name, index);
      }
      await setAppState(db, STATE_KEY, JSON.stringify(cache));
    } catch (e) {
      // Sin red o sin respuesta de la SEC: se muestra el nombre y se reintenta otro día
      console.warn("[etf] tickers de la SEC no disponibles:", e instanceof Error ? e.message : e);
    }
  }
  const out = new Map<string, string>();
  for (const name of names) {
    const id = holdingId(name);
    // En una empresa con varias clases (GOOGL/GOOG) manda la lista de la SEC
    const t = cache[id] ?? own.get(companyKey(name)) ?? null;
    if (t) out.set(name, t);
  }
  return out;
}

/** Tickers de las 10 mayores posiciones de cada fondo de la tabla. */
export function useHoldingTickers(funds: FundLine[]) {
  const names = [...new Set(funds.flatMap((f) => f.profile?.holdings.slice(0, 10).map((h) => h.name) ?? []))].sort();
  return useQuery({
    queryKey: ["holding-tickers", names],
    enabled: names.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const ua = secUserAgent(await loadSettings());
      return resolveHoldingTickers(await appDb(), names, ua ? () => tauriSecClient(ua).tickers() : null);
    },
  });
}
