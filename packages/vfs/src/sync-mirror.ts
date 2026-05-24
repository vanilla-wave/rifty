/**
 * Synchronous mirror of a VFS — needed by `fs.readFileSync` and friends.
 *
 * Per ADR-0014, the sync view ({@link MemoryFsSync}) and the async view
 * ({@link MemoryVfs}) bind to a shared {@link MemoryBackend} so writes
 * through one are visible through the other. Use {@link createMemoryFs} to
 * construct a paired set, and {@link installMemoryFs} to register both as
 * the active runtime mirror in one call.
 *
 * For OPFS in a Worker the `FileSystemSyncAccessHandle` API gives true sync
 * semantics; that backend lives in `OpfsFsSync` (ADR-0013). This module is
 * the seam that lets us swap implementations behind the same interface.
 */

import type { FsSync } from './fs-sync.ts';
import { MemoryBackend } from './memory-backend.ts';
import { MemoryVfs } from './memory.ts';
import { OpfsFsSync } from './opfs-sync.ts';
import { OpfsVfs } from './opfs.ts';
import { joinPath } from './path.ts';
import type { Vfs } from './types.ts';

export type { FsSync };

export class MemoryFsSync implements FsSync {
  readonly backend: MemoryBackend;

  constructor(backend?: MemoryBackend) {
    this.backend = backend ?? new MemoryBackend();
  }

  existsSync(path: string): boolean {
    return this.backend.exists(path);
  }

  readFileBytesSync(path: string): Uint8Array {
    return this.backend.readFile(path);
  }

  writeFileSync(path: string, data: Uint8Array): void {
    this.backend.writeFile(path, data);
  }

  readdirSync(path: string): readonly string[] {
    return this.backend.readdir(path);
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.backend.mkdir(path, options);
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.backend.rm(path, options);
  }

  statSync(path: string) {
    return this.backend.stat(path);
  }

  loadFixture(files: Readonly<Record<string, string>>): void {
    const enc = new TextEncoder();
    for (const [path, content] of Object.entries(files)) {
      const dir = path.slice(0, path.lastIndexOf('/')) || '/';
      this.backend.mkdir(dir, { recursive: true });
      this.backend.writeFile(path, enc.encode(content));
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
 * Async view paired with {@link syncMirror}. Modules that need true streaming
 * (e.g. `fs.createReadStream` on top of `Vfs.openReadable`) reach for this.
 * When unset (no paired async installed) callers should construct a
 * one-shot adapter — but in normal operation {@link installMemoryFs} or
 * {@link setAsyncVfs} is called at runtime boot to wire both surfaces.
 */
export function asyncVfs(): Vfs | null {
  return activeAsync;
}

/** Install a paired set in one call (ADR-0014). */
export function installMemoryFs(): MemoryBackend {
  const { vfs, fsSync, backend } = createMemoryFs();
  activeSync = fsSync;
  activeAsync = vfs;
  return backend;
}

/**
 * Install OPFS as both the async {@link Vfs} surface and the sync
 * {@link FsSync} surface (ADR-0013). Must be called from a Worker realm
 * where `FileSystemSyncAccessHandle` is available. After this call,
 * `syncMirror()` returns an `OpfsFsSync` and `asyncVfs()` returns the
 * paired `OpfsVfs`.
 *
 * Note: `setSyncMirror` with a non-`MemoryFsSync` clears the auto-paired
 * async view, so this helper explicitly calls `setAsyncVfs` to wire the
 * OPFS async side.
 */
export async function installOpfsFs(): Promise<{ vfs: OpfsVfs; fsSync: OpfsFsSync }> {
  const vfs = new OpfsVfs();
  await vfs.init();
  const fsSync = await OpfsFsSync.init();
  setSyncMirror(fsSync);
  setAsyncVfs(vfs);
  return { vfs, fsSync };
}

export function resetSyncMirror(): void {
  const fresh = new MemoryFsSync();
  activeSync = fresh;
  activeAsync = new MemoryVfs(fresh.backend);
}

export function setSyncMirror(impl: FsSync): void {
  activeSync = impl;
  // If the new sync impl is a MemoryFsSync we can pair its backend
  // automatically; otherwise the caller may set the async view via
  // setAsyncVfs separately.
  if (impl instanceof MemoryFsSync) {
    activeAsync = new MemoryVfs(impl.backend);
  } else {
    activeAsync = null;
  }
}

export function setAsyncVfs(vfs: Vfs): void {
  activeAsync = vfs;
}

export { joinPath };
