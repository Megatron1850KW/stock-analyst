import { FxTable, majorUnit } from "@/domain/portfolio/fx";
import type { PriceInput, PricePoint } from "./multiples";

/**
 * Precio en la divisa de las cuentas. Una empresa que publica en dólares y
 * cotiza en peniques o en euros (p. ej. Rio Tinto) solo se puede valorar con
 * el precio pasado a dólares, al tipo del BCE de cada fecha. Sin tipo, null:
 * nunca se inventa.
 */

const sameMajor = (a: string, b: string) => majorUnit(a).currency === majorUnit(b).currency;

/** Valor en `from` pasado a `to` en `date`, con la fecha del tipo usado. */
export function convert(value: number, from: string, to: string, date: string, fx: FxTable | null): { value: number; rateDate: string | null } | null {
  if (from === to) return { value, rateDate: null };
  if (sameMajor(from, to)) return { value: (value * majorUnit(from).factor) / majorUnit(to).factor, rateDate: null };
  const a = fx?.eurPer(from, date);
  const b = fx?.eurPer(to, date);
  if (!a || !b) return null;
  return { value: (value * a.value) / b.value, rateDate: a.date < b.date ? a.date : b.date };
}

export interface ValuationPrices {
  /** Precio de hoy en la divisa de las cuentas, o el original si no hay que cambiarlo o no se puede. */
  price: PriceInput;
  /** Cierres mensuales en la misma divisa que `price` (se quitan los meses sin tipo de cambio). */
  monthly: PricePoint[];
  /** Las cuentas y el precio van en divisas distintas y no hay tipos de cambio para igualarlas. */
  unresolved: boolean;
}

export function pricesInReportingCurrency(price: PriceInput, monthly: PricePoint[], reportingUnit: string | null, fx: FxTable | null): ValuationPrices {
  if (!reportingUnit || price.currency === reportingUnit) return { price, monthly, unresolved: false };
  const now = convert(price.value, price.currency, reportingUnit, price.date, fx);
  if (!now) return { price, monthly: [], unresolved: true };
  const how = now.rateDate
    ? `al tipo del BCE del ${now.rateDate.split("-").reverse().join("-")}`
    : "(misma divisa en otra unidad)";
  const converted: PriceInput = {
    ...price,
    value: now.value,
    currency: reportingUnit,
    note: `Cotiza en ${price.currency}: ${String(+price.value.toFixed(4)).replace(".", ",")} ${price.currency} pasado a ${reportingUnit} ${how}, la divisa de sus cuentas.`,
  };
  const bars = monthly.flatMap((b) => {
    const c = convert(b.close, price.currency, reportingUnit, b.date, fx);
    return c ? [{ date: b.date, close: c.value }] : [];
  });
  return { price: converted, monthly: bars, unresolved: false };
}
