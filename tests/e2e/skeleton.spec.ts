import { expect, test } from "@playwright/test";

const SCREENSHOTS = process.env.SCREENSHOT_DIR;

test("recorre las secciones y Ajustes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Equity Analyst" })).toBeVisible();
  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.")).toBeVisible();
  if (SCREENSHOTS) await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/1-watchlist.png` });

  for (const [link, heading] of [
    ["Mi Portfolio", "Mi Portfolio"],
    ["Riesgo técnico", "Riesgo técnico de largo plazo"],
    ["Estrellas", "Estrellas"],
    ["Ajustes", "Ajustes"],
  ] as const) {
    await page.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  if (SCREENSHOTS) await page.waitForTimeout(300), await page.screenshot({ path: `${SCREENSHOTS}/2-ajustes.png`, fullPage: true });
});

test("el tema oscuro se aplica desde Ajustes", async ({ page }) => {
  await page.goto("/#/ajustes");
  await page.getByLabel("Apariencia").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(31, 30, 29)");
  if (SCREENSHOTS) {
    await page.getByRole("link", { name: "Mi Portfolio" }).click();
    await page.mouse.move(700, 600);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOTS}/3-portfolio-oscuro.png` });
  }
});
