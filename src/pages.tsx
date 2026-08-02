import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { initializeAuthentication, keycloak } from "./auth";
import { useOrganization } from "./organization";

type Json = Record<string, unknown>;
const thresholdFields = [
  ["temperatureC", "Temperature"],
  ["ph", "pH"],
  ["lightLux", "Light intensity"],
  ["nitrateMgL", "Nitrate"],
  ["phosphateMgL", "Phosphate"],
  ["potassiumMgL", "Potassium"],
] as const;
type ThresholdKey = (typeof thresholdFields)[number][0];
type ThresholdInputs = Partial<
  Record<`${ThresholdKey}Min` | `${ThresholdKey}Max`, string>
>;

function profileConfiguration(inputs: ThresholdInputs): Json {
  const thresholds: Json = {};
  for (const [key] of thresholdFields) {
    const minimum = inputs[`${key}Min`];
    const maximum = inputs[`${key}Max`];
    if (!minimum?.trim() && !maximum?.trim()) continue;
    const lower = minimum?.trim() ? Number(minimum) : undefined;
    const upper = maximum?.trim() ? Number(maximum) : undefined;
    if (
      (lower !== undefined && !Number.isFinite(lower)) ||
      (upper !== undefined && !Number.isFinite(upper)) ||
      (lower !== undefined && upper !== undefined && lower > upper)
    )
      throw new Error("Each threshold must be finite and have a valid range");
    thresholds[key] = {
      ...(lower === undefined ? {} : { min: lower }),
      ...(upper === undefined ? {} : { max: upper }),
    };
  }
  return { status: "DRAFT", thresholds };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
const asRecords = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => !!item && typeof item === "object")
    : [];
const responseItems = (value: unknown): Json[] =>
  asRecords(record(value).items);
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

function usePlatformQuery<T = unknown>(
  key: string,
  path: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [key, path],
    queryFn: () => apiRequest<T>(path),
    retry: false,
    refetchInterval: 30_000,
    enabled,
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
  const [, navigate] = useLocation();
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
  const { selectedOrganizationId } = useOrganization();
  const devices = usePlatformQuery(
    "devices",
    selectedOrganizationId
      ? `/services/device/devices?organizationId=${encodeURIComponent(selectedOrganizationId)}`
      : "",
    !!selectedOrganizationId,
  );
  const list = responseItems(devices.data);
  const demoDevice = list.find(
    (device) =>
      typeof device.deviceUuid === "string" && device.lifecycle !== "UNCLAIMED",
  );
  const latest = usePlatformQuery(
    "telemetry",
    demoDevice
      ? `/services/telemetry/devices/${encodeURIComponent(String(demoDevice.deviceUuid))}/latest`
      : "",
    !!demoDevice,
  );
  const commands = usePlatformQuery("commands", "/services/command/commands");
  const ota = usePlatformQuery("ota", "/services/ota/releases");
  const telemetry = record(record(latest.data).latest);
  const values = record(telemetry.values);
  const simulated =
    asRecords(telemetry.qualityFlags).length > 0 ||
    (Array.isArray(telemetry.qualityFlags) &&
      telemetry.qualityFlags.includes("SIMULATED"));
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
      {simulated ? <p className="badge">Simulated demo data</p> : null}
      {latest.isLoading ? (
        <Loading />
      ) : latest.isError ? (
        <ErrorState error={latest.error} />
      ) : (
        <div className="cards telemetry">
          <ValueCard
            label="Temperature"
            value={
              values.temperatureC == null
                ? undefined
                : `${text(values.temperatureC)} °C`
            }
          />
          <ValueCard label="pH" value={values.ph} />
          <ValueCard
            label="Light"
            value={
              values.lightLux == null
                ? undefined
                : `${text(values.lightLux)} lux`
            }
          />
          <ValueCard
            label="Nitrate"
            value={
              values.nitrateMgL == null
                ? undefined
                : `${text(values.nitrateMgL)} mg/L`
            }
          />
          <ValueCard
            label="Phosphate"
            value={
              values.phosphateMgL == null
                ? undefined
                : `${text(values.phosphateMgL)} mg/L`
            }
          />
          <ValueCard
            label="Potassium"
            value={
              values.potassiumMgL == null
                ? undefined
                : `${text(values.potassiumMgL)} mg/L`
            }
          />
        </div>
      )}
      {typeof telemetry.observedAt === "string" ? (
        <p>Last updated {new Date(telemetry.observedAt).toLocaleString()}</p>
      ) : null}
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
  const {
    organizations: values,
    selectedOrganizationId: active,
    selectOrganization,
    loading,
    error,
  } = useOrganization();
  return (
    <Page title="Organizations">
      <p>
        Select an organization authorized by the current membership. Revoked
        memberships are shown as unavailable and cannot become active.
      </p>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={new Error("Authorized organizations unavailable")} />
      ) : values.length ? (
        <div className="list">
          {values.map((organization, index) => {
            const id = organization.organizationId;
            const revoked =
              organization.revoked === true ||
              organization.status === "REVOKED";
            return (
              <button
                className={active === id ? "selected" : ""}
                disabled={revoked}
                key={id}
                type="button"
                onClick={() => selectOrganization(id)}
              >
                <strong>
                  {text(organization.name ?? "Authorized organization")}
                </strong>
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
  const { selectedOrganizationId, loading: organizationLoading } =
    useOrganization();
  const devices = usePlatformQuery(
    "devices",
    selectedOrganizationId
      ? `/services/device/devices?organizationId=${encodeURIComponent(selectedOrganizationId)}`
      : "",
    !!selectedOrganizationId,
  );
  const values = responseItems(devices.data);
  return (
    <Page title="Devices">
      {organizationLoading || devices.isLoading ? (
        <Loading />
      ) : !selectedOrganizationId ? (
        <Empty>Select an authorized organization first.</Empty>
      ) : devices.isError ? (
        <ErrorState error={devices.error} />
      ) : values.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
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
                    <td>
                      <strong>
                        {text(device.displayName ?? device.deviceId)}
                      </strong>
                      {device.displayName ? (
                        <small>{text(device.deviceId)}</small>
                      ) : null}
                    </td>
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
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { selectedOrganizationId } = useOrganization();
  const [deviceName, setDeviceName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [thresholdInputs, setThresholdInputs] = useState<ThresholdInputs>({});
  const device = usePlatformQuery(
    `device:${deviceUuid}`,
    `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
  );
  const telemetry = usePlatformQuery(
    `telemetry:${deviceUuid}`,
    `/services/telemetry/devices/${encodeURIComponent(deviceUuid)}/telemetry`,
  );
  const status = record(device.data);
  const history = responseItems(telemetry.data);
  useEffect(() => {
    if (!deviceName && typeof status.displayName === "string") {
      setDeviceName(status.displayName);
    }
    if (!profileName && typeof status.deviceId === "string") {
      setProfileName(
        `${String(status.displayName ?? status.deviceId)} profile`,
      );
    }
  }, [deviceName, profileName, status.displayName, status.deviceId]);
  const setup = useMutation({
    mutationFn: async () => {
      const normalizedDeviceName = deviceName.trim();
      const normalizedProfileName = profileName.trim();
      if (
        !selectedOrganizationId ||
        !normalizedDeviceName ||
        !normalizedProfileName
      ) {
        throw new Error("Device and profile names are required");
      }
      await apiRequest(
        `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
        undefined,
        {
          method: "PATCH",
          body: JSON.stringify({ displayName: normalizedDeviceName }),
        },
      );
      const profileResponse = await apiRequest<Json>(
        `/services/profile/profiles?organizationId=${encodeURIComponent(selectedOrganizationId)}`,
      );
      const existing = responseItems(profileResponse).find(
        (profile) =>
          String(profile.name ?? "").toLocaleLowerCase() ===
          normalizedProfileName.toLocaleLowerCase(),
      );
      const configuration = profileConfiguration(thresholdInputs);
      const profile =
        existing ??
        (await apiRequest<Json>("/services/profile/profiles", undefined, {
          method: "POST",
          body: JSON.stringify({
            organizationId: selectedOrganizationId,
            name: normalizedProfileName,
            configuration,
          }),
        }));
      const profileId = profile.profileId;
      const current = record(profile.current);
      const profileVersion = existing
        ? await apiRequest<Json>(
            `/services/profile/profiles/${encodeURIComponent(String(profileId))}/versions`,
            undefined,
            { method: "POST", body: JSON.stringify(configuration) },
          )
        : current;
      const version = Number(profileVersion.version);
      const deviceId = String(status.deviceId ?? "");
      if (
        !isUuid(profileId) ||
        !Number.isInteger(version) ||
        version < 1 ||
        !/^AG-[0-9]{6}$/.test(deviceId)
      )
        throw new Error("Profile activation data is invalid");
      const assignment = await apiRequest<Json>(
        `/services/profile/devices/${encodeURIComponent(deviceId)}/profile-assignment`,
        undefined,
        {
          method: "PUT",
          body: JSON.stringify({
            organizationId: selectedOrganizationId,
            profileId,
            version,
          }),
        },
      );
      if (!isUuid(assignment.id))
        throw new Error("Profile assignment was not accepted");
      await apiRequest(
        `/services/command/devices/${encodeURIComponent(deviceId)}/commands`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            commandType: "APPLY_PROFILE_CONFIGURATION",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            parameters: {
              configurationId: assignment.id,
              profileId,
              profileVersion: `${version}.0.0`,
            },
          }),
        },
      );
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: [`device:${deviceUuid}`],
      }),
  });
  const remove = useMutation({
    mutationFn: () =>
      apiRequest(
        `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
        undefined,
        {
          method: "DELETE",
          body: JSON.stringify({ confirmation: "REMOVE" }),
        },
      ),
    onSuccess: () => navigate("/devices"),
  });
  return (
    <Page
      title={text(status.displayName ?? status.deviceId ?? deviceUuid)}
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
                    height: `${Math.max(8, Math.min(100, Number(record(sample.values).lightLux ?? 0) / 12))}%`,
                  }}
                  title={`Sequence ${text(sample.sequence)}`}
                />
              ))}
            </div>
          ) : (
            <Empty>No telemetry history is available.</Empty>
          )}
          <h2>Device setup</h2>
          <form
            className="panel form"
            onSubmit={(event) => {
              event.preventDefault();
              setup.mutate();
            }}
          >
            <label>
              Device name
              <input
                maxLength={64}
                required
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </label>
            <label>
              Profile name
              <input
                maxLength={120}
                required
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </label>
            <fieldset>
              <legend>User-defined profile thresholds</legend>
              <p className="notice">
                Optional values are stored in this profile only; they are not
                scientifically approved alert recommendations.
              </p>
              {thresholdFields.map(([key, label]) => (
                <div className="two-column" key={key}>
                  <label>
                    {label} minimum
                    <input
                      inputMode="decimal"
                      type="number"
                      value={thresholdInputs[`${key}Min`] ?? ""}
                      onChange={(event) =>
                        setThresholdInputs((current) => ({
                          ...current,
                          [`${key}Min`]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {label} maximum
                    <input
                      inputMode="decimal"
                      type="number"
                      value={thresholdInputs[`${key}Max`] ?? ""}
                      onChange={(event) =>
                        setThresholdInputs((current) => ({
                          ...current,
                          [`${key}Max`]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </fieldset>
            <p className="notice">
              Saving creates or versions the profile, assigns it, and queues one
              activation command for this device.
            </p>
            <button disabled={setup.isPending} type="submit">
              {setup.isPending ? "Savingâ€¦" : "Save device setup"}
            </button>
            {setup.isError ? <ErrorState error={setup.error} /> : null}
          </form>
          <section className="panel">
            <h2>Remove device</h2>
            <p>Removal revokes cloud access while preserving audit history.</p>
            <button
              disabled={remove.isPending}
              type="button"
              onClick={() => {
                if (
                  window.confirm("Remove this device from the organization?")
                ) {
                  remove.mutate();
                }
              }}
            >
              Remove device
            </button>
            {remove.isError ? <ErrorState error={remove.error} /> : null}
          </section>
        </>
      )}
    </Page>
  );
}

export function ProfilesPage() {
  const { selectedOrganizationId, loading: organizationLoading } =
    useOrganization();
  const profiles = usePlatformQuery(
    "profiles",
    selectedOrganizationId
      ? `/services/profile/profiles?organizationId=${encodeURIComponent(selectedOrganizationId)}`
      : "",
    !!selectedOrganizationId,
  );
  const values = responseItems(profiles.data);
  return (
    <Page
      title="Profiles"
      actions={
        <Link className="button-link" to="/devices">
          Create and assign from a device
        </Link>
      }
    >
      <p className="notice">
        Profile values in this demo are user-defined and are not scientifically
        approved.
      </p>
      <p>
        Open a device to create or version its profile, set optional thresholds,
        and send one activation command.
      </p>
      {organizationLoading || profiles.isLoading ? (
        <Loading />
      ) : !selectedOrganizationId ? (
        <Empty>Select an authorized organization first.</Empty>
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
