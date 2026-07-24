import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { initializeAuthentication, keycloak } from "./auth";

type Json = Record<string, unknown>;
const asRecords = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => !!item && typeof item === "object")
    : [];
const record = (value: unknown): Json =>
  value && typeof value === "object" ? (value as Json) : {};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "—";

function Page({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <h1 id="page-title">{title}</h1>
          <p className="notice">
            Development demo — telemetry is SIMULATED and thresholds are not
            scientifically approved.
          </p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Loading({ label = "Loading" }: { label?: string }) {
  return <p role="status">{label}…</p>;
}
function ErrorState({ error }: { error: unknown }) {
  return (
    <p role="alert">
      Unable to load this state:{" "}
      {error instanceof Error ? error.message : "unknown error"}. Retry after
      checking local services.
    </p>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
function ValueCard({ label, value }: { label: string; value: unknown }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{text(value)}</strong>
    </article>
  );
}

function usePlatformQuery<T = unknown>(key: string, path: string) {
  return useQuery({
    queryKey: [key],
    queryFn: () => apiRequest<T>(path),
    retry: false,
    refetchInterval: 30_000,
  });
}

export function LoginPage() {
  return (
    <section className="login">
      <h1>Sign in to AlgaGuard</h1>
      <p>
        Use the configured local Keycloak realm. Tokens are managed by Keycloak
        and are never placed in local storage by this dashboard.
      </p>
      <button
        type="button"
        onClick={() =>
          void keycloak.login({
            redirectUri: `${window.location.origin}/auth/callback`,
          })
        }
      >
        Sign in with Keycloak
      </button>
    </section>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void initializeAuthentication()
      .then(() => navigate("/dashboard", { replace: true }))
      .catch(() => setFailed(true));
  }, [navigate]);
  return (
    <section className="login">
      <h1>Completing sign-in</h1>
      {failed ? (
        <p role="alert">
          Keycloak callback failed. Return to login and try again.
        </p>
      ) : (
        <Loading label="Verifying authorization code" />
      )}
    </section>
  );
}

export function DashboardPage() {
  const devices = usePlatformQuery("devices", "/services/device/devices");
  const latest = usePlatformQuery(
    "latest",
    "/services/telemetry/devices/AG-000001/latest",
  );
  const commands = usePlatformQuery("commands", "/services/command/commands");
  const ota = usePlatformQuery("ota", "/services/ota/releases");
  const telemetry = record(latest.data);
  const list = asRecords(devices.data);
  const online = list.filter(
    (device) => device.status === "ONLINE" || device.online === true,
  ).length;
  return (
    <Page title="Dashboard">
      <div className="cards">
        <ValueCard label="Devices" value={list.length} />
        <ValueCard label="Online" value={online} />
        <ValueCard label="Offline" value={Math.max(0, list.length - online)} />
        <ValueCard
          label="Last sequence"
          value={telemetry.sequence ?? telemetry.sampleSequence}
        />
      </div>
      <h2>Latest simulated telemetry</h2>
      {latest.isLoading ? (
        <Loading />
      ) : latest.isError ? (
        <ErrorState error={latest.error} />
      ) : (
        <div className="cards telemetry">
          <ValueCard
            label="Temperature"
            value={telemetry.temperatureC ?? telemetry.temperature_c}
          />
          <ValueCard label="pH" value={telemetry.ph} />
          <ValueCard
            label="Light"
            value={telemetry.lightLux ?? telemetry.light_lux}
          />
          <ValueCard
            label="Nitrate"
            value={telemetry.nitrateMgL ?? telemetry.nitrate_mg_l}
          />
          <ValueCard
            label="Phosphate"
            value={telemetry.phosphateMgL ?? telemetry.phosphate_mg_l}
          />
          <ValueCard
            label="Potassium"
            value={telemetry.potassiumMgL ?? telemetry.potassium_mg_l}
          />
        </div>
      )}
      <div className="two-column">
        <Summary title="Recent commands" query={commands} />
        <Summary title="Development OTA releases" query={ota} />
      </div>
    </Page>
  );
}

function Summary({
  title,
  query,
}: {
  title: string;
  query: ReturnType<typeof usePlatformQuery>;
}) {
  const values = asRecords(query.data);
  return (
    <article className="panel">
      <h2>{title}</h2>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : values.length ? (
        <ul>
          {values.slice(0, 4).map((item, index) => (
            <li key={String(item.id ?? index)}>
              {text(
                item.status ?? item.name ?? item.version ?? item.commandType,
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No records yet.</Empty>
      )}
    </article>
  );
}

export function OrganizationsPage() {
  const organizations = usePlatformQuery(
    "organizations",
    "/services/access/organizations",
  );
  const [active, setActive] = useState<string | undefined>();
  const values = asRecords(organizations.data);
  return (
    <Page title="Organizations">
      <p>
        Select an organization authorized by the current membership. Revoked
        memberships are shown as unavailable and cannot become active.
      </p>
      {organizations.isLoading ? (
        <Loading />
      ) : organizations.isError ? (
        <ErrorState error={organizations.error} />
      ) : values.length ? (
        <div className="list">
          {values.map((organization, index) => {
            const id = text(organization.organizationId ?? organization.id);
            const revoked =
              organization.revoked === true ||
              organization.status === "REVOKED";
            return (
              <button
                className={active === id ? "selected" : ""}
                disabled={revoked}
                key={id}
                type="button"
                onClick={() => setActive(id)}
              >
                <strong>{text(organization.name ?? id)}</strong>
                <span>
                  {revoked
                    ? "Access revoked"
                    : active === id
                      ? "Active organization"
                      : "Select organization"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty>No authorized organizations are available.</Empty>
      )}
    </Page>
  );
}

export function DevicesPage() {
  const devices = usePlatformQuery("devices", "/services/device/devices");
  const values = asRecords(devices.data);
  return (
    <Page title="Devices">
      {devices.isLoading ? (
        <Loading />
      ) : devices.isError ? (
        <ErrorState error={devices.error} />
      ) : values.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device ID</th>
                <th>Status</th>
                <th>Profile</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {values.map((device, index) => {
                const uuid = text(device.deviceUuid ?? device.id);
                return (
                  <tr key={uuid}>
                    <td>{text(device.deviceId)}</td>
                    <td>{text(device.status)}</td>
                    <td>{text(device.profileName ?? device.profileId)}</td>
                    <td>{text(device.lastSeenAt ?? device.lastSeen)}</td>
                    <td>
                      <Link to={`/devices/${encodeURIComponent(uuid)}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No devices have been claimed for this organization.</Empty>
      )}
    </Page>
  );
}

export function DeviceDetailsPage() {
  const { deviceUuid = "" } = useParams();
  const device = usePlatformQuery(
    `device:${deviceUuid}`,
    `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
  );
  const telemetry = usePlatformQuery(
    `telemetry:${deviceUuid}`,
    `/services/telemetry/devices/${encodeURIComponent(deviceUuid)}/telemetry`,
  );
  const status = record(device.data);
  const history = asRecords(telemetry.data);
  return (
    <Page
      title={`Device ${text(status.deviceId ?? deviceUuid)}`}
      actions={
        <Link className="button-link" to="/commands">
          Send safe command
        </Link>
      }
    >
      {device.isLoading ? (
        <Loading />
      ) : device.isError ? (
        <ErrorState error={device.error} />
      ) : (
        <>
          <div className="cards">
            <ValueCard
              label="Network/cloud"
              value={status.networkState ?? status.status}
            />
            <ValueCard
              label="Active profile"
              value={status.profileName ?? status.profileId}
            />
            <ValueCard label="Firmware" value={status.firmwareVersion} />
            <ValueCard
              label="LED"
              value={status.indicatorState ?? status.ledState}
            />
            <ValueCard
              label="Health"
              value={status.health ?? status.healthStatus}
            />
            <ValueCard label="OTA" value={status.otaStatus} />
          </div>
          <h2>Live telemetry and history</h2>
          {telemetry.isLoading ? (
            <Loading />
          ) : telemetry.isError ? (
            <ErrorState error={telemetry.error} />
          ) : history.length ? (
            <div className="history" aria-label="Telemetry history">
              {history.slice(-24).map((sample, index) => (
                <span
                  key={String(sample.sequence ?? index)}
                  style={{
                    height: `${Math.max(8, Math.min(100, Number(sample.lightLux ?? sample.light_lux ?? 0) / 12))}%`,
                  }}
                  title={`Sequence ${text(sample.sequence)}`}
                />
              ))}
            </div>
          ) : (
            <Empty>No telemetry history is available.</Empty>
          )}
        </>
      )}
    </Page>
  );
}

export function ProfilesPage() {
  const profiles = usePlatformQuery("profiles", "/services/profile/profiles");
  const values = asRecords(profiles.data);
  return (
    <Page title="Profiles">
      <p className="notice">
        Profile values in this demo are user-defined and are not scientifically
        approved.
      </p>
      {profiles.isLoading ? (
        <Loading />
      ) : profiles.isError ? (
        <ErrorState error={profiles.error} />
      ) : values.length ? (
        <div className="list">
          {values.map((profile, index) => (
            <article key={String(profile.profileId ?? profile.id ?? index)}>
              <strong>{text(profile.name ?? profile.profileId)}</strong>
              <span>Version {text(profile.version)}</span>
              <p>{text(profile.description)}</p>
            </article>
          ))}
        </div>
      ) : (
        <Empty>No profile versions are available.</Empty>
      )}
    </Page>
  );
}

export function CommandPage() {
  const client = useQueryClient();
  const [deviceUuid, setDeviceUuid] = useState("");
  const [indicator, setIndicator] = useState("ON");
  const [confirmation, setConfirmation] = useState(false);
  const commands = usePlatformQuery("commands", "/services/command/commands");
  const create = useMutation({
    mutationFn: (input: Json) =>
      apiRequest<Json>("/services/command/commands", undefined, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["commands"] }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const commandType =
      (new FormData(event.currentTarget).get("commandType") as string) ??
      "REQUEST_STATUS";
    if (commandType === "SET_INDICATOR_STATE" && !confirmation) return;
    create.mutate({
      deviceUuid,
      commandType,
      parameters:
        commandType === "SET_INDICATOR_STATE" ? { state: indicator } : {},
    });
  }
  return (
    <Page title="Safe commands">
      <p>
        Remote factory reset and reboot are intentionally not available in this
        demo.
      </p>
      <form className="panel form" onSubmit={submit}>
        <label>
          Device UUID
          <input
            required
            value={deviceUuid}
            onChange={(event) => setDeviceUuid(event.target.value)}
          />
        </label>
        <label>
          Command
          <select name="commandType">
            <option value="REQUEST_STATUS">REQUEST_STATUS</option>
            <option value="SET_INDICATOR_STATE">SET_INDICATOR_STATE</option>
          </select>
        </label>
        <label>
          Indicator state
          <select
            value={indicator}
            onChange={(event) => setIndicator(event.target.value)}
          >
            <option>ON</option>
            <option>OFF</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmation}
            onChange={(event) => setConfirmation(event.target.checked)}
          />
          I confirm this changes the demo indicator only.
        </label>
        <button disabled={create.isPending || !deviceUuid} type="submit">
          {create.isPending ? "Sending…" : "Create command"}
        </button>
        {create.isError && <ErrorState error={create.error} />}
        {create.isSuccess && (
          <p role="status">
            Command accepted. Live result updates will appear below.
          </p>
        )}
      </form>
      <Summary title="Command status" query={commands} />
    </Page>
  );
}

export function OtaPage() {
  const releases = usePlatformQuery("ota", "/services/ota/releases");
  return (
    <Page title="Development OTA">
      <p>
        Development releases and assigned status are visible here. Production
        rollout controls are deliberately absent.
      </p>
      <Summary title="Releases and assignments" query={releases} />
    </Page>
  );
}
