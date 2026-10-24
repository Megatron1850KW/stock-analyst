/**
 * Sectores de la cartera (CLAUDE.md §5.2). Las 11 grandes familias habituales,
 * en español. Para EE. UU. se deducen del código SIC de la SEC; para Europa no
 * hay un dato oficial gratuito y se te pregunta («Sin dato» hasta entonces).
 */

export const SECTORS = [
  "Tecnología",
  "Salud",
  "Finanzas",
  "Consumo discrecional",
  "Consumo básico",
  "Industria",
  "Energía",
  "Materiales",
  "Servicios públicos",
  "Inmobiliario",
  "Comunicaciones",
] as const;
export type Sector = (typeof SECTORS)[number];

/** Rangos SIC → sector, del más concreto al más general (el primero que encaja gana). */
const SIC_RANGES: [number, number, Sector][] = [
  [1300, 1389, "Energía"],
  [2830, 2836, "Salud"],
  [2840, 2844, "Consumo básico"],
  [2900, 2999, "Energía"],
  [3100, 3199, "Consumo discrecional"],
  [3570, 3579, "Tecnología"],
  [3630, 3651, "Consumo discrecional"],
  [3652, 3699, "Tecnología"],
  [3711, 3716, "Consumo discrecional"],
  [3720, 3729, "Industria"],
  [3840, 3851, "Salud"],
  [3800, 3899, "Tecnología"],
  [5120, 5129, "Salud"],
  [5140, 5149, "Consumo básico"],
  [5400, 5499, "Consumo básico"],
  [5912, 5912, "Consumo básico"],
  [6798, 6798, "Inmobiliario"],
  [7310, 7319, "Comunicaciones"],
  [7370, 7379, "Tecnología"],
  [1000, 1499, "Materiales"],
  [1500, 1799, "Industria"],
  [2000, 2199, "Consumo básico"],
  [2200, 2399, "Consumo discrecional"],
  [2400, 2499, "Materiales"],
  [2500, 2599, "Consumo discrecional"],
  [2600, 2699, "Materiales"],
  [2700, 2799, "Comunicaciones"],
  [2800, 2899, "Materiales"],
  [3000, 3399, "Materiales"],
  [3400, 3699, "Industria"],
  [3700, 3799, "Industria"],
  [3900, 3999, "Consumo discrecional"],
  [4000, 4799, "Industria"],
  [4800, 4899, "Comunicaciones"],
  [4900, 4999, "Servicios públicos"],
  [5000, 5199, "Industria"],
  [5200, 5999, "Consumo discrecional"],
  [6000, 6499, "Finanzas"],
  [6500, 6599, "Inmobiliario"],
  [6700, 6799, "Finanzas"],
  [7000, 7299, "Consumo discrecional"],
  [7300, 7399, "Industria"],
  [7800, 7999, "Comunicaciones"],
  [8000, 8099, "Salud"],
  [8700, 8799, "Industria"],
];

/** Sector a partir del código SIC (null si no encaja o no es un número). */
export function sectorFromSic(sic: string | null | undefined): Sector | null {
  const n = Number(sic);
  if (!sic || !Number.isInteger(n)) return null;
  return SIC_RANGES.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null;
}

const countryNames = new Intl.DisplayNames(["es"], { type: "region" });

/** «ES» → «España». Lo que no sea un código ISO de 2 letras se deja tal cual. */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}
