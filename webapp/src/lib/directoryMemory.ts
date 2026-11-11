/** Lets "Load folder..." remember which folder you picked last time, using
 * the File System Access API (Chrome/Edge only - Safari/Firefox don't
 * support it, so callers must feature-detect with `directoryPickerSupported`
 * and fall back to a plain <input webkitdirectory> picker, which can't be
 * remembered across reloads). The directory *handle* persists in IndexedDB;
 * the browser still re-prompts for permission once per session, but the
 * user never has to browse to the folder again. Nothing in the handle or
 * its contents ever leaves the browser. */

// TS's bundled lib.dom.d.ts has FileSystemDirectoryHandle but not the
// permission-querying methods (a separate, newer part of the spec).
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }
  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
}

export const directoryPickerSupported =
  typeof window !== "undefined" && "showDirectoryPicker" in window;

const DB_NAME = "trackplotter";
const STORE_NAME = "handles";
const KEY = "lastDirectory";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRememberedDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function forgetDirectory(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Checks (and if needed, prompts for) read permission on a remembered
 * handle - required every session even though the handle itself persists. */
export async function verifyReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "read" as const };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Recursively walks a directory handle into a flat list of Files. */
export async function collectFiles(dirHandle: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  async function walk(handle: FileSystemDirectoryHandle) {
    for await (const entry of handle.values()) {
      if (entry.kind === "file") {
        files.push(await (entry as FileSystemFileHandle).getFile());
      } else if (entry.kind === "directory") {
        await walk(entry as FileSystemDirectoryHandle);
      }
    }
  }
  await walk(dirHandle);
  return files;
}
