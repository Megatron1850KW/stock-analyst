import { z } from "zod";

/**
 * Salida del análisis narrativo (CLAUDE.md §7). Se pide a Claude con salida
 * estructurada y, además, se valida aquí: si no valida, se descarta.
 */
const cita = z.object({
  /** Nº de registro del informe tal como se le dio, o "resumen". */
  documento: z.string(),
  seccion: z.string(),
  /** Frase literal del extracto ("" si cita el resumen numérico). */
  texto: z.string(),
});

const punto = z.object({ titulo: z.string(), detalle: z.string(), cita });

export const equityAnalysisSchema = z.object({
  modelo_negocio: z.string(),
  outlook: z.object({
    resumen: z.string(),
    guidance: z.array(z.object({ texto: z.string(), cita })),
  }),
  catalizadores: z.array(punto),
  riesgos: z.array(punto.extend({ gravedad: z.enum(["alta", "media", "baja"]) })),
  veredicto: z.object({
    postura: z.enum(["Interesante", "Neutral", "Precaución"]),
    resumen: z.string(),
  }),
  puntos_clave: z.array(z.string()),
  datos_no_encontrados: z.array(z.string()),
});

export type EquityAnalysis = z.infer<typeof equityAnalysisSchema>;
export type Cita = z.infer<typeof cita>;

/** Comprobaciones que el esquema no puede expresar. Si hay alguna, el análisis se descarta. */
export function analysisProblems(a: EquityAnalysis): string[] {
  const issues: string[] = [];
  if (a.modelo_negocio.trim().length < 40) issues.push("El modelo de negocio está vacío.");
  if (a.riesgos.length === 0) issues.push("No hay riesgos.");
  if (a.veredicto.resumen.trim().length < 40) issues.push("El veredicto está vacío.");
  return issues;
}

/** ¿La cita apunta a un documento que se le dio a la IA? Si no, la UI la marca como no verificada. */
export function isKnownCitation(c: Cita, documentIds: string[]): boolean {
  return c.documento === "resumen" || documentIds.includes(c.documento);
}
