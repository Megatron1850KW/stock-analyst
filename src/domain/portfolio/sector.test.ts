import { describe, expect, it } from "vitest";
import { countryName, sectorFromSic } from "./sector";

describe("sectorFromSic", () => {
  it("clasifica códigos SIC conocidos", () => {
    expect(sectorFromSic("3674")).toBe("Tecnología"); // semiconductores (NVDA, MU)
    expect(sectorFromSic("7372")).toBe("Tecnología"); // software (MSFT)
    expect(sectorFromSic("3571")).toBe("Tecnología"); // ordenadores (AAPL)
    expect(sectorFromSic("2834")).toBe("Salud"); // farmacéuticas
    expect(sectorFromSic("6021")).toBe("Finanzas"); // bancos
    expect(sectorFromSic("6798")).toBe("Inmobiliario"); // REIT
    expect(sectorFromSic("1311")).toBe("Energía");
    expect(sectorFromSic("3711")).toBe("Consumo discrecional"); // automóviles
    expect(sectorFromSic("5411")).toBe("Consumo básico"); // supermercados
    expect(sectorFromSic("4911")).toBe("Servicios públicos");
  });
  it("sin código o fuera de rango → null", () => {
    expect(sectorFromSic(null)).toBeNull();
    expect(sectorFromSic("")).toBeNull();
    expect(sectorFromSic("9999")).toBeNull();
  });
  it("nombres de país en español", () => {
    expect(countryName("ES")).toBe("España");
    expect(countryName("Otros")).toBe("Otros");
  });
});
