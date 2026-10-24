import { describe, expect, it } from "vitest";
import { comparePeers, opportunityVerdict, type Comparable } from "./peer-verdict";

// Datos FICTICIOS
const c = (ticker: string, pe: number | null, pfcf: number | null, evEbit: number | null, quality: number | null = 60): Comparable => ({
  ticker,
  multiples: { pe, pfcf, evEbit },
  quality,
});
const peers = [c("A", 20, 25, 15), c("B", 22, 30, 16), c("C", 18, 20, 14, 50)];

describe("comparePeers", () => {
  it("compara cada múltiplo con la mediana de los competidores", () => {
    const r = comparePeers(c("T", 14, 18, 10, 70), peers);
    expect(r.multiples.find((m) => m.id === "pe")).toMatchObject({ peerMedian: 20, peers: 3 });
    expect(r.multiples.find((m) => m.id === "pe")?.deviation).toBeCloseTo(-0.3);
    expect(r.verdict).toBe("Barata");
    expect(r.quality).toEqual({ current: 70, peerMedian: 60 });
  });

  it("ignora múltiplos negativos (pérdidas) y exige al menos 2 competidores con dato", () => {
    const r = comparePeers(c("T", 20, null, null), [c("A", -5, null, null), c("B", 20, null, null)]);
    expect(r.verdict).toBeNull();
    expect(r.note).toMatch(/no son comparables/);
    expect(comparePeers(c("T", 20, 20, 20), [c("A", 20, 20, 20)]).note).toMatch(/al menos 2/);
  });
});

describe("opportunityVerdict (§8.3)", () => {
  const cheapPeers = comparePeers(c("T", 14, 18, 10, 70), peers);
  it("oportunidad: barata frente a historia y competencia, con calidad igual o mejor", () => {
    expect(opportunityVerdict({ history: "Barata", peers: cheapPeers, activeSignals: [] }).outcome).toBe("Oportunidad");
  });
  it("trampa: barata con 2 o más señales de deterioro, aunque la calidad compare bien", () => {
    const v = opportunityVerdict({ history: "Barata", peers: cheapPeers, activeSignals: ["Ventas cayendo", "Deuda creciendo"] });
    expect(v.outcome).toBe("Trampa de valor");
    expect(v.reason).toContain("ventas cayendo y deuda creciendo");
  });
  it("una sola señal no basta para hablar de trampa", () => {
    expect(opportunityVerdict({ history: "Barata", peers: cheapPeers, activeSignals: ["Ventas cayendo"] }).outcome).toBe("Oportunidad");
  });
  it("barata pero con peor calidad que la competencia: justa, con el motivo", () => {
    const worse = comparePeers(c("T", 14, 18, 10, 40), peers);
    const v = opportunityVerdict({ history: "Barata", peers: worse, activeSignals: [] });
    expect(v).toMatchObject({ outcome: "Justa" });
    expect(v.reason).toMatch(/calidad es inferior/);
  });
  it("cara frente a ambas; señales que no coinciden; sin competidores", () => {
    const expensive = comparePeers(c("T", 30, 40, 22), peers);
    expect(opportunityVerdict({ history: "Cara", peers: expensive, activeSignals: [] }).outcome).toBe("Cara");
    expect(opportunityVerdict({ history: "Barata", peers: expensive, activeSignals: [] }).reason).toMatch(/no coinciden/);
    expect(opportunityVerdict({ history: "Justa", peers: null, activeSignals: [] }).reason).toMatch(/falta compararla/);
    expect(opportunityVerdict({ history: null, peers: null, activeSignals: [] }).outcome).toBeNull();
  });
});
