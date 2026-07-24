import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { hasRole, initializeAuthentication, keycloak } from "./auth";
import {
  AuthCallbackPage,
  CommandPage,
  DashboardPage,
  DeviceDetailsPage,
  DevicesPage,
  LoginPage,
  OrganizationsPage,
  OtaPage,
  ProfilesPage,
} from "./pages";
import { RealtimeClient, type RealtimeState } from "./realtime";

const navigation = [
  ["Dashboard", "/dashboard"],
  ["Organizations", "/organizations"],
  ["Devices", "/devices"],
  ["Profiles", "/profiles"],
  ["Commands", "/commands"],
  ["OTA", "/ota"],
] as const;

function ProtectedPage({ children }: { children: ReactNode }) {
  if (!keycloak.authenticated) return <Redirect to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

function useRealtime() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeState>("disconnected");
  useEffect(() => {
    if (!keycloak.authenticated) return;
    const client = new RealtimeClient(
      async () =>
        (await apiRequest<{ ticket: string }>("/services/realtime/tickets"))
          .ticket,
      async () => {
        await queryClient.invalidateQueries();
      },
      () => void queryClient.invalidateQueries(),
      setState,
    );
    void client.connect().catch(() => setState("disconnected"));
    return () => client.stop();
  }, [queryClient]);
  return state;
}

function AppShell({ children }: { children: ReactNode }) {
  const realtime = useRealtime();
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
          <img src="/brand/algaguard-32.png" alt="AlgaGuard shield logo" />
          <strong>AlgaGuard</strong>
          <span className="badge">SIMULATED development data</span>
        </div>
        <div className="header-actions">
          <span className={`connection ${realtime}`}>{realtime}</span>
          <button type="button" onClick={() => void keycloak.logout()}>
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
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/auth/callback" component={AuthCallbackPage} />
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
        <Redirect to="/dashboard" replace />
      </Route>
      <Route>
        <Redirect to="/dashboard" replace />
      </Route>
    </Switch>
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
