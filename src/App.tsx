import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { hasRole, initializeAuthentication, keycloak } from "./auth";
import { OrganizationProvider, useOrganization } from "./organization";
import "./brand.css";
import {
  AlertsPage,
  AuthCallbackPage,
  CommandPage,
  DashboardPage,
  DeviceDetailsPage,
  DevicesPage,
  HomePage,
  InvitationsPage,
  LoginPage,
  OrganizationsPage,
  OtaPage,
  OverviewPage,
  ProfilesPage,
} from "./pages";
import {
  organizationTelemetrySubscriptions,
  RealtimeClient,
  type RealtimeState,
} from "./realtime";

const navigation = [
  ["Overview", "/overview"],
  ["Dashboard", "/dashboard"],
  ["Organizations", "/organizations"],
  ["Invitations", "/invitations"],
  ["Devices", "/devices"],
  ["Profiles", "/profiles"],
  ["Alerts", "/alerts"],
  ["Commands", "/commands"],
  ["OTA", "/ota"],
] as const;

type NavLabel = (typeof navigation)[number][0];

// Small hand-authored inline icons (no icon-library dependency) for the
// sidebar nav. Each is a minimal 20x20 outline glyph, currentColor-styled so
// it follows the link's text/active color automatically.
const NAV_ICONS: Record<NavLabel, ReactNode> = {
  Overview: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="6"
        height="6"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="11.5"
        y="2.5"
        width="6"
        height="6"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="2.5"
        y="11.5"
        width="6"
        height="6"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="11.5"
        y="11.5"
        width="6"
        height="6"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  ),
  Dashboard: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 13a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M10 13 13 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="10" cy="13" r="1.3" fill="currentColor" />
    </svg>
  ),
  Organizations: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="4"
        width="9"
        height="13"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M6 7.5h3M6 10.5h3M6 13.5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M12 9h4v8h-4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  Invitations: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="4.5"
        width="15"
        height="11"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3 5.5 10 11l7-5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Devices: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="8"
        height="8"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 2.5v2.2M12 2.5v2.2M8 15.3v2.2M12 15.3v2.2M2.5 8v2.2M2.5 12v2.2M15.3 8v2.2M15.3 12v2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  Profiles: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.5 17c1-3.5 4-5 6.5-5s5.5 1.5 6.5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  Alerts: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3a4.5 4.5 0 0 0-4.5 4.5v2.6L4 13.5h12l-1.5-3.4V7.5A4.5 4.5 0 0 0 10 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.3 16a1.9 1.9 0 0 0 3.4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  Commands: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3.5"
        width="15"
        height="13"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5.5 7.5 8.5 10l-3 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 12.5h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  OTA: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.5 13.5a3.5 3.5 0 0 1 .6-6.95 4.5 4.5 0 0 1 8.6.45 3 3 0 0 1-.7 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 9v6.5M7.7 13.2 10 15.5l2.3-2.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

function ProtectedPage({ children }: { children: ReactNode }) {
  if (!keycloak.authenticated) return <Redirect to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

function useRealtime(organizationId?: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeState>("disconnected");
  useEffect(() => {
    if (!keycloak.authenticated || !organizationId) return;
    const client = new RealtimeClient(
      async () =>
        (
          await apiRequest<{ ticket: string }>(
            "/services/realtime/tickets",
            undefined,
            { method: "POST" },
          )
        ).ticket,
      async () => {
        await queryClient.invalidateQueries();
      },
      (value) => {
        if (
          value &&
          typeof value === "object" &&
          (value as Record<string, unknown>).eventType === "telemetry.updated"
        )
          // Query keys are "telemetry" on the dashboard overview but
          // "telemetry:<uuid>" / "telemetry-latest:<uuid>" on the device
          // details page, so an exact-key invalidation only ever catches
          // the former. Match by prefix so every telemetry query refreshes.
          void queryClient.invalidateQueries({
            predicate: (query) =>
              typeof query.queryKey[0] === "string" &&
              query.queryKey[0].startsWith("telemetry"),
          });
      },
      setState,
      async () => organizationTelemetrySubscriptions(organizationId),
    );
    void client.connect().catch(() => setState("disconnected"));
    return () => client.stop();
  }, [organizationId, queryClient]);
  return state;
}

function AppShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const organization = useOrganization();
  const realtime = useRealtime(organization.selectedOrganizationId);
  const visibleNavigation = useMemo(
    () =>
      navigation.filter(([label]) =>
        label === "Commands" ? hasRole("OWNER", "ADMIN", "OPERATOR") : true,
      ),
    [],
  );
  const [location] = useLocation();
  return (
    <div className="shell">
      <aside>
        <div className="brand-lockup">
          <img src="/algaguard-logo-transparent.png" alt="AlgaGuard" />
          <strong>AlgaGuard</strong>
        </div>
        <nav aria-label="Primary">
          {visibleNavigation.map(([label, path]) => (
            <Link
              key={path}
              href={path}
              className={location === path ? "active" : undefined}
            >
              {NAV_ICONS[label]}
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="shell-main">
        <header>
          <div className="header-actions">
            {organization.organizations.length > 0 ? (
              <select
                aria-label="Switch organization"
                value={organization.selectedOrganizationId ?? ""}
                disabled={organization.organizations.length < 2}
                onChange={(event) =>
                  organization.selectOrganization(event.target.value)
                }
              >
                {!organization.selectedOrganizationId ? (
                  <option value="">Select organization</option>
                ) : null}
                {organization.organizations.map((item) => (
                  <option key={item.organizationId} value={item.organizationId}>
                    {item.name ?? "Authorized organization"}
                  </option>
                ))}
              </select>
            ) : null}
            <span className={`connection ${realtime}`}>{realtime}</span>
            <button
              type="button"
              onClick={() => {
                organization.clearOrganization();
                queryClient.clear();
                void keycloak.logout();
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <OrganizationProvider>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/auth/callback" component={AuthCallbackPage} />
        <Route path="/overview">
          <ProtectedPage>
            <OverviewPage />
          </ProtectedPage>
        </Route>
        <Route path="/dashboard">
          <ProtectedPage>
            <DashboardPage />
          </ProtectedPage>
        </Route>
        <Route path="/organizations">
          <ProtectedPage>
            <OrganizationsPage />
          </ProtectedPage>
        </Route>
        <Route path="/invitations">
          <ProtectedPage>
            <InvitationsPage />
          </ProtectedPage>
        </Route>
        <Route path="/devices/:deviceUuid">
          <ProtectedPage>
            <DeviceDetailsPage />
          </ProtectedPage>
        </Route>
        <Route path="/devices">
          <ProtectedPage>
            <DevicesPage />
          </ProtectedPage>
        </Route>
        <Route path="/alerts">
          <ProtectedPage>
            <AlertsPage />
          </ProtectedPage>
        </Route>
        <Route path="/profiles">
          <ProtectedPage>
            <ProfilesPage />
          </ProtectedPage>
        </Route>
        <Route path="/commands">
          <ProtectedPage>
            <CommandPage />
          </ProtectedPage>
        </Route>
        <Route path="/ota">
          <ProtectedPage>
            <OtaPage />
          </ProtectedPage>
        </Route>
        <Route path="/">
          {keycloak.authenticated ? (
            <Redirect to="/dashboard" replace />
          ) : (
            <HomePage />
          )}
        </Route>
        <Route>
          <Redirect to="/dashboard" replace />
        </Route>
      </Switch>
    </OrganizationProvider>
  );
}

export function CallbackRecovery() {
  const [, navigate] = useLocation();
  useEffect(() => {
    void initializeAuthentication().finally(() =>
      navigate("/dashboard", { replace: true }),
    );
  }, [navigate]);
  return null;
}
