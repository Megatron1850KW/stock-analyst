import { z } from "zod";

/**
 * Esquemas de las fuentes europeas (CLAUDE.md §4.2). Solo se validan los
 * campos que se usan; si una fuente cambia de formato, la importación falla
 * con un error claro en vez de guardar datos dudosos (§2.8).
 */

/** GLEIF: https://api.gleif.org/api/v1/lei-records?filter[isin]=… */
export const gleifSchema = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        lei: z.string(),
        entity: z.object({
          legalName: z.object({ name: z.string() }),
          jurisdiction: z.string().nullish(),
          legalAddress: z.object({ country: z.string().nullish() }).partial().nullish(),
        }),
      }),
    }),
  ),
});
export type Gleif = z.infer<typeof gleifSchema>;

/** OpenFIGI: POST /v3/mapping con un único ISIN. */
export const figiRowSchema = z.object({
  figi: z.string(),
  name: z.string().nullish(),
  ticker: z.string().nullish(),
  exchCode: z.string().nullish(),
  compositeFIGI: z.string().nullish(),
  securityType: z.string().nullish(),
  securityType2: z.string().nullish(),
  marketSector: z.string().nullish(),
});
export type FigiRow = z.infer<typeof figiRowSchema>;
export const figiSchema = z.array(z.object({ data: z.array(figiRowSchema).optional(), warning: z.string().optional(), error: z.string().optional() }));

/** filings.xbrl.org: /api/entities/<LEI>/filings */
export const esefFilingSchema = z.object({
  id: z.string(),
  attributes: z.object({
    period_end: z.string(),
    country: z.string().nullish(),
    fxo_id: z.string(),
    date_added: z.string().nullish(),
    published: z.string().nullish(),
    package_url: z.string().nullish(),
    report_url: z.string().nullish(),
    viewer_url: z.string().nullish(),
    json_url: z.string().nullish(),
    error_count: z.number().nullish(),
  }),
});
export type EsefFiling = z.infer<typeof esefFilingSchema>;
export const esefFilingsSchema = z.object({ data: z.array(esefFilingSchema) });

/** Un hecho de xBRL-JSON (OIM). Los valores llegan como texto. */
export const xbrlJsonFactSchema = z.object({
  value: z.string().nullable(),
  decimals: z.union([z.number(), z.string()]).nullish(),
  dimensions: z.record(z.string(), z.string()),
});
export type XbrlJsonFact = z.infer<typeof xbrlJsonFactSchema>;

export const xbrlJsonSchema = z.object({
  documentInfo: z.object({
    documentType: z.string(),
    namespaces: z.record(z.string(), z.string()).default({}),
  }),
  facts: z.record(z.string(), xbrlJsonFactSchema),
});
export type XbrlJson = z.infer<typeof xbrlJsonSchema>;
