import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { applySyncOperation, fetchSyncDelta } from "../api/sync";
import { getNote, type Note } from "../api/notes";
import {
  getCachedNotes,
  getQueuedOperations,
  removeQueuedForNote,
  removeQueuedOperation,
  replaceLocalNoteId,
  saveCachedNotes,
  updateQueuedOperation,
  type QueuedOp,
} from "../offline/queue";

export interface SyncConflict {
  operation: QueuedOp;
  mine: Note | null;
  theirs: Note;
}

const syncStorageKey = (ownerId: string) => `notez:last-sync:${ownerId}`;
const notesKey = (ownerId: string) => ["notes", ownerId] as const;
const noteKey = (ownerId: string, noteId: string) => ["notes", ownerId, noteId] as const;

export function useOfflineSync(ownerId?: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const running = useRef(false);
  const rerunRequested = useRef(false);
  const conflictBlocked = useRef(false);
  const activeOwner = useRef(ownerId);

  const sync = useCallback(async () => {
    if (!ownerId || !navigator.onLine || conflictBlocked.current) return;
    const syncLocked = async () => {
      if (running.current) {
        rerunRequested.current = true;
        return;
      }

      running.current = true;
      setSyncing(true);
      setSyncError("");
      try {
      do {
        rerunRequested.current = false;
        if (!navigator.onLine) break;

        const since = localStorage.getItem(syncStorageKey(ownerId)) ?? new Date(0).toISOString();
        const cached = queryClient.getQueryData<Note[]>(notesKey(ownerId)) ?? await getCachedNotes(ownerId) ?? [];
        const operations = await getQueuedOperations(ownerId);
        const queuedNoteIds = new Set(operations.flatMap((operation) => {
          if (operation.op === "create") return [operation.clientId];
          return operation.noteId ? [operation.noteId] : [];
        }));
        const delta = await fetchSyncDelta(since);
        const notes = new Map(cached.map((note) => [note.id, note]));

        for (const item of delta.items) {
          if (queuedNoteIds.has(item.id)) continue;
          if (item.deleted) {
            notes.delete(item.id);
            queryClient.removeQueries({ queryKey: noteKey(ownerId, item.id) });
          } else {
            const { deleted: _deleted, ...note } = item;
            const local = notes.get(note.id);
            if (!local || Date.parse(note.updated_at) >= Date.parse(local.updated_at)) {
              notes.set(note.id, note);
              queryClient.setQueryData(noteKey(ownerId, note.id), note);
            }
          }
        }

        let currentNotes = [...notes.values()];
        queryClient.setQueryData(notesKey(ownerId), currentNotes);
        await saveCachedNotes(ownerId, currentNotes);

        let blockedByConflict = false;
        const currentVersions = new Map<string, number>();
        const missingNotes = new Set<string>();
        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index];
          if (operation.noteId && missingNotes.has(operation.noteId)) continue;
          if (!navigator.onLine) break;
          if (operation.queueId === undefined) throw new Error("A queued change is missing its storage identifier.");
          const noteId = operation.noteId;
          const localNoteId = operation.op === "create" ? operation.clientId : noteId;
          const currentLocal = localNoteId ? currentNotes.find((note) => note.id === localNoteId) : undefined;
          const version = noteId ? currentVersions.get(noteId) ?? currentLocal?.version ?? operation.version : undefined;
          const result = await applySyncOperation(operation, version, noteId);

          if (result.status === "conflict") {
            if (!noteId) throw new Error("The sync service reported a conflict without a note identifier.");
            const theirs = await getNote(noteId);
            const mine = currentNotes.find((note) => note.id === noteId) ?? null;
            conflictBlocked.current = true;
            setConflict({ operation, mine, theirs });
            blockedByConflict = true;
            break;
          }

          await removeQueuedOperation(operation.queueId, ownerId);
          if (result.status === "not_found") {
            if (noteId) {
              await removeQueuedForNote(noteId, ownerId);
              missingNotes.add(noteId);
            }
            if (localNoteId) currentNotes = currentNotes.filter((note) => note.id !== localNoteId);
            setSyncError(t("sync.noteRemoved"));
            continue;
          }

          if (operation.op === "delete") {
            if (localNoteId) {
              currentVersions.delete(localNoteId);
              currentNotes = currentNotes.filter((note) => note.id !== localNoteId);
              queryClient.removeQueries({ queryKey: noteKey(ownerId, localNoteId) });
            }
            continue;
          }

          const synced = result.note;
          if (!synced) throw new Error("The sync service confirmed a change without returning its note.");
          if (operation.op === "create") {
            await replaceLocalNoteId(operation.clientId, synced.id, ownerId);
            for (let remaining = index + 1; remaining < operations.length; remaining += 1) {
              const queued = operations[remaining];
              operations[remaining] = {
                ...queued,
                noteId: queued.noteId === operation.clientId ? synced.id : queued.noteId,
                fields: {
                  ...queued.fields,
                  parent_id: queued.fields.parent_id === operation.clientId ? synced.id : queued.fields.parent_id,
                },
              };
            }
            currentNotes = currentNotes.map((note) => {
              const parentId = note.parent_id === operation.clientId ? synced.id : note.parent_id;
              if (note.id === operation.clientId) return { ...synced, local_only: false, sync_pending: false };
              return parentId !== note.parent_id ? { ...note, parent_id: parentId } : note;
            });
            currentVersions.set(synced.id, synced.version);
            queryClient.setQueryData(noteKey(ownerId, operation.clientId), undefined);
            queryClient.setQueryData(noteKey(ownerId, synced.id), synced);
          } else {
            currentNotes = currentNotes.map((note) => note.id === synced.id ? synced : note);
            currentVersions.set(synced.id, synced.version);
            queryClient.setQueryData(noteKey(ownerId, synced.id), synced);
          }
        }

        queryClient.setQueryData(notesKey(ownerId), currentNotes);
        await saveCachedNotes(ownerId, currentNotes);
        setPendingCount((await getQueuedOperations(ownerId)).length);
        if (!blockedByConflict && navigator.onLine) {
          if (delta.next_since) localStorage.setItem(syncStorageKey(ownerId), delta.next_since);
        }
      } while (rerunRequested.current && navigator.onLine && !conflictBlocked.current);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : t("sync.syncError"));
      } finally {
        running.current = false;
        setSyncing(false);
        if (ownerId) {
          try {
            setPendingCount((await getQueuedOperations(ownerId)).length);
          } catch (error) {
            setSyncError(error instanceof Error ? error.message : t("sync.countError"));
          }
        }
        if (rerunRequested.current && navigator.onLine && !conflictBlocked.current) void sync();
      }
    };

    if (navigator.locks) {
      await navigator.locks.request(`notez-sync:${ownerId}`, syncLocked);
    } else {
      await syncLocked();
    }
  }, [conflict, ownerId, queryClient, t]);

  useEffect(() => {
    if (activeOwner.current !== ownerId) {
      activeOwner.current = ownerId;
      conflictBlocked.current = false;
      setConflict(null);
      setSyncError("");
    }
    if (!ownerId) {
      setPendingCount(0);
      return;
    }
    let active = true;
    const refreshCount = () => {
      void getQueuedOperations(ownerId).then((operations) => {
        if (active) setPendingCount(operations.length);
      }).catch((error: unknown) => {
        if (active) setSyncError(error instanceof Error ? error.message : t("sync.loadError"));
      });
    };
    const trigger = () => {
      refreshCount();
      void sync();
    };
    refreshCount();
    void sync();
    window.addEventListener("online", trigger);
    window.addEventListener("notez:queue-change", trigger);
    return () => {
      active = false;
      window.removeEventListener("online", trigger);
      window.removeEventListener("notez:queue-change", trigger);
    };
  }, [ownerId, sync, t]);

  const keepMine = useCallback(async () => {
    if (!ownerId || !conflict?.operation.queueId) return;
    await updateQueuedOperation(conflict.operation.queueId, ownerId, { version: conflict.theirs.version });
    const mine = conflict.mine
      ? { ...conflict.mine, ...conflict.operation.fields, version: conflict.theirs.version, sync_pending: true }
      : { ...conflict.theirs, ...conflict.operation.fields, sync_pending: true };
    queryClient.setQueryData(noteKey(ownerId, conflict.theirs.id), mine);
    queryClient.setQueryData<Note[]>(notesKey(ownerId), (current) =>
      current?.map((note) => note.id === mine.id ? mine : note),
    );
    conflictBlocked.current = false;
    setConflict(null);
    void sync();
  }, [conflict, ownerId, queryClient, sync]);

  const useTheirs = useCallback(async () => {
    if (!ownerId || !conflict) return;
    await removeQueuedForNote(conflict.theirs.id, ownerId);
    const notes = queryClient.getQueryData<Note[]>(notesKey(ownerId)) ?? await getCachedNotes(ownerId) ?? [];
    const updated = notes.some((note) => note.id === conflict.theirs.id)
      ? notes.map((note) => note.id === conflict.theirs.id ? conflict.theirs : note)
      : [...notes, conflict.theirs];
    queryClient.setQueryData(notesKey(ownerId), updated);
    queryClient.setQueryData(noteKey(ownerId, conflict.theirs.id), conflict.theirs);
    await saveCachedNotes(ownerId, updated);
    conflictBlocked.current = false;
    setConflict(null);
    setSyncError("");
    setPendingCount((await getQueuedOperations(ownerId)).length);
  }, [conflict, ownerId, queryClient]);

  return { conflict, keepMine, pendingCount, syncing, sync, syncError, useTheirs };
}
