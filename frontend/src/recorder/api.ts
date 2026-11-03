import type { RecordingPartRead, RecordingSessionRead, RecordingSpeaker } from "./types";

export type AccessTokenProvider = () => Promise<string>;

declare global {
  interface Window {
    notezAuth?: { getIdToken: AccessTokenProvider };
  }
}

const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export async function getAccessToken(provider?: AccessTokenProvider): Promise<string> {
  const getToken = provider ?? window.notezAuth?.getIdToken;
  if (!getToken) throw new Error("Sign in to record. The app has not provided an authentication token.");
  const token = await getToken();
  if (!token) throw new Error("Your session expired. Sign in again to continue recording.");
  return token;
}

export class RecordingApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(detail: string, status: number, retryAfterSeconds: number | null = null) {
    super(detail);
    this.name = "RecordingApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function apiErrorStatus(error: unknown): number | null {
  return error instanceof RecordingApiError ? error.status : null;
}

export function apiErrorRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof RecordingApiError) || error.retryAfterSeconds === null) return null;
  return error.retryAfterSeconds * 1000;
}

async function request<T>(
  path: string,
  tokenProvider: AccessTokenProvider | undefined,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken(tokenProvider);
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: string } | null;
    const retryAfter = Number(response.headers.get("Retry-After"));
    throw new RecordingApiError(
      data?.detail ?? `Recording request failed (${response.status}).`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface RecordingSessionResponse {
  session_id: string;
}

export function createSession(
  noteId: string,
  contextPrompt: string,
  tokenProvider?: AccessTokenProvider,
): Promise<RecordingSessionResponse> {
  return request("/v1/record/sessions", tokenProvider, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_id: noteId, context_prompt: contextPrompt || null }),
  });
}

export function fetchSession(sessionId: string, tokenProvider?: AccessTokenProvider): Promise<RecordingSessionRead> {
  return request(`/v1/record/sessions/${sessionId}`, tokenProvider);
}

export interface RecordingPartQueued {
  part_id: string;
  status: string;
}

export async function uploadPart(
  sessionId: string,
  index: number,
  blob: Blob,
  isEmpty: boolean,
  tokenProvider?: AccessTokenProvider,
): Promise<RecordingPartQueued> {
  const form = new FormData();
  form.append("audio", blob, `part-${index}.wav`);
  form.append("part_index", String(index));
  form.append("is_empty", String(isEmpty));
  return request<RecordingPartQueued>(`/v1/record/sessions/${sessionId}/parts`, tokenProvider, { method: "POST", body: form });
}

export function fetchPart(
  sessionId: string,
  index: number,
  tokenProvider?: AccessTokenProvider,
): Promise<RecordingPartRead> {
  return request(`/v1/record/sessions/${sessionId}/parts/${index}`, tokenProvider);
}

export function fetchSpeakers(sessionId: string, tokenProvider?: AccessTokenProvider): Promise<RecordingSpeaker[]> {
  return request(`/v1/record/sessions/${sessionId}/speakers`, tokenProvider);
}

export function renameSpeaker(
  sessionId: string,
  speakerId: string,
  displayName: string,
  role: string,
  tokenProvider?: AccessTokenProvider,
): Promise<RecordingSpeaker> {
  return request(`/v1/record/sessions/${sessionId}/speakers/${speakerId}`, tokenProvider, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName, role: role || null }),
  });
}

export function finishSession(
  sessionId: string,
  expectedPartCount: number,
  tokenProvider?: AccessTokenProvider,
): Promise<{ status: string }> {
  return request(`/v1/record/sessions/${sessionId}/finish`, tokenProvider, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_part_count: expectedPartCount }),
  });
}

export function retryPartTranscription(
  sessionId: string,
  index: number,
  tokenProvider?: AccessTokenProvider,
): Promise<RecordingPartQueued> {
  return request(`/v1/record/sessions/${sessionId}/parts/${index}/retry`, tokenProvider, { method: "POST" });
}

export async function manualRetryPart(
  sessionId: string,
  index: number,
  blob: Blob,
  tokenProvider?: AccessTokenProvider,
): Promise<void> {
  // Re-upload through the normal parts endpoint. The previous flow first
  // demanded a signed R2 upload URL, which the server only grants after
  // three *transcription* attempts and only when R2 is configured — so the
  // Retry button dead-ended with 409/503 for exactly the parts it exists
  // for (e.g. parts whose transcription was never dispatched). The parts
  // endpoint now replaces a failed part with the re-uploaded audio and
  // dispatches it, regardless of storage backend or attempt count.
  const result = await uploadPart(sessionId, index, blob, false, tokenProvider);
  if (result.status === "failed") {
    throw new Error("The recording part could not be queued for transcription. Try the retry again.");
  }
}
