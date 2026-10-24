import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

// Datos REALES de la SEC guardados en tests/fixtures/sec (sin conexión). El precio sí es ficticio.
const SETTINGS = { secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "fmp" };
const SCREENSHOTS = process.env.SCREENSHOT_DIR;

test("MU y GOOG con datos reales de la SEC", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS, realSec: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/watchlist");
  for (const t of ["MU", "GOOG"]) {
    await page.getByLabel("Ticker de EE. UU.").fill(t);
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText(/añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  }
  await expect(page.getByRole("row", { name: /MICRON/ })).toBeVisible();
  if (SCREENSHOTS) await page.mouse.move(5, 500), await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/3-real-watchlist.png` });

  await page.getByRole("link", { name: "GOOG" }).click();
  await expect(page.getByRole("row", { name: /^Ventas/ })).toContainText("119.796 M$");
  if (SCREENSHOTS) await page.mouse.move(5, 500), await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/4-real-goog.png`, fullPage: true });

  await page.goto("/#/watchlist");
  await page.getByRole("link", { name: "MU" }).click();
  await expect(page.getByRole("row", { name: /^Deuda financiera total/ })).toContainText("5.179 M$");
  if (SCREENSHOTS) await page.mouse.move(5, 500), await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/5-real-mu.png`, fullPage: true });
});
