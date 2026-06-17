/**
 * File-manager mutations over the sync VFS mirror (ADR-0075), factored out of
 * {@link ../components/FileExplorer.tsx | FileExplorer} so the tricky bits —
 * recursive `copyTree`, rename (no native `renameSync` on `FsSync`), collision
 * guards — are unit-testable against a fake target with no DOM.
 *
 * Every op uses the SAME sync mirror the runtime/shell read, so changes are
 * visible immediately. Collisions throw (never a silent overwrite); directory
 * rename is a real recursive copy + remove (no silent stub).
 */
import type { VfsDirent } from '@riftydev/vfs';
import { dirname, joinPath } from '@riftydev/vfs';

/** The narrow slice of `FsSync` these ops need (so a test fake stays small). */
export interface FsOpsTarget {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  readdirSync(path: string): readonly VfsDirent[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number };
  /**
   * When true the target is a read-only view (e.g. the real-vite worker
   * project mirror, ADR-0076): mutations throw, and the editor opens its files
   * read-only. Absent/false on the writable sync mirror.
   */
  readonly readOnly?: boolean;
  /**
   * Owner-snapshot targets ({@link ./snapshot-fs.ts}) notify on every applied
   * frame so a reader can retry a path a just-seeded owner write has not yet
   * reflected (editor seeded-file-editable retry). Returns an unsubscribe.
   * Absent on the plain sync mirror (no async publish to await).
   */
  subscribe?(listener: () => void): () => void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Create `path` (recursively) as a directory. */
export function ensureDir(fs: FsOpsTarget, path: string): void {
  fs.mkdirSync(path, { recursive: true });
}

/** Write text to `path`, creating parent dirs. */
export function writeText(fs: FsOpsTarget, path: string, text: string): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, enc.encode(text));
}

/** Read `path` as UTF-8 text. */
export function readText(fs: FsOpsTarget, path: string): string {
  return dec.decode(fs.readFileBytesSync(path));
}

/** Create an empty file. Throws if `path` already exists. */
export function createFile(fs: FsOpsTarget, path: string): void {
  if (fs.existsSync(path)) throw new Error(`"${path}" already exists`);
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, new Uint8Array());
}

/** Create a directory. Throws if `path` already exists. */
export function createDir(fs: FsOpsTarget, path: string): void {
  if (fs.existsSync(path)) throw new Error(`"${path}" already exists`);
  fs.mkdirSync(path, { recursive: true });
}

/** Delete a file or directory (recursive, force). */
export function deletePath(fs: FsOpsTarget, path: string): void {
  fs.rmSync(path, { recursive: true, force: true });
}

/**
 * Recursively copy `from` → `to`. Files copy their bytes; directories are
 * recreated and their children copied. `FsSync` has no `renameSync`, so this is
 * the honest primitive behind {@link renamePath}.
 *
 * TODO(backlog: vfs/native-renamesync)
 */
export function copyTree(fs: FsOpsTarget, from: string, to: string): void {
  const st = fs.statSync(from);
  if (st.isDirectory) {
    fs.mkdirSync(to, { recursive: true });
    for (const child of fs.readdirSync(from)) {
      copyTree(fs, joinPath(from, child.name), joinPath(to, child.name));
    }
  } else {
    fs.mkdirSync(dirname(to), { recursive: true });
    fs.writeFileSync(to, fs.readFileBytesSync(from));
  }
}

/** Rename/move `from` → `to` (copy then remove). Throws if `to` already exists. */
export function renamePath(fs: FsOpsTarget, from: string, to: string): void {
  if (from === to) return;
  if (fs.existsSync(to)) throw new Error(`"${to}" already exists`);
  copyTree(fs, from, to);
  fs.rmSync(from, { recursive: true, force: true });
}

/** Heuristic binary sniff: a NUL byte in the first 8 KB. TODO(backlog: playground/binary-file-content-type-detection) */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
