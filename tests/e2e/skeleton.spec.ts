import { expect, test } from "@playwright/test";

const SCREENSHOTS = process.env.SCREENSHOT_DIR;

async function shot(page: import("@playwright/test").Page, name: string, fullPage = false) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 400);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

test("portada con logo animado y columnas que se despliegan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Agente Financiero" })).toBeVisible();
  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.")).toBeVisible();
  // El logo es un SVG local: no debe pedir nada a la red
  const logo = page.locator("main img").first();
  await expect(logo).toHaveAttribute("src", /^(data:image\/svg\+xml|\/.*logo-animado)/);
  if (SCREENSHOTS) await page.waitForTimeout(2800);
  await shot(page, "1-portada");

  for (const [link, heading] of [
    ["Watchlist", "Equity Analyst"],
    ["Mi Portfolio", "Mi Portfolio"],
    ["Riesgo técnico", "Riesgo técnico de largo plazo"],
    ["Estrellas", "Estrellas"],
  ] as const) {
    await page.getByRole("link", { name: link }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    if (link === "Watchlist") await shot(page, "2-columna-watchlist");
  }
  await page.getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
  await shot(page, "4-ajustes");
});

test("el tema oscuro se aplica desde Ajustes", async ({ page }) => {
  await page.goto("/#/ajustes");
  await page.getByLabel("Apariencia").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(31, 30, 29)");
  await page.getByRole("link", { name: "Portada" }).click();
  if (SCREENSHOTS) await page.waitForTimeout(2800);
  await shot(page, "3-portada-oscuro");
});
