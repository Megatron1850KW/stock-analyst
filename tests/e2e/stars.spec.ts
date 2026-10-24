import { expect, test, type Page } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

/*
 * Estrellas con informes y precios REALES de MU y GOOG (tests/fixtures), sin
 * conexión. La operación de cartera es FICTICIA. Los cálculos tienen tests unitarios.
 */
const SETTINGS = { secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo" };
const SCREENSHOTS = process.env.SCREENSHOT_DIR;

async function shot(page: Page, name: string, fullPage = false) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

test("estrellas de la watchlist y de la cartera, con sus razones", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"], realSec: true });
  await page.setViewportSize({ width: 1440, height: 1100 });

  await page.goto("/#/estrellas");
  await expect(page.getByText("Añade acciones a tu watchlist")).toBeVisible();

  await page.goto("/#/watchlist");
  for (const t of ["MU", "GOOG"]) {
    await page.getByLabel("Ticker o ISIN").fill(t);
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText(/añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  }

  // Rango de 52 semanas y año en curso, con las velas semanales reales
  const mu = page.getByRole("row").filter({ hasText: /^MU/ });
  await expect(mu.getByLabel(/Rango de 52 semanas/)).toBeVisible();
  await expect(mu).toContainText(/[+−]\d+(,\d)?\s%/);
  await shot(page, "22-watchlist-52-semanas");

  await page.goto("/#/estrellas");
  const ranking = page.getByRole("region", { name: "Cómo se elige la mejor siguiente compra" });
  await expect(ranking.getByRole("row")).toHaveCount(3);
  const card = page.getByRole("region", { name: "Mejor siguiente compra" });
  await expect(card.getByText(/Por qué tiene la estrella|cumple hoy los mínimos/)).toBeVisible();
  await shot(page, "19-estrellas", true);

  // Si hay estrella, el ticker lleva ⭐ en la watchlist con su porqué al pasar el ratón
  const starred = await card.getByRole("link").first().textContent().catch(() => null);
  if (starred && (await card.getByText("Por qué tiene la estrella").count())) {
    await page.goto("/#/watchlist");
    const mark = page.getByRole("img", { name: "Estrella: mejor siguiente compra" });
    await expect(mark).toHaveCount(1);
    await mark.hover();
    await expect(page.getByRole("tooltip")).toContainText("Mejor siguiente compra");
    await shot(page, "20-estrella-watchlist");
  }
  // Cartera FICTICIA: 10 acciones de MU y 5 de GOOG
  await page.goto("/#/portfolio");
  for (const [t, q, p] of [["MU", "10", "80"], ["GOOG", "5", "150"]] as const) {
    await page.keyboard.press("Control+n");
    const dlg = page.getByRole("dialog", { name: "Nueva operación" });
    await dlg.locator("#tx-input").fill(t);
    await dlg.getByLabel("Fecha").fill("2024-03-04");
    await dlg.locator("#tx-q").fill(q);
    await dlg.locator("#tx-p").fill(p);
    await dlg.getByLabel("Divisa").selectOption("USD");
    await dlg.getByRole("button", { name: "Guardar operación" }).click();
    await expect(dlg).toBeHidden();
  }
  await expect(page.getByRole("article", { name: /^MU/ })).toContainText("Precio en 52 semanas");
  await shot(page, "23-cartera-52-semanas");
  await page.goto("/#/estrellas");
  const pranking = page.getByRole("region", { name: "Cómo se elige la más barata de tu cartera" });
  await expect(pranking.getByRole("row")).toHaveCount(3);
  // Con cartera, el complemento ya mide sector, país, divisa y correlación
  await expect(ranking).not.toContainText("Aún no tienes posiciones");
  await shot(page, "21-estrellas-con-cartera", true);

  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.").first()).toBeVisible();
});
