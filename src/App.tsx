import { NavLink, Route, Routes } from "react-router-dom";
import { DataPage, LoginPage } from "./pages";
import { hasRole, keycloak } from "./auth";

const navigation = [
  ["Overview", "/"],
  ["Organizations", "/organizations"],
  ["Devices", "/devices"],
  ["Device details", "/devices/demo"],
  ["Live telemetry", "/telemetry/live"],
  ["Telemetry history", "/telemetry/history"],
  ["Profiles", "/profiles"],
  ["Commands", "/commands"],
  ["OTA releases", "/ota"],
  ["Access", "/access"],
] as const;

export function App() {
  const visibleNavigation = navigation.filter(([label]) =>
    label === "Access"
      ? hasRole("OWNER", "ADMIN")
      : label === "Commands"
        ? hasRole("OWNER", "ADMIN", "OPERATOR")
        : true,
  );
  return (
    <div className="shell">
      <header>
        <strong>AlgaGuard</strong>
        <span className="badge">Development · simulated data</span>
        {keycloak.authenticated ? (
          <button type="button" onClick={() => void keycloak.logout()}>
            Sign out
          </button>
        ) : null}
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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <DataPage
                title="Overview"
                path="/services/telemetry/devices/AG-000001/latest"
                note="Simulated telemetry is clearly labelled until physical sensors are approved."
              />
            }
          />
          <Route
            path="/organizations"
            element={
              <DataPage
                title="Organization selection"
                path="/services/access/organizations"
              />
            }
          />
          <Route
            path="/devices"
            element={
              <DataPage
                title="Devices"
                path="/services/device/devices/AG-000001"
              />
            }
          />
          <Route
            path="/devices/:id"
            element={
              <DataPage
                title="Device details"
                path="/services/device/devices/AG-000001"
              />
            }
          />
          <Route
            path="/telemetry/live"
            element={
              <DataPage
                title="Live telemetry"
                path="/services/telemetry/devices/AG-000001/latest"
                note="WebSocket updates recover authoritative state through HTTPS after reconnect."
              />
            }
          />
          <Route
            path="/telemetry/history"
            element={
              <DataPage
                title="Telemetry history"
                path="/services/telemetry/devices/AG-000001/telemetry"
              />
            }
          />
          <Route
            path="/profiles"
            element={
              <DataPage
                title="Profiles and editor"
                path="/services/profile/profiles"
              />
            }
          />
          <Route
            path="/commands"
            element={
              <DataPage
                title="Commands and progress"
                path="/services/command/commands"
              />
            }
          />
          <Route
            path="/ota"
            element={
              <DataPage
                title="OTA releases and campaigns"
                path="/services/ota/releases"
              />
            }
          />
          <Route
            path="/access"
            element={
              <DataPage
                title="Access management"
                path="/services/access/organizations"
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}
