import Keycloak from "keycloak-js";

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? "http://localhost:8080/auth",
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? "algaguard",
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? "algaguard-web",
});

let initialized = false;
export async function initializeAuthentication() {
  if (initialized) return keycloak.authenticated ?? false;
  initialized = true;
  return keycloak.init({ onLoad: "check-sso", pkceMethod: "S256" });
}

export function accessToken() {
  return keycloak.token;
}

export function hasRole(...roles: string[]) {
  return roles.some((role) => keycloak.hasRealmRole(role));
}
