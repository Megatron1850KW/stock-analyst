import type { EuClient } from "@/data/esef/client";
import type { EsefFiling, FigiRow, XbrlJson } from "@/data/esef/schemas";

/**
 * Fuentes europeas FICTICIAS para los tests: «Ficticia Textil S.A.», ISIN
 * válido inventado, ejercicio que cierra el 31 de enero (como algunas
 * empresas reales) y cifras inventadas que crecen un 10 % al año.
 */
export const FAKE_ISIN = "ES0000000001";
export const FAKE_LEI = "FICTICIO0000000000ES";
export const FAKE_YEARS = [2026, 2025, 2024, 2023, 2022];

const M = 1_000_000;
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

function yearFacts(fyEndYear: number): Record<string, number> {
  const k = 1.1 ** (fyEndYear - 2022);
  return {
    Revenue: Math.round(1000 * k) * M,
    CostOfSales: Math.round(450 * k) * M,
    ProfitLossFromOperatingActivities: Math.round(180 * k) * M,
    ProfitLossAttributableToOwnersOfParent: Math.round(130 * k) * M,
    CashFlowsFromUsedInOperatingActivities: Math.round(200 * k) * M,
    PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities: Math.round(60 * k) * M,
    DilutedEarningsLossPerShare: Math.round(130 * k) / 100,
  };
}

/** xBRL-JSON con el año y su comparativo, como los reales de filings.xbrl.org. */
export function fakeXbrlJson(fyEndYear: number): XbrlJson {
  const facts: XbrlJson["facts"] = {};
  let n = 0;
  const add = (concept: string, value: number, period: string, unit = "iso4217:EUR", extra: Record<string, string> = {}) => {
    facts[`f-${n++}`] = { value: String(value), decimals: -6, dimensions: { concept: `ifrs-full:${concept}`, entity: `scheme:${FAKE_LEI}`, period, unit, ...extra } };
  };
  for (const y of [fyEndYear, fyEndYear - 1]) {
    const period = `${iso(y - 1, 2, 1)}T00:00:00/${iso(y, 2, 1)}T00:00:00`;
    for (const [concept, value] of Object.entries(yearFacts(y))) {
      add(concept, value, period, concept === "DilutedEarningsLossPerShare" ? "iso4217:EUR/xbrli:shares" : "iso4217:EUR");
    }
    const instant = `${iso(y, 2, 1)}T00:00:00`;
    add("CashAndCashEquivalents", 500 * M, instant);
    add("LongtermBorrowings", 100 * M, instant);
    add("CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", 20 * M, instant);
    add("EquityAttributableToOwnersOfParent", 900 * M, instant);
    // Desglose por segmento que no debe sumarse al total
    add("Revenue", 1 * M, period, "iso4217:EUR", { "ifrs-full:SegmentsAxis": "fic:OnlineMember" });
  }
  return { documentInfo: { documentType: "https://xbrl.org/2021/xbrl-json", namespaces: {} }, facts };
}

const jsonUrl = (y: number) => `/${FAKE_LEI}/${iso(y, 1, 31)}/ESEF/ES/0/${FAKE_LEI}-${iso(y, 1, 31)}.json`;

export function fakeEu(opts: { years?: number[]; figi?: FigiRow[] } = {}) {
  const years = opts.years ?? FAKE_YEARS;
  const calls: string[] = [];
  const client: EuClient = {
    leiByIsin: async (isin) => {
      calls.push(`lei:${isin}`);
      return isin === FAKE_ISIN ? { lei: FAKE_LEI, name: "FICTICIA TEXTIL, S.A.", country: "ES" } : null;
    },
    figi: async (isin) => {
      calls.push(`figi:${isin}`);
      return (
        opts.figi ?? [
          { figi: "BBG000FICT01", name: "FICTICIA TEXTIL", ticker: "FTX", exchCode: "GY", marketSector: "Equity" },
          { figi: "BBG000FICT02", name: "FICTICIA TEXTIL", ticker: "FTX", exchCode: "SM", marketSector: "Equity" },
        ]
      );
    },
    esefFilings: async (lei): Promise<EsefFiling[]> => {
      calls.push(`esef:${lei}`);
      return years.map((y) => ({
        id: String(y),
        attributes: { period_end: iso(y, 1, 31), fxo_id: `${FAKE_LEI}-${iso(y, 1, 31)}-ESEF-ES-0`, date_added: `${iso(y, 3, 20)} 00:00:00`, json_url: jsonUrl(y), country: "ES" },
      }));
    },
    esefDocument: async (path) => {
      calls.push(`doc:${path}`);
      const y = years.find((x) => jsonUrl(x) === path);
      if (!y) throw new Error(`documento desconocido ${path}`);
      return fakeXbrlJson(y);
    },
  };
  return { client, calls };
}
