const DRAFT_DB_NAME = "minecraft-mods-localizer";
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE_NAME = "drafts";
const SNAPSHOT_KEY = "snapshot";
const MOD_FILES_KEY = "modFiles";
const LOCAL_STORAGE_SNAPSHOT_KEY = "minecraft-mods-localizer.browserDraft";
const BROWSER_DRAFT_SCHEMA_VERSION = 1;

export interface SavedBrowserDraftSnapshot<T> {
  schemaVersion: 1;
  savedAt: string;
  data: T;
}

interface SavedModFiles {
  schemaVersion: 1;
  savedAt: string;
  files: File[];
}

export async function readBrowserDraftSnapshot<T>(): Promise<SavedBrowserDraftSnapshot<T> | null> {
  try {
    const draft = await getDraftRecord<SavedBrowserDraftSnapshot<T>>(SNAPSHOT_KEY);
    if (draft?.schemaVersion === BROWSER_DRAFT_SCHEMA_VERSION) {
      return draft;
    }
  } catch {
    // Fall back to localStorage below.
  }
  return readLocalStorageSnapshot<T>();
}

export async function writeBrowserDraftSnapshot<T>(data: T): Promise<void> {
  const draft: SavedBrowserDraftSnapshot<T> = {
    schemaVersion: BROWSER_DRAFT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  };

  try {
    await putDraftRecord(SNAPSHOT_KEY, draft);
    return;
  } catch {
    writeLocalStorageSnapshot(draft);
  }
}

export async function readBrowserDraftModFiles(): Promise<File[]> {
  try {
    const draft = await getDraftRecord<SavedModFiles>(MOD_FILES_KEY);
    if (draft?.schemaVersion === BROWSER_DRAFT_SCHEMA_VERSION && Array.isArray(draft.files)) {
      return draft.files.filter((file): file is File => file instanceof File);
    }
  } catch {
    // Without IndexedDB we cannot restore File objects.
  }
  return [];
}

export async function writeBrowserDraftModFiles(files: File[]): Promise<void> {
  const draft: SavedModFiles = {
    schemaVersion: BROWSER_DRAFT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    files,
  };
  await putDraftRecord(MOD_FILES_KEY, draft);
}

export async function clearBrowserDraftModFiles(): Promise<void> {
  try {
    await deleteDraftRecord(MOD_FILES_KEY);
  } catch (error) {
    if (error instanceof Error && error.message === "IndexedDB is not available.") {
      return;
    }
    throw error;
  }
}

async function getDraftRecord<T>(key: string): Promise<T | null> {
  const database = await openDraftDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE_NAME, "readonly");
      const request = transaction.objectStore(DRAFT_STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read browser draft."));
    });
  } finally {
    database.close();
  }
}

async function putDraftRecord<T>(key: string, value: T): Promise<void> {
  const database = await openDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(DRAFT_STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save browser draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Browser draft save was aborted."));
    });
  } finally {
    database.close();
  }
}

async function deleteDraftRecord(key: string): Promise<void> {
  const database = await openDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(DRAFT_STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear browser draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Browser draft clear was aborted."));
    });
  } finally {
    database.close();
  }
}

function openDraftDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser draft database."));
  });
}

function readLocalStorageSnapshot<T>(): SavedBrowserDraftSnapshot<T> | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(LOCAL_STORAGE_SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }
  const draft = JSON.parse(raw) as SavedBrowserDraftSnapshot<T>;
  return draft.schemaVersion === BROWSER_DRAFT_SCHEMA_VERSION ? draft : null;
}

function writeLocalStorageSnapshot<T>(draft: SavedBrowserDraftSnapshot<T>): void {
  if (typeof localStorage === "undefined") {
    throw new Error("Browser storage is not available.");
  }
  localStorage.setItem(LOCAL_STORAGE_SNAPSHOT_KEY, JSON.stringify(draft));
}
