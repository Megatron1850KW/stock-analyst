import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

const SCREENSHOTS = process.env.SCREENSHOT_DIR;
// Ajustes de prueba: identidad FICTICIA para la cabecera de la SEC
const SETTINGS = { secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo" };

async function shot(page: import("@playwright/test").Page, name: string) {
  if (!SCREENSHOTS) return;
  await page.mouse.move(5, 400);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png` });
}

test("añade un ticker (empresa ficticia), muestra la ficha y el origen de cada cifra", async ({ page }) => {
  const { calls } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"] });
  await page.goto("/#/watchlist");

  await expect(page.getByText("Añade tu primer ticker")).toBeVisible();
  await page.getByLabel("Ticker de EE. UU.").fill("fict");
  await page.getByRole("button", { name: "Añadir" }).click();

  await expect(page.getByText(/FICTICIA CORP.*añadida: 3 informes anuales y 3 trimestrales/)).toBeVisible();
  const row = page.getByRole("row", { name: /FICT/ });
  await expect(row).toContainText("3 anuales · 3 trimestrales");
  // Al añadirlo se piden su precio y su histórico una vez
  await expect(row).toContainText("42,50");
  // ⌘R vuelve a pedir el precio, pero no el histórico (tiene menos de 30 días)
  await page.keyboard.press("Control+r");
  await expect.poll(() => calls.filter((c) => c === "price_quote").length).toBe(2);
  expect(calls.filter((c) => c === "price_history")).toHaveLength(1);
  await shot(page, "1-watchlist");

  await row.getByRole("link", { name: "FICT" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /FICTICIA CORP/ })).toBeVisible();
  for (const q of ["¿Cara o barata?", "¿Genera caja?", "¿Tiene mucha deuda?", "¿Crece?"]) {
    await expect(page.getByRole("heading", { name: q })).toBeVisible();
  }
  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.").first()).toBeVisible();

  const ventas = page.locator("#financieros ~ div").getByRole("row", { name: /^Ventas/ });
  await expect(ventas).toContainText("1.200 M$");
  // Origen de la cifra al enfocar
  // Con teclado (Tab), como lo haría un usuario
  await ventas.getByText("1.200 M$").first().focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("0009999999-26-000020");
  await shot(page, "2-detalle-origen");

  // Las cifras originales siguen en «Detalle para expertos»
  await page.getByText("Detalle para expertos").click();
  await expect(page.getByText("Cifras tal como aparecen en los informes de la SEC")).toBeVisible();
});

test("sube un informe en PDF y lo lista", async ({ page }) => {
  const { uploads } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker de EE. UU.").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();

  await page.getByRole("button", { name: "Subir informe" }).click();
  const panel = page.getByRole("region", { name: "Subir informe" });
  await panel.getByLabel("Archivo del informe").setInputFiles({ name: "Informe H1 2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 FICTICIO") });
  await panel.getByLabel("Tipo de informe").selectOption("half");
  await panel.getByLabel("Cierre del periodo que cubre").fill("2026-06-30");
  await shot(page, "6-subir-informe");
  await panel.getByRole("button", { name: "Guardar informe" }).click();

  const list = page.getByRole("region", { name: "Informes subidos" });
  await expect(list).toContainText("Informe H1 2026.pdf");
  await expect(list).toContainText("Semestral (PDF)");
  expect(uploads).toEqual(["Informe H1 2026.pdf"]);

  // Un archivo que no es PDF ni ZIP se rechaza antes de enviarlo
  await page.getByRole("button", { name: "Subir informe" }).click();
  await page.getByLabel("Archivo del informe").setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await expect(page.getByRole("alert")).toContainText("Solo PDF o ZIP");
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

test("al añadir un valor la IA lo analiza y busca sus competidores una vez, y la portada lo compara", async ({ page }) => {
  const { ai } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key", "anthropic_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker de EE. UU.").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();

  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  await expect(ia.getByText("Análisis IA")).toBeVisible();
  await expect(ia.getByText("Neutral", { exact: true })).toBeVisible();
  await expect(ia).toContainText("FICTICIA CORP (empresa inventada para pruebas)");
  await expect(ia.getByRole("button", { name: "Cita sin verificar" })).toBeVisible();
  await expect(ia.getByRole("button", { name: "Re-analizar" })).toBeEnabled();
  await ia.scrollIntoViewIfNeeded();
  await shot(page, "7-analisis-ia");

  // Después del análisis, una sola llamada barata para proponer competidores
  await expect.poll(() => ai.join(",")).toBe("analysis,peers");
  const comp = page.getByRole("region", { name: "Frente a la competencia" });
  await expect(comp.getByRole("row", { name: /OTRF/ })).toBeVisible();
  await expect(comp.getByRole("row", { name: /FIC\.B/ })).toBeVisible();
  await expect(comp.getByText("¿Oportunidad o trampa?")).toBeVisible();
  await expect(comp).toContainText("Lista propuesta por la IA");
  await expect(page.getByRole("region", { name: "¿Es un buen negocio?" })).toContainText("Nota de calidad");

  // Editar la lista: quitar uno y añadir otro a mano (sin IA)
  await comp.getByRole("button", { name: "Quitar FIC.B de los competidores" }).click();
  await expect(comp.getByRole("row", { name: /FIC\.B/ })).toHaveCount(0);
  await comp.getByLabel("Añadir competidor").fill("FIC.B");
  await comp.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(comp.getByRole("row", { name: /FIC\.B/ })).toContainText("Añadido por ti");
  await comp.scrollIntoViewIfNeeded();
  await shot(page, "11-competidores");

  // Volver a la portada no vuelve a llamar a la IA; los competidores no entran en la watchlist
  await page.goto("/#/");
  const row = page.getByRole("row", { name: /FICT/ });
  await expect(row).toContainText("Neutral");
  await expect(row).toContainText("Más caja que deuda");
  await expect(row).toContainText(/frente a 2 competidores/);
  await expect(page.getByRole("row", { name: /OTRF/ })).toHaveCount(0);
  await shot(page, "8-comparativa");
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: /FICTICIA CORP/ })).toBeVisible();
  expect(ai).toEqual(["analysis", "peers"]);

  // «Re-analizar» sí llama (solo al análisis)
  await page.getByRole("button", { name: "Re-analizar" }).click();
  await expect.poll(() => ai.join(",")).toBe("analysis,peers,analysis");
});

test("sin clave de Claude no se llama a la IA y se ofrece el botón", async ({ page }) => {
  const { calls } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker de EE. UU.").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();
  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  await ia.getByRole("button", { name: "Analizar con IA" }).click();
  await expect(ia.getByRole("alert")).toContainText("Falta la clave de Claude. Añádela en Ajustes.");
  expect(calls).not.toContain("claude_request");
});
