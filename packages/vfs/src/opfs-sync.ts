/// <reference lib="webworker" />
/**
 * Worker-only synchronous OPFS mirror (ADR-0013/0072). Content and directory
 * reads use memory preloaded by {@link init}; mutations enqueue OPFS
 * write-through. {@link flush} reports durability before a reload.
 *
 * The warm index (ADR-0014) tracks kind/size/children. Writes through the paired
 * async surface require {@link refreshIndex}; sync mutations update it locally.
 * Sync-access handles open lazily and remain owned by this instance.
 * atime/mtime overrides are memory-only (ADR-0029), lost on reload.
 */

import { NotImplementedError, VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import {
  type FlushProgressSnapshot,
  OpfsDrainScheduler,
  type PersistOperation,
} from './opfs-drain-scheduler.ts';
import { assertNotCrswapReserved } from './opfs-errors.ts';
import { type IndexEntry, OpfsPreloadError, walkOpfsTree } from './opfs-preload.ts';
import type { ReplicaImage, ReplicaPersistence, ReplicaRecord } from './opfs-replica-types.ts';
export { walkOpfsTree } from './opfs-preload.ts';
import {
  basename,
  basenameNormalized,
  dirname,
  dirnameNormalized,
  normalizeAbsolute,
  segments,
} from './path.ts';
import type { VfsDirent } from './types.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

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

/** {@link OpfsFsSync.flush} result (ADR-0358, carried from ADR-0187): the still-unhealed
 * persist failures. `failures` is a SAMPLE (first {@link
 * PERSIST_REPORT_SAMPLE} by ledger order); `total` is the full count —
 * `total === 0` ⇔ everything drained IS durable. Every counted path stays
 * individually healable (the ledger itself is never truncated). */
export interface PersistFailureReport {
  readonly failures: ReadonlyArray<PersistFailure>;
  readonly total: number;
  /**
   * FULL-ledger predicate query. `failures` is a SAMPLE (first {@link
   * PERSIST_REPORT_SAMPLE}), so a durability gate that scans it can MISS damage
   * beyond the sample — e.g. 20 foreign failures fill the sample while a
   * `node_modules` failure sits outside it. Callers that gate on "is any path
   * matching X still unhealed?" MUST ask the whole ledger via this. Present on
   * the OpfsFsSync backend; absent on report literals / the memory backend
   * (there the sample IS the full set), where callers fall back to `failures`.
   */
  readonly anyFailure?: (predicate: (path: string) => boolean) => boolean;
}

/** {@link OpfsFsSync.flush} options (ADR-0359): `onProgress` observes REAL
 * settled counts over the flush-time watermark — `total` = ops pending at the
 * call, `persisted` = the subset since settled successfully. Events-out only;
 * never changes the drain. */
export interface FlushOptions {
  readonly onProgress?: (snapshot: FlushProgressSnapshot) => void;
}

/** Report-sample size: consumers read `failures[0]` + `total`; shipping the
 * whole ledger on every flush is waste, truncating the LEDGER (not just the
 * report) would make over-cap failures unhealable — `total` could then never
 * return to 0 after a big quota event. */
const PERSIST_REPORT_SAMPLE = 20;

interface TrackedPersistFailure {
  readonly failure: PersistFailure;
  readonly operationSequence: number;
  /** Settled structural failure; timeouts instead retain the scheduler's real-operation fence. */
  readonly subtreeSequence?: number;
}

export class OpfsFsSync implements FsSync {
  private readonly handles = new Map<string, FileSystemSyncAccessHandle>();
  private readonly index = new Map<string, IndexEntry>();
  /** atime/mtime side-table — see file header (ADR-0029). */
  private readonly times = new Map<string, { atime: number; mtime: number }>();

  private readonly root: FileSystemDirectoryHandle;
  private readonly replica: ReplicaPersistence | undefined;
  /**
   * Synchronous file-content cache (ADR-0072). `readFileBytesSync` /
   * `writeFileSync` operate on this map so they never need a mid-call async
   * sync-access-handle open. Seeded at boot from OPFS (see {@link init})
   * and kept authoritative as the page runs; OPFS receives the bytes via
   * async write-through.
   */
  private readonly content = new Map<string, Uint8Array>();
  /**
   * ADR-0358 bounded per-path parallel drain: lane scheduler (same-path
   * order, ancestor gating, structural subtree fences, per-lane watchdog) +
   * its drain-scoped dir-handle cache. The ledger stays HERE (single ledger
   * owner); the scheduler reports timeouts/blocked fences via these hooks.
   */
  private readonly scheduler: OpfsDrainScheduler;
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

  /** Bind a Worker mirror to one captured root and its physical writer. */
  constructor(
    root: FileSystemDirectoryHandle,
    paired?: PairedAsyncSurface,
    options: {
      readonly ioReportTimeoutMs?: number;
      readonly replica?: ReplicaPersistence;
      readonly initialImage?: readonly ReplicaImage[];
    } = {},
  ) {
    if (!OpfsFsSync.isSupported()) {
      throw new NotImplementedError(
        'OpfsFsSync',
        'sync OPFS only available inside a Web Worker realm',
      );
    }
    this.root = root;
    this.replica = options.replica;
    if (this.replica && !paired) throw new TypeError('Replica requires its paired native surface');
    this.asyncSurface = paired ?? null;
    this.scheduler = new OpfsDrainScheduler(
      {
        onReportTimeout: (operation) => {
          this.recordOperationFailure(
            operation,
            new Error(
              `OPFS ${operation.op} did not settle within ${this.scheduler.reportTimeoutMs}ms`,
            ),
            true,
          );
        },
        onBlockedBehindTimeout: (operation, blocker) => {
          this.recordOperationFailure(
            operation,
            new Error(
              `OPFS ${operation.op} blocked behind timed out ${blocker.op} ${blocker.paths[0] ?? '/'}`,
            ),
            true,
          );
        },
      },
      options.ioReportTimeoutMs,
      this.replica ? (operations) => this.persistReplicaBatch(operations) : undefined,
    );
    // Seed root so `readdirSync('/')` works before `refreshIndex` runs.
    this.index.set('/', { kind: 'dir', size: 0, children: new Set() });
    for (const entry of options.initialImage ?? []) {
      this.index.set(
        entry.path,
        entry.kind === 'dir'
          ? { kind: 'dir', size: 0, children: new Set() }
          : { kind: 'file', size: entry.bytes.length },
      );
      this.times.set(entry.path, { atime: entry.atime, mtime: entry.mtime });
      if (entry.kind === 'file') this.content.set(entry.path, entry.bytes);
    }
    for (const path of this.index.keys()) this.attachChild(path);
  }

  /** Worker-only mount/index/preload; paired surface owns write-through (ADR-0072/0402). */
  static async init(
    paired?: PairedAsyncSurface,
    root?: FileSystemDirectoryHandle,
    options: { readonly ioReportTimeoutMs?: number } = {},
  ): Promise<OpfsFsSync> {
    const ioReportTimeoutMs = options.ioReportTimeoutMs;
    if (!OpfsFsSync.isSupported()) {
      throw new NotImplementedError(
        'OpfsFsSync',
        'sync OPFS only available inside a Web Worker realm',
      );
    }
    let dir = root;
    if (dir === undefined) {
      if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
        throw new VfsError('EPERM', '/', 'OPFS navigator.storage.getDirectory unavailable');
      }
      dir = await navigator.storage.getDirectory();
    }
    const instance = new OpfsFsSync(dir, paired, { ioReportTimeoutMs });
    const fresh = await walkOpfsTree(dir, paired ? instance.content : undefined);
    for (const [path, entry] of fresh) instance.index.set(path, entry);
    return instance;
  }

  /** Explicit content refresh publishes bytes only after every read succeeds. */
  async preloadContent(): Promise<void> {
    if (this.replica)
      throw new NotImplementedError(
        'OpfsFsSync.preloadContent.replica',
        'replica has no external per-file surface',
      );
    const surface = this.asyncSurface;
    if (!surface) return;
    const fresh = new Map<string, Uint8Array>();
    try {
      await Promise.all(
        [...this.index].map(async ([path, entry]) => {
          if (entry.kind === 'file') fresh.set(path, await surface.readFile(path));
        }),
      );
    } catch (cause) {
      throw new OpfsPreloadError(cause);
    }
    this.content.clear();
    for (const [path, bytes] of fresh) this.content.set(path, bytes);
  }

  /** Per-file mode: rebuild metadata after external paired writes. */
  async refreshIndex(): Promise<void> {
    if (this.replica)
      throw new NotImplementedError(
        'OpfsFsSync.refreshIndex.replica',
        'replica has no external per-file surface',
      );
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

  /** Drain-task sibling of {@link resolveParent} through the drain-scoped
   * dir-handle cache (ADR-0358). Persist tasks only — `ensureHandle`'s
   * pre-warm path stays uncached (it runs outside any drain lifetime). */
  private resolveParentCached(path: string): Promise<FileSystemDirectoryHandle> {
    return this.scheduler.dirHandles.resolveDir(this.root, segments(dirname(path)), () => false);
  }

  private async persistDirectoryPath(path: string, recursive: boolean): Promise<void> {
    const parts = segments(path);
    // reuse:false — a create-chain must hit the live tree like main's fresh
    // walk (row-f differential); it still re-populates the cache.
    await this.scheduler.dirHandles.resolveDir(
      this.root,
      parts,
      (index) => recursive || index === parts.length - 1,
      false,
    );
  }

  /** Per-file mode: acquire a native handle for explicit prewarming. */
  private async ensureHandle(path: string, create: boolean): Promise<FileSystemSyncAccessHandle> {
    const normalized = normalizeAbsolute(path);
    const existing = this.handles.get(normalized);
    if (existing) return existing;
    const parent = await this.resolveParent(normalized);
    // `normalized` = normalizeAbsolute(path) (#10) — basenameNormalized skips the
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

  /** Per-file native prewarm; ordinary reads use the eager content cache. */
  async openSync(path: string, create = false): Promise<void> {
    if (this.replica)
      throw new NotImplementedError(
        'OpfsFsSync.openSync.replica',
        'replica has no external per-file surface',
      );
    if (create) assertNotCrswapReserved(normalizeAbsolute(path));
    await this.ensureHandle(path, create);
  }

  /** Releases all open sync access handles. Idempotent. */
  closeAll(): void {
    this.replica?.closeAfter(this.scheduler.settledBarrier());
    for (const handle of this.handles.values()) handle.close();
    this.handles.clear();
  }

  /** Keep the parent child set and sorted-dirent cache coherent. */
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

  /** Remove a cached subtree and release any native prewarm handles. */
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

  /** Per-file mkdir effect; the shared ledger owns failures. */
  private persistMkdirAsync(path: string, recursive: boolean): void {
    // Scope = the WHOLE chain this persist may create ('/a','/a/b','/a/b/c'
    // for a recursive mkdir), never just the leaf: a later '/a/f' write's
    // ancestor walk must find '/a' in the scheduler registry or it races the
    // chain create — OpfsVfs.writeFile resolves parents with create:false →
    // NotFoundError → torn tree (ADR-0358 ancestor gating). Non-recursive
    // creates only the leaf (parents pre-exist), so its scope stays the leaf.
    let paths: readonly string[];
    if (recursive) {
      const chain: string[] = [];
      let prefix = '';
      for (const part of segments(path)) {
        prefix = `${prefix}/${part}`;
        chain.push(prefix);
      }
      paths = chain;
    } else {
      paths = [path];
    }
    this.enqueuePending({ paths, op: 'mkdir' }, async (operation) => {
      try {
        await this.persistDirectoryPath(path, recursive);
        this.healPersistFailure(path, operation.sequence, true);
        // A persisted dir proves its ancestors exist on disk too — heal any
        // stale ancestor mkdir failure.
        this.healAncestorPersistFailures(path, operation.sequence);
      } catch (err) {
        // Mirror already reflects intent; a failed persist (quota, perm)
        // reconciles on next refresh — but the divergence is RECORDED so a
        // durability-gated caller (install stamp) can refuse to trust it.
        // Rethrow = the scheduler's failure-settle signal (ADR-0359); it
        // never escapes the scheduler.
        this.recordPersistFailure(path, 'mkdir', err, operation.sequence);
        throw err;
      }
    });
  }

  /** Per-file removal; an absent native path is already durable removal. */
  private persistRmAsync(path: string, recursive: boolean): void {
    this.enqueuePending({ paths: [path], op: 'rm' }, async (operation) => {
      try {
        const parent = await this.resolveParentCached(path);
        await parent.removeEntry(basename(path), { recursive });
        // A durably-removed subtree heals EVERY ledger entry under it: disk
        // and mirror now agree the paths are gone, so an unhealed child write
        // failure is moot — leaving it would make a durable tree look torn
        // and wrongly skip/revoke install stamps.
        this.clearPersistFailuresUnder(path, operation.sequence);
      } catch (err) {
        // See `persistMkdirAsync` — mismatch reconciles on refresh; recorded
        // meanwhile. A missing OPFS entry is already-removed = success.
        if ((err as { name?: string }).name === 'NotFoundError') {
          this.clearPersistFailuresUnder(path, operation.sequence);
          return;
        }
        // Rethrow = failure-settle signal (see persistMkdirAsync).
        this.recordPersistFailure(path, 'rm', err, operation.sequence);
        throw err;
      }
    });
  }

  /** Heal `path` and every ledger entry beneath it (recursive rm / moved-away
   * subtree): once disk agrees the subtree is gone, its unhealed write
   * failures no longer describe a divergence. */
  private clearPersistFailuresUnder(path: string, operationSequence: number): void {
    const prefix = path === '/' ? '/' : `${path}/`;
    for (const key of [...this.persistFailures.keys()]) {
      if (key === path || key.startsWith(prefix)) {
        this.healPersistFailure(key, operationSequence);
      }
    }
  }

  /** A persisted write/dir at `path` proves each ANCESTOR directory exists on
   * disk: mkdir creates the chain, and writeFile can now only succeed when the
   * chain is already present. A stale ancestor mkdir failure no longer
   * describes a divergence — clear it. Guarded on a non-empty ledger so the
   * common (nothing-failed) path stays O(1). */
  private healAncestorPersistFailures(path: string, operationSequence: number): void {
    if (this.persistFailures.size === 0) return;
    let parent = dirnameNormalized(path);
    while (parent !== '/') {
      this.healPersistFailure(parent, operationSequence, true);
      const next = dirnameNormalized(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  existsSync(path: string): boolean {
    return this.index.has(normalizeAbsolute(path));
  }

  /**
   * Strict-walk guard (Node parity; mirrors `MemoryBackend.resolveStrict`):
   * when the nearest EXISTING ancestor of `normalized` is a file, the lookup
   * traversed through a file → `ENOTDIR` named after `reportPath`, never a
   * silent miss→ENOENT. A missing ancestor stays a miss (caller picks
   * ENOENT vs `force`). Parity case: fs/error-shape-errno-syscall.
   */
  private assertNoFileAncestor(normalized: string, reportPath: string): void {
    let p = normalized;
    while (p !== '/') {
      p = dirnameNormalized(p);
      const e = this.index.get(p);
      if (e) {
        if (e.kind !== 'dir') throw new VfsError('ENOTDIR', reportPath);
        return;
      }
    }
  }

  readFileBytesSync(path: string): Uint8Array {
    const normalized = normalizeAbsolute(path);
    const entry = this.index.get(normalized);
    if (!entry) {
      this.assertNoFileAncestor(normalized, path);
      throw new VfsError('ENOENT', path);
    }
    if (entry.kind === 'dir') throw new VfsError('EISDIR', path);
    return this.readCachedContent(normalized, path);
  }

  private readCachedContent(normalized: string, reportPath: string): Uint8Array {
    const bytes = this.content.get(normalized);
    if (bytes === undefined) {
      throw new VfsError('EIO', reportPath, `OPFS content is unavailable: ${reportPath}`);
    }
    return bytes;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    this.replica?.assertWritable();
    const normalized = normalizeAbsolute(path);
    assertNotCrswapReserved(normalized);
    // `normalized` (#10) — skip dirname's redundant normalize.
    const parent = dirnameNormalized(normalized);
    const parentEntry = this.index.get(parent);
    // Errors name the TARGET path (Node parity); a file on the parent chain
    // is ENOTDIR, a missing chain is ENOENT.
    if (!parentEntry) {
      this.assertNoFileAncestor(normalized, path);
      throw new VfsError('ENOENT', path);
    }
    if (parentEntry.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    if (this.index.get(normalized)?.kind === 'dir') throw new VfsError('EISDIR', path);
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
    const previousTimes = this.times.get(normalized);
    const now = Date.now();
    const previousMtime = previousTimes?.mtime ?? 0;
    const mtime = now <= previousMtime ? previousMtime + 1 : now;
    this.times.set(normalized, { atime: previousTimes?.atime ?? now, mtime });
    this.index.set(normalized, { kind: 'file', size: data.byteLength });
    if (!wasKnown) {
      this.attachChild(normalized); // attachChild invalidates the parent cache
    } else {
      // Already a known child: attachChild is skipped, but a parent cache may
      // exist, so drop it conservatively on every overwrite.
      const parentEntry = this.index.get(parent);
      if (parentEntry?.kind === 'dir') parentEntry.sortedDirents = null;
    }
    this.enqueueWriteThrough(normalized, copy);
  }

  /** Register the already-applied write with the one drain owner. */
  private enqueueWriteThrough(normalized: string, data: Uint8Array): void {
    const surface = this.asyncSurface;
    if (!surface) return;
    this.enqueuePending({ paths: [normalized], op: 'write' }, async (operation) => {
      try {
        await surface.writeFile(normalized, data);
        this.healPersistFailure(normalized, operation.sequence);
        // A persisted write proves every ANCESTOR directory exists on disk:
        // OpfsVfs.writeFile no longer creates parents, so success itself is the
        // proof. Heal stale ancestor mkdir failures, else a durable tree can
        // wrongly revoke its install stamp.
        this.healAncestorPersistFailures(normalized, operation.sequence);
      } catch (err) {
        // Persist failure (quota, perm) leaves OPFS behind the cache; next
        // refreshIndex/preload reconciles. Cache stays correct for sync
        // callers in this realm — but the divergence is RECORDED: a caller
        // that promises durability (install stamp) must be able to see it.
        // Rethrow = failure-settle signal (see persistMkdirAsync).
        this.recordPersistFailure(normalized, 'write', err, operation.sequence);
        throw err;
      }
    });
  }

  /** Exact, uncapped logical-path failures; later successful state heals them. */
  private readonly persistFailures = new Map<string, TrackedPersistFailure>();

  private recordPersistFailure(
    path: string,
    op: PersistFailure['op'],
    err: unknown,
    operationSequence: number,
    provisional = false,
  ): void {
    const current = this.persistFailures.get(path);
    const subtreeSequence =
      !provisional && (op === 'rm' || op === 'rename')
        ? Math.max(operationSequence, current?.subtreeSequence ?? 0)
        : current?.subtreeSequence;
    if (current && current.operationSequence > operationSequence) {
      this.persistFailures.set(path, { ...current, subtreeSequence });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.persistFailures.set(path, {
      failure: { path, op, message },
      operationSequence,
      subtreeSequence,
    });
  }

  private healPersistFailure(path: string, operationSequence: number, entryOnly = false): void {
    const current = this.persistFailures.get(path);
    if (!current || (entryOnly && current.subtreeSequence !== undefined)) return;
    if (current.operationSequence <= operationSequence) {
      this.persistFailures.delete(path);
    } else if (
      current.subtreeSequence !== undefined &&
      current.subtreeSequence <= operationSequence
    ) {
      this.persistFailures.set(path, {
        failure: current.failure,
        operationSequence: current.operationSequence,
      });
    }
  }

  private recordOperationFailure(
    operation: PersistOperation,
    err: unknown,
    provisional = false,
  ): void {
    for (const path of operation.paths) {
      this.recordPersistFailure(path, operation.op, err, operation.sequence, provisional);
    }
  }

  private enqueuePending(
    operation: { readonly paths: readonly string[]; readonly op: PersistFailure['op'] },
    task: (operation: PersistOperation) => Promise<void>,
  ): void {
    // ADR-0358: bounded per-path parallel lanes replace the ADR-0187 global
    // FIFO. Same-path order, ancestor-chain gating and rm/rename subtree
    // fences live in the scheduler; "durable stamp implies durable tree" is
    // delivered by the install stamp's explicit full {@link fence} plus the
    // persist-failure ledger gate. A ready op still starts SYNCHRONOUSLY so
    // it captures its already-defensively-copied bytes before the caller can
    // reuse a buffer.
    this.scheduler.enqueue(operation.op, operation.paths, this.replica ? undefined : task);
  }

  /** Capture final batch state before any async native work; no queued byte mirror. */
  private replicaImage(path: string): ReplicaImage {
    const entry = this.index.get(path);
    if (!entry) throw new VfsError('EIO', path, 'Replica image lost an indexed path');
    const times = this.times.get(path) ?? { atime: 0, mtime: 0 };
    return entry.kind === 'dir'
      ? { kind: 'dir', path, ...times }
      : { kind: 'file', path, ...times, bytes: this.readCachedContent(path, path).slice() };
  }

  private captureReplicaRecords(operations: readonly PersistOperation[]): readonly ReplicaRecord[] {
    const touched = new Set(operations.flatMap((operation) => operation.paths));
    const removed = new Set<string>();
    for (const operation of operations) {
      for (const path of operation.paths) {
        if (operation.op === 'rm' || operation.op === 'rename' || !this.index.has(path))
          removed.add(path);
      }
    }
    const roots = new Set<string>();
    for (const path of [...removed].sort((a, b) => a.length - b.length)) {
      let parent = path;
      let covered = false;
      for (;;) {
        if (roots.has(parent)) {
          covered = true;
          break;
        }
        if (parent === '/') break;
        parent = dirnameNormalized(parent);
      }
      if (!covered) roots.add(path);
    }
    const current = new Set<string>();
    for (const path of touched) {
      if (!this.index.has(path)) continue;
      let parent = path;
      for (;;) {
        current.add(parent);
        if (parent === '/') break;
        parent = dirnameNormalized(parent);
      }
    }
    return [
      ...[...roots].map((path) => ({ kind: 'delete' as const, path })),
      ...[...current]
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .map((path) => this.replicaImage(path)),
    ];
  }

  private async persistReplicaBatch(operations: readonly PersistOperation[]): Promise<void> {
    const replica = this.replica;
    const last = operations.at(-1);
    if (!replica || !last) throw new Error('Invalid replica batch');
    try {
      const records = this.captureReplicaRecords(operations);
      const result = await replica.commit(operations, records, () =>
        [...this.index.keys()]
          .sort((a, b) => a.length - b.length || a.localeCompare(b))
          .map((path) => this.replicaImage(path)),
      );
      if (result.base) {
        // A complete image also proves absent paths and earlier failed state.
        for (const path of this.persistFailures.keys())
          this.healPersistFailure(path, last.sequence);
      } else {
        for (const record of records) {
          if (record.kind === 'delete') this.clearPersistFailuresUnder(record.path, last.sequence);
          else {
            this.healPersistFailure(record.path, last.sequence, record.kind === 'dir');
            this.healAncestorPersistFailures(record.path, last.sequence);
          }
        }
      }
    } catch (error) {
      for (const operation of operations) this.recordOperationFailure(operation, error);
      throw error;
    }
  }

  /** Private pairing bridge; errors belong to these admitted operations only. */
  persistMutation(apply: () => void): Promise<void> {
    return this.scheduler.afterMutations(apply);
  }

  /** Bounded reporting, never real-settle release; full ledger, sampled report. */
  async flush(options?: FlushOptions): Promise<PersistFailureReport> {
    const onProgress = options?.onProgress;
    if (onProgress !== undefined) this.scheduler.observeFlushProgress(onProgress);
    await this.scheduler.reportingBarrier();
    const failures: PersistFailure[] = [];
    for (const tracked of this.persistFailures.values()) {
      if (failures.length >= PERSIST_REPORT_SAMPLE) break;
      failures.push(tracked.failure);
    }
    // `anyFailure` scans the WHOLE ledger (not the sample) so a durability gate
    // never misses a torn-tree path beyond the first PERSIST_REPORT_SAMPLE.
    return {
      failures,
      total: this.persistFailures.size,
      anyFailure: (predicate) => {
        for (const path of this.persistFailures.keys()) {
          if (predicate(path)) return true;
        }
        return false;
      },
    };
  }

  /**
   * ADR-0358 stamp full fence: resolves once EVERY persist op enqueued before
   * this call has REALLY settled (success or failure) — cap-queued ops and
   * ops past their report timeout included. {@link flush}'s bounded reporting
   * is NOT this barrier. Never rejects. Caller: install-stamp `promote()`,
   * immediately before its trusted-stamp write (one per transition).
   */
  /** Installer eligibility only; equality still requires a fresh native read (ADR-0392). */
  isPersistenceClean(path: string): boolean {
    const normalized = normalizeAbsolute(path);
    if (
      !this.asyncSurface ||
      !this.index.has(normalized) ||
      this.scheduler.hasPendingAtOrAbove(normalized)
    )
      return false;
    for (const failed of this.persistFailures.keys()) {
      if (failed === normalized || failed === '/' || normalized.startsWith(`${failed}/`))
        return false;
    }
    return true;
  }

  fence(): Promise<void> {
    return this.scheduler.settledBarrier();
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
      const normalized = normalizeAbsolute(path);
      const dir = dirnameNormalized(normalized);
      if (dir !== '/' && !this.index.has(dir)) {
        this.mkdirSync(dir, { recursive: true });
      }
      this.writeFileSync(normalized, enc.encode(content));
    }
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const normalized = normalizeAbsolute(path);
    const entry = this.index.get(normalized);
    if (!entry) {
      this.assertNoFileAncestor(normalized, path);
      throw new VfsError('ENOENT', path);
    }
    // mtime: prefer `utimes` side-table; fall back to 0 — OPFS exposes no
    // native mtime to the sync surface (ADR-0029).
    const mtime = this.times.get(normalized)?.mtime ?? 0;
    if (entry.kind === 'dir') {
      return { isFile: false, isDirectory: true, size: 0, mtime };
    }
    // Content/index cache is the authoritative sync mirror (ADR-0072). An
    // open sync access handle can lag a write-through queued from writeFileSync.
    return { isFile: true, isDirectory: false, size: entry.size, mtime };
  }

  statSyncOrNull(
    path: string,
  ): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } | null {
    // Non-throwing stat (ADR-0083): null on an absent warm-index entry, else
    // the same statSync path (live-handle size + utimes-side-table mtime).
    // One normalize; statSync re-normalizes the already-normalized arg cheaply
    // via the #10 fast-path.
    const norm = normalizeAbsolute(path);
    if (!this.index.has(norm)) return null;
    return this.statSync(norm);
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.replica?.assertWritable();
    const normalized = normalizeAbsolute(path);
    if (!this.index.has(normalized)) {
      this.assertNoFileAncestor(normalized, path);
      throw new VfsError('ENOENT', path);
    }
    this.times.set(normalized, { atime: atimeMs, mtime: mtimeMs });
    if (this.replica)
      this.scheduler.enqueue(this.index.get(normalized)?.kind === 'dir' ? 'mkdir' : 'write', [
        normalized,
      ]);
  }

  /** Cached immediate dirents, sorted and frozen. */
  readdirSync(path: string): readonly VfsDirent[] {
    const normalized = normalizeAbsolute(path);
    const entry = this.index.get(normalized);
    if (!entry) {
      this.assertNoFileAncestor(normalized, path);
      throw new VfsError('ENOENT', path);
    }
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

  /** Apply mkdir synchronously, then register its persistence footprint. */
  mkdirSync(path: string, options: { recursive?: boolean } = {}): void {
    this.replica?.assertWritable();
    const recursive = options.recursive ?? false;
    const normalized = normalizeAbsolute(path);
    assertNotCrswapReserved(normalized);
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
        // Full target path in the error (Node parity: `mkdir 'plain.txt/sub'`).
        if (existing.kind !== 'dir') {
          throw new VfsError(i === parts.length - 1 ? 'EEXIST' : 'ENOTDIR', path);
        }
        if (i === parts.length - 1 && !recursive) {
          throw new VfsError('EEXIST', path);
        }
        continue;
      }
      if (!recursive && i < parts.length - 1) {
        // Missing parent still names the TARGET (same rule as ENOTDIR above).
        throw new VfsError('ENOENT', path);
      }
      this.index.set(cumulative, { kind: 'dir', size: 0, children: new Set() });
      this.attachChild(cumulative);
    }
    // Mirror is source of truth for sync callers; OPFS catches up best-effort.
    this.persistMkdirAsync(normalized, recursive);
  }

  /** Apply removal synchronously, preserving the mounted root. */
  rmSync(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    this.replica?.assertWritable();
    const recursive = options.recursive ?? false;
    const force = options.force ?? false;
    const normalized = normalizeAbsolute(path);
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
      // ENOTDIR (path through a file) throws even under `force` — Node's
      // force suppresses only ENOENT (verified against real Node, 2026-07-05).
      this.assertNoFileAncestor(normalized, path);
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
    this.replica?.assertWritable();
    const s = normalizeAbsolute(src);
    const d = normalizeAbsolute(dst);
    const srcEntry = this.index.get(s);
    if (!srcEntry) {
      this.assertNoFileAncestor(s, src);
      throw new VfsError('ENOENT', src);
    }
    if (srcEntry.kind === 'dir') throw new VfsError('EISDIR', src);
    const dstEntry = this.index.get(d);
    if (dstEntry && dstEntry.kind === 'dir') throw new VfsError('EISDIR', dst);
    const parent = dirname(d);
    const parentEntry = this.index.get(parent);
    if (!parentEntry) {
      this.assertNoFileAncestor(d, dst);
      throw new VfsError('ENOENT', dst);
    }
    if (parentEntry.kind !== 'dir') throw new VfsError('ENOTDIR', dst);
    const bytes = this.readCachedContent(s, src).slice();
    // writeFileSync updates content/index/attachChild + enqueues OPFS write-through.
    this.writeFileSync(d, bytes);
    // A copy is a new file → dst mtime = now (ADR-0090; OPFS mtime via side-table).
    const now = Date.now();
    this.utimes(d, now, now);
  }

  cpSync(src: string, dst: string, options: { recursive?: boolean } = {}): void {
    this.replica?.assertWritable();
    const recursive = options.recursive ?? false;
    const s = normalizeAbsolute(src);
    const d = normalizeAbsolute(dst);
    const srcEntry = this.index.get(s);
    if (!srcEntry) {
      this.assertNoFileAncestor(s, src);
      throw new VfsError('ENOENT', src);
    }
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
    this.replica?.assertWritable();
    const s = normalizeAbsolute(src);
    const d = normalizeAbsolute(dst);
    assertNotCrswapReserved(d);
    if (s === d) return;
    if (s === '/') throw new VfsError('EINVAL', src);
    const srcEntry = this.index.get(s);
    if (!srcEntry) {
      this.assertNoFileAncestor(s, src);
      throw new VfsError('ENOENT', src);
    }
    if (srcEntry.kind === 'dir' && d.startsWith(`${s}/`)) throw new VfsError('EINVAL', src);
    const dstParent = dirname(d);
    const dstParentEntry = this.index.get(dstParent);
    if (!dstParentEntry) {
      this.assertNoFileAncestor(d, dst);
      throw new VfsError('ENOENT', dst);
    }
    if (dstParentEntry.kind !== 'dir') throw new VfsError('ENOTDIR', dst);
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
          ...(bytes !== undefined && !this.replica ? { bytes: bytes.slice() } : {}),
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

  /** Per-file rename effect; replica mode captures final images at admission. */
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
    this.enqueuePending(
      {
        paths: [...new Set([srcRoot, ...dirCreates, ...fileMoves.map(({ newPath }) => newPath)])],
        op: 'rename',
      },
      async (operation) => {
        try {
          if (fileMoves.length > 0 && !surface) return;
          const orderedDirs = [...dirCreates].sort(
            (a, b) => segments(a).length - segments(b).length || a.localeCompare(b),
          );
          for (const dir of orderedDirs) {
            await this.persistDirectoryPath(dir, true);
            this.healPersistFailure(dir, operation.sequence, true);
            this.healAncestorPersistFailures(dir, operation.sequence);
          }
          if (surface) {
            for (const move of fileMoves) {
              const bytes = move.bytes ?? (await surface.readFile(move.oldPath));
              await surface.writeFile(move.newPath, bytes);
            }
          }
          // Remove the source subtree AFTER the destinations wrote durably.
          // Already-gone (NotFoundError) counts as a successful removal (same
          // rule as persistRmAsync): a rename whose source never reached disk
          // must still HEAL its durably-written destinations below, not record
          // bogus per-destination failures for a move that actually persisted.
          try {
            if (surface) {
              await surface.rm(srcRoot, { recursive: true });
            } else {
              const parent = await this.resolveParentCached(srcRoot);
              await parent.removeEntry(basename(srcRoot), { recursive: true });
            }
          } catch (err) {
            if ((err as { name?: string }).name !== 'NotFoundError') throw err;
          }
          // A fully-persisted move heals both sides of the ledger: each
          // destination just got written durably, and the removed source
          // subtree no longer describes any divergence (same rule as
          // `persistRmAsync`). Without this, a pre-rename write failure on a
          // moved path would read as torn forever.
          const directoryPaths = new Set(dirCreates);
          for (const path of operation.paths) {
            if (path === srcRoot) continue;
            this.healPersistFailure(path, operation.sequence, directoryPaths.has(path));
            this.healAncestorPersistFailures(path, operation.sequence);
          }
          this.clearPersistFailuresUnder(srcRoot, operation.sequence);
        } catch (err) {
          // Any source/destination can now differ from the atomic sync view.
          // Record the full move footprint so a root-scoped durability gate
          // cannot miss a cross-root rename; a later successful move heals it.
          // Rethrow = failure-settle signal (see persistMkdirAsync).
          this.recordOperationFailure(operation, err);
          throw err;
        }
      },
    );
  }
}
