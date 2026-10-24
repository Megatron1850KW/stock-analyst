import { expect, test, type Page } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

/*
 * Precios mensuales y semanales REALES de MU y GOOG (tests/fixtures/prices),
 * sin conexión. Solo comprueba la pantalla; los cálculos tienen tests unitarios.
 */
const SETTINGS = { secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo" };
const SCREENSHOTS = process.env.SCREENSHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png` });
}

test("riesgo técnico de largo plazo con precios reales", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"], realSec: true });
  await page.setViewportSize({ width: 1440, height: 1100 });

  await page.goto("/#/riesgo-tecnico");
  await expect(page.getByText("Aún no hay valores que revisar")).toBeVisible();

  await page.goto("/#/watchlist");
  for (const t of ["MU", "GOOG"]) {
    await page.getByLabel("Ticker o ISIN").fill(t);
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText(/añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  }

  await page.goto("/#/riesgo-tecnico");
  const list = page.getByRole("list", { name: "Tus valores por riesgo técnico" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  for (const t of ["MU", "GOOG"]) {
    const item = list.getByRole("listitem").filter({ hasText: new RegExp(`^${t} `) });
    await expect(item).toContainText(/Riesgo (bajo|medio|alto)/);
    await expect(item).toContainText(/La tendencia de fondo es (alcista|lateral|bajista)/);
  }

  await list.getByRole("button", { name: /^MU / }).click();
  const detail = page.getByRole("region", { name: "Riesgo técnico de MU" });
  await expect(detail).toContainText("Por qué este semáforo");
  await expect(detail).toContainText("Media de 10 meses");
  await expect(detail.locator("canvas").first()).toBeVisible();
  await shot(page, "15-riesgo-mensual");

  await detail.getByRole("tab", { name: "Semanales · 5 años" }).click();
  await expect(detail).toContainText("Media de 40 semanas");
  await shot(page, "16-riesgo-semanal");

  // Nunca intradía: no hay más escalas que mensual y semanal
  await expect(detail.getByRole("tab")).toHaveCount(2);
  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.").first()).toBeVisible();
});
