import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { keycloak } from "./auth";

function renderApp(path = "/dashboard") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("dashboard demo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    Object.defineProperty(keycloak, "authenticated", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(keycloak, "token", {
      configurable: true,
      value: "test-token",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("protects dashboard navigation when signed out", () => {
    Object.defineProperty(keycloak, "authenticated", {
      configurable: true,
      value: false,
    });
    const view = renderApp();
    expect(
      screen.getByRole("heading", { name: "Sign in to AlgaGuard" }),
    ).toBeInTheDocument();
    view.unmount();
    view.queryClient.clear();
  });

  it("shows accessible navigation and simulated-data disclosure when signed in", async () => {
    const view = renderApp();
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/simulated/i).length).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText("No records yet.")).length,
    ).toBeGreaterThan(0);
    view.unmount();
    view.queryClient.clear();
  });

  it("requires confirmation before an indicator command can be created", () => {
    const view = renderApp("/commands");
    const submit = screen.getByRole("button", { name: "Create command" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Device UUID"), {
      target: { value: "device-uuid" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
    view.unmount();
    view.queryClient.clear();
  });
});
