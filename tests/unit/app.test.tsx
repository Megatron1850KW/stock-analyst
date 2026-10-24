import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "@/app/router";
import { DISCLAIMER } from "@/app/Disclaimer";

function renderApp(path = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("esqueleto de la app", () => {
  it("abre en la Watchlist con el aviso legal visible", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "Equity Analyst" })).toBeInTheDocument();
    expect(screen.getByText("Añade tu primer ticker")).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("la barra lateral tiene las 4 secciones y Ajustes", async () => {
    renderApp();
    const nav = await screen.findByRole("navigation", { name: "Secciones" });
    const labels = within(nav).getAllByRole("link").map((a) => a.textContent?.replace(/⌘.$/, ""));
    expect(labels).toEqual(["Watchlist", "Mi Portfolio", "Riesgo técnico", "Estrellas"]);
    expect(screen.getByRole("link", { name: /Ajustes/ })).toBeInTheDocument();
  });

  it("navega entre secciones con clic y con ⌘2", async () => {
    const user = userEvent.setup();
    const router = renderApp();
    await user.click(await screen.findByRole("link", { name: /Estrellas/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Estrellas" })).toBeInTheDocument();
    await user.keyboard("{Meta>}2{/Meta}");
    expect(router.state.location.pathname).toBe("/portfolio");
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
