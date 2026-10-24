import { z } from "zod";

/**
 * Esquemas de las respuestas de SEC EDGAR. Solo se validan los campos que se
 * usan; si la SEC cambia el formato, la importación falla con un error claro
 * en vez de guardar datos dudosos (CLAUDE.md §2.8).
 */

/** https://www.sec.gov/files/company_tickers_exchange.json */
export const tickersExchangeSchema = z.object({
  fields: z.array(z.string()),
  data: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});
export type TickersExchange = z.infer<typeof tickersExchangeSchema>;

/** Columnas paralelas de submissions.filings.recent (y de las páginas antiguas). */
export const filingColumnsSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  reportDate: z.array(z.string()),
  form: z.array(z.string()),
  primaryDocument: z.array(z.string()),
  isXBRL: z.array(z.number()).optional(),
});
export type FilingColumns = z.infer<typeof filingColumnsSchema>;

/** https://data.sec.gov/submissions/CIK##########.json */
export const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  sic: z.string().nullish(),
  sicDescription: z.string().nullish(),
  tickers: z.array(z.string()).default([]),
  exchanges: z.array(z.string().nullable()).default([]),
  fiscalYearEnd: z.string().nullish(),
  filings: z.object({
    recent: filingColumnsSchema,
    files: z.array(z.object({ name: z.string(), filingFrom: z.string(), filingTo: z.string() })).default([]),
  }),
});
export type Submissions = z.infer<typeof submissionsSchema>;

/** Un valor XBRL de companyfacts. */
export const factEntrySchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string(),
  fy: z.number().nullish(),
  fp: z.string().nullish(),
  form: z.string(),
  filed: z.string(),
  frame: z.string().optional(),
});
export type FactEntry = z.infer<typeof factEntrySchema>;

const conceptSchema = z.object({
  label: z.string().nullish(),
  units: z.record(z.string(), z.array(factEntrySchema)),
});

/** https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json */
export const companyFactsSchema = z.object({
  cik: z.union([z.string(), z.number()]).transform(String),
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), conceptSchema)),
});
export type CompanyFacts = z.infer<typeof companyFactsSchema>;
