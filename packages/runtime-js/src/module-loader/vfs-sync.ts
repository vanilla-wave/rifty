/**
 * Synchronous view over a VFS. CJS resolution and execution are synchronous in
 * Node, so we need a sync wrapper. The Memory backend is genuinely sync under
 * the hood; for OPFS-in-Worker the SyncAccessHandle API supports this too.
 *
 * For now we accept an explicit sync interface so the implementation is
 * testable against any backend that can answer synchronously.
 */
export interface SyncVfs {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
  readFileBytesSync(path: string): Uint8Array;
  statSync(path: string): { isFile: boolean; isDirectory: boolean };
  readdirSync(path: string): readonly string[];
}
