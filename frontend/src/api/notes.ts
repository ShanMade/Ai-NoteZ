import { apiRequest } from "./client";
import { getAuthenticatedUserId } from "../store/auth";
import { enqueueOperation, getCachedNotes, getQueuedOperations, mergeIntoQueuedCreate, removeQueuedForNote } from "../offline/queue";

export interface Note {
  id: string;
  title: string;
  body: string;
  kind: string;
  folder_path: string;
  parent_id: string | null;
  note_type: string | null;
  version: number;
  shared_token: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  local_only?: boolean;
  sync_pending?: boolean;
}

export type NoteInput = Partial<Pick<
  Note,
  "title" | "body" | "kind" | "folder_path" | "parent_id" | "note_type"
>>;

export interface NoteListParams {
  folder?: string;
  kind?: string;
  updatedAfter?: string;
  cursor?: string;
}

export interface NotePage {
  items: Note[];
  next_cursor: string | null;
}

export async function listNotes(params: NoteListParams = {}): Promise<NotePage> {
  const query = new URLSearchParams({ limit: "200" });
  if (params.folder) query.set("folder", params.folder);
  if (params.kind) query.set("kind", params.kind);
  if (params.updatedAfter) query.set("updated_after", params.updatedAfter);
  if (params.cursor) query.set("cursor", params.cursor);
  return apiRequest<NotePage>(`/v1/notes?${query}`);
}

export async function listAllNotes(): Promise<Note[]> {
  const all: Note[] = [];
  let cursor: string | undefined;
  do {
    const page = await listNotes({ cursor });
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

export function createNote(input: NoteInput): Promise<Note> {
  return apiRequest<Note>("/v1/notes", { method: "POST", body: JSON.stringify(input) }).catch(async (error: unknown) => {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    const ownerId = getAuthenticatedUserId();
    if (!ownerId) throw error;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await enqueueOperation({ clientId: id, ownerId, op: "create", fields: input, timestamp: Date.now() });
    return {
      id,
      title: input.title ?? "",
      body: input.body ?? "",
      kind: input.kind ?? "note",
      folder_path: input.folder_path ?? "",
      parent_id: input.parent_id ?? null,
      note_type: input.note_type ?? null,
      version: 1,
      shared_token: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
      local_only: true,
      sync_pending: true,
    };
  });
}

export function getNote(id: string): Promise<Note> {
  return apiRequest<Note>(`/v1/notes/${encodeURIComponent(id)}`).catch(async (error: unknown) => {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    const ownerId = getAuthenticatedUserId();
    if (!ownerId) throw error;
    const notes = await getCachedNotes(ownerId);
    const cached = notes?.find((note) => note.id === id);
    if (!cached) throw error;
    return cached;
  });
}

export function updateNote(id: string, version: number, fields: NoteInput, fallback?: Note): Promise<Note> {
  if (fallback?.local_only) {
    const ownerId = getAuthenticatedUserId();
    if (!ownerId) return Promise.reject(new Error("Sign in to update this note."));
    return mergeIntoQueuedCreate(id, ownerId, fields).then((merged) => {
      if (!merged) throw new Error("The new offline note is missing from the sync queue.");
      return { ...fallback, ...fields, sync_pending: true };
    });
  }
  return apiRequest<Note>(`/v1/notes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ version, ...fields }),
  }).catch(async (error: unknown) => {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    if (!fallback) throw error;
    const ownerId = getAuthenticatedUserId();
    if (!ownerId) throw error;
    await enqueueOperation({
      clientId: crypto.randomUUID(),
      ownerId,
      op: "patch",
      noteId: id,
      version,
      fields,
      timestamp: Date.now(),
    });
    return { ...fallback, ...fields, sync_pending: true, updated_at: new Date().toISOString() };
  });
}

export async function deleteNote(id: string): Promise<void> {
  const ownerId = getAuthenticatedUserId();
  if (!ownerId) throw new Error("Sign in to delete this note.");
  const queued = await getQueuedOperations(ownerId);
  if (queued.some((operation) => operation.op === "create" && operation.clientId === id)) {
    await removeQueuedForNote(id, ownerId);
    return;
  }
  try {
    await apiRequest<void>(`/v1/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    await enqueueOperation({
      clientId: crypto.randomUUID(),
      ownerId,
      op: "delete",
      noteId: id,
      fields: {},
      timestamp: Date.now(),
    });
  }
}

export function getChildren(id: string): Promise<Note[]> {
  return apiRequest<Note[]>(`/v1/notes/${encodeURIComponent(id)}/children`).catch(async (error: unknown) => {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    const ownerId = getAuthenticatedUserId();
    if (!ownerId) throw error;
    const notes = await getCachedNotes(ownerId);
    if (!notes) throw error;
    return notes.filter((note) => note.parent_id === id);
  });
}

export function shareNote(id: string): Promise<{ shared_token: string; url: string }> {
  return apiRequest(`/v1/notes/${encodeURIComponent(id)}/share`, { method: "POST" });
}
