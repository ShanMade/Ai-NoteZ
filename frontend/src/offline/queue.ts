import type { Note, NoteInput } from "../api/notes";
import { openSchemaDatabase } from "./idb";

export type OfflineOperation = "create" | "patch" | "delete";

export interface QueuedOp {
  queueId?: number;
  clientId: string;
  ownerId: string;
  op: OfflineOperation;
  noteId?: string;
  version?: number;
  fields: NoteInput;
  timestamp: number;
}

const DATABASE_NAME = "notez-offline";
const STORE_NAME = "ops";
const CACHE_STORE_NAME = "notes-cache";
let databasePromise: Promise<IDBDatabase> | undefined;
const queueChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("notez:offline-queue");

function announceQueueChange() {
  window.dispatchEvent(new Event("notez:queue-change"));
  queueChannel?.postMessage("changed");
}

queueChannel?.addEventListener("message", () => {
  window.dispatchEvent(new Event("notez:queue-change"));
});

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) return Promise.reject(new Error("This browser does not support offline storage."));
  if (databasePromise) return databasePromise;
  const opening = openSchemaDatabase(DATABASE_NAME, 2, [
    { name: STORE_NAME, options: { keyPath: "queueId", autoIncrement: true } },
    { name: CACHE_STORE_NAME, options: { keyPath: "ownerId" } },
  ]).then((database) => {
    database.onversionchange = () => {
      database.close();
      databasePromise = undefined;
    };
    return database;
  });
  databasePromise = opening;
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = undefined;
  });
  return opening;
}

export async function getCachedNotes(ownerId: string): Promise<Note[] | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(CACHE_STORE_NAME, "readonly")
      .objectStore(CACHE_STORE_NAME)
      .get(ownerId) as IDBRequest<{ ownerId: string; notes: Note[] } | undefined>;
    request.onsuccess = () => resolve(request.result?.notes ?? null);
    request.onerror = () => reject(request.error ?? new Error("Saved notes could not be loaded from this device."));
  });
}

export async function saveCachedNotes(ownerId: string, notes: Note[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
    transaction.objectStore(CACHE_STORE_NAME).put({ ownerId, notes });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Notes could not be saved for offline use."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline note caching was cancelled."));
  });
}

export async function enqueueOperation(operation: Omit<QueuedOp, "queueId">): Promise<QueuedOp> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    let queued: QueuedOp | undefined;
    const addOperation = () => {
      const request = store.add(operation);
      request.onsuccess = () => {
        queued = { ...operation, queueId: Number(request.result) };
      };
    };
    if (operation.op === "patch" && operation.noteId) {
      const request = store.getAll() as IDBRequest<QueuedOp[]>;
      request.onsuccess = () => {
        const latestForNote = request.result
          .filter((item) => item.ownerId === operation.ownerId && item.noteId === operation.noteId)
          .sort((left, right) => (right.queueId ?? 0) - (left.queueId ?? 0))[0];
        if (latestForNote?.op === "patch" && latestForNote.queueId !== undefined) {
          queued = {
            ...latestForNote,
            fields: { ...latestForNote.fields, ...operation.fields },
            timestamp: operation.timestamp,
          };
          store.put(queued);
        } else {
          addOperation();
        }
      };
    } else {
      addOperation();
    }
    transaction.oncomplete = () => {
      if (!queued) {
        reject(new Error("The offline operation was not stored."));
        return;
      }
      announceQueueChange();
      resolve(queued);
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("The offline operation could not be stored."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The offline operation was cancelled."));
  });
}

export async function getQueuedOperations(ownerId: string): Promise<QueuedOp[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const collected: QueuedOp[] = [];
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(collected.sort((left, right) => (left.queueId ?? 0) - (right.queueId ?? 0)));
        return;
      }
      const value = cursor.value as QueuedOp;
      // Records written by older schemas may have an out-of-line key and no queueId field.
      // The record key is then the only identifier, so use it to keep these changes syncable.
      const queueId = typeof value.queueId === "number"
        ? value.queueId
        : typeof cursor.primaryKey === "number" ? cursor.primaryKey : undefined;
      if (value.ownerId === ownerId) collected.push({ ...value, queueId });
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Offline operations could not be loaded."));
  });
}

export async function updateQueuedOperation(queueId: number, ownerId: string, patch: Partial<QueuedOp>): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(queueId) as IDBRequest<QueuedOp | undefined>;
    request.onsuccess = () => {
      if (!request.result || request.result.ownerId !== ownerId) {
        transaction.abort();
        reject(new Error("The queued offline change is unavailable."));
        return;
      }
      store.put({ ...request.result, ...patch, queueId });
    };
    transaction.oncomplete = () => {
      announceQueueChange();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("The offline change could not be updated."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The offline change was cancelled."));
  });
}

export async function removeQueuedOperation(queueId: number, ownerId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(queueId) as IDBRequest<QueuedOp | undefined>;
    request.onsuccess = () => {
      if (!request.result || request.result.ownerId !== ownerId) {
        transaction.abort();
        reject(new Error("The queued offline change is unavailable."));
        return;
      }
      store.delete(queueId);
    };
    transaction.oncomplete = () => {
      announceQueueChange();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("The synced change could not be removed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The synced change removal was cancelled."));
  });
}

export async function removeQueuedForNote(noteId: string, ownerId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll() as IDBRequest<QueuedOp[]>;
    request.onsuccess = () => {
      for (const operation of request.result) {
        if (operation.ownerId === ownerId && (operation.noteId === noteId || (operation.op === "create" && operation.clientId === noteId))) {
          if (operation.queueId !== undefined) store.delete(operation.queueId);
        }
      }
    };
    transaction.oncomplete = () => {
      announceQueueChange();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline changes could not be discarded."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline changes could not be discarded."));
  });
}

export async function mergeIntoQueuedCreate(noteId: string, ownerId: string, fields: NoteInput): Promise<boolean> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll() as IDBRequest<QueuedOp[]>;
    let merged = false;
    request.onsuccess = () => {
      const create = request.result.find((operation) => operation.ownerId === ownerId && operation.op === "create" && operation.clientId === noteId);
      if (create?.queueId !== undefined) {
        store.put({ ...create, fields: { ...create.fields, ...fields } });
        merged = true;
      }
    };
    transaction.oncomplete = () => {
      if (merged) announceQueueChange();
      resolve(merged);
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("The queued note could not be updated."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The queued note update was cancelled."));
  });
}

export async function replaceLocalNoteId(localId: string, serverId: string, ownerId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll() as IDBRequest<QueuedOp[]>;
    request.onsuccess = () => {
      for (const operation of request.result) {
        if (operation.ownerId !== ownerId) continue;
        const noteId = operation.noteId === localId ? serverId : operation.noteId;
        const parentId = operation.fields.parent_id === localId ? serverId : operation.fields.parent_id;
        if (noteId !== operation.noteId || parentId !== operation.fields.parent_id) {
          if (operation.queueId !== undefined) {
            store.put({ ...operation, noteId, fields: { ...operation.fields, parent_id: parentId } });
          }
        }
      }
    };
    transaction.oncomplete = () => {
      announceQueueChange();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("Queued note references could not be updated."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Queued note references could not be updated."));
  });
}
