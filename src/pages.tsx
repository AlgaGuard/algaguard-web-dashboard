import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
  ["nutrientPercent", "Nutrient value"],
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

function exceededThresholds(values: Json, thresholds: Json) {
  const alerts: { label: string; value: number; min?: number; max?: number }[] =
    [];
  for (const [key, label] of thresholdFields) {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const bounds = record(thresholds[key]);
    const min = typeof bounds.min === "number" ? bounds.min : undefined;
    const max = typeof bounds.max === "number" ? bounds.max : undefined;
    if (
      (min !== undefined && value < min) ||
      (max !== undefined && value > max)
    )
      alerts.push({ label, value, min, max });
  }
  return alerts;
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
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <h1 id="page-title">{title}</h1>
          {subtitle ? <p className="empty">{subtitle}</p> : null}
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
const PARAM_ICONS: Record<
  "temp" | "ph" | "light" | "nutrient",
  ReactNode
> = {
  temp: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M9 3.5a1.5 1.5 0 0 1 3 0v6.9a3.5 3.5 0 1 1-3 0Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  ),
  ph: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7 3h6l1.5 8a4.5 4.5 0 1 1-9 0Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.5 12.5h7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  ),
  nutrient: (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3v6l3.5 6a2 2 0 0 1-1.7 3h-3.6a2 2 0 0 1-1.7-3L10 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8 3h4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
};

const ONLINE_ICON = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4 8.5a8.5 8.5 0 0 1 12 0M6.8 11.3a4.7 4.7 0 0 1 6.4 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <circle cx="10" cy="14.5" r="1.3" fill="currentColor" />
  </svg>
);

const ALERT_ICON = (
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
);

const CHART_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 18V6M4 18h16M8 14l3-3 3 2 4-5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const DEVICE_ICON = (
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
);

function ValueCard({
  label,
  value,
  unit,
  paramKey,
  icon,
  statusVariant,
  statusLabel,
  simulated,
}: {
  label: string;
  value: unknown;
  unit?: string;
  paramKey?: keyof typeof PARAM_ICONS;
  icon?: ReactNode;
  statusVariant?: "good" | "warning" | "serious" | "critical";
  statusLabel?: string;
  simulated?: boolean;
}) {
  return (
    <article className={`metric${simulated ? " metric--simulated" : ""}`}>
      <div className="metric-head">
        <span className="metric-label">{label}</span>
        {paramKey ? (
          <span className={`icon-circle icon-circle--${paramKey}`}>
            {PARAM_ICONS[paramKey]}
          </span>
        ) : icon ? (
          <span className="icon-circle icon-circle--device">{icon}</span>
        ) : null}
      </div>
      <strong>
        {text(value)}
        {unit && value != null ? <small>{unit}</small> : null}
      </strong>
      {statusVariant ? (
        <span className={`status-pill status-pill--${statusVariant}`}>
          {statusLabel ?? statusVariant}
        </span>
      ) : simulated ? (
        <span className="badge-simulated">Simulated</span>
      ) : null}
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

const homeFeatures = [
  {
    title: "Live device monitoring",
    description:
      "Watch temperature, pH, light, and nutrient readings update in real time, device by device.",
  },
  {
    title: "Threshold alerts",
    description:
      "Set custom algae profiles per tank and get notified the moment a reading drifts out of range.",
  },
  {
    title: "Multi-organization",
    description:
      "Switch between every organization you belong to and see every device in one overview.",
  },
];

export function HomePage() {
  return (
    <div className="home">
      <header className="home-header">
        <div className="brand-lockup">
          <img
            src="/algaguard-logo-transparent.png"
            alt=""
            width={40}
            height={40}
          />
          <strong>AlgaGuard</strong>
        </div>
        <button
          type="button"
          onClick={() =>
            void keycloak.login({
              redirectUri: `${window.location.origin}/auth/callback`,
            })
          }
        >
          Sign in
        </button>
      </header>
      <div className="home-hero">
        <div className="home-hero-inner">
          <h1>Know your algae culture's water, minute by minute.</h1>
          <p>
            AlgaGuard turns your ESP32-S3 monitoring devices into a live,
            organization-wide view of every tank&apos;s water chemistry, with
            alerts before a reading becomes a problem.
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
        </div>
      </div>
      <div className="home-features">
        {homeFeatures.map((feature) => (
          <article key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function LoginPage() {
  return (
    <div className="login-page">
      <section className="login">
        <span className="login-badge">
          <img src="/algaguard-logo-transparent.png" alt="" />
        </span>
        <h1>Sign in to AlgaGuard</h1>
        <p className="login-subtitle">Algae tank monitoring platform</p>
        <p>
          Use the configured local Keycloak realm. Tokens are managed by
          Keycloak and are never placed in local storage by this dashboard.
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
        <div className="login-footer">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 2 4 4.5v4c0 4 2.6 6.7 6 8 3.4-1.3 6-4 6-8v-4Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          Secure Keycloak sign-in
        </div>
      </section>
    </div>
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
      <img
        className="brand-wordmark"
        src="/algaguard-logo-tagline-transparent.png"
        alt="AlgaGuard"
      />
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
  const commands = usePlatformQuery(
    "commands",
    demoDevice
      ? `/services/command/devices/${encodeURIComponent(String(demoDevice.deviceId))}/commands`
      : "",
    !!demoDevice,
  );
  const ota = usePlatformQuery("ota", "/services/ota/firmware/releases");
  const telemetry = record(record(latest.data).latest);
  const values = record(telemetry.values);
  const online = list.filter(
    (device) => device.status === "ONLINE" || device.online === true,
  ).length;
  const offline = Math.max(0, list.length - online);
  const simulated = telemetry.source === "SIMULATED_DEMO";
  return (
    <Page
      title="System Overview"
      subtitle="Real-time status of every device across the active organization."
      actions={
        <span className="status-pill status-pill--good">System online</span>
      }
    >
      {simulated ? (
        <p className="simulated-banner">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M7 3h6l1.5 8a4.5 4.5 0 1 1-9 0Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M6.5 12.5h7" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          Simulated demo data active. Changes will not affect live hardware.
        </p>
      ) : null}
      <div className="cards">
        <ValueCard
          label="Total devices"
          value={list.length}
          icon={DEVICE_ICON}
        />
        <ValueCard
          label="Online"
          value={online}
          icon={ONLINE_ICON}
          statusVariant={online > 0 ? "good" : undefined}
          statusLabel="Live"
        />
        <ValueCard
          label="Offline"
          value={offline}
          icon={ALERT_ICON}
          statusVariant={offline > 0 ? "warning" : undefined}
          statusLabel="Attention"
        />
        <ValueCard
          label="Last sequence"
          value={telemetry.sequence ?? telemetry.sampleSequence}
          simulated={simulated}
        />
      </div>

      <div className="panel chart-placeholder" style={{ margin: "1.5rem 0" }}>
        <div className="chart-placeholder-head">
          <h2>Telemetry trend</h2>
          <span className="pill-button">Last 24 hours</span>
        </div>
        <div className="chart-placeholder-body">
          {CHART_ICON}
          <span>Trend charting is coming soon</span>
        </div>
      </div>

      <h2>Latest telemetry</h2>
      {latest.isLoading ? (
        <Loading />
      ) : latest.isError ? (
        <ErrorState error={latest.error} />
      ) : (
        <div className="cards telemetry">
          <ValueCard
            label="Temperature"
            paramKey="temp"
            unit=" °C"
            value={values.temperatureC}
            simulated={simulated}
          />
          <ValueCard
            label="pH"
            paramKey="ph"
            value={values.ph}
            simulated={simulated}
          />
          <ValueCard
            label="Light"
            paramKey="light"
            unit=" lux"
            value={values.lightLux}
            simulated={simulated}
          />
          <ValueCard
            label="Nutrient value"
            paramKey="nutrient"
            unit="%"
            value={values.nutrientPercent}
            simulated={simulated}
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

export function OverviewPage() {
  const { organizations, loading: organizationLoading } = useOrganization();
  const organizationIds = organizations
    .map((organization) => organization.organizationId)
    .sort()
    .join(",");
  const overview = useQuery({
    queryKey: ["overview", organizationIds],
    queryFn: async () => {
      const perOrganization = await Promise.all(
        organizations.map(async (organization) => ({
          organization,
          devices: responseItems(
            await apiRequest<Json>(
              `/services/device/devices?organizationId=${encodeURIComponent(organization.organizationId)}`,
            ),
          ),
        })),
      );
      const deviceUuids = perOrganization
        .flatMap(({ devices }) => devices.map((device) => device.deviceUuid))
        .filter(isUuid);
      const latestByDevice = new Map<string, Json>();
      if (deviceUuids.length) {
        const batch = await apiRequest<Json>(
          "/services/telemetry/devices/latest-batch",
          undefined,
          { method: "POST", body: JSON.stringify({ deviceUuids }) },
        );
        for (const item of responseItems(batch)) {
          const deviceUuid = item.deviceUuid;
          if (isUuid(deviceUuid))
            latestByDevice.set(deviceUuid, record(item.latest));
        }
      }
      return perOrganization.map(({ organization, devices }) => ({
        organization,
        devices: devices.map((device): Json => {
          const deviceUuid = device.deviceUuid;
          return {
            ...device,
            latest: isUuid(deviceUuid)
              ? latestByDevice.get(deviceUuid)
              : undefined,
          };
        }),
      }));
    },
    enabled: organizations.length > 0,
    retry: false,
    refetchInterval: 30_000,
  });
  const groups = overview.data ?? [];
  const totalDevices = groups.reduce(
    (sum, group) => sum + group.devices.length,
    0,
  );
  return (
    <Page title="Overview">
      <p>All devices across every organization you belong to.</p>
      {organizationLoading || overview.isLoading ? (
        <Loading />
      ) : !organizations.length ? (
        <Empty>No authorized organizations are available.</Empty>
      ) : overview.isError ? (
        <ErrorState error={overview.error} />
      ) : totalDevices ? (
        <div className="list">
          {groups
            .filter((group) => group.devices.length > 0)
            .map((group) => (
              <article key={group.organization.organizationId}>
                <strong>
                  {group.organization.name ?? "Authorized organization"}
                </strong>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Temperature</th>
                        <th>pH</th>
                        <th>Last reading</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.devices.map((device, index) => {
                        const latest = record(device.latest);
                        const values = record(latest.values);
                        return (
                          <tr key={String(device.deviceUuid ?? index)}>
                            <td>
                              {text(device.displayName ?? device.deviceId)}
                            </td>
                            <td>
                              {values.temperatureC == null
                                ? "—"
                                : `${text(values.temperatureC)} °C`}
                            </td>
                            <td>{text(values.ph)}</td>
                            <td>
                              {typeof latest.observedAt === "string"
                                ? new Date(latest.observedAt).toLocaleString()
                                : "No data yet"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
        </div>
      ) : (
        <Empty>No devices have been claimed in any organization yet.</Empty>
      )}
    </Page>
  );
}

export function OrganizationsPage() {
  const queryClient = useQueryClient();
  const {
    organizations: values,
    selectedOrganizationId: active,
    selectOrganization,
    loading,
    error,
  } = useOrganization();
  const [organizationName, setOrganizationName] = useState("");
  const createOrganization = useMutation({
    mutationFn: async () => {
      const normalized = organizationName.trim().slice(0, 120);
      if (!normalized) throw new Error("Organization name is required");
      await apiRequest("/services/access/organizations", undefined, {
        method: "POST",
        body: JSON.stringify({ name: normalized }),
      });
    },
    onSuccess: () => {
      setOrganizationName("");
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("VIEWER");
  const invite = useMutation({
    mutationFn: async () => {
      const normalized = inviteEmail.trim();
      if (!active || !normalized)
        throw new Error("Select an organization and enter an email address");
      await apiRequest(
        `/services/access/organizations/${encodeURIComponent(active)}/invitations`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ email: normalized, role: inviteRole }),
        },
      );
    },
    onSuccess: () => setInviteEmail(""),
  });
  return (
    <Page title="Organizations">
      <p>
        Select an organization authorized by the current membership. Revoked
        memberships are shown as unavailable and cannot become active.
      </p>
      <form
        className="panel form"
        onSubmit={(event) => {
          event.preventDefault();
          createOrganization.mutate();
        }}
      >
        <label>
          New organization name
          <input
            maxLength={120}
            required
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
          />
        </label>
        <button disabled={createOrganization.isPending} type="submit">
          {createOrganization.isPending ? "Creating…" : "Create organization"}
        </button>
        {createOrganization.isError ? (
          <ErrorState error={createOrganization.error} />
        ) : null}
      </form>
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
      <h2>Invite a member</h2>
      <form
        className="panel form"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate();
        }}
      >
        <p className="notice">
          Invites the active organization&apos;s membership. Only owners and
          admins can send invitations; other members will see an error.
        </p>
        <label>
          Email address
          <input
            required
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
          />
        </label>
        <label>
          Role
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value)}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="VIEWER">VIEWER</option>
          </select>
        </label>
        <button disabled={invite.isPending || !active} type="submit">
          {invite.isPending ? "Sending…" : "Send invitation"}
        </button>
        {invite.isError ? <ErrorState error={invite.error} /> : null}
        {invite.isSuccess ? <p role="status">Invitation sent.</p> : null}
      </form>
    </Page>
  );
}

export function InvitationsPage() {
  const queryClient = useQueryClient();
  const invitations = usePlatformQuery(
    "invitations",
    "/services/access/invitations",
  );
  const values = responseItems(invitations.data);
  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "reject" }) =>
      apiRequest(
        `/services/access/invitations/${encodeURIComponent(id)}/${action}`,
        undefined,
        { method: "POST" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
  return (
    <Page title="Invitations">
      <p>
        Pending invitations to organizations for your account. Accepting adds
        the organization to your available list; rejecting discards it.
      </p>
      {invitations.isLoading ? (
        <Loading />
      ) : invitations.isError ? (
        <ErrorState error={invitations.error} />
      ) : values.length ? (
        <div className="list">
          {values.map((invitation, index) => {
            const id = String(invitation.id ?? index);
            return (
              <article key={id}>
                <strong>
                  {text(
                    invitation.organizationName ?? invitation.organizationId,
                  )}
                </strong>
                <span>Role {text(invitation.role)}</span>
                <span>
                  {typeof invitation.expiresAt === "string"
                    ? `Expires ${new Date(invitation.expiresAt).toLocaleString()}`
                    : null}
                </span>
                <div className="item-actions">
                  <button
                    disabled={respond.isPending}
                    type="button"
                    onClick={() => respond.mutate({ id, action: "accept" })}
                  >
                    Accept
                  </button>
                  <button
                    className="button-danger"
                    disabled={respond.isPending}
                    type="button"
                    onClick={() => {
                      if (window.confirm("Reject this invitation?"))
                        respond.mutate({ id, action: "reject" });
                    }}
                  >
                    Reject
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty>No pending invitations.</Empty>
      )}
      {respond.isError ? <ErrorState error={respond.error} /> : null}
    </Page>
  );
}

function deviceStatusVariant(status: string) {
  return status === "ONLINE"
    ? "good"
    : status === "OFFLINE"
      ? "critical"
      : "warning";
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "online" | "offline"
  >("all");
  const values = responseItems(devices.data);
  const query = search.trim().toLowerCase();
  const filtered = values.filter((device) => {
    const status = String(device.status ?? "").toUpperCase();
    if (statusFilter === "online" && status !== "ONLINE") return false;
    if (statusFilter === "offline" && status !== "OFFLINE") return false;
    if (!query) return true;
    const haystack =
      `${text(device.displayName)} ${text(device.deviceId)}`.toLowerCase();
    return haystack.includes(query);
  });
  return (
    <Page
      title="Device Fleet"
      subtitle="Manage and monitor all deployed hardware nodes."
      actions={
        <div className="segmented">
          {(
            [
              ["all", "All"],
              ["online", "Online"],
              ["offline", "Offline"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? "active" : undefined}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {organizationLoading || devices.isLoading ? (
        <Loading />
      ) : !selectedOrganizationId ? (
        <Empty>Select an authorized organization first.</Empty>
      ) : devices.isError ? (
        <ErrorState error={devices.error} />
      ) : values.length ? (
        <>
          <label className="search-input" style={{ marginBottom: "1rem" }}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle
                cx="9"
                cy="9"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="m17 17-3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              placeholder="Search devices…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search devices"
            />
          </label>
          {filtered.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name / ID</th>
                    <th>Status</th>
                    <th>Profile</th>
                    <th>Last update</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((device) => {
                    const uuid = text(device.deviceUuid ?? device.id);
                    const status = String(device.status ?? "").toUpperCase();
                    return (
                      <tr key={uuid}>
                        <td>
                          <div className="row-identity">
                            <span className="icon-circle icon-circle--device">
                              {DEVICE_ICON}
                            </span>
                            <div>
                              <strong>
                                {text(device.displayName ?? device.deviceId)}
                              </strong>
                              {device.displayName ? (
                                <small>{text(device.deviceId)}</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status-pill status-pill--${deviceStatusVariant(status)}`}
                          >
                            {text(device.status) === "—"
                              ? "Unknown"
                              : text(device.status)}
                          </span>
                        </td>
                        <td>{text(device.profileName ?? device.profileId)}</td>
                        <td>{text(device.lastSeenAt ?? device.lastSeen)}</td>
                        <td>
                          <Link
                            className="button-link"
                            to={`/devices/${encodeURIComponent(uuid)}`}
                          >
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
            <Empty>No devices match this search.</Empty>
          )}
        </>
      ) : (
        <div className="empty-cta">
          <strong>No devices yet</strong>
          <p>
            Pair a device from the AlgaGuard mobile app to see it here — the web
            dashboard doesn&apos;t claim devices directly.
          </p>
        </div>
      )}
    </Page>
  );
}

export function AlertsPage() {
  const { selectedOrganizationId, loading: organizationLoading } =
    useOrganization();
  const alerts = usePlatformQuery(
    "alerts",
    selectedOrganizationId
      ? `/services/realtime/organizations/${encodeURIComponent(selectedOrganizationId)}/alerts`
      : "",
    !!selectedOrganizationId,
  );
  const values = responseItems(alerts.data);
  return (
    <Page title="Alerts">
      <p>
        Threshold breaches for devices in the active organization, most recent
        first.
      </p>
      {organizationLoading || alerts.isLoading ? (
        <Loading />
      ) : !selectedOrganizationId ? (
        <Empty>Select an authorized organization first.</Empty>
      ) : alerts.isError ? (
        <ErrorState error={alerts.error} />
      ) : values.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Parameter</th>
                <th>Reading</th>
                <th>Threshold</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {values.map((alert, index) => (
                <tr key={String(alert.alertId ?? index)}>
                  <td>{text(alert.deviceId)}</td>
                  <td>{text(alert.parameter)}</td>
                  <td>
                    {text(alert.value)} ({text(alert.direction)})
                  </td>
                  <td>
                    {alert.direction === "HIGH"
                      ? `above ${text(alert.maximum)}`
                      : `below ${text(alert.minimum)}`}
                  </td>
                  <td>
                    {typeof alert.occurredAt === "string"
                      ? new Date(alert.occurredAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No alerts recorded yet.</Empty>
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
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [unpairState, setUnpairState] = useState("IDLE");
  const device = usePlatformQuery(
    `device:${deviceUuid}`,
    `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
  );
  const telemetry = usePlatformQuery(
    `telemetry:${deviceUuid}`,
    `/services/telemetry/devices/${encodeURIComponent(deviceUuid)}/telemetry`,
  );
  const latest = usePlatformQuery(
    `telemetry-latest:${deviceUuid}`,
    `/services/telemetry/devices/${encodeURIComponent(deviceUuid)}/latest`,
  );
  const status = record(device.data);
  const history = responseItems(telemetry.data);
  const profiles = usePlatformQuery(
    "profiles",
    selectedOrganizationId
      ? `/services/profile/profiles?organizationId=${encodeURIComponent(selectedOrganizationId)}`
      : "",
    !!selectedOrganizationId,
  );
  const profileOptions = responseItems(profiles.data);
  const activeDeviceId = String(status.deviceId ?? "");
  const profileAssignment = usePlatformQuery(
    `profile-assignment:${activeDeviceId}`,
    `/services/profile/devices/${encodeURIComponent(activeDeviceId)}/profile-assignment`,
    /^AG-[0-9]{6}$/.test(activeDeviceId),
  );
  const assignedProfileId = String(
    record(profileAssignment.data).profileId ?? "",
  );
  const assignedProfile = usePlatformQuery(
    `profile:${assignedProfileId}`,
    `/services/profile/profiles/${encodeURIComponent(assignedProfileId)}`,
    isUuid(assignedProfileId),
  );
  const thresholds = record(
    record(record(assignedProfile.data).current).configuration,
  ).thresholds;
  const latestValues = record(record(latest.data).latest).values;
  const alerts = exceededThresholds(record(latestValues), record(thresholds));
  useEffect(() => {
    if (!deviceName && typeof status.displayName === "string") {
      setDeviceName(status.displayName);
    }
    if (!selectedProfileId && assignedProfileId) {
      setSelectedProfileId(assignedProfileId);
    }
  }, [deviceName, selectedProfileId, status.displayName, assignedProfileId]);
  const setupSubmitting = useRef(false);
  const setup = useMutation({
    mutationFn: async () => {
      // useMutation's `isPending` flag only updates on the next render, so a
      // fast double-submit (e.g. Enter followed immediately by a button
      // click) can invoke this twice before the button disables -- each
      // invocation would mint its own commandId/expiresAt and the second
      // one gets rejected with a 409 by command-service's idempotency check.
      // Guard re-entrancy synchronously instead of relying on render timing.
      if (setupSubmitting.current) throw new Error("Setup is already saving");
      setupSubmitting.current = true;
      const normalizedDeviceName = deviceName.trim();
      if (!selectedOrganizationId || !normalizedDeviceName) {
        throw new Error("Device name is required");
      }
      await apiRequest(
        `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
        undefined,
        {
          method: "PATCH",
          body: JSON.stringify({ displayName: normalizedDeviceName }),
        },
      );
      const profile = profileOptions.find(
        (candidate) => String(candidate.profileId) === selectedProfileId,
      );
      const profileId = profile?.profileId;
      const version = Number(record(profile?.current).version);
      const deviceId = String(status.deviceId ?? "");
      if (
        !isUuid(profileId) ||
        !Number.isInteger(version) ||
        version < 1 ||
        !/^AG-[0-9]{6}$/.test(deviceId)
      )
        throw new Error("Select a profile to assign to this device");
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
    onSettled: () => {
      setupSubmitting.current = false;
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const deviceId = String(status.deviceId ?? "");
      const ownershipVersion = String(status.ownershipVersion ?? "");
      if (
        !/^AG-[0-9]{6}$/.test(deviceId) ||
        !/^[1-9][0-9]{0,18}$/.test(ownershipVersion)
      )
        throw new Error("Device binding is unavailable");
      const commandId = crypto.randomUUID();
      const expiresAt = Date.now() + 2 * 60 * 1000;
      setUnpairState("WAITING_FOR_DEVICE");
      await apiRequest(
        `/services/command/devices/${encodeURIComponent(deviceId)}/commands`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify({
            commandId,
            commandType: "REQUEST_PHYSICAL_UNPAIR",
            expiresAt: new Date(expiresAt).toISOString(),
            parameters: {},
          }),
        },
      );
      while (Date.now() < expiresAt) {
        const command = await apiRequest<Json>(
          `/services/command/commands/${encodeURIComponent(commandId)}`,
        );
        if (
          command.commandId !== commandId ||
          command.deviceId !== deviceId ||
          command.commandType !== "REQUEST_PHYSICAL_UNPAIR"
        )
          throw new Error("Physical confirmation response is invalid");
        if (command.status === "SUCCEEDED") {
          setUnpairState("FINALIZING");
          const result = await apiRequest<Json>(
            `/services/device/devices/${encodeURIComponent(deviceUuid)}/physical-unpair/finalize`,
            undefined,
            {
              method: "POST",
              body: JSON.stringify({
                commandId,
                ownershipVersion,
                confirmation: "PHYSICALLY_CONFIRMED",
              }),
            },
          );
          if (result.state !== "UNPAIRED" || result.lifecycle !== "UNCLAIMED")
            throw new Error("Physical unpair was not finalized");
          return;
        }
        if (["REJECTED", "FAILED", "EXPIRED"].includes(String(command.status)))
          throw new Error("The device cancelled or rejected physical unpair");
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      throw new Error(
        "Physical confirmation expired; the device remains paired",
      );
    },
    onSuccess: () => navigate("/devices"),
    onError: () => setUnpairState("NOT_REMOVED"),
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
          {alerts.length ? (
            <div className="alert-banner" role="alert">
              <strong>Threshold alert</strong>
              <ul>
                {alerts.map((alert) => (
                  <li key={alert.label}>
                    {alert.label} is {text(alert.value)}
                    {alert.max !== undefined && alert.value > alert.max
                      ? ` (above maximum ${text(alert.max)})`
                      : ` (below minimum ${text(alert.min)})`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="cards">
            <ValueCard
              label="Network/cloud"
              value={status.networkState ?? status.status}
            />
            <ValueCard
              label="Active profile"
              value={
                assignedProfileId
                  ? (record(assignedProfile.data).name ?? assignedProfileId)
                  : undefined
              }
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
              Assign profile
              <select
                aria-label="Assign profile"
                required
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
              >
                <option value="">Select a profile</option>
                {profileOptions.map((profile) => (
                  <option
                    key={String(profile.profileId)}
                    value={String(profile.profileId)}
                  >
                    {text(profile.name)} (v
                    {text(record(profile.current).version)})
                  </option>
                ))}
              </select>
            </label>
            {!profileOptions.length ? (
              <p className="notice">
                No profiles exist yet.{" "}
                <Link to="/profiles">Create one on the Profiles page</Link>.
              </p>
            ) : null}
            <p className="notice">
              Saving assigns the selected profile and queues one activation
              command for this device.
            </p>
            <button
              disabled={setup.isPending || !selectedProfileId}
              type="submit"
            >
              {setup.isPending ? "Saving…" : "Save device setup"}
            </button>
            {setup.isError ? <ErrorState error={setup.error} /> : null}
          </form>
          <section className="panel">
            <h2>Physically unpair device</h2>
            <p>
              The online ESP32 will show REMOVE DEVICE?. Press Select on its
              OLED to confirm, or Back to cancel. Ownership and credentials are
              changed only after the device confirms.
            </p>
            <button
              disabled={remove.isPending}
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Request physical unpair? You must confirm on the ESP32 OLED.",
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              {remove.isPending
                ? "Waiting for device confirmationÃ¢â‚¬Â¦"
                : "Request physical unpair"}
            </button>
            {unpairState !== "IDLE" ? (
              <p className="notice" role="status">
                {unpairState === "WAITING_FOR_DEVICE"
                  ? "Waiting for OLED confirmation. The device remains paired until confirmed."
                  : unpairState === "FINALIZING"
                    ? "Physical confirmation received; securely finalizing unpair."
                    : "Unpair did not complete; the device remains paired."}
              </p>
            ) : null}
            {remove.isError ? <ErrorState error={remove.error} /> : null}
          </section>
        </>
      )}
    </Page>
  );
}

export function ProfilesPage() {
  const queryClient = useQueryClient();
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
  const [profileName, setProfileName] = useState("");
  const [thresholdInputs, setThresholdInputs] = useState<ThresholdInputs>({});
  const create = useMutation({
    mutationFn: async () => {
      const normalizedName = profileName.trim();
      if (!selectedOrganizationId || !normalizedName)
        throw new Error("Organization and profile name are required");
      await apiRequest("/services/profile/profiles", undefined, {
        method: "POST",
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
          name: normalizedName,
          configuration: profileConfiguration(thresholdInputs),
        }),
      });
    },
    onSuccess: () => {
      setProfileName("");
      setThresholdInputs({});
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
  const deleteProfile = useMutation({
    mutationFn: (profileId: string) =>
      apiRequest(
        `/services/profile/profiles/${encodeURIComponent(profileId)}`,
        undefined,
        {
          method: "DELETE",
          body: JSON.stringify({ confirmation: "DELETE" }),
        },
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
  return (
    <Page title="Profiles">
      <p className="notice">
        Profile values are user-defined and are not scientifically approved.
      </p>
      <p>
        Create algae profiles here, then assign one to a device from that
        device&apos;s page.
      </p>
      {organizationLoading || profiles.isLoading ? (
        <Loading />
      ) : !selectedOrganizationId ? (
        <Empty>Select an authorized organization first.</Empty>
      ) : profiles.isError ? (
        <ErrorState error={profiles.error} />
      ) : values.length ? (
        <div className="list">
          {values.map((profile, index) => {
            const profileId = String(profile.profileId ?? profile.id ?? "");
            return (
              <article key={profileId || index}>
                <strong>{text(profile.name ?? profileId)}</strong>
                <span>Version {text(record(profile.current).version)}</span>
                <div className="item-actions">
                  <button
                    className="button-danger"
                    disabled={deleteProfile.isPending}
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete profile "${text(profile.name ?? profileId)}"? This cannot be undone.`,
                        )
                      )
                        deleteProfile.mutate(profileId);
                    }}
                  >
                    Delete profile
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty>No profiles have been created for this organization.</Empty>
      )}
      {deleteProfile.isError ? (
        <ErrorState error={deleteProfile.error} />
      ) : null}
      <h2>Create profile</h2>
      <form
        className="panel form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
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
        <button
          disabled={create.isPending || !selectedOrganizationId}
          type="submit"
        >
          {create.isPending ? "Creating…" : "Create profile"}
        </button>
        {create.isError ? <ErrorState error={create.error} /> : null}
      </form>
    </Page>
  );
}

export function CommandPage() {
  const client = useQueryClient();
  const [deviceUuid, setDeviceUuid] = useState("");
  const [lastDeviceId, setLastDeviceId] = useState("");
  const [indicator, setIndicator] = useState("ON");
  const [confirmation, setConfirmation] = useState(false);
  const commands = usePlatformQuery(
    "commands",
    lastDeviceId
      ? `/services/command/devices/${encodeURIComponent(lastDeviceId)}/commands`
      : "",
    !!lastDeviceId,
  );
  const create = useMutation({
    mutationFn: async (input: { commandType: string; parameters: Json }) => {
      const device = await apiRequest<Json>(
        `/services/device/devices/${encodeURIComponent(deviceUuid)}`,
      );
      const deviceId = String(device.deviceId ?? "");
      if (!/^AG-[0-9]{6}$/.test(deviceId))
        throw new Error("Device UUID did not resolve to a paired device");
      const result = await apiRequest<Json>(
        `/services/command/devices/${encodeURIComponent(deviceId)}/commands`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            commandType: input.commandType,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            parameters: input.parameters,
          }),
        },
      );
      setLastDeviceId(deviceId);
      return result;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ["commands"] }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const commandType =
      (new FormData(event.currentTarget).get("commandType") as string) ??
      "REQUEST_STATUS";
    if (commandType === "SET_INDICATOR_STATE" && !confirmation) return;
    create.mutate({
      commandType,
      parameters:
        commandType === "SET_INDICATOR_STATE"
          ? { red: indicator, green: indicator, blue: indicator }
          : {},
    });
  }
  return (
    <Page title="Safe commands">
      <p>Remote factory reset and reboot are intentionally not available.</p>
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
          I confirm this changes the device indicator only.
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
  const releases = usePlatformQuery("ota", "/services/ota/firmware/releases");
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
