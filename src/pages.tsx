import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { keycloak } from "./auth";

export function DataPage({
  title,
  path,
  note,
}: {
  title: string;
  path: string;
  note?: string;
}) {
  const query = useQuery({
    queryKey: [path],
    queryFn: () => apiRequest<unknown>(path),
    retry: false,
  });
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      {note && <p className="notice">{note}</p>}
      {query.isLoading && <p role="status">Loading…</p>}
      {query.isError && (
        <p role="alert">
          Unable to load this view. Check the development services and retry.
        </p>
      )}
      {query.data ? (
        <pre aria-label={`${title} data`}>
          {JSON.stringify(query.data, null, 2)}
        </pre>
      ) : !query.isLoading && !query.isError ? (
        <p>No records yet.</p>
      ) : null}
    </section>
  );
}

export function LoginPage() {
  return (
    <section>
      <h1>Sign in</h1>
      <p>Continue with the configured Keycloak realm.</p>
      <button type="button" onClick={() => void keycloak.login()}>
        Sign in with Keycloak
      </button>
    </section>
  );
}
