import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, secUserAgent } from "./schema";

describe("ajustes", () => {
  it("usa valores por defecto si no hay nada guardado", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.baseCurrency).toBe("EUR");
    expect(DEFAULT_SETTINGS.aiModelAnalysis).toBe("claude-sonnet-5-5");
    expect(DEFAULT_SETTINGS.aiModelExtraction).toBe("claude-haiku-5-5");
  });

  it("conserva los campos válidos y descarta los inválidos", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = parseSettings({ theme: "dark", aiMonthlyBudgetEur: -5, secUserAgentEmail: "no-es-email", desconocido: 1 });
    expect(s.theme).toBe("dark");
    expect(s.aiMonthlyBudgetEur).toBe(DEFAULT_SETTINGS.aiMonthlyBudgetEur);
    expect(s.secUserAgentEmail).toBe("");
    expect(s).not.toHaveProperty("desconocido");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("construye el User-Agent de la SEC solo con nombre y email", () => {
    expect(secUserAgent({ secUserAgentName: "", secUserAgentEmail: "a@b.es" })).toBeNull();
    expect(secUserAgent({ secUserAgentName: " Pablo ", secUserAgentEmail: "a@b.es" })).toBe("Pablo a@b.es");
  });
});
