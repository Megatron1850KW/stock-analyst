/**
 * Extractos de texto de un 10-K / 10-Q / 20-F en HTML (CLAUDE.md §7): a la IA
 * no se le manda el documento entero, solo las secciones de negocio, riesgos
 * y comentario de la dirección (MD&A), con un tope de caracteres por sección.
 * Funciona sin DOM para poder probarse en Node.
 */

export type SectionId = "business" | "risks" | "mdna";

export const SECTION_LABELS: Record<SectionId, string> = {
  business: "Negocio",
  risks: "Factores de riesgo",
  mdna: "Comentario de la dirección (MD&A)",
};

/** Tope de caracteres por sección (≈ 4 caracteres por token). */
export const SECTION_LIMITS: Record<SectionId, number> = {
  business: 24_000,
  risks: 40_000,
  mdna: 48_000,
};

export interface Excerpt {
  section: SectionId;
  text: string;
  /** Caracteres de la sección completa, antes de recortar. */
  fullLength: number;
  truncated: boolean;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", bull: "•", middot: "·", reg: "®", trade: "™", copy: "©", sect: "§",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML (incluido XBRL inline) → texto plano con un párrafo por línea. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Cabecera XBRL oculta, scripts y estilos no son texto del informe
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?(p|div|br|tr|li|h[1-6]|table|section)\b[^>]*>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t  -​]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

interface Bounds {
  start: RegExp;
}

// Encabezados «Item 1A. Risk Factors» (con o sin punto, guion o dos puntos), al principio de línea
const item = (n: string, title: string) => new RegExp(`^\\s*item\\s+(?:${n})\\b\\s*[.:\\-–—]?\\s*${title}`, "gim");

/** Una sección termina en el siguiente encabezado «Item …», sea cual sea. */
const NEXT_ITEM = item("\\d{1,2}[a-d]?", "");

const TEN_K: Record<SectionId, Bounds> = {
  business: { start: item("1", "business") },
  risks: { start: item("1a", "risk\\s+factors") },
  mdna: { start: item("7", "management") },
};
const TEN_Q: Partial<Record<SectionId, Bounds>> = {
  mdna: { start: item("2", "management") },
  risks: { start: item("1a", "risk\\s+factors") },
};
const TWENTY_F: Record<SectionId, Bounds> = {
  business: { start: item("4", "information\\s+on\\s+the\\s+company") },
  risks: { start: /^\s*(item\s+3\s*[.:]?\s*)?d\.?\s*risk\s+factors/gim },
  mdna: { start: item("5", "operating\\s+and\\s+financial") },
};

export function boundsFor(form: string): Partial<Record<SectionId, Bounds>> {
  if (form.startsWith("10-K")) return TEN_K;
  if (form.startsWith("10-Q")) return TEN_Q;
  if (form.startsWith("20-F") || form.startsWith("40-F")) return TWENTY_F;
  return {};
}

/**
 * Busca la sección más larga entre cada encabezado de inicio y el siguiente
 * encabezado «Item». El índice del principio repite los encabezados con poco texto entre
 * ellos; la sección real es la de mayor longitud.
 */
export function findSection(text: string, b: Bounds): string | null {
  let best: string | null = null;
  for (const m of text.matchAll(b.start)) {
    const from = m.index;
    const end = new RegExp(NEXT_ITEM.source, NEXT_ITEM.flags);
    end.lastIndex = from + m[0].length;
    const e = end.exec(text);
    const body = text.slice(from, e ? e.index : text.length).trim();
    // Sin final reconocible se descarta: sería el resto del documento
    if (!e) continue;
    if (!best || body.length > best.length) best = body;
  }
  // Menos de 400 caracteres suele ser solo el índice o una remisión a otro apartado
  return best && best.length >= 400 ? best : null;
}

export function clip(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", limit);
  return { text: text.slice(0, cut > limit * 0.8 ? cut : limit), truncated: true };
}

/** Extractos de un informe. Las secciones que no se encuentran simplemente no aparecen. */
export function extractSections(form: string, html: string, limits = SECTION_LIMITS): Excerpt[] {
  const text = htmlToText(html);
  const out: Excerpt[] = [];
  for (const [id, b] of Object.entries(boundsFor(form)) as [SectionId, Bounds][]) {
    const body = findSection(text, b);
    if (!body) continue;
    const c = clip(body, limits[id]);
    out.push({ section: id, text: c.text, fullLength: body.length, truncated: c.truncated });
  }
  return out;
}
