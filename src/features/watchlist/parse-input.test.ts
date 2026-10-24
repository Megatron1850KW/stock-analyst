import { describe, expect, it } from "vitest";
import { parseWatchlistEntry, splitWatchlistInput } from "./parse-input";

describe("lo que se escribe en «Ticker o ISIN»", () => {
  it("separa una lista pegada tal cual (con prefijos de bolsa y nombres entre paréntesis)", () => {
    const text = "NASDAQ: NBIS ; LU1681044720 ; ETR: BMW ; EPA: EL ; NYSE: V (Visa) ; NYSE: AXP ; IE00BDFL4P12 ; NYSE: NKE ; BIT: UCG (UniCredit Spa)";
    const parsed = splitWatchlistInput(text).map(parseWatchlistEntry);
    expect(parsed.map(({ raw: _raw, ...p }) => p)).toEqual([
      { kind: "us", ticker: "NBIS" },
      { kind: "isin", isin: "LU1681044720" },
      { kind: "eu-ticker", ticker: "BMW", exchange: "Xetra" },
      { kind: "eu-ticker", ticker: "EL", exchange: "París" },
      { kind: "us", ticker: "V" },
      { kind: "us", ticker: "AXP" },
      { kind: "isin", isin: "IE00BDFL4P12" },
      { kind: "us", ticker: "NKE" },
      { kind: "eu-ticker", ticker: "UCG", exchange: "Milán" },
    ]);
    expect(parsed[4]!.raw).toBe("NYSE: V (Visa)");
  });

  it("acepta comas y saltos de línea, minúsculas y un solo valor", () => {
    expect(splitWatchlistInput("aapl, msft\nes0148396007")).toEqual(["aapl", "msft", "es0148396007"]);
    expect(parseWatchlistEntry(" aapl ")).toMatchObject({ kind: "us", ticker: "AAPL" });
    expect(parseWatchlistEntry("es0148396007")).toMatchObject({ kind: "isin", isin: "ES0148396007" });
    expect(parseWatchlistEntry("BRK.B")).toMatchObject({ kind: "us", ticker: "BRK.B" });
    expect(parseWatchlistEntry("BME: ES0148396007")).toMatchObject({ kind: "isin", isin: "ES0148396007" });
  });
});
