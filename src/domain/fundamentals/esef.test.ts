// @vitest-environment node
import { describe, expect, it } from "vitest";
import { xbrlJsonSchema, type EsefFiling } from "@/data/esef/schemas";
import { addXbrlJson, closingDate, emptyFacts, periodTypeOf, pickEsefFilings, unitOf } from "./esef";
import { grossDebt, type Getter } from "./metrics";
import { normalizeCompanyFacts } from "./normalize";

// DATOS FICTICIOS: un informe ESEF inventado, con la forma de los reales de filings.xbrl.org
const ENTITY = "scheme:FICTICIO00000000000X";
const FY = "2025-02-01T00:00:00/2026-02-01T00:00:00";
const PY = "2024-02-01T00:00:00/2025-02-01T00:00:00";
const fact = (concept: string, value: string, period: string, unit = "iso4217:EUR", extra: Record<string, string> = {}) => ({
  value,
  decimals: -6,
  dimensions: { concept, entity: ENTITY, period, unit, ...extra },
});
const doc = xbrlJsonSchema.parse({
  documentInfo: { documentType: "https://xbrl.org/2021/xbrl-json", namespaces: {} },
  facts: {
    a: fact("ifrs-full:Revenue", "1000000000.0", FY),
    b: fact("ifrs-full:Revenue", "900000000.0", PY),
    // Desglose por segmento: no es el total del grupo
    c: fact("ifrs-full:Revenue", "400000000.0", FY, "iso4217:EUR", { "ifrs-full:SegmentsAxis": "fic:EuropaMember" }),
    d: fact("ifrs-full:ProfitLossAttributableToOwnersOfParent", "100000000.0", FY),
    e: fact("ifrs-full:CashAndCashEquivalents", "300000000.0", "2026-02-01T00:00:00"),
    f: fact("ifrs-full:LongtermBorrowings", "200000000.0", "2026-02-01T00:00:00"),
    g: fact("ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "50000000.0", "2026-02-01T00:00:00"),
    h: fact("ifrs-full:CurrentBorrowings", "30000000.0", "2026-02-01T00:00:00"),
    i: fact("ifrs-full:DilutedEarningsLossPerShare", "0.5", FY, "iso4217:EUR/xbrli:shares"),
    j: fact("fic:MargenPropio", "0.4", FY, "xbrli:pure"),
  },
});
const ACCN = "FICTICIO00000000000X-2026-01-31-ESEF-ES-0";

describe("informes ESEF (xBRL-JSON) — datos ficticios", () => {
  it("convierte las fechas de xBRL-JSON en fechas de cierre", () => {
    expect(closingDate("2026-02-01T00:00:00")).toBe("2026-01-31");
    expect(closingDate("2025-01-01T00:00:00")).toBe("2024-12-31");
    expect(closingDate("2025-12-31")).toBe("2025-12-31");
  });

  it("traduce las unidades", () => {
    expect(unitOf("iso4217:EUR")).toBe("EUR");
    expect(unitOf("xbrli:shares")).toBe("shares");
    expect(unitOf("iso4217:EUR/xbrli:shares")).toBe("EUR/shares");
  });

  const facts = emptyFacts("FICTICIO00000000000X", "Ficticia S.A.");
  const added = addXbrlJson(facts, doc, { accession: ACCN, filed: "2026-03-15" });
  const filing = { accession: ACCN, form: "ESEF", periodType: "annual" as const, reportDate: "2026-01-31", filingDate: "2026-03-15", primaryDocument: "/x.json" };
  const norm = normalizeCompanyFacts(facts, [filing]);
  const value = (concept: string, end = "2026-01-31") => norm.facts.find((f) => f.concept === concept && f.periodEnd === end)?.value;

  it("ignora los desgloses por dimensión y conserva el total y el comparativo", () => {
    expect(added).toBe(9);
    expect(value("revenue")).toBe(1_000_000_000);
    expect(value("revenue", "2025-01-31")).toBe(900_000_000);
    expect(norm.facts.find((f) => f.concept === "revenue")?.sourceTag).toBe("ifrs-full:Revenue");
    expect(norm.currency).toBe("EUR");
  });

  it("detecta que es un informe anual por la duración de sus cifras", () => {
    expect(periodTypeOf(facts, ACCN, "2026-01-31")).toBe("annual");
  });

  it("no cuenta dos veces la deuda a corto en NIIF", () => {
    const get: Getter = (concept) => {
      const f = norm.facts.find((x) => x.concept === concept && x.periodEnd === "2026-01-31");
      return f ? { label: concept, value: f.value, unit: f.unit, sources: [{ tag: f.sourceTag, value: f.value, unit: f.unit } as never] } : null;
    };
    // No corriente 200 + corriente (que ya incluye los préstamos a corto) 50; los 30 de CurrentBorrowings no se suman
    expect(grossDebt(get).value).toBe(250_000_000);
  });

  it("elige un informe por cierre: la última versión, con la fecha de la primera", () => {
    const f = (id: string, period: string, added: string, json: string | null): EsefFiling => ({
      id,
      attributes: { period_end: period, fxo_id: id, date_added: added, json_url: json, country: "ES" },
    });
    const picked = pickEsefFilings([
      f("L-2025-01-31-ESEF-ES-0", "2025-01-31", "2025-03-20 00:00:00", "/a0.json"),
      f("L-2025-01-31-ESEF-ES-1", "2025-01-31", "2026-10-20 12:00:00", "/a1.json"),
      f("L-2026-01-31-ESEF-ES-0", "2026-01-31", "2026-03-18 00:00:00", "/b.json"),
      f("L-2024-01-31-ESEF-ES-0", "2024-01-31", "2024-03-18 00:00:00", null),
    ]);
    expect(picked.map((p) => [p.reportDate, p.primaryDocument, p.filingDate])).toEqual([
      ["2026-01-31", "/b.json", "2026-03-18"],
      ["2025-01-31", "/a1.json", "2025-03-20"],
    ]);
  });
});

describe("etiquetas propias de la empresa en el xBRL-JSON (FICTICIO)", () => {
  it("se guardan con el prefijo común «ext» aunque cada año usen otro", () => {
    const fact = (concept: string, value: string) => ({ value, decimals: "-6", dimensions: { concept, entity: "scheme:FICTICIO", period: "2024-01-01T00:00:00/2025-01-01T00:00:00", unit: "iso4217:EUR" } });
    const doc = {
      documentInfo: { documentType: "https://xbrl.org/2021/xbrl-json", namespaces: { uc24: "https://www.banco-ficticio.example/esef/2024-12-31", "ifrs-full": "https://xbrl.ifrs.org/taxonomy/2023-03-23/ifrs-full" } },
      facts: { a: fact("uc24:GrossIncome", "24270000000"), b: fact("ifrs-full:ProfitLoss", "9774000000") },
    };
    const target = emptyFacts("FICTICIO", "BANCO FICTICIO");
    addXbrlJson(target, doc, { accession: "FICTICIO-2024", filed: "2025-03-01" });
    expect(target.facts.ext?.GrossIncome?.units.EUR?.[0]).toMatchObject({ end: "2024-12-31", val: 24_270_000_000 });
    expect(target.facts["ifrs-full"]?.ProfitLoss).toBeDefined();
  });
});
