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
  weights: { growth: 0.2, margins: 0.25, cashConversion: 0.25, debt: 0.2, dilution: 0.1 },
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
  /**
   * Márgenes en máximos (aviso de ciclo): margen operativo actual al menos 1,5 veces
   * la mediana de sus últimos 5 ejercicios y 10 puntos por encima. En empresas
   * cíclicas, un PER bajo con márgenes récord puede engañar.
   */
  peak: { years: 5, ratio: 1.5, minGap: 0.1 },
};

/** Competidores (§5.1.6): los 3–4 más cercanos. */
export const PEERS_CONFIG = {
  max: 4,
  /** Hacen falta al menos 2 con datos para dar un veredicto frente a la competencia. */
  minForVerdict: 2,
};

/** Recomendación de cartera Comprar más / Mantener (§8.4). */
export const PORTFOLIO_CONFIG = {
  /** Peso máximo de una posición antes de dejar de sumar (15 %). */
  maxPosition: 0.15,
  /** Peso máximo de un sector (35 %). */
  maxSector: 0.35,
  /** Por debajo de esta calidad (0–100) la posición se marca «Mantener — vigilar». */
  watchQualityBelow: 40,
  /** Una acción a precio justo solo se recomienda comprar con calidad igual o superior a esta. */
  buyFairQualityFrom: 60,
  /** Tendencia de fondo de ETFs/ETCs: precio frente a su media de 10 meses (§5.3). */
  trendMonths: 10,
};

/**
 * Escenarios de largo plazo de la cartera (§5.2): ESCENARIOS, no predicciones.
 * Base = el crecimiento histórico de cada posición (ventas de los últimos años
 * en acciones; precio en ETFs/ETCs). Prudente y optimista lo multiplican.
 */
export const SCENARIO_CONFIG = {
  years: 10,
  prudentFactor: 0.5,
  optimisticFactor: 1.5,
  /** El crecimiento histórico de cada posición se acota a este rango anual. */
  floor: -0.1,
  cap: 0.2,
  /** Años de precios que se exigen como mínimo para un ETF/ETC. */
  minPriceYears: 3,
};

/**
 * Riesgo técnico de largo plazo (§5.3): solo velas mensuales y semanales de
 * varios años, nunca intradía. Cada señal suma puntos; el total da el semáforo.
 */
export const TECHNICAL_CONFIG = {
  /** Media de largo plazo: 10 meses (≈ 200 sesiones / 40 semanas). */
  maPeriods: 10,
  /** Meses atrás con los que se compara la media para ver si sube o baja. */
  slopeLookback: 3,
  /** Por debajo de este cambio de la media (±1 %) se considera plana. */
  flatSlope: 0.01,
  /** Meses de historia mínimos para dar semáforo. */
  minMonths: 24,
  /** Soportes y resistencias: mínimo/máximo de ±3 meses a cada lado; zonas a menos de un 4 % se juntan. */
  pivotWindow: 3,
  mergeWithin: 0.04,
  points: {
    trend: { Bajista: 2, Lateral: 1, Alcista: 0 },
    /** Caída actual desde máximos. */
    drawdown: [
      { above: 0.5, points: 2 },
      { above: 0.25, points: 1 },
    ],
    /** Volatilidad anual (desviación típica de las rentabilidades mensuales × √12). */
    volatility: [
      { above: 0.4, points: 2 },
      { above: 0.25, points: 1 },
    ],
  },
  /** Semáforo según los puntos: 0–1 Bajo, 2–3 Medio, 4 o más Alto. */
  mediumFrom: 2,
  highFrom: 4,
};

/**
 * Estrellas ⭐ (§5.4 y §8.5). Watchlist: valoración × calidad × complemento de
 * la cartera. Cartera: la posición con más descuento (historia y competencia)
 * que pase la calidad mínima, para no premiar trampas de valor.
 */
export const STARS_CONFIG = {
  /** Calidad mínima (0–100) para optar a cualquier estrella. */
  minQuality: 50,
  /** Watchlist: peso de cada parte del «complemento de cartera». */
  complementWeights: { sector: 0.35, country: 0.2, currency: 0.15, correlation: 0.3 },
  /** Peso en tu cartera a partir del cual un sector, país o divisa ya no aporta nada (0 puntos). */
  fullAt: { sector: 0.35, country: 0.6, currency: 0.6 },
  /** Correlación media de precios mensuales con tus posiciones: 0,2 o menos = 100 puntos, 0,9 o más = 0. */
  correlation: { low: 0.2, high: 0.9, years: 5, minMonths: 24 },
  /** Cartera: hace falta un descuento (media historia + competencia) de al menos un 5 % para dar estrella. */
  minDiscount: 0.05,
};

/**
 * Criterio Buffett «B»: las acciones que hoy compraría Warren Buffett según
 * los criterios que repite en sus cartas a los accionistas de Berkshire
 * Hathaway: beneficios constantes, alta rentabilidad sobre el capital con
 * poca deuda, ventaja duradera (márgenes altos), caja de verdad, sin diluir
 * al accionista y a un precio sensato. Hay que cumplirlos todos; un dato que
 * falta cuenta como no cumplido («lo que no entiendo, no lo compro»).
 */
export const BUFFETT_CONFIG = {
  /** Años con beneficio positivo exigidos (los últimos, con un mínimo de 3 publicados). */
  profitYears: 5,
  minYears: 3,
  /** Rentabilidad sobre el capital (beneficio ÷ patrimonio), media de los últimos 3 años. */
  minRoe: 0.15,
  roeYears: 3,
  /** Ventaja duradera: margen bruto mínimo; si no publica bruto, margen operativo mínimo. */
  minGrossMargin: 0.4,
  minOperatingMargin: 0.2,
  /** Poca deuda: caja neta o deuda neta pagable en estos años con su caja libre. */
  maxDebtYears: 3,
  /** Caja libre ÷ beneficio neto (media de varios años). */
  minCashConversion: 0.7,
  /** Aumento máximo de acciones al año. */
  maxDilution: 0.01,
  /** Precio sensato: no «Cara» frente a su historia y rentabilidad del dueño (caja libre ÷ capitalización) mínima. */
  minOwnerYield: 0.04,
};
