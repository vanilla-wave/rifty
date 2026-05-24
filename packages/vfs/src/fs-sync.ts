/**
 * Sync-side counterpart of {@link Vfs}. Implementations:
 *   - {@link MemoryFsSync} — in-memory, backed by a shared `MemoryBackend`
 *     (ADR-0014).
 *   - {@link OpfsFsSync} — OPFS via `FileSystemSyncAccessHandle`, Worker
 *     realm only (ADR-0013).
 *
 * Kept in its own module so backend implementations and the swap-in
 * registry (`sync-mirror.ts`) don't import each other.
 */
export interface FsSync {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  readdirSync(path: string): readonly string[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number };
}
