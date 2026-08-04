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
          void queryClient.invalidateQueries({ queryKey: ["telemetry"] });
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
  return (
    <div className="shell">
      <header>
        <div className="brand-lockup">
          <img src="/algaguard-logo-transparent.png" alt="AlgaGuard" />
          <strong>AlgaGuard</strong>
          <span className="badge">Simulated demo data</span>
        </div>
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
      <aside>
        <nav aria-label="Primary">
          {visibleNavigation.map(([label, path]) => (
            <Link key={path} href={path}>
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main>{children}</main>
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
