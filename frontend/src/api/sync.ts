import { apiRequest } from "./client";
import type { Note } from "./notes";
import type { QueuedOp } from "../offline/queue";

export interface DeltaNote extends Note {
  deleted: boolean;
}

interface SyncDelta {
  items: DeltaNote[];
  next_since: string | null;
}

export interface SyncResult {
  client_id: string;
  status: "ok" | "conflict" | "not_found";
  note: Note | null;
  current_version: number | null;
}

export async function fetchSyncDelta(since: string): Promise<SyncDelta> {
  const query = new URLSearchParams({ since });
  return apiRequest<SyncDelta>(`/v1/sync/delta?${query}`);
}

export async function applySyncOperation(operation: QueuedOp, version?: number, noteId?: string): Promise<SyncResult> {
  const response = await apiRequest<{ results: SyncResult[] }>("/v1/sync/batch", {
    method: "POST",
    body: JSON.stringify({
      ops: [{
        op: operation.op,
        client_id: operation.clientId,
        ...(operation.op !== "create" ? { note_id: noteId ?? operation.noteId } : {}),
        ...(operation.op !== "create" ? { version } : {}),
        fields: operation.fields,
      }],
    }),
  });
  const result = response.results[0];
  if (!result) throw new Error("The sync service returned no result for a queued change.");
  return result;
}
