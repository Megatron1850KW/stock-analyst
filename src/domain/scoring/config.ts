/**
 * Umbrales y pesos de las puntuaciones (CLAUDE.md §8). Todo lo ajustable vive
 * aquí para poder cambiarlo sin tocar la lógica.
 */

export const VALUATION_CONFIG = {
  /** Barata si los múltiplos están más de un 15 % por debajo de su mediana histórica (§8.1). */
  cheapBelow: -0.15,
  /** Cara si están más de un 15 % por encima. */
  expensiveAbove: 0.15,
  /** Ventanas de la mediana y meses con dato válido que se exigen como mínimo. */
  windows: {
    fiveYears: { months: 60, minPoints: 24 },
    tenYears: { months: 120, minPoints: 60 },
  },
  /** Múltiplos que se comparan con su historia. */
  multiples: ["pe", "pfcf", "evEbit"] as const,
  /** Peso de cada parte en la puntuación 0–100. */
  weights: { multiples: 0.8, priceRange: 0.2 },
  /** Desviación que lleva la parte de múltiplos a 0 o a 100 puntos (±50 %). */
  fullScaleDeviation: 0.5,
};

export const DEBT_CONFIG = {
  /** Deuda baja: caja neta o menos de 2 años de caja libre para pagarla. */
  lowBelowYears: 2,
  /** Deuda alta: más de 4 años (o deuda neta sin caja libre para pagarla). */
  highAboveYears: 4,
};
