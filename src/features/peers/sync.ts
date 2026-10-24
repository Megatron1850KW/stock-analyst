import type { PriceProvider } from "@/data/prices/provider";
import type { SecClient } from "@/data/sec-edgar/client";
import type { Db } from "@/db/client";
import { addPeer, type PeerSource } from "@/db/peers-repo";
import { deleteIfUnused, getLatestQuote } from "@/db/repo";
import { refreshPrices } from "@/features/prices/refresh";
import { importUsTicker } from "@/features/watchlist/import-us";

/**
 * Guarda los datos de los competidores (SEC + precio) sin añadirlos a tu
 * watchlist. Si ya estaban guardados (por ser competidor de otro valor o
 * estar en tu watchlist), no se vuelven a descargar.
 */

export interface PeerSyncDeps {
  db: Db;
  sec: SecClient;
  /** Sin proveedor de precios se guardan solo los informes. */
  prices: PriceProvider | null;
  today?: Date;
}

export interface PeerSyncResult {
  added: string[];
  failed: { ticker: string; message: string }[];
}

/** La lista de tickers de la SEC se pide una sola vez por tanda. */
export function memoTickers(sec: SecClient): SecClient {
  let tickers: ReturnType<SecClient["tickers"]> | null = null;
  return { ...sec, tickers: () => (tickers ??= sec.tickers()) };
}

async function securityByCik(db: Db, cik: string) {
  const rows = await db.select<{ id: number; filings: number }>(
    "SELECT s.id, (SELECT COUNT(*) FROM filings f WHERE f.security_id = s.id) AS filings FROM securities s WHERE s.cik = ?",
    [cik],
  );
  return rows[0] ?? null;
}

export async function linkPeers(
  deps: PeerSyncDeps,
  securityId: number,
  peers: { ticker: string; cik?: string; reason: string | null }[],
  source: PeerSource,
): Promise<PeerSyncResult> {
  const { db } = deps;
  const sec = memoTickers(deps.sec);
  const result: PeerSyncResult = { added: [], failed: [] };
  /** Descargados en esta tanda que al final no se pudieron enlazar. */
  const orphans: number[] = [];
  for (const p of peers) {
    let imported: number | null = null;
    try {
      const known = p.cik ? await securityByCik(db, p.cik) : null;
      if (!known || known.filings === 0) imported = (await importUsTicker(sec, db, p.ticker, undefined, deps.today, { watchlist: false })).securityId;
      const peerId = imported ?? known!.id;
      if (peerId === securityId) throw new Error("Es la propia empresa.");
      if (deps.prices && !(await getLatestQuote(db, peerId))) {
        const r = await refreshPrices(db, deps.prices, peerId);
        if (r.failed.length) result.failed.push({ ticker: p.ticker, message: `Precio: ${r.failed[0]!.message}` });
      }
      await addPeer(db, securityId, peerId, source, p.reason);
      result.added.push(p.ticker);
    } catch (e) {
      result.failed.push({ ticker: p.ticker, message: e instanceof Error ? e.message : String(e) });
      if (imported !== null) orphans.push(imported);
    }
  }
  // Un competidor que no se pudo enlazar no debe quedarse ocupando sitio. Solo se
  // miran los de esta tanda: otra búsqueda en paralelo puede tener los suyos a medio enlazar.
  for (const id of orphans) await deleteIfUnused(db, id);
  return result;
}
