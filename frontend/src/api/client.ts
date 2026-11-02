import { getAccessToken, type AccessTokenProvider } from "../recorder/api";

const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export class VersionConflictError extends Error {
  constructor(
    message: string,
    readonly currentVersion: number,
    readonly current: unknown,
  ) {
    super(message);
    this.name = "VersionConflictError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  tokenProvider?: AccessTokenProvider,
): Promise<T> {
  const token = await getAccessToken(tokenProvider);
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      detail?: string;
      current_version?: number;
      current?: unknown;
    } | null;
    if (response.status === 409) {
      throw new VersionConflictError(
        payload?.detail ?? "This note changed elsewhere.",
        payload?.current_version ?? 0,
        payload?.current,
      );
    }
    throw new Error(payload?.detail ?? `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
