export interface JournalSlice {
  sessionId_slot_seq: string;
  sessionId: string;
  slot: number;
  seq: number;
  blob: Blob;
  committedAt: number;
}

export interface JournalPart {
  sessionId_index: string;
  sessionId: string;
  index: number;
  fromSeq: number;
  toSeq: number;
  blob: Blob;
  isEmpty: boolean;
  createdAt: number;
}

export interface JournalSession {
  sessionId: string;
  noteId: string;
  nextSequence: number;
  nextPartIndex: number;
  configuredInterval: 20 | 30 | 40;
  elapsedMs?: number;
  startedAt: number;
  updatedAt: number;
  status: "recording" | "stopped" | "finished";
}

export type JobStatus = "queued" | "uploading" | "done" | "failed";

export interface UploadJob {
  sessionId_index: string;
  sessionId: string;
  index: number;
  blob: Blob;
  fileName: string;
  isEmpty: boolean;
  attempts: number;
  nextAttemptAt: number;
  status: JobStatus;
  error?: string;
}

type StoreName = "slices" | "parts" | "sessions" | "jobs";
const DATABASE_NAME = "notez-rec-journal";
const DATABASE_VERSION = 1;
const COMMIT_TIMEOUT_MS = 5000;

export class RecordingJournal {
  degraded = false;
  private database?: IDBDatabase;
  private opening?: Promise<IDBDatabase | null>;
  private readonly memory = new Map<StoreName, Map<string, unknown>>([
    ["slices", new Map()],
    ["parts", new Map()],
    ["sessions", new Map()],
    ["jobs", new Map()],
  ]);

  private open(): Promise<IDBDatabase | null> {
    if (this.database) return Promise.resolve(this.database);
    if (this.opening) return this.opening;
    this.opening = this.tryOpenTwice().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  private async tryOpenTwice(): Promise<IDBDatabase | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const database = await this.openOnce();
        database.onversionchange = () => {
          database.close();
          this.database = undefined;
        };
        this.database = database;
        return database;
      } catch {
        if (attempt === 1) {
          this.degraded = true;
          return null;
        }
      }
    }
    this.degraded = true;
    return null;
  }

  private openOnce(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("slices")) {
          database.createObjectStore("slices", { keyPath: "sessionId_slot_seq" });
        }
        if (!database.objectStoreNames.contains("parts")) {
          database.createObjectStore("parts", { keyPath: "sessionId_index" });
        }
        if (!database.objectStoreNames.contains("sessions")) {
          database.createObjectStore("sessions", { keyPath: "sessionId" });
        }
        if (!database.objectStoreNames.contains("jobs")) {
          database.createObjectStore("jobs", { keyPath: "sessionId_index" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open the recording journal."));
      request.onblocked = () => reject(new Error("The recording journal is blocked by another tab."));
    });
  }

  private async transact<T>(
    storeName: StoreName,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    if (!database) throw new Error("Recording journal is using in-memory-only storage.");
    return new Promise((resolve, reject) => {
      let requestResult: T;
      let settled = false;
      const transaction = database.transaction(storeName, mode);
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        transaction.abort();
        reject(new Error("Recording journal commit exceeded 5 seconds."));
      }, COMMIT_TIMEOUT_MS);
      const request = work(transaction.objectStore(storeName));
      request.onsuccess = () => {
        requestResult = request.result;
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(request.error ?? new Error("Recording journal transaction failed."));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(requestResult);
      };
      transaction.onabort = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(transaction.error ?? new Error("Recording journal transaction was aborted."));
      };
      transaction.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(transaction.error ?? new Error("Recording journal transaction failed."));
      };
    });
  }

  private async put<T extends object>(store: StoreName, key: string, value: T): Promise<void> {
    const database = await this.open();
    if (!database) {
      this.memory.get(store)?.set(key, value);
      return;
    }
    await this.transact(store, "readwrite", (objectStore) => objectStore.put(value));
  }

  private async all<T>(store: StoreName): Promise<T[]> {
    const database = await this.open();
    if (!database) return [...(this.memory.get(store)?.values() ?? [])] as T[];
    return this.transact(store, "readonly", (objectStore) => objectStore.getAll()) as Promise<T[]>;
  }

  async writeSlice(slice: Omit<JournalSlice, "committedAt">): Promise<void> {
    await this.put("slices", slice.sessionId_slot_seq, { ...slice, committedAt: Date.now() });
  }

  async readSlices(sessionId: string, slot: number, fromSeq: number, toSeq: number): Promise<JournalSlice[]> {
    const slices = await this.all<JournalSlice>("slices");
    return slices
      .filter((slice) => slice.sessionId === sessionId && slice.slot === slot && slice.seq >= fromSeq && slice.seq <= toSeq)
      .sort((left, right) => left.seq - right.seq);
  }

  async writePart(part: Omit<JournalPart, "createdAt">): Promise<void> {
    await this.put("parts", part.sessionId_index, { ...part, createdAt: Date.now() });
  }

  async saveSession(session: JournalSession): Promise<void> {
    await this.put("sessions", session.sessionId, session);
  }

  async getSession(sessionId: string): Promise<JournalSession | undefined> {
    const sessions = await this.all<JournalSession>("sessions");
    return sessions.find((session) => session.sessionId === sessionId);
  }

  async listSessions(): Promise<JournalSession[]> {
    return (await this.all<JournalSession>("sessions")).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async saveJob(job: UploadJob): Promise<void> {
    await this.put("jobs", job.sessionId_index, job);
  }

  async getJob(sessionId: string, index: number): Promise<UploadJob | undefined> {
    return (await this.getJobs(sessionId)).find((job) => job.index === index);
  }

  async getJobs(sessionId?: string): Promise<UploadJob[]> {
    const jobs = await this.all<UploadJob>("jobs");
    return jobs
      .filter((job) => sessionId === undefined || job.sessionId === sessionId)
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.index - right.index);
  }

  async removeJob(sessionId: string, index: number): Promise<void> {
    const database = await this.open();
    const key = `${sessionId}_${index}`;
    if (!database) {
      this.memory.get("jobs")?.delete(key);
      return;
    }
    await this.transact("jobs", "readwrite", (objectStore) => objectStore.delete(key));
  }
}

export const recordingJournal = new RecordingJournal();
