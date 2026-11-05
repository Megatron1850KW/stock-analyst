/**
 * Nombres de las posiciones de un fondo tal como vienen en las fichas
 * («NVIDIA CORP USD0.001», «ALPHABET INC-CL A»): versión legible y una clave
 * para reconocer la misma empresa en otro fondo o en tu cartera.
 */

const LEGAL = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "sa", "nv", "ag", "se", "spa", "asa", "ab", "oyj",
  "class", "cl", "cls", "a", "b", "c", "the", "com", "reg", "ord", "adr", "shs", "registered", "holding", "holdings", "group", "&",
]);

const strip = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Valor nominal: «USD0.001», «EUR1», «NPV»
    .replace(/\b[A-Z]{3}\s?\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/\bNPV\b/g, " ");

/** Clave de la empresa: las dos primeras palabras significativas, en minúsculas («alphabet», «micron technology»). */
export function companyKey(name: string): string {
  const words = strip(name)
    .toLowerCase()
    // «N.V.», «S.p.A.» → «nv», «spa»
    .replace(/\b(?:[a-z]\.){2,}/g, (m) => m.replace(/\./g, "") + " ")
    .replace(/[^a-z0-9&]+/g, " ").split(" ").filter((w) => w && !LEGAL.has(w));
  return words.slice(0, 2).join(" ");
}

/** «NVIDIA CORP USD0.001» → «Nvidia Corp». Lo que no va en mayúsculas se deja como está. */
export function holdingLabel(name: string): string {
  const s = strip(name).replace(/\s+/g, " ").trim();
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-(./])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}
