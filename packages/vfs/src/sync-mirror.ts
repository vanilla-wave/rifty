/**
 * Synchronous mirror of a VFS — needed by `fs.readFileSync` and friends.
 *
 * Per ADR-0014, the sync view ({@link MemoryFsSync}) and async view
 * ({@link MemoryVfs}) bind to a shared {@link MemoryBackend} so writes through
 * one are visible through the other. {@link createMemoryFs} builds a paired
 * set; {@link installMemoryFs} registers both as the runtime mirror at once.
 *
 * OPFS in a Worker gives true sync semantics via `FileSystemSyncAccessHandle`;
 * that backend is `OpfsFsSync` (ADR-0013). This module is the seam for
 * swapping implementations behind one interface.
 *
 * Wrapper classes keep their backend private; pairing flows through
 * `createMemoryFs()` or `setSyncMirror(impl, { async })`, never by reaching
 * into an instance for a backend.
 */

import type { FsSync } from './fs-sync.ts';
import { MemoryBackend } from './memory-backend.ts';
import { MemoryVfs } from './memory.ts';
import { OpfsFsSync } from './opfs-sync.ts';
import { OpfsVfs } from './opfs.ts';
import { joinPath, normalizeAbsolute } from './path.ts';
import type { Vfs, VfsDirent } from './types.ts';

export type { FsSync };

export class MemoryFsSync implements FsSync {
  readonly #backend: MemoryBackend;

  constructor(backend?: MemoryBackend) {
    this.#backend = backend ?? new MemoryBackend();
  }

  existsSync(path: string): boolean {
    return this.#backend.exists(normalizeAbsolute(path));
  }

  readFileBytesSync(path: string): Uint8Array {
    return this.#backend.readFile(normalizeAbsolute(path));
  }

  writeFileSync(path: string, data: Uint8Array): void {
    this.#backend.writeFile(normalizeAbsolute(path), data);
  }

  readdirSync(path: string): readonly VfsDirent[] {
    return this.#backend.readdirEntries(normalizeAbsolute(path));
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.#backend.mkdir(normalizeAbsolute(path), options);
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.#backend.rm(normalizeAbsolute(path), options);
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    return this.#backend.stat(normalizeAbsolute(path));
  }

  statSyncOrNull(
    path: string,
  ): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } | null {
    // One normalize, no throw: exists() gates stat() so a miss returns null
    // (ADR-0083). The wrapper's statSync normalizes twice (here + via exists);
    // this path normalizes once.
    const np = normalizeAbsolute(path);
    return this.#backend.exists(np) ? this.#backend.stat(np) : null;
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.#backend.utimes(normalizeAbsolute(path), atimeMs, mtimeMs);
  }

  loadFixture(files: Readonly<Record<string, string>>): void {
    const enc = new TextEncoder();
    for (const [path, content] of Object.entries(files)) {
      const dir = path.slice(0, path.lastIndexOf('/')) || '/';
      this.#backend.mkdir(dir, { recursive: true });
      this.#backend.writeFile(path, enc.encode(content));
    }
  }
}

/** Construct a paired async + sync VFS sharing one in-memory backend. */
export function createMemoryFs(): { vfs: MemoryVfs; fsSync: MemoryFsSync; backend: MemoryBackend } {
  const backend = new MemoryBackend();
  return { vfs: new MemoryVfs(backend), fsSync: new MemoryFsSync(backend), backend };
}

let activeSync: FsSync & { loadFixture?(files: Readonly<Record<string, string>>): void } =
  new MemoryFsSync();
let activeAsync: Vfs | null = null;

export function syncMirror(): FsSync & {
  loadFixture?(files: Readonly<Record<string, string>>): void;
} {
  return activeSync;
}

/**
 * Async view paired with {@link syncMirror}, used by modules needing true
 * streaming (e.g. `fs.createReadStream` over `Vfs.openReadable`). Null when no
 * paired async is installed — callers then build a one-shot adapter; normally
 * {@link installMemoryFs}/{@link setAsyncVfs} wires both surfaces at boot.
 */
export function asyncVfs(): Vfs | null {
  return activeAsync;
}

/** Install a paired set in one call (ADR-0014). */
export function installMemoryFs(): MemoryBackend {
  const { vfs, fsSync, backend } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  return backend;
}

/**
 * Install OPFS as both the async {@link Vfs} surface and the sync
 * {@link FsSync} surface (ADR-0013). Must be called from a Worker realm
 * where `FileSystemSyncAccessHandle` is available. After this call,
 * `syncMirror()` returns an `OpfsFsSync` and `asyncVfs()` returns the
 * paired `OpfsVfs`.
 */
export async function installOpfsFs(): Promise<{ vfs: OpfsVfs; fsSync: OpfsFsSync }> {
  const vfs = new OpfsVfs();
  await vfs.init();
  // Pair the async surface into the sync mirror (ADR-0072) so write-through
  // and boot preload route through OPFS. Passing the structural
  // `PairedAsyncSurface` (which `OpfsVfs` satisfies) avoids a reverse import of
  // `OpfsVfs` into `opfs-sync.ts`.
  const fsSync = await OpfsFsSync.init(vfs);
  setSyncMirror(fsSync, { async: vfs });
  return { vfs, fsSync };
}

export function resetSyncMirror(): void {
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
}

/**
 * Install `impl` as the active sync mirror. The paired async surface is
 * explicit — callers wire both at the same call site rather than letting the
 * registry sniff at the implementation. Omitting `options.async` clears the
 * async surface; pass `{ async }` to install the matching async view.
 *
 * Explicit pairing is why wrappers need no public `.backend` back-channel.
 */
export function setSyncMirror(impl: FsSync, options: { async?: Vfs } = {}): void {
  activeSync = impl;
  activeAsync = options.async ?? null;
}

export function setAsyncVfs(vfs: Vfs): void {
  activeAsync = vfs;
}

export { joinPath };
