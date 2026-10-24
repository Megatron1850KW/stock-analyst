import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

/*
 * Datos REALES de la SEC guardados en tests/fixtures/sec (sin conexión). Los
 * precios son reales si existen en tests/fixtures/prices; si no, FICTICIOS.
 */
const SETTINGS = { secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo" };
const SCREENSHOTS = process.env.SCREENSHOT_DIR;

test("MU y GOOG con datos reales de la SEC", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key", "anthropic_api_key"], realSec: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/watchlist");
  for (const t of ["MU", "GOOG"]) {
    await page.getByLabel("Ticker de EE. UU.").fill(t);
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText(/añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  }
  await expect(page.getByRole("row", { name: /MICRON/ })).toBeVisible();
  if (SCREENSHOTS) await page.mouse.move(5, 500), await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/3-real-watchlist.png` });

  // Portada: las dos frente a frente
  await page.goto("/#/");
  await expect(page.getByRole("row", { name: /^MU/ })).toContainText("Barata");
  await expect(page.getByRole("row", { name: /^GOOG/ })).toContainText("Justa");
  // Análisis IA real (guardado): una llamada por valor al darlo de alta
  await expect(page.getByRole("row", { name: /^MU/ })).toContainText("Neutral");
  await expect(page.getByRole("row", { name: /^GOOG/ })).toContainText("Neutral");
  await expect(page.getByLabel("Destacados")).toContainText("La más barata frente a su historia");
  if (SCREENSHOTS) await page.mouse.move(5, 900), await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/9-real-comparativa.png` });

  await page.goto("/#/watchlist");
  await page.getByRole("link", { name: "GOOG" }).click();
  const fin = page.locator("#financieros ~ div");
  // Últimos doce meses: ventas 2025 + 1S 2026 − 1S 2025
  await expect(fin.getByRole("row", { name: /^Ventas/ })).toContainText("445.866 M$");
  await expect(page.getByRole("heading", { name: "¿Tiene mucha deuda?" }).locator("..")).toContainText("más caja que deuda");
  await expect(page.getByText(/Vende un .* más que hace un año/)).toBeVisible();
  if (SCREENSHOTS) await page.setViewportSize({ width: 1440, height: 3300 }), await page.mouse.move(5, 500), await page.waitForTimeout(400), await page.screenshot({ path: `${SCREENSHOTS}/4-real-goog.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/#/watchlist");
  await page.getByRole("link", { name: "MU" }).click();
  await expect(fin.getByRole("row", { name: /^Deuda financiera/ })).toContainText("5.179 M$");
  // El 10-K es más reciente que los 10-Q: crecimiento del último ejercicio
  await expect(page.getByText(/Vende un .* más que el año anterior/)).toBeVisible();
  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  await expect(ia).toContainText("HBM");
  await expect(ia.getByRole("button", { name: "Cita sin verificar" })).toHaveCount(0);
  // Precio y valoración frente al día del análisis, calculado sin la IA
  await expect(ia.getByRole("note", { name: "Cambios desde el análisis" })).toContainText(/El precio no ha cambiado|Frente a su historia sigue/);
  if (SCREENSHOTS) {
    await page.setViewportSize({ width: 1440, height: 1500 });
    await ia.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOTS}/10-real-mu-ia.png` });
  }
  if (SCREENSHOTS) await page.setViewportSize({ width: 1440, height: 3300 }), await page.mouse.move(5, 500), await page.waitForTimeout(400), await page.screenshot({ path: `${SCREENSHOTS}/5-real-mu.png` });
});
