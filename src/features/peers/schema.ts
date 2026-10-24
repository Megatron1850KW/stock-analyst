import { z } from "zod";

/** Propuesta de competidores de la IA (CLAUDE.md §4.3). Se valida aquí además de pedirla con esquema. */
const peerSchema = z.object({
  ticker: z.string(),
  nombre: z.string(),
  /** Dónde presenta sus informes oficiales: SEC o ESEF. */
  mercado: z.enum(["EEUU", "Europa"]),
  /** ISIN de una europea; null para las de EE. UU. */
  isin: z.string().nullable(),
  motivo: z.string(),
});

/** Lo que se pide a la IA (versión 2 del prompt). */
export const peerOutputSchema = z.object({ competidores: z.array(peerSchema), nota: z.string() });

/** Lo guardado: las propuestas de la versión 1 no traían mercado ni ISIN (eran todas de EE. UU.). */
export const peerProposalSchema = z.object({
  competidores: z.array(peerSchema.extend({ mercado: peerSchema.shape.mercado.optional(), isin: peerSchema.shape.isin.optional() })),
  nota: z.string(),
});

export type PeerProposal = z.infer<typeof peerProposalSchema>;
