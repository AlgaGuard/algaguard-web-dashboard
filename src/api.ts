import { accessToken } from "./auth";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/v1";

export async function apiRequest<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  const bearer = token ?? accessToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}
