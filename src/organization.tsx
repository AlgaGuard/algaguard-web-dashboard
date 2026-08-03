import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { keycloak } from "./auth";

export interface AuthorizedOrganization {
  organizationId: string;
  name?: string;
  status?: string;
  revoked?: boolean;
}

interface OrganizationContextValue {
  organizations: AuthorizedOrganization[];
  selectedOrganizationId?: string;
  loading: boolean;
  error: boolean;
  selectOrganization: (organizationId: string) => void;
  clearOrganization: () => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(
  null,
);

const storageKey = "algaguard.selectedOrganizationId";
function readStoredOrganizationId(): string | undefined {
  try {
    return localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeStoredOrganizationId(organizationId: string | undefined) {
  try {
    if (organizationId) localStorage.setItem(storageKey, organizationId);
    else localStorage.removeItem(storageKey);
  } catch {
    /* storage unavailable; selection just won't persist across reloads */
  }
}

function authorizedOrganizations(value: unknown): AuthorizedOrganization[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const organizationId = record.organizationId ?? record.id;
    if (
      typeof organizationId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(organizationId)
    )
      return [];
    return [
      {
        organizationId,
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        ...(typeof record.status === "string" ? { status: record.status } : {}),
        ...(typeof record.revoked === "boolean"
          ? { revoked: record.revoked }
          : {}),
      },
    ];
  });
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: () =>
      apiRequest<{ items: unknown[] }>("/services/access/organizations"),
    retry: false,
    enabled: keycloak.authenticated === true,
  });
  const organizations = useMemo(
    () =>
      authorizedOrganizations(query.data).filter(
        (organization) =>
          organization.revoked !== true && organization.status !== "REVOKED",
      ),
    [query.data],
  );
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | undefined
  >(readStoredOrganizationId);

  useEffect(() => {
    if (!keycloak.authenticated) {
      setSelectedOrganizationId(undefined);
      return;
    }
    if (
      selectedOrganizationId &&
      organizations.some(
        (organization) =>
          organization.organizationId === selectedOrganizationId,
      )
    )
      return;
    const next =
      organizations.length === 1 ? organizations[0]!.organizationId : undefined;
    setSelectedOrganizationId(next);
    writeStoredOrganizationId(next);
  }, [organizations, selectedOrganizationId]);

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      selectedOrganizationId,
      loading: query.isLoading,
      error: query.isError,
      selectOrganization: (organizationId) => {
        if (
          organizations.some(
            (organization) => organization.organizationId === organizationId,
          )
        ) {
          setSelectedOrganizationId(organizationId);
          writeStoredOrganizationId(organizationId);
        }
      },
      clearOrganization: () => {
        setSelectedOrganizationId(undefined);
        writeStoredOrganizationId(undefined);
      },
    }),
    [organizations, query.isError, query.isLoading, selectedOrganizationId],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const value = useContext(OrganizationContext);
  if (!value)
    throw new Error("OrganizationProvider is required for authorized pages");
  return value;
}
