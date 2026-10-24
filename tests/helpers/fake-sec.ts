import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SecClient } from "@/data/sec-edgar/client";
import { companyFactsSchema, submissionsSchema, tickersExchangeSchema } from "@/data/sec-edgar/schemas";

const dir = join(__dirname, "../fixtures/ficticio");
const load = (name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

/** Cliente SEC que sirve los datos FICTICIOS de tests/fixtures/ficticio. */
export function fakeSec(): SecClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    tickers: async () => (calls.push("tickers"), tickersExchangeSchema.parse(load("tickers"))),
    submissions: async (cik) => (calls.push(`submissions:${cik}`), submissionsSchema.parse(load("submissions"))),
    submissionsFile: async (name) => {
      calls.push(`file:${name}`);
      throw new Error("no hay páginas antiguas en el fixture");
    },
    companyFacts: async (cik) => (calls.push(`facts:${cik}`), companyFactsSchema.parse(load("companyfacts"))),
  };
}
