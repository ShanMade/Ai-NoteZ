export interface StoreSpec {
  name: string;
  options: IDBObjectStoreParameters;
}

const MAX_SCHEMA_ATTEMPTS = 4;

/**
 * Opens an IndexedDB database and guarantees that every required object store exists.
 *
 * `onupgradeneeded` only runs when the requested version is higher than the stored one. A
 * database that was already created at this version by an older build (without a store added
 * later) would otherwise stay broken, and every transaction on the missing store throws
 * `NotFoundError`. When a store is missing, this bumps the version and creates it.
 */
export function openSchemaDatabase(name: string, version: number, stores: StoreSpec[], attempt = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support offline storage."));
      return;
    }
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of stores) {
        if (!database.objectStoreNames.contains(store.name)) {
          database.createObjectStore(store.name, store.options);
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      const missing = stores.some((store) => !database.objectStoreNames.contains(store.name));
      if (!missing) {
        resolve(database);
        return;
      }
      const nextVersion = database.version + 1;
      database.close();
      if (attempt >= MAX_SCHEMA_ATTEMPTS) {
        reject(new Error(`Local storage in "${name}" is missing a required table and could not be repaired.`));
        return;
      }
      openSchemaDatabase(name, nextVersion, stores, attempt + 1).then(resolve, reject);
    };
    request.onerror = () => reject(request.error ?? new Error(`Local storage "${name}" could not be opened.`));
    request.onblocked = () => reject(new Error(`Local storage "${name}" is waiting for another tab to close.`));
  });
}
