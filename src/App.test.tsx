import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { keycloak } from "./auth";
import { organizationTelemetrySubscriptions } from "./realtime";

function renderApp(path = "/dashboard") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  window.history.replaceState({}, "", path);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("dashboard demo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/services/access/organizations")
          ? {
              items: [
                {
                  id: "10000000-0000-4000-8000-000000000001",
                  name: "Development organization",
                },
              ],
            }
          : url.includes("/services/device/devices")
            ? {
                items: [
                  {
                    deviceUuid: "20000000-0000-4000-8000-000000000001",
                    deviceId: "AG-999999",
                    lifecycle: "ACTIVE",
                    status: "ONLINE",
                  },
                ],
              }
            : url.includes("/services/realtime/tickets")
              ? { ticket: "synthetic-test-ticket" }
              : url.includes("/services/telemetry/devices/")
                ? {
                    latest: {
                      source: "SIMULATED_DEMO",
                      values: {
                        temperatureC: 24.5,
                        ph: 7.2,
                        lightLux: 600,
                        nitrateMgL: 2.1,
                        phosphateMgL: 0.4,
                        potassiumMgL: 3.2,
                      },
                    },
                  }
                : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("requests a one-time realtime ticket with POST", async () => {
    const view = renderApp();
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/services/realtime/tickets"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    view.unmount();
    view.queryClient.clear();
  });

  it("scopes device requests to the authorized organization", async () => {
    const view = renderApp("/devices");
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/services/device/devices?organizationId=10000000-0000-4000-8000-000000000001",
        ),
        expect.any(Object),
      ),
    );
    expect(
      screen.queryByText(/Request failed with 400/i),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("AG-999999")).toBeInTheDocument();
    view.unmount();
    view.queryClient.clear();
  });

  it("shows device naming, profile setup, and confirmed removal controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/services/access/organizations")
          ? {
              items: [
                {
                  id: "10000000-0000-4000-8000-000000000001",
                  name: "Development organization",
                },
              ],
            }
          : url.includes("/services/telemetry/devices/")
            ? { items: [] }
            : {
                deviceUuid: "20000000-0000-4000-8000-000000000001",
                deviceId: "AG-999999",
                displayName: "North tank",
                lifecycle: "ACTIVE",
              };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const view = renderApp("/devices/20000000-0000-4000-8000-000000000001");
    expect(await screen.findByDisplayValue("North tank")).toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).toBeInTheDocument();
    expect(screen.getByLabelText("Temperature minimum")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save device setup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove device" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/preserving audit history/i)).toBeInTheDocument();
    view.unmount();
    view.queryClient.clear();
  });

  it("stores thresholds, assigns the profile, and queues one activation command", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = url.includes("/services/access/organizations")
          ? {
              items: [
                {
                  id: "10000000-0000-4000-8000-000000000001",
                  name: "Development organization",
                },
              ],
            }
          : url.includes("/services/telemetry/devices/")
            ? { items: [] }
            : url.includes("/services/profile/profiles?")
              ? { items: [] }
              : method === "POST" && url.endsWith("/services/profile/profiles")
                ? {
                    profileId: "30000000-0000-4000-8000-000000000001",
                    current: { version: 1 },
                  }
                : method === "PUT" && url.includes("profile-assignment")
                  ? { id: "40000000-0000-4000-8000-000000000001" }
                  : {
                      deviceUuid: "20000000-0000-4000-8000-000000000001",
                      deviceId: "AG-999999",
                      displayName: "North tank",
                      lifecycle: "ACTIVE",
                    };
        return new Response(JSON.stringify(body), {
          status: method === "POST" && url.includes("/commands") ? 202 : 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = renderApp("/devices/20000000-0000-4000-8000-000000000001");
    await screen.findByDisplayValue("North tank");
    fireEvent.change(screen.getByLabelText("Temperature minimum"), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByLabelText("Temperature maximum"), {
      target: { value: "28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save device setup" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/services/command/devices/AG-999999/commands"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const profileCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/services/profile/profiles") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(
      JSON.parse(String((profileCall?.[1] as RequestInit).body)),
    ).toMatchObject({
      configuration: {
        thresholds: { temperatureC: { min: 18, max: 28 } },
      },
    });
    const commandCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/services/command/devices/AG-999999/commands"),
    );
    expect(
      JSON.parse(String((commandCall?.[1] as RequestInit).body)),
    ).toMatchObject({
      commandType: "APPLY_PROFILE_CONFIGURATION",
      parameters: {
        configurationId: "40000000-0000-4000-8000-000000000001",
        profileId: "30000000-0000-4000-8000-000000000001",
        profileVersion: "1.0.0",
      },
    });
    view.unmount();
    view.queryClient.clear();
  });

  it("uses the canonical telemetry event for an organization subscription", () => {
    const subscriptions = organizationTelemetrySubscriptions(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(subscriptions[0]?.events).toEqual(["telemetry.updated"]);
    expect(JSON.stringify(subscriptions)).not.toContain("device.telemetry");
  });

  it("labels simulated data and exposes all six parameter cards", async () => {
    const view = renderApp();
    expect(screen.getAllByText(/simulated demo data/i).length).toBeGreaterThan(
      0,
    );
    await vi.waitFor(() => {
      for (const label of [
        "Temperature",
        "pH",
        "Light",
        "Nitrate",
        "Phosphate",
        "Potassium",
      ])
        expect(screen.getByText(label)).toBeInTheDocument();
    });
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
