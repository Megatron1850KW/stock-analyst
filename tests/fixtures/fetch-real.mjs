#!/usr/bin/env node
/**
 * Descarga datos REALES para los tests sin conexión (se ejecuta en el Mac de
 * Pablo, que sí llega a la SEC y a FMP):
 *
 *   node fetch-real.mjs "Nombre email" [carpeta] [MU,GOOG]
 *
 * - SEC: submissions completo y companyfacts recortado a las etiquetas del
 *   modelo común y a 10-K/10-Q/20-F/40-F desde 2013 (incluye la historia).
 * - Tiingo: precios diarios desde 2015 (sin ajustar, con factor de split). La
 *   clave se lee del Llavero (la guarda la app en Ajustes), viaja en una
 *   cabecera y NUNCA se escribe ni se muestra.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [ua, out = "af-fixtures", tickers = "MU,GOOG"] = process.argv.slice(2);
if (!ua || !/@/.test(ua)) throw new Error('Uso: node fetch-real.mjs "Nombre email" [carpeta] [MU,GOOG]');
const CIKS = { MU: "723125", GOOG: "1652044" };
const TAGS = new Set("AdjustedWeightedAverageShares AllocatedShareBasedCompensationExpense Assets AvailableForSaleSecuritiesDebtSecuritiesCurrent Borrowings Cash CashAndCashEquivalents CashAndCashEquivalentsAtCarryingValue CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents CashFlowsFromUsedInOperatingActivities CommercialPaper CommonStockSharesOutstanding CostOfGoodsAndServicesSold CostOfGoodsSold CostOfRevenue CostOfSales CurrentBorrowings CurrentInvestments CurrentPortionOfNoncurrentBorrowings DebtAndCapitalLeaseObligations DebtCurrent DebtLongtermAndShorttermCombinedAmount Depreciation DepreciationAmortizationAndAccretionNet DepreciationAndAmortisationExpense DepreciationAndAmortization DepreciationDepletionAndAmortization DilutedEarningsLossPerShare DividendsPaidClassifiedAsFinancingActivities EarningsPerShareDiluted EntityCommonStockSharesOutstanding Equity EquityAttributableToOwnersOfParent FinanceCosts GrossProfit IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments IncomeTaxExpenseBenefit IncomeTaxExpenseContinuingOperations InterestExpense InterestExpenseDebt InterestExpenseNonoperating Liabilities LongTermDebt LongTermDebtAndCapitalLeaseObligations LongTermDebtAndCapitalLeaseObligationsCurrent LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities LongTermDebtCurrent LongTermDebtNoncurrent MarketableSecuritiesCurrent NetCashProvidedByUsedInOperatingActivities NetCashProvidedByUsedInOperatingActivitiesContinuingOperations NetIncomeLoss NetIncomeLossAvailableToCommonStockholdersBasic NoncurrentBorrowings NoncurrentPortionOfNoncurrentBorrowings OperatingIncomeLoss PaymentsForRepurchaseOfCommonStock PaymentsOfDividends PaymentsOfDividendsCommonStock PaymentsToAcquireOrRedeemEntitysShares PaymentsToAcquireProductiveAssets PaymentsToAcquirePropertyPlantAndEquipment ProfitLoss ProfitLossAttributableToOwnersOfParent ProfitLossBeforeTax ProfitLossFromOperatingActivities PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities Revenue RevenueFromContractWithCustomerExcludingAssessedTax RevenueFromContractWithCustomerIncludingAssessedTax RevenueFromContractsWithCustomers Revenues SalesRevenueGoodsNet SalesRevenueNet ShareBasedCompensation ShortTermBorrowings ShortTermInvestments ShorttermBorrowings StockholdersEquity StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest WeightedAverageNumberOfDilutedSharesOutstanding ".trim().split(" "));
const FORMS = new Set(["10-K", "10-Q", "20-F", "40-F"]);
mkdirSync(join(out, "sec"), { recursive: true });
mkdirSync(join(out, "prices"), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sec(url) {
  await sleep(150);
  const res = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

let key = null;
try {
  key = execFileSync("security", ["find-generic-password", "-s", "es.agentefinanciero.app", "-a", "prices_api_key", "-w"], { encoding: "utf8" }).trim();
} catch {
  console.log("Precios: no hay clave en el Llavero (guárdala en Ajustes de la app). Se omiten.");
}
async function tiingo(symbol, startDate) {
  const url = new URL(`https://api.tiingo.com/tiingo/daily/${symbol.toLowerCase()}/prices`);
  if (startDate) url.searchParams.set("startDate", startDate);
  await sleep(300);
  const res = await fetch(url, { headers: { Authorization: `Token ${key}` } });
  const text = await res.text();
  console.log(`Tiingo ${symbol} ${startDate ? "histórico" : "último día"}: HTTP ${res.status}, ${text.length} bytes${res.ok ? "" : " → " + text.slice(0, 160)}`);
  return res.ok ? text : null;
}

for (const t of tickers.split(",")) {
  const cik = CIKS[t].padStart(10, "0");
  const subs = await sec(`https://data.sec.gov/submissions/CIK${cik}.json`);
  writeFileSync(join(out, "sec", `${t}-submissions.json`), JSON.stringify(subs));
  const facts = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  let kept = 0;
  for (const [tax, concepts] of Object.entries(facts.facts)) {
    for (const tag of Object.keys(concepts)) {
      if (!TAGS.has(tag)) { delete concepts[tag]; continue; }
      for (const [unit, entries] of Object.entries(concepts[tag].units)) {
        concepts[tag].units[unit] = entries.filter((e) => FORMS.has(e.form) && e.filed >= "2013-01-01");
        kept += concepts[tag].units[unit].length;
      }
    }
    if (Object.keys(concepts).length === 0) delete facts.facts[tax];
  }
  writeFileSync(join(out, "sec", `${t}-companyfacts.json`), JSON.stringify(facts));
  console.log(`SEC ${t}: submissions y companyfacts (${kept} valores) guardados`);

  if (key) {
    const quote = await tiingo(t, null);
    if (quote) writeFileSync(join(out, "prices", `${t}-quote.json`), quote);
    const history = await tiingo(t, "2015-01-01");
    if (history) writeFileSync(join(out, "prices", `${t}-history.json`), history);
  }
}
console.log("Listo:", out);
