/**
 * Modelo común de conceptos contables (CLAUDE.md §10 "Normalización contable").
 *
 * Cada concepto lista, por orden de preferencia, las etiquetas XBRL de las que
 * puede salir. Se usa la primera que aparezca en el informe y se guarda cuál
 * fue (financial_facts.source_tag), así siempre se puede auditar el origen.
 * Si ninguna aparece, se registra el hueco (concept_gaps) y la UI muestra
 * "Sin dato": nunca se estima.
 *
 * Taxonomías: us-gaap (10-K/10-Q), ifrs-full (20-F de emisores que presentan
 * en NIIF e informes europeos ESEF) y dei (portada del informe).
 *
 * Notas de mapeo:
 * - Ventas: desde 2018 (ASC 606) la mayoría usa RevenueFromContractWith…;
 *   "Revenues" es el total cuando la empresa tiene otros ingresos además.
 * - Deuda: no se suma aquí. Se guardan las piezas y el cálculo de deuda
 *   financiera se hace en domain/valuation, documentado y testeado:
 *   · debt_total: total con vencimientos corrientes. Ojo: en US-GAAP
 *     "LongTermDebt" ya incluye la parte corriente, mientras que
 *     "LongTermDebtAndCapitalLeaseObligations" es SOLO la parte no corriente
 *     (por eso va en debt_noncurrent). Comprobado con Micron (MU), cuyo
 *     balance usa DebtAndCapitalLeaseObligations como total.
 *   · debt_noncurrent + debt_current: alternativa cuando no hay total.
 *   · short_term_borrowings y commercial_paper: deuda a corto que no viene de
 *     la deuda a largo; se suman aparte, sin riesgo de contar dos veces.
 *   · NIIF (ESEF): «LongtermBorrowings» es la deuda financiera no corriente y
 *     «CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings» ya incluye los
 *     préstamos a corto, así que con ella no se suman aparte (ver metrics.ts).
 *     Los pasivos por arrendamiento (NIIF 16) no se cuentan como deuda, igual
 *     que los arrendamientos operativos en US-GAAP, para comparar igual con igual.
 * - Beneficio bruto: algunas empresas (p. ej. Alphabet) no lo publican. No se
 *   rellena aquí; si hace falta, se calcula en domain/valuation como ventas
 *   menos coste de las ventas y se etiqueta como cifra calculada.
 * - Capex: pagos por inmovilizado material. Algunas empresas lo desglosan en
 *   varias líneas; si solo hay PaymentsToAcquireProductiveAssets se usa esa.
 * - Bancos: «RevenuesNetOfInterestExpense» va antes que RevenueFromContract…,
 *   que en un banco solo recoge las comisiones (American Express: 32.962 M
 *   frente a 58.606 M de ingresos totales en el 10-Q de sep. 2026).
 * - Etiquetas propias («ext»): solo UniCredit, que presenta ventas y patrimonio
 *   con su extensión (comprobado en su ESEF 2025). Su deuda NO se mapea: en un
 *   banco los valores emitidos y los depósitos son su materia prima, y medirlos
 *   contra la caja generada como en una industrial daría una alarma falsa.
 * - Las cifras de flujo de caja de un 10-Q son acumuladas del año (YTD); se
 *   guardan con sus fechas de inicio y fin para no confundirlas con trimestres.
 */

export type ConceptKind = "money" | "perShare" | "shares";
export type PeriodType = "duration" | "instant";

export interface TagRef {
  /** "ext": extensión propia de la empresa (prefijo «ext» en su ESEF), solo para casos documentados abajo. */
  taxonomy: "us-gaap" | "ifrs-full" | "dei" | "ext";
  tag: string;
}

export interface ConceptDef {
  id: string;
  label: string;
  kind: ConceptKind;
  period: PeriodType;
  tags: TagRef[];
}

const g = (tag: string): TagRef => ({ taxonomy: "us-gaap", tag });
const i = (tag: string): TagRef => ({ taxonomy: "ifrs-full", tag });
const d = (tag: string): TagRef => ({ taxonomy: "dei", tag });
const x = (tag: string): TagRef => ({ taxonomy: "ext", tag });

export const CONCEPTS: ConceptDef[] = [
  // Cuenta de resultados
  {
    id: "revenue",
    label: "Ventas",
    kind: "money",
    period: "duration",
    tags: [
      g("Revenues"),
      // Bancos y financieras (p. ej. American Express): el total es neto de intereses;
      // su RevenueFromContractWithCustomer… es solo una parte (las comisiones)
      g("RevenuesNetOfInterestExpense"),
      g("RevenueFromContractWithCustomerExcludingAssessedTax"),
      g("RevenueFromContractWithCustomerIncludingAssessedTax"),
      g("SalesRevenueNet"),
      g("SalesRevenueGoodsNet"),
      i("Revenue"),
      i("RevenueFromContractsWithCustomers"),
      i("RevenueFromSaleOfGoods"),
      // Bancos italianos (UniCredit): «margine di intermediazione», renglón 120 del
      // formato del Banco de Italia = margen de intereses + comisiones netas + negociación + dividendos
      x("GrossIncome"),
      // Lo mismo en los informes en italiano (versión «-it» de filings.xbrl.org)
      x("MargineDiIntermediazione"),
    ],
  },
  {
    id: "cost_of_revenue",
    label: "Coste de las ventas",
    kind: "money",
    period: "duration",
    tags: [g("CostOfRevenue"), g("CostOfGoodsAndServicesSold"), g("CostOfGoodsSold"), i("CostOfSales")],
  },
  { id: "gross_profit", label: "Beneficio bruto", kind: "money", period: "duration", tags: [g("GrossProfit"), i("GrossProfit")] },
  {
    id: "operating_income",
    label: "Beneficio operativo (EBIT)",
    kind: "money",
    period: "duration",
    tags: [g("OperatingIncomeLoss"), i("ProfitLossFromOperatingActivities")],
  },
  {
    id: "pretax_income",
    label: "Beneficio antes de impuestos",
    kind: "money",
    period: "duration",
    tags: [
      g("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"),
      g("IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"),
      i("ProfitLossBeforeTax"),
    ],
  },
  { id: "income_tax", label: "Impuesto sobre beneficios", kind: "money", period: "duration", tags: [g("IncomeTaxExpenseBenefit"), i("IncomeTaxExpenseContinuingOperations")] },
  { id: "interest_expense", label: "Gastos financieros", kind: "money", period: "duration", tags: [g("InterestExpense"), g("InterestExpenseNonoperating"), g("InterestExpenseDebt"), i("FinanceCosts")] },
  {
    id: "net_income",
    label: "Beneficio neto",
    kind: "money",
    period: "duration",
    tags: [g("NetIncomeLoss"), g("NetIncomeLossAvailableToCommonStockholdersBasic"), g("ProfitLoss"), i("ProfitLossAttributableToOwnersOfParent"), i("ProfitLoss")],
  },
  { id: "eps_diluted", label: "Beneficio por acción (diluido)", kind: "perShare", period: "duration", tags: [g("EarningsPerShareDiluted"), i("DilutedEarningsLossPerShare")] },
  // Algunas europeas sin instrumentos dilutivos (p. ej. Inditex) solo publican el básico
  { id: "eps_basic", label: "Beneficio por acción (básico)", kind: "perShare", period: "duration", tags: [g("EarningsPerShareBasic"), i("BasicEarningsLossPerShare")] },
  {
    id: "depreciation",
    label: "Amortizaciones",
    kind: "money",
    period: "duration",
    tags: [g("DepreciationDepletionAndAmortization"), g("DepreciationAndAmortization"), g("DepreciationAmortizationAndAccretionNet"), g("Depreciation"), i("DepreciationAndAmortisationExpense")],
  },

  // Flujo de caja
  {
    id: "operating_cash_flow",
    label: "Caja de las operaciones",
    kind: "money",
    period: "duration",
    tags: [g("NetCashProvidedByUsedInOperatingActivities"), g("NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"), i("CashFlowsFromUsedInOperatingActivities")],
  },
  {
    id: "capex",
    label: "Inversión en activos (capex)",
    kind: "money",
    period: "duration",
    tags: [g("PaymentsToAcquirePropertyPlantAndEquipment"), g("PaymentsToAcquireProductiveAssets"), i("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities")],
  },
  { id: "share_based_comp", label: "Pagos en acciones", kind: "money", period: "duration", tags: [g("ShareBasedCompensation"), g("AllocatedShareBasedCompensationExpense")] },
  { id: "dividends_paid", label: "Dividendos pagados", kind: "money", period: "duration", tags: [g("PaymentsOfDividends"), g("PaymentsOfDividendsCommonStock"), i("DividendsPaidClassifiedAsFinancingActivities"), i("DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities")] },
  { id: "buybacks", label: "Recompra de acciones", kind: "money", period: "duration", tags: [g("PaymentsForRepurchaseOfCommonStock"), i("PaymentsToAcquireOrRedeemEntitysShares")] },

  // Balance
  {
    id: "cash",
    label: "Caja y equivalentes",
    kind: "money",
    period: "instant",
    tags: [g("CashAndCashEquivalentsAtCarryingValue"), g("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"), g("Cash"), i("CashAndCashEquivalents")],
  },
  {
    id: "short_term_investments",
    label: "Inversiones a corto plazo",
    kind: "money",
    period: "instant",
    tags: [g("ShortTermInvestments"), g("MarketableSecuritiesCurrent"), g("AvailableForSaleSecuritiesDebtSecuritiesCurrent"), i("CurrentInvestments")],
  },
  {
    id: "debt_total",
    label: "Deuda financiera total",
    kind: "money",
    period: "instant",
    tags: [
      g("DebtAndCapitalLeaseObligations"),
      g("LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"),
      g("DebtLongtermAndShorttermCombinedAmount"),
      g("LongTermDebt"),
      i("Borrowings"),
    ],
  },
  {
    id: "debt_noncurrent",
    label: "Deuda a largo plazo (no corriente)",
    kind: "money",
    period: "instant",
    tags: [g("LongTermDebtNoncurrent"), g("LongTermDebtAndCapitalLeaseObligations"), i("NoncurrentPortionOfNoncurrentBorrowings"), i("NoncurrentBorrowings"), i("LongtermBorrowings")],
  },
  {
    id: "debt_current",
    label: "Deuda que vence en 12 meses",
    kind: "money",
    period: "instant",
    tags: [
      g("LongTermDebtCurrent"),
      g("DebtCurrent"),
      g("LongTermDebtAndCapitalLeaseObligationsCurrent"),
      i("CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings"),
      i("CurrentPortionOfNoncurrentBorrowings"),
    ],
  },
  { id: "short_term_borrowings", label: "Préstamos a corto plazo", kind: "money", period: "instant", tags: [g("ShortTermBorrowings"), i("ShorttermBorrowings"), i("CurrentBorrowings")] },
  { id: "commercial_paper", label: "Papel comercial", kind: "money", period: "instant", tags: [g("CommercialPaper")] },
  { id: "total_assets", label: "Activo total", kind: "money", period: "instant", tags: [g("Assets"), i("Assets")] },
  { id: "total_liabilities", label: "Pasivo total", kind: "money", period: "instant", tags: [g("Liabilities"), i("Liabilities")] },
  {
    id: "equity",
    label: "Patrimonio neto",
    kind: "money",
    period: "instant",
    tags: [
      g("StockholdersEquity"),
      g("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
      i("EquityAttributableToOwnersOfParent"),
      i("Equity"),
      // UniCredit no usa las etiquetas NIIF del patrimonio, sino las suyas
      x("TotalEquityAttributableToOwnersOfParent"),
      x("TotalEquity"),
      // Versión en italiano: del grupo (dominante) y total
      x("PatrimonioNettoDelGruppo"),
      x("PatrimonioNetto"),
    ],
  },

  // Acciones
  { id: "shares_outstanding", label: "Acciones en circulación", kind: "shares", period: "instant", tags: [d("EntityCommonStockSharesOutstanding"), g("CommonStockSharesOutstanding"), i("NumberOfSharesOutstanding")] },
  {
    id: "shares_diluted",
    label: "Acciones diluidas (media del periodo)",
    kind: "shares",
    period: "duration",
    tags: [g("WeightedAverageNumberOfDilutedSharesOutstanding"), i("AdjustedWeightedAverageShares")],
  },
];

export const CONCEPT_BY_ID: ReadonlyMap<string, ConceptDef> = new Map(CONCEPTS.map((c) => [c.id, c]));
