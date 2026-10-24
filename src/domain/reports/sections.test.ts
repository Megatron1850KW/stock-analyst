// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fakeReportHtml } from "../../../tests/helpers/fake-claude";
import { clip, extractEuSections, extractSections, htmlToText } from "./sections";

describe("extractos de informes (HTML FICTICIO)", () => {
  it("pasa el HTML a texto sin la cabecera XBRL y con las entidades resueltas", () => {
    const t = htmlToText("<ix:header>oculto</ix:header><p>Management&#8217;s&nbsp;view &amp; more</p><p>B</p>");
    expect(t).toBe("Management’s view & more\nB");
  });

  it("encuentra negocio, riesgos y MD&A de un 10-K saltándose el índice", () => {
    const ex = extractSections("10-K", fakeReportHtml("10-K"));
    expect(ex.map((e) => e.section)).toEqual(["business", "risks", "mdna"]);
    const risks = ex.find((e) => e.section === "risks")!;
    expect(risks.text).toMatch(/^ITEM 1A\. RISK FACTORS/);
    expect(risks.text).toContain("One customer");
    expect(risks.text).not.toContain("UNRESOLVED");
    expect(ex.find((e) => e.section === "mdna")!.text).toContain("Margins improved & cash flow");
  });

  it("en un 10-Q toma el MD&A (Item 2) y no inventa secciones que no tiene", () => {
    const ex = extractSections("10-Q", fakeReportHtml("10-Q"));
    expect(ex.map((e) => e.section)).toEqual(["mdna"]);
    expect(ex[0]!.text).toContain("expand our plant in 2027");
    expect(ex[0]!.text).not.toContain("Quantitative");
  });

  it("recorta por un salto de línea y lo indica", () => {
    const text = "a".repeat(90) + "\n" + "b".repeat(50);
    expect(clip(text, 100)).toEqual({ text: "a".repeat(90), truncated: true });
    expect(clip("corto", 100)).toEqual({ text: "corto", truncated: false });
    const ex = extractSections("10-K", fakeReportHtml("10-K"), { business: 200, risks: 40_000, mdna: 40_000 });
    expect(ex[0]).toMatchObject({ section: "business", truncated: true });
    expect(ex[0]!.text.length).toBeLessThanOrEqual(200);
  });

  it("un formulario desconocido no da extractos", () => {
    expect(extractSections("8-K", fakeReportHtml("10-K"))).toEqual([]);
  });
});

describe("extractos de informes europeos ESEF (HTML FICTICIO)", () => {
  const para = (t: string, n: number) => Array.from({ length: n }, (_, k) => `<p>${t} ${k}: texto ficticio de relleno para la prueba.</p>`).join("");
  const html = [
    "<p>Índice</p><p>Modelo de negocio</p><p>Principales riesgos</p><p>Evolución previsible</p>",
    "<h2>Modelo de negocio</h2>",
    para("La empresa ficticia vende ropa en 50 mercados", 12),
    "<h2>Principales riesgos</h2>",
    para("Riesgo de tipo de cambio ficticio", 12),
    "<h2>Evolución previsible</h2>",
    para("La dirección espera crecer", 12),
  ].join("");

  it("encuentra las tres secciones por sus encabezados en español, saltándose el índice", () => {
    const ex = extractEuSections(html);
    expect(ex.map((e) => e.section)).toEqual(["business", "risks", "mdna"]);
    const business = ex.find((e) => e.section === "business")!;
    expect(business.text).toMatch(/^Modelo de negocio/);
    expect(business.text).toContain("vende ropa");
    expect(business.text).not.toContain("Riesgo de tipo de cambio");
    expect(ex.find((e) => e.section === "mdna")!.text).toContain("espera crecer");
  });

  it("extractSections usa la búsqueda europea para los informes ESEF", () => {
    expect(extractSections("ESEF", html).map((e) => e.section)).toEqual(["business", "risks", "mdna"]);
  });

  it("omite las secciones que no encuentra o que son demasiado cortas", () => {
    expect(extractEuSections("<h2>Outlook</h2><p>Breve.</p>")).toEqual([]);
  });
});
