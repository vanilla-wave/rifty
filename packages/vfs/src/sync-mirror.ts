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
 *
 * The wrapper classes (`MemoryVfs`, `MemoryFsSync`) keep their backend
 * private — pairing across surfaces flows through `createMemoryFs()` or via
 * `setSyncMirror(impl, { async })`; nothing here reaches into a class
 * instance to find a backend.
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
  const fsSync = await OpfsFsSync.init();
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
 * async surface; pass `{ async }` to install the matching async view in the
 * same step.
 *
 * The `instanceof MemoryFsSync` branch that this replaced was the only
 * back-channel that needed a public `.backend` field on the wrapper; with
 * pairing made explicit at the call site the field is gone.
 */
export function setSyncMirror(impl: FsSync, options: { async?: Vfs } = {}): void {
  activeSync = impl;
  activeAsync = options.async ?? null;
}

export function setAsyncVfs(vfs: Vfs): void {
  activeAsync = vfs;
}

export { joinPath };
