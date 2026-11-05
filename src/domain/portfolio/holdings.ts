/**
 * Nombres de las posiciones de un fondo tal como vienen en las fichas
 * («NVIDIA CORP USD0.001», «ALPHABET INC-CL A»): versión legible y una clave
 * para reconocer la misma empresa en otro fondo o en tu cartera.
 */

const LEGAL = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "sa", "nv", "ag", "se", "spa", "asa", "ab", "oyj",
  "class", "cl", "cls", "a", "b", "c", "the", "com", "reg", "ord", "adr", "shs", "registered", "holding", "holdings", "group", "&", "of", "and", "de", "del",
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

/** Clase de acción escrita en el nombre («ALPHABET INC-CL A» → «A»), o «» si no la lleva. */
export function shareClass(name: string): string {
  return /(?:^|[\s\-])(?:CL|CLS|CLASS)\.?\s*([A-C])\b/i.exec(name)?.[1]?.toUpperCase() ?? "";
}

/** Clave de una posición concreta: empresa + clase («alphabet|A»). */
export const holdingId = (name: string) => `${companyKey(name)}|${shareClass(name)}`;

export interface ListedCompany {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
}

/**
 * Índice empresa → tickers a partir de la lista oficial de la SEC (solo NYSE y
 * Nasdaq, sin OTC). Si dos empresas distintas comparten clave, no se usa: mejor
 * el nombre completo que un ticker equivocado.
 */
export function tickerIndex(list: ListedCompany[]): Map<string, string[] | null> {
  const byKey = new Map<string, { cik: string; tickers: string[] } | null>();
  for (const c of list) {
    if (!c.exchange || !/^(nyse|nasdaq)$/i.test(c.exchange)) continue;
    const k = companyKey(c.name);
    if (!k) continue;
    const prev = byKey.get(k);
    if (prev === undefined) byKey.set(k, { cik: c.cik, tickers: [c.ticker] });
    else if (prev && prev.cik === c.cik) prev.tickers.push(c.ticker);
    else byKey.set(k, null);
  }
  return new Map([...byKey].map(([k, v]) => [k, v ? v.tickers : null]));
}

/** Ticker de una posición: clase A o sin clase → el primero de la SEC; clase B o C → el segundo (GOOGL / GOOG, BRK-A / BRK-B). */
export function tickerFor(name: string, index: Map<string, string[] | null>): string | null {
  const tickers = index.get(companyKey(name));
  if (!tickers?.length) return null;
  const cls = shareClass(name);
  return cls === "B" || cls === "C" ? tickers[1] ?? tickers[0]! : tickers[0]!;
}
