import { expect, test, type Page } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

/*
 * Calendario y aviso de informe nuevo con la SEC FICTICIA (tests/fixtures/ficticio):
 * tras el alta, la SEC ficticia «publica» el 10-Q de Q3 2026 de FICT.
 */
const SETTINGS = { aiMode: "api", secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo" };
const SCREENSHOTS = process.env.SCREENSHOT_DIR;

async function shot(page: Page, name: string, fullPage = false) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

test("calendario estimado, informe nuevo con aviso de macOS y «Analizar ahora»", async ({ page }) => {
  const { ai } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key", "anthropic_api_key"], newFilingAfter: 1 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Las fechas estimadas dependen de «hoy»: se fija para que el test no caduque
  await page.clock.setFixedTime(new Date("2026-10-24T10:00:00Z"));

  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  await expect.poll(() => ai).toContain("peers");
  const before = ai.length;

  await page.getByRole("link", { name: /Calendario/ }).click();
  const upcoming = page.getByRole("region", { name: "Próximos resultados" });
  await expect(upcoming).toContainText("FICT");
  await expect(upcoming).toContainText("10-Q de Q3 2026");
  await expect(upcoming.getByText("Estimada")).toBeVisible();

  // La SEC ficticia ya tiene el 10-Q nuevo: se detecta, se avisa y queda para decidir
  await page.getByRole("button", { name: "Comprobar ahora" }).click();
  await expect(page.getByRole("status")).toContainText("1 informe nuevo");
  const card = page.getByRole("listitem", { name: "FICT: 10-Q de Q3 2026" });
  await expect(card).toBeVisible();
  await expect(page.getByLabel("1 informes nuevos")).toBeVisible();
  const notes = await page.evaluate(() => (window as unknown as { __notifications: { body?: string }[] }).__notifications);
  expect(notes.map((n) => n.body)).toEqual(["Ha salido el 10-Q de Q3 2026 de FICT. ¿Analizar ahora? Ábrelo en el Calendario."]);
  // Detectar no llama a la IA
  expect(ai.length).toBe(before);
  await shot(page, "24-calendario-informe-nuevo");

  await card.getByRole("button", { name: "Analizar ahora" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole("region", { name: "Analizados hace poco" })).toContainText("FICT");
  await expect(upcoming).toContainText("10-K del ejercicio 2026");
  await shot(page, "25-calendario-analizado");

  // Ajuste: preguntar o analizar solo
  await page.goto("/#/ajustes");
  await expect(page.getByLabel("Cuando salga un informe nuevo")).toHaveValue("ask");
  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.").first()).toBeVisible();
});
