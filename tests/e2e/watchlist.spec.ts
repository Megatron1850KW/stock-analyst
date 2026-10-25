import { expect, test } from "@playwright/test";
import { FAKE_ANALYSIS } from "../helpers/fake-claude";
import { FAKE_ETF_SHEET, installTauriMock } from "./tauri-mock";

const SCREENSHOTS = process.env.SCREENSHOT_DIR;
// Ajustes de prueba: identidad FICTICIA para la cabecera de la SEC
const SETTINGS = { aiMode: "api", secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo" };

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
  await page.getByLabel("Ticker o ISIN").fill("fict");
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
  await page.getByLabel("Ticker o ISIN").fill("FICT");
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
  await expect(page.getByRole("alert")).toContainText("Solo PDF o paquete ESEF");
  // Sin fecha, el botón explica qué falta; un paquete .xbri trae el cierre en su nombre
  const again = page.getByRole("region", { name: "Subir informe" });
  await again.getByLabel("Archivo del informe").setInputFiles({ name: "informe.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04 FICTICIO") });
  await expect(again).toContainText("Falta la fecha de cierre");
  await again.getByLabel("Archivo del informe").setInputFiles({ name: "fict-2025-12-31-1-fr.xbri", mimeType: "application/octet-stream", buffer: Buffer.from("PK\x03\x04 FICTICIO") });
  await expect(again.getByLabel("Cierre del periodo que cubre")).toHaveValue("2025-12-31");
  await expect(again.getByRole("button", { name: "Guardar informe" })).toBeEnabled();
});

test("modo manual: lee un semestral en PDF con claude.ai pegando la respuesta FICTICIA", async ({ page }) => {
  const { aiMode: _mode, ...manual } = SETTINGS;
  const { calls } = await installTauriMock(page, { settings: manual, secrets: ["prices_api_key"] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();

  await page.getByRole("button", { name: "Subir informe" }).click();
  const up = page.getByRole("region", { name: "Subir informe" });
  await up.getByLabel("Archivo del informe").setInputFiles({ name: "Informe H1 2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 FICTICIO") });
  await up.getByLabel("Tipo de informe").selectOption("half");
  await up.getByLabel("Cierre del periodo que cubre").fill("2026-06-30");
  await up.getByRole("button", { name: "Guardar informe" }).click();

  const list = page.getByRole("region", { name: "Informes subidos" });
  await expect(list).toContainText("cifras sin leer");
  await list.getByRole("button", { name: "Leer con Claude.ai" }).click();
  const panel = list.getByLabel("Leer Informe H1 2026.pdf con Claude.ai");
  await expect(panel.getByLabel("Texto para Claude")).toHaveValue(/Te adjunto un informe en PDF[\s\S]*2026-06-30/);
  await expect(panel.getByRole("button", { name: "Mostrar el PDF en el Finder" })).toBeVisible();
  await shot(page, "27-pdf-manual");

  // Respuesta FICTICIA (el PDF simulado tiene 2 páginas)
  const answer = {
    moneda: "USD",
    tipo: "semestral",
    periodo: { inicio: "2026-01-01", fin: "2026-06-30" },
    cifras: [
      { concepto: "revenue", valor: 640, escala: "millones", inicio: "2026-01-01", fin: "2026-06-30", pagina: 1, etiqueta: "Ventas (ficticio)" },
      { concepto: "cash", valor: 210, escala: "millones", inicio: null, fin: "2026-06-30", pagina: 2, etiqueta: "Caja (ficticio)" },
    ],
    notas: "",
  };
  await panel.getByLabel("Respuesta de Claude").fill(JSON.stringify(answer));
  await panel.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(list).toContainText("2 cifras leídas");
  await expect(list.getByRole("button", { name: "Volver a leer con Claude.ai" })).toBeVisible();
  expect(calls).not.toContain("claude_request");
});

test("sin nombre y email para la SEC no busca acciones de EE. UU. y lo explica", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/#/watchlist");
  await expect(page.getByText("La SEC exige identificarse con nombre y email.")).toBeVisible();
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/la SEC exige tu nombre y email/)).toBeVisible();
});

test("una acción europea (ficticia) se añade por su ISIN con sus informes ESEF, sin pedir datos para la SEC", async ({ page }) => {
  const { calls } = await installTauriMock(page, { secrets: ["prices_api_key", "alphavantage_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("ES0000000010");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/Ficticia Textil.*añadida: 3 informes anuales y 0 intermedios/i)).toBeVisible();
  // Faltan los semestrales: se piden en «Documentos pendientes»
  await expect(page.getByText(/en «Documentos pendientes»/)).toBeVisible();
  expect(calls).not.toContain("sec_fetch");
  // Alpha Vantage no cubre Madrid: se dice sin gastar consultas
  await expect(page.getByText("Precio: Alpha Vantage no cubre la Bolsa de Madrid: por ahora va sin precio.")).toBeVisible();
  expect(calls.filter((c) => c.startsWith("price_"))).toEqual([]);
  await shot(page, "6-europa-watchlist");

  await page.getByRole("row", { name: /FTX/ }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /Ficticia Textil/i })).toBeVisible();
  await expect(page.getByText("ES0000000010").first()).toBeVisible();
  await expect(page.locator("#financieros ~ div").getByRole("row", { name: /^Ventas/ })).toContainText("1.331 M€");
  await shot(page, "7-europa-ficha");
});

test("una europea (ficticia) se analiza con su informe ESEF y se compara con una competidora europea", async ({ page }) => {
  const peers = {
    competidores: [{ ticker: "FMD", nombre: "Ficticia Moda", mercado: "Europa", isin: "FR0000000010", motivo: "También vende ropa (ficticio)." }],
    nota: "",
  };
  const { ai, calls } = await installTauriMock(page, { settings: { aiMode: "api" }, secrets: ["prices_api_key", "alphavantage_api_key", "anthropic_api_key"], peers });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("ES0000000010");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("row", { name: /FTX/ }).getByRole("link").first().click();

  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  await expect(ia.getByText("Análisis IA")).toBeVisible();
  await expect.poll(() => ai.join(",")).toBe("analysis,peers");
  // El texto para la IA sale del informe ESEF guardado, nunca de la SEC
  expect(calls).toContain("esef_report");
  expect(calls).not.toContain("sec_fetch");
  const comp = page.getByRole("region", { name: "Frente a la competencia" });
  await expect(comp.getByRole("row", { name: /FMD/ })).toBeVisible();
  await comp.scrollIntoViewIfNeeded();
  await shot(page, "8-europa-competidores");
});

test("sin clave de precios avisa en llano", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByRole("row", { name: /FICT/ })).toBeVisible();
  await page.getByRole("button", { name: /Actualizar precios/ }).click();
  await expect(page.getByText("1 sin precio")).toBeVisible();
});

test("al añadir un valor la IA lo analiza y busca sus competidores una vez, y la portada lo compara", async ({ page }) => {
  const { ai } = await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key", "anthropic_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("FICT");
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
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();
  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  await ia.getByRole("button", { name: "Analizar con IA" }).click();
  await expect(ia.getByRole("alert")).toContainText("Falta la clave de Claude. Añádela en Ajustes.");
  expect(calls).not.toContain("claude_request");
});

test("modo Claude.ai manual (por defecto): copiar, pegar la respuesta FICTICIA y guardar sin llamar a la API", async ({ page }) => {
  const { aiMode: _mode, ...manual } = SETTINGS;
  const { calls } = await installTauriMock(page, { settings: manual, secrets: ["prices_api_key", "anthropic_api_key"] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();
  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  // Al añadirla no se llama a la API, aunque haya clave
  await ia.getByRole("button", { name: "Analizar con Claude.ai" }).click();
  const panel = ia.getByLabel("Análisis con Claude.ai");
  await expect(panel.getByLabel("Texto para Claude")).toHaveValue(/Analiza la acción .*\(FICT\)[\s\S]*<resumen_numerico>/);
  await expect(panel.getByRole("link", { name: /Abrir claude.ai/ })).toHaveAttribute("href", "https://claude.ai/new");

  await panel.getByLabel("Respuesta de Claude").fill("No puedo ayudarte con eso");
  await panel.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("No encuentro el JSON");
  await shot(page, "26-ia-manual");

  await panel.getByLabel("Respuesta de Claude").fill("```json\n" + JSON.stringify(FAKE_ANALYSIS) + "\n```");
  await panel.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(ia).toContainText("Redactado en claude.ai (copiado a mano)");
  await expect(ia).toContainText(FAKE_ANALYSIS.veredicto.resumen);
  await expect(ia.getByRole("button", { name: "Rehacer con Claude.ai" })).toBeVisible();
  expect(calls).not.toContain("claude_request");
});

test("sin IA (Ajustes) no hay botón de análisis", async ({ page }) => {
  await installTauriMock(page, { settings: { ...SETTINGS, aiMode: "off" }, secrets: ["prices_api_key", "anthropic_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("FICT");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FICT" }).click();
  const ia = page.getByRole("region", { name: /Qué opina el analista/ });
  await expect(ia).toContainText("La IA está desactivada en Ajustes");
  await expect(ia.getByRole("button")).toHaveCount(0);
});

test("añade una lista pegada de golpe (ficticia): acción de EE. UU., ETF por ISIN y una europea sin ISIN", async ({ page }) => {
  await installTauriMock(page, { settings: SETTINGS, secrets: ["prices_api_key"] });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("NYSE: FICT (Ficticia Corp) ; IE000FICTET1 ; ETR: FTX");
  await page.getByRole("button", { name: "Añadir" }).click();

  const ok = page.getByRole("status").filter({ hasText: "añadida" });
  await expect(ok).toContainText(/FICTICIA CORP.*añadida: 3 informes anuales y 3 trimestrales/);
  await expect(ok).toContainText(/FICTICIO MSCI WORLD.*añadido como ETF \(cotiza en Xetra\)/);
  await expect(ok).toContainText("Te pido su ficha en «Documentos pendientes».");
  // La europea por ticker no se adivina: se pide su ISIN y queda en la casilla para corregirla
  await expect(page.getByRole("alert")).toContainText("ETR: FTX: FTX (Xetra): las acciones europeas las identifico por su ISIN");
  await expect(page.getByLabel("Ticker o ISIN")).toHaveValue("ETR: FTX");

  const etfRow = page.getByRole("row", { name: /FWRL/ });
  await expect(etfRow).toContainText("ETF: sin informes, se mira su ficha");
  await expect(etfRow).toContainText("Ficha pendiente");
  await shot(page, "17-watchlist-lista");

  await page.getByRole("link", { name: "FWRL" }).click();
  const sheet = page.getByRole("region", { name: "Ficha del fondo" });
  await expect(sheet).toContainText("Me falta su ficha mensual o su KID");
  await expect(sheet.getByRole("link", { name: "su página de justETF" })).toHaveAttribute("href", "https://www.justetf.com/es/etf-profile.html?isin=IE000FICTET1");
  await expect(page.getByText("Herramienta informativa, no constituye asesoramiento financiero.").first()).toBeVisible();
  await shot(page, "18-ficha-etf-watchlist");

  // La portada lo compara con los demás fondos aunque no esté en la cartera
  await page.goto("/#/");
  await page.getByRole("tab", { name: /ETFs y ETCs/ }).click();
  await expect(page.getByRole("table", { name: "ETFs y ETCs que sigues" }).getByRole("row", { name: /FWRL/ })).toContainText("En tu watchlist");
});

test("modo manual: lee la ficha de un ETF (ficticio) con claude.ai pegando la respuesta", async ({ page }) => {
  const { aiMode: _mode, ...manual } = SETTINGS;
  const { calls } = await installTauriMock(page, { settings: manual, secrets: ["prices_api_key"] });
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("IE000FICTET1");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByRole("link", { name: "FWRL" }).click();
  await page.getByRole("region", { name: "Ficha del fondo" }).getByRole("button", { name: /Subir/ }).click();

  const dlg = page.getByRole("dialog", { name: /Ficha de FWRL/ });
  await dlg.locator('input[type="file"]').setInputFiles({ name: "factsheet-ficticio.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 /Type /Page /Type /Page FICTICIO") });
  const steps = dlg.getByLabel("Leer factsheet-ficticio.pdf con Claude.ai");
  await expect(steps.getByLabel("Texto para Claude")).toHaveValue(/Te adjunto la ficha[\s\S]*IE000FICTET1/);
  await steps.getByLabel("Respuesta de Claude").fill(JSON.stringify(FAKE_ETF_SHEET));
  await steps.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dlg).toContainText("MSCI World (ficticio)");
  await expect(dlg).toContainText("Leída en claude.ai de factsheet-ficticio.pdf");
  expect(calls).not.toContain("claude_request");
});
