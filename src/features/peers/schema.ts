import { z } from "zod";

/** Propuesta de competidores de la IA (CLAUDE.md §4.3). Se valida aquí además de pedirla con esquema. */
export const peerProposalSchema = z.object({
  competidores: z.array(
    z.object({
      ticker: z.string(),
      nombre: z.string(),
      motivo: z.string(),
    }),
  ),
  nota: z.string(),
});

export type PeerProposal = z.infer<typeof peerProposalSchema>;
