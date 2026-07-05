/// <reference lib="webworker" />
/**
 * `OpfsFsSync` — synchronous {@link FsSync} backed by OPFS via
 * `FileSystemSyncAccessHandle` (ADR-0013). Worker realm only; main-thread
 * construction throws `NotImplementedError`.
 *
 * Scope: all seven `FsSync` methods are implemented. File **content** I/O
 * goes through a synchronous in-memory content cache with async OPFS
 * write-through (ADR-0072): `writeFileSync` updates the cache immediately
 * and enqueues an async `OpfsVfs.writeFile`; `readFileBytesSync` serves the
 * cache, which {@link init} preloads from OPFS at boot so reads after a page
 * reload return the persisted bytes synchronously. This replaces the earlier
 * `FileSystemSyncAccessHandle`-on-the-hot-path design (ADR-0013), which
 * couldn't service a sync read/write on a brand-new path without an async
 * handle open mid-call. The handle machinery (`openSync`/`ensureHandle`) is
 * retained but off the read/write hot path. Callers can drain the
 * write-through deterministically via {@link flush} before a reload.
 *
 * Directory-shape ops (`readdirSync`, `mkdirSync`, `rmSync`, `renameSync`)
 * read/write an in-memory directory tree mirror that is **seeded** at boot
 * from the OPFS root and kept in sync as the page runs. Persistence of
 * directory-shape mutations back to OPFS happens via async helpers
 * (`getDirectoryHandle`/`removeEntry`) tracked in the same `flush` queue; if
 * the page is closed before a flush completes, the on-disk tree is slightly
 * behind the in-memory mirror — acceptable for a dev runtime.
 *
 * Warm index (ADR-0014): {@link init} walks the OPFS tree and caches
 * `{ kind, size, children? }` so `existsSync`/`statSync`/`readdirSync`
 * see the same tree the async {@link OpfsVfs} sees. `writeFileSync`
 * mutates the cache in place; async writes through the paired async
 * surface make it stale until {@link refreshIndex} is called.
 *
 * Handle lifecycle: a `Map<path, FileSystemSyncAccessHandle>` opens
 * lazily on `openSync(path)` and is reused (browsers serialise handle
 * access). No cross-instance eviction — Worker owns its filesystem
 * view for life.
 *
 * atime/mtime side-table (ADR-0029): `FileSystemSyncAccessHandle`
 * exposes no mtime mutation; `utimes` records into an in-memory map and
 * `statSync` prefers it over the default `0`. Not persisted across page
 * reloads.
 */

import { NotImplementedError, VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import {
  basename,
  basenameNormalized,
  dirname,
  dirnameNormalized,
  normalizePath,
  segments,
} from './path.ts';
import type { VfsDirent } from './types.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

interface IndexEntry {
  readonly kind: 'file' | 'dir';
  /** Last-known size in bytes (files only; `0` for dirs). */
  size: number;
  /**
   * For directories: the set of child names (one segment, no slash).
   * Maintained in lockstep with the prefix-keyed `index` map so dir-shape
   * ops are O(children) instead of O(tree). `undefined` for files.
   */
  children?: Set<string>;
  /**
   * For directories: memoised sorted dirent list (perf audit 2026-06-05).
   * Invalidated to `null` on attach/detach/removeSubtree of a child AND on a
   * per-child index.set (a child's kind/identity can flip — e.g. writeFileSync
   * over an existing name — and each dirent's isFile/isDirectory is derived
   * per-child). Cleared wholesale on refreshIndex. `null`/absent = rebuild.
   */
  sortedDirents?: readonly VfsDirent[] | null;
}

/**
 * Minimal structural view of the paired async OPFS surface
 * ({@link OpfsVfs}) that the sync mirror needs for content write-through and
 * the boot-time content preload (ADR-0072). Declared structurally — and NOT
 * by importing `OpfsVfs` — so `opfs-sync.ts` stays free of a cycle through
 * `opfs.ts` and the layering rule (no reverse import into the async backend
 * inside the sync class) holds. `OpfsVfs` already satisfies this shape.
 */
export interface PairedAsyncSurface {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

/** One path whose LAST OPFS persist attempt failed — disk lags the mirror. */
export interface PersistFailure {
  readonly path: string;
  readonly op: 'write' | 'mkdir' | 'rm' | 'rename';
  readonly message: string;
}

/** {@link OpfsFsSync.flush} result (ADR-0187 Corrected): the still-unhealed
 * persist failures. `failures` is a SAMPLE (first {@link
 * PERSIST_REPORT_SAMPLE} by ledger order); `total` is the full count —
 * `total === 0` ⇔ everything drained IS durable. Every counted path stays
 * individually healable (the ledger itself is never truncated). */
export interface PersistFailureReport {
  readonly failures: ReadonlyArray<PersistFailure>;
  readonly total: number;
}

/** Report-sample size: consumers read `failures[0]` + `total`; shipping the
 * whole ledger on every flush is waste, truncating the LEDGER (not just the
 * report) would make over-cap failures unhealable — `total` could then never
 * return to 0 after a big quota event. */
const PERSIST_REPORT_SAMPLE = 20;

/**
 * Walks an OPFS directory tree and yields `{ path, kind, size, children? }`
 * for every entry under `root`. The root itself is reported as
 * `'/' → dir`. Exported for unit tests; not part of the public surface.
 */
export async function walkOpfsTree(
  root: FileSystemDirectoryHandle,
): Promise<Map<string, IndexEntry>> {
  const out = new Map<string, IndexEntry>();
  out.set('/', { kind: 'dir', size: 0, children: new Set() });

  async function recurse(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const parentEntry = out.get(prefix);
    const parentChildren = parentEntry?.children;
    // FileSystemDirectoryHandle is async-iterable yielding [name, handle].
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      const childPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
      parentChildren?.add(name);
      if (handle.kind === 'file') {
        let size = 0;
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          size = file.size;
        } catch {
          // Keep size 0 so the entry stays discoverable; statSync surfaces
          // the real error if the file is later opened.
        }
        out.set(childPath, { kind: 'file', size });
      } else if (handle.kind === 'directory') {
        out.set(childPath, { kind: 'dir', size: 0, children: new Set() });
        await recurse(handle as FileSystemDirectoryHandle, childPath);
      }
    }
  }

  await recurse(root, '/');
  return out;
}

export class OpfsFsSync implements FsSync {
  private readonly handles = new Map<string, FileSystemSyncAccessHandle>();
  private readonly index = new Map<string, IndexEntry>();
  /** atime/mtime side-table — see file header (ADR-0029). */
  private readonly times = new Map<string, { atime: number; mtime: number }>();
  private readonly root: FileSystemDirectoryHandle;
  /**
   * Synchronous file-content cache (ADR-0072). `readFileBytesSync` /
   * `writeFileSync` operate on this map so they never need a mid-call async
   * sync-access-handle open. Seeded at boot from OPFS (see {@link init})
   * and kept authoritative as the page runs; OPFS receives the bytes via
   * async write-through.
   */
  private readonly content = new Map<string, Uint8Array>();
  /** In-flight async OPFS write-through / structural promises; drained by {@link flush}. */
  private readonly pending: Array<Promise<void>> = [];
  /** Serialises OPFS side effects so durable state follows sync call order. */
  private pendingTail: Promise<void> = Promise.resolve();
  /**
   * Paired async OPFS surface used for content write-through, content
   * preload, and durable file-bearing structural moves/deletes. `null` when
   * constructed without a pair (the unit-test path), in which case writes
   * stay in-cache only — fine, because those tests never reload a page.
   */
  private readonly asyncSurface: PairedAsyncSurface | null;

  /**
   * `true` when the current realm is a Worker that exposes
   * `FileSystemFileHandle.prototype.createSyncAccessHandle`. Always
   * `false` in the main thread (no sync OPFS API) and in Node tests
   * (no `FileSystemFileHandle` at all).
   */
  static isSupported(): boolean {
    const inWorker =
      typeof globalThis !== 'undefined' &&
      (typeof (globalThis as { importScripts?: unknown }).importScripts !== 'undefined' ||
        (typeof (globalThis as { window?: unknown }).window === 'undefined' &&
          typeof (globalThis as { document?: unknown }).document === 'undefined'));
    if (!inWorker) return false;
    const ctor = (globalThis as { FileSystemFileHandle?: { prototype?: unknown } })
      .FileSystemFileHandle;
    const proto = ctor?.prototype as { createSyncAccessHandle?: unknown } | undefined;
    return typeof proto?.createSyncAccessHandle === 'function';
  }

  /**
   * Constructs an instance bound to an already-obtained OPFS root. Use
   * {@link OpfsFsSync.init} in normal code; the constructor is exposed
   * for tests that want to inject a fake root.
   *
   * `paired` is the async OPFS surface used for content write-through and
   * the boot content preload (ADR-0072). It is optional so unit tests that
   * inject only a fake root keep compiling and behaving identically; when
   * omitted, sync writes stay in-cache only (no OPFS persistence).
   */
  constructor(root: FileSystemDirectoryHandle, paired?: PairedAsyncSurface) {
    if (!OpfsFsSync.isSupported()) {
      throw new NotImplementedError(
        'OpfsFsSync',
        'sync OPFS only available inside a Web Worker realm',
      );
    }
    this.root = root;
    this.asyncSurface = paired ?? null;
    // Seed root so `readdirSync('/')` works before `refreshIndex` runs.
    this.index.set('/', { kind: 'dir', size: 0, children: new Set() });
  }

  /**
   * Acquires the OPFS root via `navigator.storage.getDirectory()`,
   * builds the warm path index, preloads file content into the sync cache,
   * and returns a ready-to-use `OpfsFsSync`. Throws (via the constructor)
   * if called outside a Worker realm that supports `createSyncAccessHandle`.
   *
   * `paired` is the async OPFS surface ({@link OpfsVfs}); passing it enables
   * content write-through and the boot preload (ADR-0072). Omitting it
   * keeps the no-persistence test path working.
   */
  static async init(paired?: PairedAsyncSurface): Promise<OpfsFsSync> {
    if (!OpfsFsSync.isSupported()) {
      throw new NotImplementedError(
        'OpfsFsSync',
        'sync OPFS only available inside a Web Worker realm',
      );
    }
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      throw new VfsError('EPERM', '/', 'OPFS navigator.storage.getDirectory unavailable');
    }
    const dir = await navigator.storage.getDirectory();
    const instance = new OpfsFsSync(dir, paired);
    await instance.refreshIndex();
    await instance.preloadContent();
    return instance;
  }

  /**
   * Reads every known file's bytes from the paired async OPFS surface into
   * the sync {@link content} cache so post-reload `readFileSync` serves the
   * persisted bytes synchronously (ADR-0072). No-op without a paired
   * surface. Failures per file are swallowed (the file stays out of the
   * cache and reads as empty until a fresh write) so one unreadable entry
   * never blocks boot.
   */
  async preloadContent(): Promise<void> {
    const surface = this.asyncSurface;
    if (!surface) return;
    const reads: Array<Promise<void>> = [];
    for (const [path, entry] of this.index) {
      if (entry.kind !== 'file') continue;
      reads.push(
        (async () => {
          try {
            const bytes = await surface.readFile(path);
            this.content.set(path, bytes);
          } catch {
            // Unreadable at boot — leave uncached; a later sync read returns
            // empty bytes, a later write re-establishes content.
          }
        })(),
      );
    }
    await Promise.allSettled(reads);
  }

  /**
   * Re-walks the OPFS tree and rebuilds the warm path index. Callers that
   * have done async writes through the paired {@link OpfsVfs} surface
   * (which the sync index can't observe directly) should invoke this to
   * see the new entries through {@link existsSync} / {@link statSync} /
   * {@link readdirSync}.
   */
  async refreshIndex(): Promise<void> {
    const fresh = await walkOpfsTree(this.root);
    this.index.clear();
    for (const [k, v] of fresh) this.index.set(k, v);
  }

  private async resolveParent(path: string): Promise<FileSystemDirectoryHandle> {
    let dir: FileSystemDirectoryHandle = this.root;
    for (const part of segments(dirname(path))) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    return dir;
  }

  private async persistDirectoryPath(path: string, recursive: boolean): Promise<void> {
    const parts = segments(path);
    let dir: FileSystemDirectoryHandle = this.root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      dir = await dir.getDirectoryHandle(part, {
        create: recursive || i === parts.length - 1,
      });
    }
  }

  /**
   * Returns a memoised sync access handle for `path`, opening the file
   * (creating if absent) and acquiring a handle on first call.
   *
   * Async helper *invoked from sync methods* via a pre-warm step: sync
   * methods only call it after the handle is known-present in `handles`.
   * The first read/write to a brand-new path must therefore be preceded by
   * `await openSync(path)` or by an `OpfsVfs.writeFile` through the paired
   * async surface — the intended bootstrap path.
   */
  private async ensureHandle(path: string, create: boolean): Promise<FileSystemSyncAccessHandle> {
    const normalized = normalizePath(path);
    const existing = this.handles.get(normalized);
    if (existing) return existing;
    const parent = await this.resolveParent(normalized);
    // `normalized` = normalizePath(path) (#10) — basenameNormalized skips the
    // redundant normalize pass.
    const file = await parent.getFileHandle(basenameNormalized(normalized), { create });
    const handle = await file.createSyncAccessHandle();
    this.handles.set(normalized, handle);
    // Pre-warm also indexes a brand-new path (e.g. `openSync(p, create=true)`).
    if (!this.index.has(normalized)) {
      this.index.set(normalized, { kind: 'file', size: handle.getSize() });
      this.attachChild(normalized);
    }
    return handle;
  }

  /**
   * Pre-warms a sync access handle for `path` so subsequent sync ops on
   * the same path are fully synchronous. Callers that know the working
   * set ahead of time should warm it once at bootstrap.
   */
  async openSync(path: string, create = false): Promise<void> {
    await this.ensureHandle(path, create);
  }

  /** Releases all open sync access handles. Idempotent. */
  closeAll(): void {
    for (const handle of this.handles.values()) handle.close();
    this.handles.clear();
  }

  /**
   * Adds `path`'s basename to its parent directory's `children` set.
   * Idempotent. No-op if the parent isn't in the index — callers must
   * ensure parent exists (sync mkdir does this; async paths arrive via
   * `walkOpfsTree`).
   */
  private attachChild(path: string): void {
    if (path === '/') return;
    // `path` is always a normalized index key here (#10) — skip the re-normalize.
    const parent = dirnameNormalized(path);
    const parentEntry = this.index.get(parent);
    if (parentEntry?.kind === 'dir' && parentEntry.children) {
      parentEntry.children.add(basenameNormalized(path));
      parentEntry.sortedDirents = null; // child added — invalidate dirent cache
    }
  }

  /** Removes `path`'s basename from its parent's `children` set. Idempotent. */
  private detachChild(path: string): void {
    if (path === '/') return;
    // `path` is always a normalized index key here (#10) — skip the re-normalize.
    const parent = dirnameNormalized(path);
    const parentEntry = this.index.get(parent);
    if (parentEntry?.kind === 'dir' && parentEntry.children) {
      parentEntry.children.delete(basenameNormalized(path));
      parentEntry.sortedDirents = null; // child removed — invalidate dirent cache
    }
  }

  /**
   * Recursively removes `path` and all descendants from the in-memory
   * index, closing any open sync access handles along the way.
   */
  private removeSubtree(path: string): void {
    const entry = this.index.get(path);
    if (!entry) return;
    if (entry.kind === 'dir' && entry.children) {
      // Snapshot — recursion mutates `children`.
      for (const name of [...entry.children]) {
        const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
        this.removeSubtree(childPath);
      }
    }
    const handle = this.handles.get(path);
    if (handle) {
      try {
        handle.close();
      } catch {
        // Closing a stale handle is best-effort.
      }
      this.handles.delete(path);
    }
    this.index.delete(path);
    this.times.delete(path);
    // Drop cached content (ADR-0072) so a re-created path can't read stale
    // bytes from a prior incarnation.
    this.content.delete(path);
  }

  /**
   * Fire-and-forget async persist of a directory creation to OPFS. Caller
   * already mutated the in-memory mirror; this brings disk in line.
   * Errors never reject the queue — they land in the persist-failure ledger
   * ({@link flush} reports them); the next `refreshIndex` reconciles disk.
   */
  private persistMkdirAsync(path: string, recursive: boolean): void {
    this.enqueuePending(async () => {
      try {
        await this.persistDirectoryPath(path, recursive);
        this.persistFailures.delete(path);
      } catch (err) {
        // Mirror already reflects intent; a failed persist (quota, perm)
        // reconciles on next refresh — but the divergence is RECORDED so a
        // durability-gated caller (install stamp) can refuse to trust it.
        this.recordPersistFailure(path, 'mkdir', err);
      }
    });
  }

  /**
   * Async persist of an `rm` to OPFS, tracked in {@link pending} so
   * {@link flush} drains deletes too (ADR-0072). Errors never reject the
   * queue — they land in the persist-failure ledger; the next `refreshIndex`
   * reconciles any mismatch.
   */
  private persistRmAsync(path: string, recursive: boolean): void {
    this.enqueuePending(async () => {
      try {
        const parent = await this.resolveParent(path);
        await parent.removeEntry(basename(path), { recursive });
        // A durably-removed subtree heals EVERY ledger entry under it: disk
        // and mirror now agree the paths are gone, so an unhealed child write
        // failure is moot — leaving it would make a durable tree look torn
        // and wrongly skip/revoke install stamps.
        this.clearPersistFailuresUnder(path);
      } catch (err) {
        // See `persistMkdirAsync` — mismatch reconciles on refresh; recorded
        // meanwhile. A missing OPFS entry is already-removed = success.
        if ((err as { name?: string }).name === 'NotFoundError') {
          this.clearPersistFailuresUnder(path);
          return;
        }
        this.recordPersistFailure(path, 'rm', err);
      }
    });
  }

  /** Heal `path` and every ledger entry beneath it (recursive rm / moved-away
   * subtree): once disk agrees the subtree is gone, its unhealed write
   * failures no longer describe a divergence. */
  private clearPersistFailuresUnder(path: string): void {
    const prefix = path === '/' ? '/' : `${path}/`;
    for (const key of [...this.persistFailures.keys()]) {
      if (key === path || key.startsWith(prefix)) this.persistFailures.delete(key);
    }
  }

  existsSync(path: string): boolean {
    return this.index.has(normalizePath(path));
  }

  readFileBytesSync(path: string): Uint8Array {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    if (entry.kind === 'dir') throw new VfsError('EISDIR', path);
    // Content cache (ADR-0072) is authoritative for sync reads. The
    // `?? new Uint8Array()` covers a file the boot preload couldn't read
    // (e.g. transient OPFS error): empty read is the safe degenerate, not a
    // thrown stub.
    return this.content.get(normalized) ?? new Uint8Array();
  }

  writeFileSync(path: string, data: Uint8Array): void {
    const normalized = normalizePath(path);
    // `normalized` (#10) — skip dirname's redundant normalize.
    const parent = dirnameNormalized(normalized);
    const parentEntry = this.index.get(parent);
    if (!parentEntry || parentEntry.kind !== 'dir') {
      throw new VfsError('ENOENT', parent);
    }
    // In-cache write (ADR-0072): ONE defensive slice shared by the content
    // cache and the async write-through (#3, perf audit 2026-06-05: 2N->N
    // copies/write). This single entry-point slice is the SOLE barrier
    // severing the caller buffer (and WASI fd_write's in-place reuse, fd.ts:88)
    // from cached content — readFileBytesSync returns the cache by reference.
    // NEVER cache `data` directly; merging the two slices is safe, dropping the
    // copy is the regression (Q-2026-06-06-319 aliasing gate, verdict
    // safe-to-proceed). The write-through consumer (OpfsVfs.writeFile) is
    // read-only, so the two surfaces can share one copy.
    // TODO(backlog: perf/opfs-writefilesync-shared-slice)
    const copy = data.slice();
    this.content.set(normalized, copy);
    const wasKnown = this.index.has(normalized);
    this.index.set(normalized, { kind: 'file', size: data.byteLength });
    if (!wasKnown) {
      this.attachChild(normalized); // attachChild invalidates the parent cache
    } else {
      // Already a known child: attachChild is skipped, but the child's kind can
      // flip (e.g. dir->file) so the parent's dirent cache must still drop
      // (perf audit 2026-06-05; kind-flip hazard).
      const parentEntry = this.index.get(parent);
      if (parentEntry?.kind === 'dir') parentEntry.sortedDirents = null;
    }
    this.enqueueWriteThrough(normalized, copy);
  }

  /**
   * Enqueues a fire-and-forget async OPFS write-through for `normalized`
   * and tracks the promise in {@link pending} so {@link flush} can drain it
   * before a page reload (ADR-0072). No-op without a paired async surface.
   */
  private enqueueWriteThrough(normalized: string, data: Uint8Array): void {
    const surface = this.asyncSurface;
    if (!surface) return;
    this.enqueuePending(async () => {
      try {
        await surface.writeFile(normalized, data);
        this.persistFailures.delete(normalized);
      } catch (err) {
        // Persist failure (quota, perm) leaves OPFS behind the cache; next
        // refreshIndex/preload reconciles. Cache stays correct for sync
        // callers in this realm — but the divergence is RECORDED: a caller
        // that promises durability (install stamp) must be able to see it.
        this.recordPersistFailure(normalized, 'write', err);
      }
    });
  }

  /**
   * Persist-failure ledger: paths whose LAST persist attempt failed, i.e.
   * where OPFS is known to lag the in-memory mirror. A later successful
   * persist of the same path heals its entry (re-install after a freed
   * quota). Deliberately UNCAPPED: keyed by path, so growth is bounded by the
   * distinct paths written this session — the same order as the mirror's own
   * `index`/`content` maps (which hold the actual bytes). A truncated ledger
   * would make over-cap failures unhealable (`total` never returns to 0 after
   * a big quota event); only the REPORT is sampled.
   */
  private readonly persistFailures = new Map<string, PersistFailure>();

  private recordPersistFailure(path: string, op: PersistFailure['op'], err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.persistFailures.set(path, { path, op, message });
  }

  /** Adds `p` to {@link pending} and self-removes it on settle. */
  private trackPending(p: Promise<void>): void {
    this.pending.push(p);
    void p.finally(() => {
      const i = this.pending.indexOf(p);
      if (i >= 0) this.pending.splice(i, 1);
    });
  }

  private enqueuePending(task: () => Promise<void>): void {
    // FIFO is load-bearing (ADR-0187 Corrected): the install stamp's "durable
    // stamp implies durable tree" is delivered by write-through ORDER plus the
    // persist-failure ledger gate (order alone can't survive a swallowed
    // per-op failure). Parallelizing this queue requires per-path ordering +
    // an explicit stamp barrier (tripwire: the FIFO pin in opfs-sync.test.ts).
    const p = this.pending.length === 0 ? task() : this.pendingTail.then(task, task);
    this.pendingTail = p.catch(() => {});
    this.trackPending(p);
  }

  /**
   * Drains all in-flight async OPFS write-through / structural operations
   * (ADR-0072). Callers invoke this before a deterministic boundary —
   * e.g. the runtime worker awaits it before resolving an `eval` result so
   * persistence completes before any page reload. Never rejects — instead it
   * RETURNS the persist-failure ledger (ADR-0187 Corrected): paths where OPFS
   * still lags the mirror because their last persist attempt failed. Callers
   * that only order writes ignore the result; callers that PROMISE durability
   * (the install stamp) gate on `report.total === 0`.
   */
  async flush(): Promise<PersistFailureReport> {
    await Promise.allSettled([...this.pending]);
    const failures: PersistFailure[] = [];
    for (const failure of this.persistFailures.values()) {
      if (failures.length >= PERSIST_REPORT_SAMPLE) break;
      failures.push(failure);
    }
    return { failures, total: this.persistFailures.size };
  }

  /**
   * Editor-save fast path mirroring {@link MemoryFsSync.loadFixture}, but
   * routed through {@link writeFileSync} so saves land in the content cache
   * and flow through to OPFS — keeping the editor->runtime view coherent on
   * the OPFS backend (ADR-0072).
   */
  loadFixture(files: Readonly<Record<string, string>>): void {
    const enc = new TextEncoder();
    for (const [path, content] of Object.entries(files)) {
      const normalized = normalizePath(path);
      const dir = dirnameNormalized(normalized);
      if (dir !== '/' && !this.index.has(dir)) {
        this.mkdirSync(dir, { recursive: true });
      }
      this.writeFileSync(normalized, enc.encode(content));
    }
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    // mtime: prefer `utimes` side-table; fall back to 0 — OPFS exposes no
    // native mtime to the sync surface (ADR-0029).
    const mtime = this.times.get(normalized)?.mtime ?? 0;
    if (entry.kind === 'dir') {
      return { isFile: false, isDirectory: true, size: 0, mtime };
    }
    // Prefer live size from an open sync access handle; else cached size
    // from the last walk/write.
    const handle = this.handles.get(normalized);
    const size = handle ? handle.getSize() : entry.size;
    return { isFile: true, isDirectory: false, size, mtime };
  }

  statSyncOrNull(
    path: string,
  ): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } | null {
    // Non-throwing stat (ADR-0083): null on an absent warm-index entry, else
    // the same statSync path (live-handle size + utimes-side-table mtime).
    // One normalize; statSync re-normalizes the already-normalized arg cheaply
    // via the #10 fast-path.
    const norm = normalizePath(path);
    if (!this.index.has(norm)) return null;
    return this.statSync(norm);
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    const normalized = normalizePath(path);
    if (!this.index.has(normalized)) throw new VfsError('ENOENT', path);
    this.times.set(normalized, { atime: atimeMs, mtime: mtimeMs });
  }

  /**
   * Lists immediate children of `path`. Reads the in-memory dir-tree
   * mirror that was seeded by {@link refreshIndex} / boot. Result is
   * sorted lexicographically for deterministic iteration (matches
   * `MemoryBackend.readdir`).
   */
  readdirSync(path: string): readonly VfsDirent[] {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    if (entry.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    if (!entry.children) return [];
    if (entry.sortedDirents != null) return entry.sortedDirents;
    const dirents: VfsDirent[] = [];
    for (const name of [...entry.children].sort()) {
      const childPath = normalized === '/' ? `/${name}` : `${normalized}/${name}`;
      const childEntry = this.index.get(childPath);
      // A child listed in `entry.children` should always have an `index`
      // entry — the two are maintained in lockstep. Defensive fallback:
      // treat an orphaned name as a file with unknown size.
      const isDir = childEntry?.kind === 'dir';
      dirents.push({ name, isFile: !isDir, isDirectory: isDir });
    }
    // Cache the sorted, kind-resolved list (perf audit 2026-06-05). Frozen so
    // callers can't mutate the shared array.
    const frozen = Object.freeze(dirents);
    entry.sortedDirents = frozen;
    return frozen;
  }

  /**
   * Creates the directory at `path` in the in-memory mirror and kicks
   * off a fire-and-forget async persist to OPFS. With `recursive`, any
   * missing parent segments are also created.
   *
   * If `recursive` is false and the parent does not exist, throws
   * `VfsError('ENOENT')`. If the target already exists as a directory,
   * non-recursive callers get `VfsError('EEXIST')`; recursive callers
   * are tolerated. If the target exists as a file, throws
   * `VfsError('ENOTDIR')`.
   */
  mkdirSync(path: string, options: { recursive?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const normalized = normalizePath(path);
    const parts = segments(normalized);
    if (parts.length === 0) {
      // mkdir('/'): root always exists.
      if (!recursive) throw new VfsError('EEXIST', path);
      return;
    }
    let cumulative = '';
    for (let i = 0; i < parts.length; i++) {
      cumulative = `${cumulative}/${parts[i]}`;
      const existing = this.index.get(cumulative);
      if (existing) {
        if (existing.kind !== 'dir') throw new VfsError('ENOTDIR', cumulative);
        if (i === parts.length - 1 && !recursive) {
          throw new VfsError('EEXIST', path);
        }
        continue;
      }
      if (!recursive && i < parts.length - 1) {
        throw new VfsError('ENOENT', cumulative);
      }
      this.index.set(cumulative, { kind: 'dir', size: 0, children: new Set() });
      this.attachChild(cumulative);
    }
    // Mirror is source of truth for sync callers; OPFS catches up best-effort.
    this.persistMkdirAsync(normalized, recursive);
  }

  /**
   * Removes `path` from the in-memory mirror and kicks off a
   * fire-and-forget async persist to OPFS. `recursive: true` deletes a
   * non-empty directory subtree; `force: true` makes missing paths a
   * no-op.
   *
   * Throws `VfsError('ENOTEMPTY')` for non-empty directories without
   * `recursive` (Node `fs.rmSync` parity). Throws `VfsError('ENOENT')`
   * for unknown paths unless `force` is set.
   */
  rmSync(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const force = options.force ?? false;
    const normalized = normalizePath(path);
    if (normalized === '/') {
      if (recursive) {
        // Clear root's children, keep the root entry. Persist per-child:
        // OPFS `removeEntry` cannot target the root itself, so a single
        // persistRmAsync('/') was a silent on-disk no-op.
        const rootEntry = this.index.get('/');
        if (rootEntry?.children) {
          const names = [...rootEntry.children];
          for (const name of names) {
            this.removeSubtree(`/${name}`);
          }
          rootEntry.sortedDirents = null; // subtree removed — invalidate root cache
          for (const name of names) {
            this.persistRmAsync(`/${name}`, true);
          }
        }
        return;
      }
      throw new VfsError('EPERM', '/');
    }
    const entry = this.index.get(normalized);
    if (!entry) {
      if (force) return;
      throw new VfsError('ENOENT', path);
    }
    if (entry.kind === 'dir' && entry.children && entry.children.size > 0 && !recursive) {
      // Match Node `fs.rmSync` ENOTEMPTY message — single code across backends.
      throw new VfsError('ENOTEMPTY', path, `ENOTEMPTY: directory not empty, rmdir '${path}'`);
    }
    this.detachChild(normalized);
    this.removeSubtree(normalized);
    this.persistRmAsync(normalized, recursive);
  }

  copyFileSync(src: string, dst: string): void {
    const s = normalizePath(src);
    const d = normalizePath(dst);
    const srcEntry = this.index.get(s);
    if (!srcEntry) throw new VfsError('ENOENT', src);
    if (srcEntry.kind === 'dir') throw new VfsError('EISDIR', src);
    const dstEntry = this.index.get(d);
    if (dstEntry && dstEntry.kind === 'dir') throw new VfsError('EISDIR', dst);
    const parent = dirname(d);
    const parentEntry = this.index.get(parent);
    if (!parentEntry || parentEntry.kind !== 'dir') throw new VfsError('ENOENT', parent);
    const bytes = (this.content.get(s) ?? new Uint8Array()).slice();
    // writeFileSync updates content/index/attachChild + enqueues OPFS write-through.
    this.writeFileSync(d, bytes);
    // A copy is a new file → dst mtime = now (ADR-0090; OPFS mtime via side-table).
    const now = Date.now();
    this.times.set(d, { atime: now, mtime: now });
  }

  cpSync(src: string, dst: string, options: { recursive?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const s = normalizePath(src);
    const d = normalizePath(dst);
    const srcEntry = this.index.get(s);
    if (!srcEntry) throw new VfsError('ENOENT', src);
    if (srcEntry.kind === 'file') {
      this.copyFileSync(s, d);
      return;
    }
    if (!recursive) throw new VfsError('EISDIR', src);
    // Guard against copying a dir into its own subtree (`cp -r a a`, `cp -r a
    // a/b`) — without it the recursion never terminates → stack overflow.
    // Matches `renameSync`'s into-subtree EINVAL.
    if (d === s || d.startsWith(`${s}/`)) throw new VfsError('EINVAL', src);
    this.mkdirSync(d, { recursive: true });
    // Fail-fast: a child failure propagates; entries copied before remain.
    for (const name of [...(srcEntry.children ?? [])].sort()) {
      this.cpSync(`${s}/${name}`, `${d}/${name}`, { recursive: true });
    }
  }

  renameSync(src: string, dst: string): void {
    const s = normalizePath(src);
    const d = normalizePath(dst);
    if (s === d) return;
    if (s === '/') throw new VfsError('EINVAL', src);
    const srcEntry = this.index.get(s);
    if (!srcEntry) throw new VfsError('ENOENT', src);
    if (srcEntry.kind === 'dir' && d.startsWith(`${s}/`)) throw new VfsError('EINVAL', src);
    const dstParent = dirname(d);
    const dstParentEntry = this.index.get(dstParent);
    if (!dstParentEntry || dstParentEntry.kind !== 'dir') throw new VfsError('ENOENT', dstParent);
    const dstEntry = this.index.get(d);
    if (dstEntry) {
      if (srcEntry.kind === 'file' && dstEntry.kind === 'dir') throw new VfsError('EISDIR', dst);
      if (srcEntry.kind === 'dir' && dstEntry.kind === 'file') throw new VfsError('ENOTDIR', dst);
      if (dstEntry.kind === 'dir' && dstEntry.children && dstEntry.children.size > 0) {
        throw new VfsError('ENOTEMPTY', dst);
      }
      // File overwrite or empty-dir replace: drop the dst subtree from all maps.
      this.detachChild(d);
      this.removeSubtree(d);
    }
    // Snapshot the src subtree paths BEFORE mutating, then re-key index /
    // content / times across each — preserving the entry objects so the
    // `times` mtime survives (the ADR-0090 win). Open handles point at the
    // OLD on-disk file (which the async persist removes), so close+drop them;
    // a fresh handle opens lazily on next access.
    const moved = [...this.index.keys()]
      .filter((p) => p === s || p.startsWith(`${s}/`))
      .sort((a, b) => segments(a).length - segments(b).length || a.localeCompare(b));
    this.detachChild(s);
    const dirCreates = new Set<string>();
    const fileMoves: Array<{
      readonly oldPath: string;
      readonly newPath: string;
      readonly bytes?: Uint8Array;
    }> = [];
    for (const oldP of moved) {
      const newP = d + oldP.slice(s.length);
      const entry = this.index.get(oldP);
      if (entry) {
        this.index.set(newP, entry);
        this.index.delete(oldP);
        if (entry.kind === 'dir') dirCreates.add(newP);
      }
      const bytes = this.content.get(oldP);
      if (bytes !== undefined) {
        this.content.set(newP, bytes);
        this.content.delete(oldP);
      }
      if (entry?.kind === 'file') {
        fileMoves.push({
          oldPath: oldP,
          newPath: newP,
          ...(bytes !== undefined ? { bytes: bytes.slice() } : {}),
        });
      }
      const t = this.times.get(oldP);
      if (t !== undefined) {
        this.times.set(newP, t);
        this.times.delete(oldP);
      }
      const h = this.handles.get(oldP);
      if (h !== undefined) {
        try {
          h.close();
        } catch {
          // Closing a stale handle is best-effort.
        }
        this.handles.delete(oldP);
      }
    }
    this.attachChild(d);
    this.persistRenameAsync(s, [...dirCreates], fileMoves);
  }

  /**
   * Best-effort async OPFS persist of a rename: recreate moved directories
   * and files at their new paths from the captured snapshot, then remove the
   * old subtree.
   * `FileSystemSyncAccessHandle` has no native rename; the SYNC view is
   * already atomic (the in-memory re-key above), so on-disk lag is acceptable
   * (ADR-0072/0083) and reconciles on the next `refreshIndex`. Tracked in
   * `pending` so `flush()` drains it before a reload.
   */
  private persistRenameAsync(
    srcRoot: string,
    dirCreates: readonly string[],
    fileMoves: ReadonlyArray<{
      readonly oldPath: string;
      readonly newPath: string;
      readonly bytes?: Uint8Array;
    }>,
  ): void {
    const surface = this.asyncSurface;
    this.enqueuePending(async () => {
      try {
        if (fileMoves.length > 0 && !surface) return;
        const orderedDirs = [...dirCreates].sort(
          (a, b) => segments(a).length - segments(b).length || a.localeCompare(b),
        );
        for (const dir of orderedDirs) await this.persistDirectoryPath(dir, true);
        if (surface) {
          for (const move of fileMoves) {
            const bytes = move.bytes ?? (await surface.readFile(move.oldPath));
            await surface.writeFile(move.newPath, bytes);
          }
          await surface.rm(srcRoot, { recursive: true });
        } else {
          const parent = await this.resolveParent(srcRoot);
          await parent.removeEntry(basename(srcRoot), { recursive: true });
        }
        // A fully-persisted move heals both sides of the ledger: each
        // destination just got written durably, and the removed source
        // subtree no longer describes any divergence (same rule as
        // `persistRmAsync`). Without this, a pre-rename write failure on a
        // moved path would read as torn forever.
        for (const move of fileMoves) this.persistFailures.delete(move.newPath);
        this.clearPersistFailuresUnder(srcRoot);
      } catch (err) {
        // Mismatch reconciles on the next refreshIndex (same posture as
        // enqueueWriteThrough / persistRmAsync). Recorded per DESTINATION
        // path — those are the files a reload would find missing; a later
        // successful write-through of the same path heals the entry.
        for (const move of fileMoves) {
          this.recordPersistFailure(move.newPath, 'rename', err);
        }
        if (fileMoves.length === 0) this.recordPersistFailure(srcRoot, 'rename', err);
      }
    });
  }
}
