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

export const SINCE_ANALYSIS_CONFIG = {
  /** Un movimiento de precio mayor que este (±20 %) desde el último análisis IA se destaca y se sugiere re-analizar. Nunca se re-analiza solo. */
  bigPriceMove: 0.2,
};

/**
 * Puntuación de calidad / salud financiera (§8.2) y señales de trampa de valor (§8.3).
 * Cada parte va de 0 a 100 de forma lineal entre «mal» y «bien».
 */
export const QUALITY_CONFIG = {
  /** Ejercicios que se miran hacia atrás para crecimientos y tendencias. */
  lookbackYears: 3,
  weights: { growth: 0.25, margins: 0.2, cashConversion: 0.2, debt: 0.2, dilution: 0.15 },
  /** Crecimiento anual compuesto de ventas/beneficio: −5 % = 0 puntos, +15 % = 100. */
  growth: { bad: -0.05, good: 0.15 },
  /** Margen operativo: 0 % = 0 puntos, 25 % = 100; y su tendencia: −5 puntos = 0, +5 = 100. */
  margins: { levelBad: 0, levelGood: 0.25, trendBad: -0.05, trendGood: 0.05 },
  /** Caja libre ÷ beneficio neto: 30 % = 0 puntos, 100 % = 100. */
  cashConversion: { bad: 0.3, good: 1 },
  /** Puntos según el nivel de deuda del indicador «¿Tiene mucha deuda?». */
  debt: { Baja: 100, Moderada: 60, Alta: 15 },
  /** Variación anual del nº de acciones: +5 % al año = 0 puntos, −2 % (recompras) = 100. */
  dilution: { bad: 0.05, good: -0.02 },
  /** Hacen falta al menos 3 de las 5 partes para dar una nota. */
  minParts: 3,
  /** Señales de trampa de valor (§8.3). */
  trap: {
    /** Ventas cayendo: el último ejercicio por debajo del anterior y del de hace 3 años. */
    salesFalling: true,
    /** Márgenes empeorando de forma sostenida: el margen operativo baja 2 años seguidos. */
    marginYearsDown: 2,
    /** Deuda creciendo: la deuda neta sube más de un 20 % en 2 años. */
    debtGrowth: 0.2,
    /** Caja libre en caída: más de un 25 % por debajo del año anterior (o negativa). */
    fcfDrop: 0.25,
    /** Dilución relevante: más de un 2 % de acciones nuevas al año. */
    dilutionPerYear: 0.02,
    /** Hacen falta 2 o más señales para hablar de trampa. */
    minSignals: 2,
  },
};

/** Competidores (§5.1.6): los 3–4 más cercanos. */
export const PEERS_CONFIG = {
  max: 4,
  /** Hacen falta al menos 2 con datos para dar un veredicto frente a la competencia. */
  minForVerdict: 2,
};
