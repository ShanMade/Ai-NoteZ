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
    throw new Error(data?.detail ?? `Recording request failed (${response.status}).`);
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

export async function uploadPart(
  sessionId: string,
  index: number,
  blob: Blob,
  isEmpty: boolean,
  tokenProvider?: AccessTokenProvider,
): Promise<void> {
  const form = new FormData();
  form.append("audio", blob, `part-${index}.wav`);
  form.append("part_index", String(index));
  form.append("is_empty", String(isEmpty));
  await request(`/v1/record/sessions/${sessionId}/parts`, tokenProvider, { method: "POST", body: form });
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

export async function manualRetryPart(
  sessionId: string,
  index: number,
  blob: Blob,
  tokenProvider?: AccessTokenProvider,
): Promise<void> {
  const upload = await request<{ upload_url: string }>(
    `/v1/record/sessions/${sessionId}/parts/${index}/upload-url`,
    tokenProvider,
  );
  const response = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "audio/wav" },
    body: blob,
  });
  if (!response.ok) throw new Error(`Could not upload the replacement audio (${response.status}).`);
  await request(`/v1/record/sessions/${sessionId}/parts/${index}/retry`, tokenProvider, { method: "POST" });
}
