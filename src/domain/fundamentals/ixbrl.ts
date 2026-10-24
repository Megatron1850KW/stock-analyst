import type { XbrlJson } from "@/data/esef/schemas";

/**
 * Lectura determinista de un informe ESEF subido por ti (el .xhtml de dentro
 * del ZIP, en Inline XBRL). Devuelve los hechos numéricos con la misma forma
 * que el xBRL-JSON de filings.xbrl.org, para pasar por el mismo camino
 * (esef.ts → normalize.ts). Sin IA (CLAUDE.md §2.4).
 *
 * - Contextos con segmento (ejes y miembros) se marcan como desglose y se ignoran luego.
 * - Formatos de número de las transformaciones ixt (punto o coma decimal, guion = 0).
 * - `scale` (potencia de 10) y `sign="-"`.
 */

const IX = "http://www.xbrl.org/2013/inlineXBRL";
const XBRLI = "http://www.xbrl.org/2003/instance";
const IFRS_NS = /xbrl\.ifrs\.org\/taxonomy\/[\d-]+\/ifrs-full/;

const text = (el: Element | null | undefined) => (el?.textContent ?? "").trim();
const children = (el: Element, ns: string, name: string) => Array.from(el.getElementsByTagNameNS(ns, name));

/** Valor numérico de un ix:nonFraction según su formato ixt. */
export function ixNumber(raw: string, format: string | null): number | null {
  const fmt = (format ?? "").split(":").pop()!.toLowerCase().replace(/-/g, "");
  const s = raw.replace(/\s/g, "");
  if (/zero|nocontent|fixedempty/.test(fmt) || s === "-" || s === "–" || s === "—") return 0;
  let digits: string;
  if (fmt.includes("comma")) digits = s.replace(/[. ' ]/g, "").replace(",", ".");
  else digits = s.replace(/[, ' ]/g, "");
  digits = digits.replace(/[()]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return Number(digits);
}

function measureText(unit: Element): string | null {
  const divide = unit.getElementsByTagNameNS(XBRLI, "divide")[0];
  const m = (el: Element) => children(el, XBRLI, "measure").map(text)[0] ?? null;
  if (divide) {
    const num = divide.getElementsByTagNameNS(XBRLI, "unitNumerator")[0];
    const den = divide.getElementsByTagNameNS(XBRLI, "unitDenominator")[0];
    const a = num && m(num);
    const b = den && m(den);
    return a && b ? `${a}/${b}` : null;
  }
  return m(unit);
}

/** «iso4217:EUR» con el prefijo canónico aunque el documento use otro. */
function canonicalMeasure(unit: string, el: Element): string {
  return unit
    .split("/")
    .map((part) => {
      const [prefix, name] = part.split(":");
      if (!name) return part;
      const ns = el.lookupNamespaceURI(prefix ?? null) ?? "";
      if (ns.includes("iso4217")) return `iso4217:${name}`;
      if (ns === XBRLI) return `xbrli:${name}`;
      return part;
    })
    .join("/");
}

export function parseIxbrl(xhtml: string): XbrlJson {
  const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("El informe del ZIP no es un XHTML válido.");

  const contexts = new Map<string, { entity: string; period: string; dimensional: boolean }>();
  for (const ctx of children(doc.documentElement, XBRLI, "context")) {
    const id = ctx.getAttribute("id");
    if (!id) continue;
    const entity = text(ctx.getElementsByTagNameNS(XBRLI, "identifier")[0]);
    const instant = text(ctx.getElementsByTagNameNS(XBRLI, "instant")[0]);
    const start = text(ctx.getElementsByTagNameNS(XBRLI, "startDate")[0]);
    const end = text(ctx.getElementsByTagNameNS(XBRLI, "endDate")[0]);
    const period = instant || (start && end ? `${start}/${end}` : "");
    const dimensional = ctx.getElementsByTagNameNS(XBRLI, "segment").length > 0 || ctx.getElementsByTagNameNS(XBRLI, "scenario").length > 0;
    if (period) contexts.set(id, { entity: `scheme:${entity}`, period, dimensional });
  }
  const units = new Map<string, string>();
  for (const u of children(doc.documentElement, XBRLI, "unit")) {
    const id = u.getAttribute("id");
    const m = measureText(u);
    if (id && m) units.set(id, canonicalMeasure(m, u));
  }

  const facts: XbrlJson["facts"] = {};
  let k = 0;
  for (const el of children(doc.documentElement, IX, "nonFraction")) {
    const ctx = contexts.get(el.getAttribute("contextRef") ?? "");
    const unit = units.get(el.getAttribute("unitRef") ?? "");
    const name = el.getAttribute("name") ?? "";
    if (!ctx || !unit || !name.includes(":")) continue;
    if (el.getAttribute("xsi:nil") === "true" || el.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "nil") === "true") continue;
    const base = ixNumber(text(el), el.getAttribute("format"));
    if (base === null) continue;
    const scale = Number(el.getAttribute("scale") ?? "0") || 0;
    const value = base * 10 ** scale * (el.getAttribute("sign") === "-" ? -1 : 1);
    const [prefix, local] = name.split(":");
    const ns = el.lookupNamespaceURI(prefix ?? null) ?? "";
    const concept = IFRS_NS.test(ns) ? `ifrs-full:${local}` : name;
    const dimensions: Record<string, string> = { concept, entity: ctx.entity, period: ctx.period, unit };
    if (ctx.dimensional) dimensions["xbrl:segment"] = "desglose";
    facts[`ix-${k++}`] = { value: String(value), decimals: el.getAttribute("decimals"), dimensions };
  }
  return { documentInfo: { documentType: "inline-xbrl", namespaces: {} }, facts };
}
