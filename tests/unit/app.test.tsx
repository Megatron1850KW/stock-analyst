import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "@/app/router";
import { DISCLAIMER } from "@/app/Disclaimer";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderApp(path = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("esqueleto de la app", () => {
  it("abre en la comparativa con el logo, las 4 secciones y el aviso legal", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "Comparativa" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Stock Analisis").length).toBeGreaterThan(0);
    expect(screen.getByRole("tablist", { name: "Qué comparar" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    const titles = within(nav).getAllByRole("link").map((a) => a.querySelector("span span")?.textContent);
    expect(titles).toEqual(["Watchlist", "Mi Portfolio", "Riesgo técnico", "Estrellas"]);
    expect(screen.getByRole("link", { name: /Ajustes/ })).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("al abrir una sección, esa columna se despliega y las demás quedan como franjas", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: /Watchlist/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Equity Analyst" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Watchlist" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("aria-label")).filter(Boolean)).toEqual([
      "Mi Portfolio",
      "Riesgo técnico",
      "Estrellas",
    ]);
  });

  it("navega entre columnas con clic y con atajos de teclado", async () => {
    const user = userEvent.setup();
    const router = renderApp("/watchlist");
    await user.click(await screen.findByRole("link", { name: "Estrellas" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Estrellas" })).toBeInTheDocument();
    await user.keyboard("{Meta>}2{/Meta}");
    expect(router.state.location.pathname).toBe("/portfolio");
    await user.keyboard("{Meta>}0{/Meta}");
    expect(router.state.location.pathname).toBe("/");
  });

  it("guarda una clave sin volver a mostrarla", async () => {
    const user = userEvent.setup();
    renderApp("/ajustes");
    const input = await screen.findByLabelText("Claude (Anthropic)");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "sk-ant-ficticia-test");
    const row = input.closest("div.border-t") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Guardar" }));
    expect(await within(row).findByText("Guardada en el Llavero")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("sk-ant-ficticia-test")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-ant-ficticia-test");
  });

  it("valida el email de la SEC", async () => {
    const user = userEvent.setup();
    renderApp("/ajustes");
    const email = await screen.findByLabelText("Email");
    await user.type(email, "no-es-un-email");
    await user.tab();
    expect(await screen.findByText("Email no válido")).toBeInTheDocument();
  });
});
