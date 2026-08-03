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
    expect(screen.getByLabelText("Assign profile")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save device setup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request physical unpair" }),
    ).toBeInTheDocument();
    view.unmount();
    view.queryClient.clear();
  });

  it("assigns an existing profile and queues one activation command", async () => {
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
              ? {
                  items: [
                    {
                      profileId: "30000000-0000-4000-8000-000000000001",
                      name: "Reef mix",
                      current: { version: 1 },
                    },
                  ],
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
    await screen.findByRole("option", { name: /Reef mix/ });
    fireEvent.change(screen.getByLabelText("Assign profile"), {
      target: { value: "30000000-0000-4000-8000-000000000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save device setup" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/services/command/devices/AG-999999/commands"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const assignmentCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("profile-assignment") &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(
      JSON.parse(String((assignmentCall?.[1] as RequestInit).body)),
    ).toMatchObject({
      profileId: "30000000-0000-4000-8000-000000000001",
      version: 1,
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

  it("creates and deletes an algae profile from the Profiles page", async () => {
    let profiles: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/services/access/organizations")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "10000000-0000-4000-8000-000000000001",
                  name: "Development organization",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (method === "POST" && url.endsWith("/services/profile/profiles")) {
          const created = {
            profileId: "30000000-0000-4000-8000-000000000001",
            name: "Reef mix",
            current: { version: 1 },
          };
          profiles = [...profiles, created];
          return new Response(JSON.stringify(created), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (
          method === "DELETE" &&
          url.includes("/services/profile/profiles/")
        ) {
          profiles = profiles.filter(
            (profile) => !url.endsWith(String(profile.profileId)),
          );
          return new Response(null, { status: 204 });
        }
        if (url.includes("/services/profile/profiles?")) {
          return new Response(JSON.stringify({ items: profiles }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const view = renderApp("/profiles");
    await screen.findByText(
      "No profiles have been created for this organization.",
    );
    fireEvent.change(screen.getByLabelText("Profile name"), {
      target: { value: "Reef mix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    expect(await screen.findByText("Reef mix")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }));
    await vi.waitFor(() =>
      expect(screen.queryByText("Reef mix")).not.toBeInTheDocument(),
    );
    view.unmount();
    view.queryClient.clear();
  });

  it("creates an organization and sends an invitation", async () => {
    let organizations = [
      {
        id: "10000000-0000-4000-8000-000000000001",
        name: "Development organization",
      },
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (
          method === "POST" &&
          url.endsWith("/services/access/organizations")
        ) {
          const created = {
            id: "10000000-0000-4000-8000-000000000002",
            name: "Second org",
          };
          organizations = [...organizations, created];
          return new Response(JSON.stringify(created), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "POST" && url.includes("/invitations")) {
          return new Response(
            JSON.stringify({ id: "50000000-0000-4000-8000-000000000001" }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/services/access/organizations")) {
          return new Response(JSON.stringify({ items: organizations }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = renderApp("/organizations");
    await screen.findByText("Development organization");
    fireEvent.change(screen.getByLabelText("New organization name"), {
      target: { value: "Second org" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    expect(await screen.findByText("Second org")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "member@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/invitations"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const inviteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/invitations") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(
      JSON.parse(String((inviteCall?.[1] as RequestInit).body)),
    ).toMatchObject({ email: "member@example.com", role: "VIEWER" });
    view.unmount();
    view.queryClient.clear();
  });

  it("lists, accepts, and rejects invitations", async () => {
    let invitations = [
      {
        id: "60000000-0000-4000-8000-000000000001",
        organizationName: "Reef club",
        role: "VIEWER",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        organizationName: "Tide pool",
        role: "ADMIN",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/services/access/invitations")) {
          return new Response(JSON.stringify({ items: invitations }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "POST" && url.includes("/accept")) {
          invitations = invitations.filter(
            (invite) => !url.includes(invite.id),
          );
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "POST" && url.includes("/reject")) {
          invitations = invitations.filter(
            (invite) => !url.includes(invite.id),
          );
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const view = renderApp("/invitations");
    expect(await screen.findByText("Reef club")).toBeInTheDocument();
    expect(screen.getByText("Tide pool")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]!);
    await vi.waitFor(() =>
      expect(screen.queryByText("Reef club")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await vi.waitFor(() =>
      expect(screen.queryByText("Tide pool")).not.toBeInTheDocument(),
    );
    view.unmount();
    view.queryClient.clear();
  });

  it("shows a threshold alert banner when telemetry exceeds the assigned profile's thresholds", async () => {
    const deviceUuid = "20000000-0000-4000-8000-000000000001";
    const profileId = "30000000-0000-4000-8000-000000000001";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
        : url.includes(`/services/profile/profiles/${profileId}`)
          ? {
              name: "Reef mix",
              current: {
                configuration: {
                  thresholds: { temperatureC: { min: 18, max: 28 } },
                },
              },
            }
          : url.includes("/profile-assignment")
            ? { profileId }
            : url.includes("/services/profile/profiles?")
              ? { items: [] }
              : url.includes("/latest")
                ? { latest: { values: { temperatureC: 32 } } }
                : url.includes("/services/telemetry/devices/")
                  ? { items: [] }
                  : {
                      deviceUuid,
                      deviceId: "AG-999999",
                      displayName: "North tank",
                      lifecycle: "ACTIVE",
                    };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderApp(`/devices/${deviceUuid}`);
    expect(await screen.findByText(/Threshold alert/i)).toBeInTheDocument();
    expect(screen.getByText(/above maximum 28/i)).toBeInTheDocument();
    view.unmount();
    view.queryClient.clear();
  });
});
