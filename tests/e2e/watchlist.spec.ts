import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

const SCREENSHOTS = process.env.SCREENSHOT_DIR;
// Ajustes de prueba: identidad FICTICIA para la cabecera de la SEC
const SETTINGS = { secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "fmp" };

async function shot(page: import("@playwright/test").Page, name: string) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 400);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png` });
}

test("añade un ticker (empresa ficticia), muestra precio y cifras con su origen", async ({ page }) => {
  const { calls } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"] });
  await page.goto("/#/watchlist");

  await expect(page.getByText("Añade tu primer ticker")).toBeVisible();
  await page.getByLabel("Ticker de EE. UU.").fill("fict");
  await page.getByRole("button", { name: "Añadir" }).click();

  await expect(page.getByText(/FICTICIA CORP.*añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  const row = page.getByRole("row", { name: /FICT/ });
  await expect(row).toContainText("3 anuales · 3 trimestrales");

  // Al añadir no se pide precio: se pide al abrir la app o con ⌘R
  await page.keyboard.press("Control+r");
  await expect(row).toContainText("42,50");
  expect(calls.filter((c) => c === "price_quote")).toHaveLength(1);
  await shot(page, "1-watchlist");

  await row.getByRole("link", { name: "FICT" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /FICTICIA CORP/ })).toBeVisible();
  const ventas = page.getByRole("row", { name: /^Ventas/ });
  await expect(ventas).toContainText("1.200 M$");
  await expect(page.getByRole("row", { name: /^Beneficio bruto/ })).toContainText("Sin dato");

  // Origen de la cifra al enfocar
  await ventas.locator("span[tabindex='0']").first().focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("SEC EDGAR (XBRL)");
  await expect(tip).toContainText("10-K · 0009999999-26-000020");
  await expect(tip).toContainText("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  await shot(page, "2-detalle-origen");
});

test("sin nombre y email para la SEC no deja buscar y lo explica", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/#/watchlist");
  await expect(page.getByText("La SEC exige identificarse con nombre y email.")).toBeVisible();
  await page.getByLabel("Ticker de EE. UU.").fill("FICT");
  await expect(page.getByRole("button", { name: "Añadir" })).toBeDisabled();
});

test("un ISIN se explica en vez de buscarse en la SEC", async ({ page }) => {
  const { calls } = await installTauriMock(page, { settings: SETTINGS });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker de EE. UU.").fill("ES0148396007");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/ISIN .* fase 6/)).toBeVisible();
  expect(calls).not.toContain("sec_fetch");
});

test("sin clave de precios avisa en llano", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker de EE. UU.").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByRole("row", { name: /FICT/ })).toBeVisible();
  await page.getByRole("button", { name: /Actualizar precios/ }).click();
  await expect(page.getByText("1 sin precio")).toBeVisible();
});
