// @vitest-environment node
/**
 * Extractos de informes REALES de la SEC (10-K y 10-Q de MU y GOOG,
 * descargados el 24-10-2026 y guardados comprimidos en tests/fixtures/sec-docs).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractSections } from "@/domain/reports/sections";

const doc = (name: string) => gunzipSync(readFileSync(join(__dirname, "../fixtures/sec-docs", `${name}.htm.gz`))).toString("utf8");

describe("secciones de informes reales", () => {
  it("10-K de Micron (ejercicio 2026): negocio, riesgos y MD&A", () => {
    const ex = extractSections("10-K", doc("MU-000072312526000023"));
    expect(ex.map((e) => e.section)).toEqual(["business", "risks", "mdna"]);
    const [business, risks, mdna] = ex;
    expect(business!.text).toMatch(/^Item 1\.\s*Business/i);
    expect(business!.text).toContain("DRAM");
    expect(risks!.fullLength).toBeGreaterThan(50_000);
    expect(risks!.text).toContain("average selling prices");
    expect(mdna!.text).toMatch(/^Item 7\.\s*Management/i);
    expect(mdna!.text).not.toMatch(/Item 7A\.\s*Quantitative/i);
  });

  it("10-K 2025 y 10-Q del 2T 2026 de Alphabet", () => {
    const k = extractSections("10-K", doc("GOOG-000165204426000018"));
    expect(k.map((e) => e.section)).toEqual(["business", "risks", "mdna"]);
    expect(k[0]!.text).toContain("Google Cloud");
    const q = extractSections("10-Q", doc("GOOG-000165204426000071"));
    expect(q.map((e) => e.section).sort()).toEqual(["mdna", "risks"]);
    expect(q.find((e) => e.section === "mdna")!.text).toContain("Google Cloud");
  });
});
