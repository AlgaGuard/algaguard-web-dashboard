import { useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
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

function ProtectedRoute() {
  const location = useLocation();
  if (!keycloak.authenticated)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
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

function AppShell() {
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
        <div>
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
            <NavLink key={path} to={path}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:deviceUuid" element={<DeviceDetailsPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/commands" element={<CommandPage />} />
          <Route path="/ota" element={<OtaPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function CallbackRecovery() {
  const navigate = useNavigate();
  useEffect(() => {
    void initializeAuthentication().finally(() =>
      navigate("/dashboard", { replace: true }),
    );
  }, [navigate]);
  return null;
}
