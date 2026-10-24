import type { EuClient } from "@/data/esef/client";
import type { EsefFiling, FigiRow, XbrlJson } from "@/data/esef/schemas";

/**
 * Fuentes europeas FICTICIAS para los tests: «Ficticia Textil S.A.» (España)
 * y su competidora «Ficticia Moda SE» (Francia), con ISIN inventados pero con
 * dígito de control válido, ejercicio que cierra el 31 de enero (como algunas
 * empresas reales) y cifras inventadas que crecen un 10 % al año.
 */
export const FAKE_ISIN = "ES0000000010";
export const FAKE_LEI = "FICTICIO0000000000ES";
export const FAKE_PEER_ISIN = "FR0000000010";
const FAKE_PEER_LEI = "FICTICIO0000000000FR";
/** La moda ficticia es un 60 % del tamaño de la textil. */
const SIZE: Record<string, number> = { [FAKE_LEI]: 1, [FAKE_PEER_LEI]: 0.6 };
export const FAKE_YEARS = [2026, 2025, 2024, 2023, 2022];

const M = 1_000_000;
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

function yearFacts(fyEndYear: number, size = 1): Record<string, number> {
  const k = size * 1.1 ** (fyEndYear - 2022);
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
export function fakeXbrlJson(fyEndYear: number, lei = FAKE_LEI): XbrlJson {
  const facts: XbrlJson["facts"] = {};
  let n = 0;
  const add = (concept: string, value: number, period: string, unit = "iso4217:EUR", extra: Record<string, string> = {}) => {
    facts[`f-${n++}`] = { value: String(value), decimals: -6, dimensions: { concept: `ifrs-full:${concept}`, entity: `scheme:${lei}`, period, unit, ...extra } };
  };
  for (const y of [fyEndYear, fyEndYear - 1]) {
    const period = `${iso(y - 1, 2, 1)}T00:00:00/${iso(y, 2, 1)}T00:00:00`;
    for (const [concept, value] of Object.entries(yearFacts(y, SIZE[lei]))) {
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

const jsonUrl = (y: number, lei = FAKE_LEI) => `/${lei}/${iso(y, 1, 31)}/ESEF/${lei.slice(-2)}/0/${lei}-${iso(y, 1, 31)}.json`;
const reportUrl = (y: number, lei = FAKE_LEI) => `/${lei}/${iso(y, 1, 31)}/ESEF/${lei.slice(-2)}/0/${lei}-${iso(y, 1, 31)}/reports/informe-${y}.xhtml`;

export function fakeEu(opts: { years?: number[]; figi?: FigiRow[] } = {}) {
  const years = opts.years ?? FAKE_YEARS;
  const calls: string[] = [];
  const client: EuClient = {
    leiByIsin: async (isin) => {
      calls.push(`lei:${isin}`);
      if (isin === FAKE_PEER_ISIN) return { lei: FAKE_PEER_LEI, name: "FICTICIA MODA SE", country: "FR" };
      return isin === FAKE_ISIN ? { lei: FAKE_LEI, name: "FICTICIA TEXTIL, S.A.", country: "ES" } : null;
    },
    figi: async (isin) => {
      calls.push(`figi:${isin}`);
      if (isin === FAKE_PEER_ISIN) return [{ figi: "BBG000FICT03", name: "FICTICIA MODA", ticker: "FMD", exchCode: "FP", marketSector: "Equity" }];
      return (
        opts.figi ?? [
          { figi: "BBG000FICT01", name: "FICTICIA TEXTIL", ticker: "FTX", exchCode: "GY", marketSector: "Equity" },
          { figi: "BBG000FICT02", name: "FICTICIA TEXTIL", ticker: "FTX", exchCode: "SM", marketSector: "Equity" },
        ]
      );
    },
    esefFilings: async (lei): Promise<EsefFiling[]> => {
      calls.push(`esef:${lei}`);
      if (!(lei in SIZE)) return [];
      const cc = lei.slice(-2);
      return years.map((y) => ({
        id: `${cc}${y}`,
        attributes: {
          period_end: iso(y, 1, 31),
          fxo_id: `${lei}-${iso(y, 1, 31)}-ESEF-${cc}-0`,
          date_added: `${iso(y, 3, 20)} 00:00:00`,
          json_url: jsonUrl(y, lei),
          report_url: reportUrl(y, lei),
          country: cc,
        },
      }));
    },
    esefDocument: async (path) => {
      calls.push(`doc:${path}`);
      for (const lei of Object.keys(SIZE)) {
        const y = years.find((x) => jsonUrl(x, lei) === path);
        if (y) return fakeXbrlJson(y, lei);
      }
      throw new Error(`documento desconocido ${path}`);
    },
  };
  return { client, calls };
}
