// @vitest-environment node
import { describe, expect, it } from "vitest";
import tickersJson from "../../../tests/fixtures/ficticio/tickers.json";
import { filingUrl, findTicker } from "./client";
import { tickersExchangeSchema } from "./schemas";

const list = tickersExchangeSchema.parse(tickersJson);

describe("ticker → CIK (datos ficticios)", () => {
  it("encuentra el ticker sin distinguir mayúsculas", () => {
    expect(findTicker(list, " fict ")).toEqual({ cik: "9999999", name: "FICTICIA CORP", ticker: "FICT", exchange: "Nasdaq" });
  });

  it("trata igual BRK.B y BRK-B", () => {
    expect(findTicker(list, "FIC-B")?.cik).toBe("7777777");
    expect(findTicker(list, "fic.b")?.exchange).toBeNull();
  });

  it("devuelve null si no existe", () => {
    expect(findTicker(list, "NOPE")).toBeNull();
  });

  it("construye el enlace al documento en EDGAR", () => {
    expect(filingUrl("0000320193", "0000320193-25-000079", "aapl-20250927.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    );
  });
});
