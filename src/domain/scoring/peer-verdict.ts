import { median } from "@/domain/valuation/multiples";
import { PEERS_CONFIG, QUALITY_CONFIG, VALUATION_CONFIG } from "./config";
import { verdictFor, type Verdict } from "./valuation-score";

/**
 * Veredicto frente a la competencia y «¿oportunidad o trampa?» (CLAUDE.md §8.3).
 * Determinista: compara los múltiplos y la calidad con la mediana de los
 * competidores y combina el resultado con la valoración frente a su historia.
 */

export type PeerMultipleId = "pe" | "pfcf" | "evEbit";

export interface Comparable {
  ticker: string;
  /** Solo múltiplos positivos (con pérdidas o caja libre negativa no sirven para comparar). */
  multiples: Record<PeerMultipleId, number | null>;
  quality: number | null;
}

export interface PeerMultipleComparison {
  id: PeerMultipleId;
  current: number | null;
  peerMedian: number | null;
  /** current ÷ mediana de competidores − 1. */
  deviation: number | null;
  peers: number;
}

export interface PeerComparison {
  verdict: Verdict | null;
  /** Mediana de las desviaciones de los múltiplos frente a los competidores. */
  deviation: number | null;
  multiples: PeerMultipleComparison[];
  quality: { current: number | null; peerMedian: number | null };
  /** Competidores con algún dato comparable. */
  peersWithData: number;
  note?: string;
}

const positive = (x: number | null) => (x !== null && x > 0 ? x : null);

export function comparePeers(target: Comparable, peers: Comparable[], cfg = { peers: PEERS_CONFIG, valuation: VALUATION_CONFIG }): PeerComparison {
  const ids: PeerMultipleId[] = ["pe", "pfcf", "evEbit"];
  const multiples = ids.map((id): PeerMultipleComparison => {
    const values = peers.map((p) => positive(p.multiples[id])).filter((x): x is number => x !== null);
    const current = positive(target.multiples[id]);
    const peerMedian = values.length >= cfg.peers.minForVerdict ? median(values) : null;
    return { id, current, peerMedian, deviation: current !== null && peerMedian ? current / peerMedian - 1 : null, peers: values.length };
  });
  const devs = multiples.map((m) => m.deviation).filter((x): x is number => x !== null);
  const deviation = median(devs);
  const qualities = peers.map((p) => p.quality).filter((x): x is number => x !== null);
  const peersWithData = peers.filter((p) => ids.some((id) => positive(p.multiples[id]) !== null)).length;
  return {
    verdict: deviation === null ? null : verdictFor(deviation, cfg.valuation),
    deviation,
    multiples,
    quality: { current: target.quality, peerMedian: qualities.length >= cfg.peers.minForVerdict ? median(qualities) : null },
    peersWithData,
    note:
      deviation === null
        ? peers.length < cfg.peers.minForVerdict
          ? `Hacen falta al menos ${cfg.peers.minForVerdict} competidores con datos para comparar.`
          : "Los múltiplos de la empresa o de sus competidores no son comparables (pérdidas o caja libre negativa)."
        : undefined,
  };
}

export type Outcome = "Oportunidad" | "Trampa de valor" | "Justa" | "Cara";

export interface OpportunityVerdict {
  outcome: Outcome | null;
  /** Frase en llano con el porqué. */
  reason: string;
}

/**
 * §8.3. Trampa: barata (frente a su historia o a la competencia) y con 2 o más
 * señales de deterioro. Oportunidad: barata frente a su historia y a la
 * competencia, con calidad igual o mejor que la mediana de competidores.
 * Cara: cara frente a ambas. En otro caso, Justa, con la explicación.
 */
export function opportunityVerdict(input: {
  history: Verdict | null;
  peers: PeerComparison | null;
  activeSignals: string[];
  minSignals?: number;
}): OpportunityVerdict {
  const { history, peers, activeSignals } = input;
  const minSignals = input.minSignals ?? QUALITY_CONFIG.trap.minSignals;
  const vsPeers = peers?.verdict ?? null;
  const cheapSomewhere = history === "Barata" || vsPeers === "Barata";
  const list = (xs: string[]) => xs.map((x) => x.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " y $1");

  if (history === null && vsPeers === null) return { outcome: null, reason: "Sin valoración frente a su historia ni frente a la competencia no se puede juzgar." };
  if (cheapSomewhere && activeSignals.length >= minSignals) {
    return { outcome: "Trampa de valor", reason: `Parece barata, pero el negocio se deteriora: ${list(activeSignals)}. Lo barato puede estar justificado.` };
  }
  if (history === "Barata" && vsPeers === "Barata") {
    const q = peers?.quality;
    if (q && q.current !== null && q.peerMedian !== null) {
      return q.current >= q.peerMedian
        ? { outcome: "Oportunidad", reason: "Está barata frente a su historia y a la competencia, y su calidad es igual o mejor que la de sus competidores." }
        : { outcome: "Justa", reason: "Está barata frente a su historia y a la competencia, pero su calidad es inferior: no basta para llamarla oportunidad." };
    }
    return { outcome: "Justa", reason: "Está barata, pero sin la calidad de los competidores no se puede confirmar la oportunidad." };
  }
  if (history === "Cara" && vsPeers === "Cara") return { outcome: "Cara", reason: "Está cara frente a su historia y frente a la competencia." };
  if (vsPeers === null) {
    return { outcome: "Justa", reason: `Frente a su historia está ${history?.toLowerCase()}; falta compararla con la competencia para un veredicto completo.` };
  }
  if (history === null) return { outcome: "Justa", reason: `Frente a la competencia está ${vsPeers.toLowerCase()}; sin historia suficiente para confirmarlo.` };
  return {
    outcome: "Justa",
    reason: history === vsPeers
      ? `Está ${history.toLowerCase()} tanto frente a su historia como frente a la competencia.`
      : `Frente a su historia está ${history.toLowerCase()} y frente a la competencia, ${vsPeers.toLowerCase()}: las señales no coinciden.`,
  };
}
