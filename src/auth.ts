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
  const authenticated = await keycloak.init({
    onLoad: "check-sso",
    pkceMethod: "S256",
  });
  if (authenticated) {
    // keycloak-js never refreshes the access token on its own -- without
    // this, every request silently 401s once the token's short lifespan
    // (a few minutes) elapses, for the rest of the session. Proactively
    // refresh on a cadence tighter than the token lifespan, and fall back
    // to a fresh login if the refresh token itself has also expired.
    const refresh = () =>
      void keycloak.updateToken(30).catch(() => keycloak.login());
    keycloak.onTokenExpired = refresh;
    setInterval(refresh, 30_000);
  }
  return authenticated;
}

export function accessToken() {
  return keycloak.token;
}

export function hasRole(...roles: string[]) {
  return roles.some((role) => keycloak.hasRealmRole(role));
}
