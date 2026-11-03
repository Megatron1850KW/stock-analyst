import type { Fundamentals } from "@/domain/fundamentals/metrics";

/**
 * ¿Banco, aseguradora o similar? Sin margen bruto ni operativo pero con margen
 * neto es la huella de una financiera. Pero también la de una industrial que
 * presenta la cuenta de resultados por naturaleza (TotalEnergies): si se sabe
 * su sector y no es «Finanzas», no se trata como un banco.
 */
export function isFinancial(current: Pick<Fundamentals, "grossMargin" | "operatingMargin" | "netMargin">, sector: string | null | undefined): boolean {
  const shape = current.grossMargin.value === null && current.operatingMargin.value === null && current.netMargin.value !== null;
  return shape && (!sector || sector === "Finanzas");
}
