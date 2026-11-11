/** "Load folder..." uses the File System Access API (Chrome/Edge) when
 * available, falling back to a plain <input webkitdirectory> picker
 * (Firefox/Safari) - see handlePickFolder/handleFolderUpload in App.tsx.
 * Nothing about the chosen folder is remembered between sessions: each
 * click opens a fresh native picker, since the browser would force a
 * permission re-prompt on reload anyway, so persisting the handle bought
 * nothing but an extra button. */

export const directoryPickerSupported =
  typeof window !== "undefined" && "showDirectoryPicker" in window;

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
