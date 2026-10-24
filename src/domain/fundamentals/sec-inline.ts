import type { XbrlJson } from "@/data/esef/schemas";
import type { CompanyFacts } from "@/data/sec-edgar/schemas";
import { addXbrlJson, emptyFacts } from "./esef";
import { CLASS_A_DIMENSION } from "./ixbrl";

/**
 * Cifras de un 10-K / 10-Q leídas de su propio documento (Inline XBRL), sin IA,
 * para lo que el companyfacts de la SEC no trae:
 * - un informe reciente que la SEC aún no ha cargado en companyfacts (p. ej. el
 *   10-Q de Visa de junio de 2026, semanas después de presentarse);
 * - el beneficio por acción de empresas que solo lo dan por clase de acción
 *   (Visa: clases A, B y C). Se usa el de la clase A, la que cotiza, y solo si
 *   el informe no da uno sin desglosar. Las acciones se deducen después como
 *   beneficio neto ÷ BPA (metrics.ts) y se dice.
 */

const CLASS_A_TAGS = new Set(["us-gaap:EarningsPerShareBasic", "us-gaap:EarningsPerShareDiluted"]);

export function factsFromInline(doc: XbrlJson, filing: { accession: string; filed: string }): CompanyFacts {
  const plain = new Set<string>();
  for (const f of Object.values(doc.facts)) {
    if (Object.keys(f.dimensions).length <= 4 && !f.dimensions["xbrl:segment"] && !f.dimensions[CLASS_A_DIMENSION]) {
      plain.add(`${f.dimensions.concept}|${f.dimensions.period}`);
    }
  }
  const facts: XbrlJson["facts"] = {};
  for (const [id, f] of Object.entries(doc.facts)) {
    const { [CLASS_A_DIMENSION]: classA, ...dims } = f.dimensions;
    if (!classA) facts[id] = f;
    else if (CLASS_A_TAGS.has(dims.concept ?? "") && !plain.has(`${dims.concept}|${dims.period}`)) facts[id] = { ...f, dimensions: dims };
  }
  const out = emptyFacts("", "");
  addXbrlJson(out, { ...doc, facts }, filing);
  return out;
}

/** Añade a `base` las cifras de `extra` de los informes que `base` no tenga para esa etiqueta y unidad. */
export function mergeFacts(base: CompanyFacts, extra: CompanyFacts): CompanyFacts {
  const out: CompanyFacts = { ...base, facts: {} };
  for (const [prefix, concepts] of Object.entries(base.facts)) {
    out.facts[prefix] = {};
    for (const [name, c] of Object.entries(concepts)) {
      out.facts[prefix][name] = { ...c, units: Object.fromEntries(Object.entries(c.units).map(([u, e]) => [u, [...e]])) };
    }
  }
  for (const [prefix, concepts] of Object.entries(extra.facts)) {
    const target = (out.facts[prefix] ??= {});
    for (const [name, c] of Object.entries(concepts)) {
      const concept = (target[name] ??= { units: {} });
      for (const [unit, entries] of Object.entries(c.units)) {
        const list = (concept.units[unit] ??= []);
        const known = new Set(list.map((e) => e.accn));
        list.push(...entries.filter((e) => !known.has(e.accn)));
      }
    }
  }
  return out;
}
