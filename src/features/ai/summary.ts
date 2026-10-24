import type { SecurityRow } from "@/db/repo";
import type { Input, Metric } from "@/domain/fundamentals/metrics";
import type { Analysis } from "@/features/watchlist/analysis";

/**
 * Resumen numérico que se envía a la IA (CLAUDE.md §7): solo cifras ya
 * calculadas en código, redondeadas y con su unidad, sin datos de más.
 */

const r = (x: number, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;
const millions = (v: number | null | undefined) => (v === null || v === undefined ? null : r(v / 1e6, 0));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : r(v * 100, 1));
const num = (v: number | null | undefined) => (v === null || v === undefined ? null : r(v, 1));
const val = (x: Input | Metric | null) => x?.value ?? null;

export function numericSummary(security: SecurityRow, a: Analysis) {
  const unit = a.current.revenue?.unit ?? security.reporting_currency ?? security.currency;
  const m = a.multiples;
  const v = a.valuation;
  return {
    empresa: { ticker: security.ticker, nombre: security.name, sector_sic: security.sic_description, divisa_cuentas: unit },
    unidades: `Importes en millones de ${unit}; porcentajes en %; múltiplos en veces.`,
    ultimos_12_meses: {
      ventas: millions(val(a.current.revenue)),
      beneficio_neto: millions(val(a.current.netIncome)),
      beneficio_operativo: millions(val(a.current.operatingIncome)),
      caja_operativa: millions(val(a.current.operatingCashFlow)),
      capex: millions(val(a.current.capex)),
      caja_libre: millions(a.current.freeCashFlow.value),
      margen_bruto: pct(a.current.grossMargin.value),
      margen_operativo: pct(a.current.operatingMargin.value),
      margen_neto: pct(a.current.netMargin.value),
      conversion_beneficio_en_caja: pct(a.current.cashConversion.value),
    },
    balance: {
      caja_e_inversiones: millions(a.current.cash.value),
      deuda_bruta: millions(a.current.grossDebt.value),
      deuda_neta: millions(a.current.netDebt.value),
      anios_para_pagar_deuda_con_caja_libre: num(a.current.debtYears.value),
      nivel_de_deuda: a.debt,
    },
    crecimiento_titular: {
      base: a.growth.basis === "quarter" ? "último trimestre vs. mismo trimestre del año anterior" : "último ejercicio vs. el anterior",
      ventas: pct(a.growth.revenue.value),
      beneficio_neto: pct(a.growth.netIncome.value),
    },
    ejercicios: a.years.slice(-6).map((y) => ({
      cierre: y.periodEnd,
      ventas: millions(val(y.revenue)),
      beneficio_neto: millions(val(y.netIncome)),
      caja_libre: millions(y.freeCashFlow.value),
      margen_operativo: pct(y.operatingMargin.value),
      crecimiento_ventas: pct(y.revenueGrowth.value),
    })),
    valoracion: {
      precio: a.price ? { valor: a.price.value, divisa: a.price.currency, fecha: a.price.date } : null,
      capitalizacion: millions(m?.marketCap.value),
      anios_de_beneficios_PER: num(m?.pe.value),
      anios_de_caja_libre_P_FCF: num(m?.pfcf.value),
      EV_EBIT: num(m?.evEbit.value),
      rentabilidad_caja_libre: pct(m?.fcfYield.value),
      frente_a_su_historia: v?.comparisons.map((c) => ({
        multiplo: c.id,
        actual: num(c.current),
        mediana_5_anios: num(c.fiveYears.median),
        mediana_10_anios: num(c.tenYears.median),
        desviacion: pct(c.deviation),
      })),
      veredicto_valoracion: v?.verdict ?? null,
      puntuacion_valoracion_0_100: v?.score ?? null,
      desviacion_tipica: pct(v?.deviation),
    },
    avisos: a.warnings,
  };
}
