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
 * en NIIF; también servirá para ESEF en la fase 6) y dei (portada del informe).
 *
 * Notas de mapeo:
 * - Ventas: desde 2018 (ASC 606) la mayoría usa RevenueFromContractWith…;
 *   "Revenues" es el total cuando la empresa tiene otros ingresos además.
 * - Deuda: no se suma aquí. Se guardan las piezas (largo plazo total, parte
 *   corriente/no corriente, préstamos a corto, papel comercial) y el cálculo
 *   de deuda financiera se hace en domain/valuation, documentado y testeado.
 * - Capex: pagos por inmovilizado material. Algunas empresas lo desglosan en
 *   varias líneas; si solo hay PaymentsToAcquireProductiveAssets se usa esa.
 * - Las cifras de flujo de caja de un 10-Q son acumuladas del año (YTD); se
 *   guardan con sus fechas de inicio y fin para no confundirlas con trimestres.
 */

export type ConceptKind = "money" | "perShare" | "shares";
export type PeriodType = "duration" | "instant";

export interface TagRef {
  taxonomy: "us-gaap" | "ifrs-full" | "dei";
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

export const CONCEPTS: ConceptDef[] = [
  // Cuenta de resultados
  {
    id: "revenue",
    label: "Ventas",
    kind: "money",
    period: "duration",
    tags: [
      g("Revenues"),
      g("RevenueFromContractWithCustomerExcludingAssessedTax"),
      g("RevenueFromContractWithCustomerIncludingAssessedTax"),
      g("SalesRevenueNet"),
      g("SalesRevenueGoodsNet"),
      i("Revenue"),
      i("RevenueFromContractsWithCustomers"),
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
  { id: "dividends_paid", label: "Dividendos pagados", kind: "money", period: "duration", tags: [g("PaymentsOfDividends"), g("PaymentsOfDividendsCommonStock"), i("DividendsPaidClassifiedAsFinancingActivities")] },
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
  { id: "long_term_debt_total", label: "Deuda a largo plazo (total)", kind: "money", period: "instant", tags: [g("LongTermDebt"), g("LongTermDebtAndCapitalLeaseObligations")] },
  { id: "long_term_debt_noncurrent", label: "Deuda a largo plazo (no corriente)", kind: "money", period: "instant", tags: [g("LongTermDebtNoncurrent"), g("LongTermDebtAndCapitalLeaseObligationsNoncurrent"), i("NoncurrentPortionOfNoncurrentBorrowings"), i("NoncurrentBorrowings")] },
  { id: "long_term_debt_current", label: "Deuda a largo plazo (parte corriente)", kind: "money", period: "instant", tags: [g("LongTermDebtCurrent"), g("LongTermDebtAndCapitalLeaseObligationsCurrent"), i("CurrentPortionOfNoncurrentBorrowings")] },
  { id: "short_term_borrowings", label: "Préstamos a corto plazo", kind: "money", period: "instant", tags: [g("ShortTermBorrowings"), g("DebtCurrent"), i("ShorttermBorrowings"), i("CurrentBorrowings")] },
  { id: "commercial_paper", label: "Papel comercial", kind: "money", period: "instant", tags: [g("CommercialPaper")] },
  { id: "total_assets", label: "Activo total", kind: "money", period: "instant", tags: [g("Assets"), i("Assets")] },
  { id: "total_liabilities", label: "Pasivo total", kind: "money", period: "instant", tags: [g("Liabilities"), i("Liabilities")] },
  {
    id: "equity",
    label: "Patrimonio neto",
    kind: "money",
    period: "instant",
    tags: [g("StockholdersEquity"), g("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"), i("EquityAttributableToOwnersOfParent"), i("Equity")],
  },

  // Acciones
  { id: "shares_outstanding", label: "Acciones en circulación", kind: "shares", period: "instant", tags: [d("EntityCommonStockSharesOutstanding"), g("CommonStockSharesOutstanding")] },
  {
    id: "shares_diluted",
    label: "Acciones diluidas (media del periodo)",
    kind: "shares",
    period: "duration",
    tags: [g("WeightedAverageNumberOfDilutedSharesOutstanding"), i("AdjustedWeightedAverageShares")],
  },
];

export const CONCEPT_BY_ID: ReadonlyMap<string, ConceptDef> = new Map(CONCEPTS.map((c) => [c.id, c]));
