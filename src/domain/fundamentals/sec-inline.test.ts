// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CompanyFacts } from "@/data/sec-edgar/schemas";
import { parseIxbrl } from "./ixbrl";
import { normalizeCompanyFacts } from "./normalize";
import { factsFromInline, mergeFacts } from "./sec-inline";

// 10-Q FICTICIO en Inline XBRL al estilo de la SEC: BPA solo por clase de acción (como Visa)
const ctx = (id: string, period: string, member?: string) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0009999999</xbrli:identifier>${
  member ? `<xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">${member}</xbrldi:explicitMember></xbrli:segment>` : ""
}</xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
const Q3 = "<xbrli:startDate>2025-10-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate>";
const XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
  xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
  xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
  xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:fic="http://ficticia.example/2026">
<head><title>Ficticia</title></head><body>
<div style="display:none"><ix:header><ix:resources>
  ${ctx("D", Q3)}${ctx("D_A", Q3, "us-gaap:CommonClassAMember")}${ctx("D_B", Q3, "fic:CommonClassBMember")}
  <xbrli:unit id="USD"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
  <xbrli:unit id="USDps"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator>
    <xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
</ix:resources></ix:header></div>
<p><ix:nonFraction name="us-gaap:Revenues" contextRef="D" unitRef="USD" decimals="-6" scale="6" format="ixt:num-dot-decimal">30,000</ix:nonFraction></p>
<p><ix:nonFraction name="us-gaap:NetIncomeLoss" contextRef="D" unitRef="USD" decimals="-6" scale="6" format="ixt:num-dot-decimal">15,000</ix:nonFraction></p>
<p><ix:nonFraction name="us-gaap:NetCashProvidedByUsedInOperatingActivities" contextRef="D" unitRef="USD" decimals="-6" scale="6" format="ixt:num-dot-decimal">16,000</ix:nonFraction></p>
<p><ix:nonFraction name="us-gaap:EarningsPerShareDiluted" contextRef="D_A" unitRef="USDps" decimals="2" format="ixt:num-dot-decimal">7.50</ix:nonFraction></p>
<p><ix:nonFraction name="us-gaap:EarningsPerShareDiluted" contextRef="D_B" unitRef="USDps" decimals="2" format="ixt:num-dot-decimal">11.90</ix:nonFraction></p>
</body></html>`;

const filing = { accession: "0009999999-26-000104", form: "10-Q", periodType: "interim" as const, reportDate: "2026-06-30", filingDate: "2026-07-29", primaryDocument: "fict-20260630.htm" };

describe("cifras leídas del propio 10-Q (Inline XBRL FICTICIO)", () => {
  it("rellena un informe que companyfacts aún no tiene y toma el BPA de la clase A", () => {
    const companyFacts: CompanyFacts = { cik: "9999999", entityName: "FICTICIA", facts: {} };
    expect(normalizeCompanyFacts(companyFacts, [filing]).facts).toHaveLength(0);

    const inline = factsFromInline(parseIxbrl(XHTML), { accession: filing.accession, filed: filing.filingDate });
    const merged = mergeFacts(companyFacts, inline);
    const n = normalizeCompanyFacts(merged, [filing]);
    const value = (c: string) => n.facts.find((f) => f.concept === c)?.value;
    expect(value("revenue")).toBe(30_000_000_000);
    expect(value("net_income")).toBe(15_000_000_000);
    // Clase A (la que cotiza), nunca la B
    expect(value("eps_diluted")).toBe(7.5);
    expect(n.facts.filter((f) => f.concept === "eps_diluted")).toHaveLength(1);
  });

  it("no pisa lo que companyfacts ya trae para ese informe", () => {
    const base: CompanyFacts = {
      cik: "9999999",
      entityName: "FICTICIA",
      facts: { "us-gaap": { Revenues: { units: { USD: [{ start: "2025-10-01", end: "2026-06-30", val: 1, accn: filing.accession, form: "10-Q", filed: "2026-07-29" }] } } } },
    };
    const merged = mergeFacts(base, factsFromInline(parseIxbrl(XHTML), { accession: filing.accession, filed: filing.filingDate }));
    expect(merged.facts["us-gaap"]!.Revenues!.units.USD!.map((e) => e.val)).toEqual([1]);
    expect(base.facts["us-gaap"]!.NetIncomeLoss).toBeUndefined();
  });
});
