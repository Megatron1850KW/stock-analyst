import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_ETF_ISIN, installTauriMock } from "./tauri-mock";

/*
 * Accesibilidad (WCAG 2.1 AA) de todas las pantallas, en modo claro y oscuro,
 * con datos FICTICIOS: una acción en la watchlist y en la cartera y un ETF.
 */
const SETTINGS = { aiMode: "api", secUserAgentName: "Usuario Prueba", secUserAgentEmail: "prueba@example.com", priceProvider: "tiingo", priceProviderEu: "alphavantage" };
const SECRETS = ["prices_api_key", "alphavantage_api_key", "anthropic_api_key"];
const SCREENSHOTS = process.env.SCREENSHOT_DIR;
const ROUTES = ["/", "/watchlist", "/portfolio", "/riesgo-tecnico", "/estrellas", "/calendario", "/ajustes"];

async function seed(page: Page) {
  await page.goto("/#/watchlist");
  await page.getByLabel("Ticker o ISIN").fill("fict");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/añadida: 3 informes anuales/)).toBeVisible();
  await page.goto("/#/portfolio");
  for (const t of [{ input: "fict", kind: null, q: "40", p: "21,50" }, { input: FAKE_ETF_ISIN, kind: "ETF", q: "25", p: "52" }]) {
    await page.keyboard.press("Control+n");
    const dlg = page.getByRole("dialog", { name: "Nueva operación" });
    await dlg.locator("#tx-input").fill(t.input);
    if (t.kind) await dlg.getByRole("radio", { name: t.kind, exact: true }).click();
    await dlg.getByLabel("Fecha").fill("2024-03-04");
    await dlg.locator("#tx-q").fill(t.q);
    await dlg.locator("#tx-p").fill(t.p);
    await dlg.getByRole("button", { name: "Guardar operación" }).click();
    await expect(dlg).toBeHidden({ timeout: 20_000 });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`accesibilidad AA en modo ${theme === "light" ? "claro" : "oscuro"}`, async ({ page }) => {
    test.setTimeout(120_000);
    await installTauriMock(page, { settings: { ...SETTINGS, theme }, secrets: SECRETS, price: 38.4 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await seed(page);
    const routes = [...ROUTES];
    await page.goto("/#/watchlist");
    const href = await page.getByRole("link", { name: "FICT", exact: true }).first().getAttribute("href");
    if (href) routes.push(href.replace(/^#/, ""));
    const report: string[] = [];
    for (const r of routes) {
      await page.goto(`/#${r}`);
      await page.waitForTimeout(800);
      if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/${theme}${r.replace(/\//g, "_") || "_"}.png`, fullPage: true });
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of res.violations) {
        report.push(`${r} · ${v.id} (${v.impact}) · ${v.nodes.length}× · ${v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n").slice(1, 2).join("") ?? ""}`).join(" | ")}`);
      }
    }
    if (process.env.A11Y_REPORT) console.log(`\n[${theme}]\n${report.join("\n")}`);
    expect(report).toEqual([]);
  });
}
