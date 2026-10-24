import { expect, test, type Page } from "@playwright/test";
import { FAKE_ETF_ISIN, installTauriMock } from "./tauri-mock";

const SCREENSHOTS = process.env.SCREENSHOT_DIR;
// Ajustes de prueba: identidad FICTICIA para la cabecera de la SEC
const SETTINGS = { aiMode: "api", secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo", priceProviderEu: "alphavantage" };
const SECRETS = ["prices_api_key", "alphavantage_api_key", "anthropic_api_key"];

async function shot(page: Page, name: string, fullPage = false) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 400);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage });
}

async function addTx(page: Page, t: { input: string; kind?: "Acción" | "ETF" | "ETC"; type?: "Compra" | "Venta" | "Dividendo"; date: string; q: string; p: string; cur?: string; fees?: string; broker?: string }) {
  await page.keyboard.press("Control+n");
  const dlg = page.getByRole("dialog", { name: "Nueva operación" });
  await expect(dlg).toBeVisible();
  if (t.type) await dlg.getByRole("radio", { name: t.type }).click();
  await dlg.locator("#tx-input").fill(t.input);
  if (t.kind) await dlg.getByRole("radio", { name: t.kind, exact: true }).click();
  await dlg.getByLabel("Fecha").fill(t.date);
  await dlg.locator("#tx-q").fill(t.q);
  await dlg.locator("#tx-p").fill(t.p);
  if (t.cur) await dlg.getByLabel("Divisa").selectOption(t.cur);
  if (t.fees) await dlg.locator("#tx-f").fill(t.fees);
  if (t.broker) await dlg.locator("#tx-b").fill(t.broker);
  return dlg;
}

test("cartera (datos ficticios): operaciones, vision board, ficha de ETF y portada", async ({ page }) => {
  const { ai, calls, db } = await installTauriMock(page, { settings: SETTINGS, secrets: SECRETS, price: 38.4 });
  await page.goto("/#/portfolio");
  await expect(page.getByText("Registra tu primera operación")).toBeVisible();

  // 1) Acción de EE. UU. en dólares: se buscan sus informes y el tipo del BCE del día
  let dlg = await addTx(page, { input: "fict", date: "2024-03-04", q: "40", p: "21,50", cur: "USD", fees: "4", broker: "Bróker ficticio" });
  await expect(dlg.getByText(/BCE: 1 USD = 0,\d{4} € \(4 mar 2024\)/)).toBeVisible();
  await shot(page, "9-nueva-operacion");
  await dlg.getByRole("button", { name: "Guardar operación" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("article", { name: /FICT/ })).toBeVisible();
  expect(calls).toContain("fx_series");
  // Una acción nueva pasa por el análisis inicial con IA, como en la watchlist
  await expect.poll(() => ai).toContain("analysis");

  // 2) ETF por ISIN, en euros (Xetra)
  dlg = await addTx(page, { input: FAKE_ETF_ISIN, kind: "ETF", date: "2023-06-01", q: "25", p: "52", fees: "2" });
  await dlg.getByRole("button", { name: "Guardar operación" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("article", { name: /FWRL/ })).toBeVisible();

  // 3) Acción europea por ISIN (Madrid: sin precio, y se dice)
  dlg = await addTx(page, { input: "ES0000000010", date: "2025-02-10", q: "30", p: "41", fees: "3" });
  await dlg.getByRole("button", { name: "Guardar operación" }).click();
  await expect(dlg.getByText(/Alpha Vantage no cubre la Bolsa de Madrid/)).toBeVisible();
  await dlg.getByRole("button", { name: "Cerrar" }).first().click();

  // 4) Venta parcial y dividendo de FICT
  dlg = await addTx(page, { input: "FICT", type: "Venta", date: "2026-02-02", q: "10", p: "35", cur: "USD", fees: "2" });
  await dlg.getByRole("button", { name: "Guardar operación" }).click();
  await expect(dlg).toBeHidden();
  dlg = await addTx(page, { input: "FICT", type: "Dividendo", date: "2026-06-15", q: "30", p: "0,40", cur: "USD", fees: "0,06" });
  await dlg.getByRole("button", { name: "Guardar operación" }).click();
  await expect(dlg).toBeHidden();
  // No se puede vender más de lo que tienes
  dlg = await addTx(page, { input: "FICT", type: "Venta", date: "2026-07-01", q: "500", p: "35", cur: "USD" });
  await dlg.getByRole("button", { name: "Guardar operación" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Solo tienes 30 acciones");
  await dlg.getByRole("button", { name: "Cancelar" }).click();

  const rows = db.prepare("SELECT type, quantity, currency FROM transactions ORDER BY id").all();
  expect(rows).toHaveLength(5);

  // Vision board
  await expect(page.getByText("Valor de tu cartera")).toBeVisible();
  const fict = page.getByRole("article", { name: /FICT/ });
  await expect(fict).toContainText("30 ×");
  const ftx = page.getByRole("article", { name: /FTX/ });
  await expect(ftx).toContainText("Sin precio todavía.");
  await expect(ftx).toContainText("Sector: Sin dato");
  // Indicar el sector de la europea
  await ftx.getByRole("button", { name: /Sector: Sin dato/ }).click();
  const cls = page.getByRole("dialog", { name: /Sector y país de FTX/ });
  await cls.getByLabel("Sector").selectOption("Consumo discrecional");
  await cls.getByRole("button", { name: "Guardar" }).click();
  await expect(ftx).toContainText("Consumo discrecional · España");

  // Ficha del ETF: la lee la IA y reparte su exposición
  await page.getByRole("article", { name: /FWRL/ }).getByRole("button", { name: "Subir su ficha (PDF)" }).click();
  const sheet = page.getByRole("dialog", { name: /Ficha de FWRL/ });
  await sheet.locator('input[type="file"]').setInputFiles({ name: "factsheet-ficticio.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 FICTICIO") });
  await expect(sheet).toContainText("MSCI World (ficticio)");
  await expect(sheet).toContainText("0,20 %");
  await expect(sheet).toContainText("Leída por IA de factsheet-ficticio.pdf");
  expect(ai.filter((x) => x === "etf")).toHaveLength(1);
  await shot(page, "12-ficha-etf");
  await sheet.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("article", { name: /FWRL/ })).toContainText("0,20 %");

  await page.getByText("Valor de tu cartera").scrollIntoViewIfNeeded();
  await shot(page, "10-cartera");
  await page.getByRole("tab", { name: "Sector" }).click();
  await expect(page.getByRole("list", { name: "Peso por sector" })).toContainText("Tecnología");
  await page.getByRole("heading", { name: "¿Dónde está tu dinero?" }).scrollIntoViewIfNeeded();
  await shot(page, "11-composicion");

  // Portada: pestañas de cartera y de ETFs
  await page.goto("/#/");
  await page.getByRole("tab", { name: /Mi cartera/ }).click();
  await expect(page.getByText("Valor de tu cartera")).toBeVisible();
  await shot(page, "13-portada-cartera");
  await page.getByRole("tab", { name: /ETFs y ETCs/ }).click();
  await expect(page.getByRole("table", { name: "ETFs y ETCs que sigues" })).toContainText("MSCI World (ficticio)");
  await shot(page, "14-portada-etfs");
});
