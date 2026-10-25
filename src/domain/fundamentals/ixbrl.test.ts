// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addXbrlJson, emptyFacts } from "./esef";
import { ixNumber, parseIxbrl } from "./ixbrl";
import { normalizeCompanyFacts } from "./normalize";

// Informe Inline XBRL FICTICIO, con la estructura de un ESEF real (prefijo «ifrs» a propósito)
const XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
  xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
  xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
  xmlns:ifrs="https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full" xmlns:fic="http://ficticia.example/2025">
<head><title>Ficticia</title></head>
<body>
<div style="display:none"><ix:header><ix:resources>
  <xbrli:context id="FY25"><xbrli:entity><xbrli:identifier scheme="http://standards.iso.org/iso/17442">FICTICIO0000000000ES</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="FY25_seg"><xbrli:entity><xbrli:identifier scheme="http://standards.iso.org/iso/17442">FICTICIO0000000000ES</xbrli:identifier>
    <xbrli:segment><xbrldi:explicitMember dimension="ifrs:SegmentsAxis">fic:EuropaMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="I25"><xbrli:entity><xbrli:identifier scheme="http://standards.iso.org/iso/17442">FICTICIO0000000000ES</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context>
  <xbrli:unit id="EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>
  <xbrli:unit id="EURps"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unitNumerator>
    <xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
</ix:resources></ix:header></div>
<table>
  <tr><td>Ventas</td><td><ix:nonFraction name="ifrs:Revenue" contextRef="FY25" unitRef="EUR" decimals="-3" scale="3" format="ixt:num-dot-decimal">1,234,567</ix:nonFraction></td></tr>
  <tr><td>Ventas Europa</td><td><ix:nonFraction name="ifrs:Revenue" contextRef="FY25_seg" unitRef="EUR" decimals="-3" scale="3" format="ixt:num-dot-decimal">500,000</ix:nonFraction></td></tr>
  <tr><td>Beneficio</td><td><ix:nonFraction name="ifrs:ProfitLossAttributableToOwnersOfParent" contextRef="FY25" unitRef="EUR" decimals="-3" scale="3" format="ixt:num-comma-decimal">98.765,4</ix:nonFraction></td></tr>
  <tr><td>Inversiones</td><td>(<ix:nonFraction name="ifrs:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities" contextRef="FY25" unitRef="EUR" decimals="-3" scale="3" format="ixt:num-dot-decimal">45,000</ix:nonFraction>)</td></tr>
  <tr><td>Pérdida otra</td><td><ix:nonFraction name="fic:OtroResultado" contextRef="FY25" unitRef="EUR" decimals="-3" scale="3" sign="-" format="ixt:num-dot-decimal">1,000</ix:nonFraction></td></tr>
  <tr><td>Caja</td><td><ix:nonFraction name="ifrs:CashAndCashEquivalents" contextRef="I25" unitRef="EUR" decimals="-3" scale="3" format="ixt:fixed-zero">-</ix:nonFraction></td></tr>
  <tr><td>BPA</td><td><ix:nonFraction name="ifrs:DilutedEarningsLossPerShare" contextRef="FY25" unitRef="EURps" decimals="2" format="ixt:num-comma-decimal">0,45</ix:nonFraction></td></tr>
</table>
</body></html>`;

describe("informes ESEF subidos en ZIP (Inline XBRL ficticio)", () => {
  it("lee los formatos de número de ixt", () => {
    expect(ixNumber("1,234,567", "ixt:num-dot-decimal")).toBe(1234567);
    expect(ixNumber("1.234.567,8", "ixt:num-comma-decimal")).toBe(1234567.8);
    expect(ixNumber("-", "ixt:fixed-zero")).toBe(0);
    expect(ixNumber("1 234", "ixt:numdotdecimal")).toBe(1234);
    expect(ixNumber("n/a", "ixt:num-dot-decimal")).toBeNull();
  });

  it("convierte el informe en cifras con escala, signo, unidades y sin desgloses", () => {
    const doc = parseIxbrl(XHTML);
    const facts = emptyFacts("", "");
    addXbrlJson(facts, doc, { accession: "subido-1", filed: "2026-04-01" });
    const ref = { accession: "subido-1", form: "Anual (ZIP)", periodType: "annual" as const, reportDate: "2025-12-31", filingDate: "2026-04-01", primaryDocument: "" };
    const n = normalizeCompanyFacts(facts, [ref]);
    const v = (c: string) => n.facts.find((f) => f.concept === c)?.value;
    expect(v("revenue")).toBe(1_234_567_000);
    expect(v("net_income")).toBe(98_765_400);
    expect(v("capex")).toBe(45_000_000);
    expect(v("cash")).toBe(0);
    expect(n.facts.find((f) => f.concept === "eps_diluted")).toMatchObject({ value: 0.45, unit: "EUR/shares" });
    expect(n.facts.filter((f) => f.concept === "revenue")).toHaveLength(1);
    // La extensión propia de la empresa se guarda con el prefijo común «ext»
    expect(facts.facts.ext?.OtroResultado?.units.EUR?.[0]?.val).toBe(-1_000_000);
  });
});
