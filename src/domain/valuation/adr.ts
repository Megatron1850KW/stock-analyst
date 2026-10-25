/**
 * Acciones ordinarias que representa cada ADR (certificado que cotiza en
 * EE. UU. en lugar de la acción original). Los informes (20-F) dan el número
 * de acciones ordinarias y el precio es el del ADR: sin este ratio, la
 * capitalización saldría multiplicada por él. Solo ADR cuyo ratio consta en
 * su programa de depositario; el resto se trata como 1 ADR = 1 acción.
 */
export const ADR_RATIOS: Readonly<Record<string, number>> = {
  TSM: 5, // Taiwan Semiconductor
  UMC: 5, // United Microelectronics
  ASX: 2, // ASE Technology
  BABA: 8, // Alibaba
  BIDU: 8, // Baidu
  JD: 2, // JD.com
  NTES: 5, // NetEase
  PDD: 4, // PDD Holdings
  HSBC: 5,
  BP: 6,
  AZN: 0.5, // AstraZeneca
  SNY: 0.5, // Sanofi
  TM: 10, // Toyota
  HDB: 3, // HDFC Bank
  IBN: 2, // ICICI Bank
};

/** Acciones ordinarias por cada ADR (1 si no es un ADR conocido). */
export const adrRatio = (ticker: string, market: string | null): number => (market === "US" ? (ADR_RATIOS[ticker.toUpperCase()] ?? 1) : 1);
