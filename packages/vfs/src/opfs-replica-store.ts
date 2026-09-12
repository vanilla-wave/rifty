/// <reference lib="webworker" />
import { VfsError } from './errors.ts';
import {
  PERSIST_OPERATION_REPORT_TIMEOUT_MS,
  type PersistOperation,
} from './opfs-drain-scheduler.ts';
import { OpfsPreloadError } from './opfs-preload.ts';
import {
  type CommittedReplicaEntry,
  ReplicaCorruptionError,
  applyReplicaRecords,
  decodeHead,
  decodeSegment,
  emptyReplicaEntries,
  encodeHead,
  encodeSegment,
  replicaDigest,
  segmentName,
} from './opfs-replica-codec.ts';
import type {
  OpfsLayoutIssue,
  ReplicaImage,
  ReplicaPersistence,
  ReplicaRecord,
} from './opfs-replica-types.ts';
import { dirnameNormalized, normalizeAbsolute } from './path.ts';
import type { VfsDirent, VfsStat } from './types.ts';

const DIRECTORY = '.rifty-replica-v1';
const HEAD = 'HEAD';
const GUARD = 'writer.lock';
const MIN_COMPACTION_BYTES = 4 * 1024 * 1024;
const MAX_SEGMENTS = 64;

/** ADR-0428: terminate() may leave a busy native writer alive briefly. Never steal its guard. */
async function acquireGuard(
  directory: FileSystemDirectoryHandle,
  timeoutMs: number,
): Promise<FileSystemSyncAccessHandle> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('OPFS replica admission timeout must be positive and finite');
  const deadline = performance.now() + timeoutMs;
  let expired = false;
  let lastContention: unknown;
  const timeoutError = () =>
    new Error(`OPFS replica writer admission timed out after ${timeoutMs}ms`, {
      cause: lastContention,
    });
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(timeoutError());
    }, timeoutMs);
  });
  const acquiring = (async () => {
    const file = await directory.getFileHandle(GUARD, { create: true });
    for (;;) {
      if (expired || performance.now() >= deadline) throw timeoutError();
      let handle: FileSystemSyncAccessHandle;
      try {
        handle = await file.createSyncAccessHandle();
      } catch (cause) {
        if ((cause as { name?: string } | null)?.name !== 'NoModificationAllowedError') throw cause;
        lastContention = cause;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        continue;
      }
      if (expired || performance.now() >= deadline) {
        handle.close();
        throw timeoutError();
      }
      return handle;
    }
  })();
  try {
    return await Promise.race([acquiring, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function absent(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'NotFoundError';
}

async function writeNative(
  root: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const file = await root.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      /* Native close may already have settled. */
    }
    throw error;
  }
}

interface LoadedReplica {
  readonly segments: readonly string[];
  readonly sizes: readonly number[];
  readonly entries: Map<string, CommittedReplicaEntry>;
  readonly images: readonly ReplicaImage[];
}

async function load(root: FileSystemDirectoryHandle): Promise<LoadedReplica> {
  let head: FileSystemFileHandle;
  try {
    head = await root.getFileHandle(HEAD);
  } catch (error) {
    if (!absent(error)) throw error;
    return { segments: [], sizes: [], entries: emptyReplicaEntries(), images: [] };
  }
  const segments = await decodeHead(new Uint8Array(await (await head.getFile()).arrayBuffer()));
  const entries = emptyReplicaEntries();
  const images = new Map<string, ReplicaImage>();
  const sizes: number[] = [];
  for (const digest of segments) {
    let file: File;
    try {
      file = await (await root.getFileHandle(segmentName(digest))).getFile();
    } catch (error) {
      if (absent(error)) throw new ReplicaCorruptionError('Committed segment is missing');
      throw error;
    }
    sizes.push(file.size);
    const records = await decodeSegment(new Uint8Array(await file.arrayBuffer()), digest);
    applyReplicaRecords(entries, records, images);
  }
  return { segments, sizes, entries, images: [...images.values()] };
}

export class OpfsReplicaStore implements ReplicaPersistence {
  #entries: Map<string, CommittedReplicaEntry>;
  #segments: readonly string[];
  #sizes: readonly number[];
  #closing = false;
  #guard: FileSystemSyncAccessHandle | null;
  #forceBase = false;
  readonly layoutIssue?: OpfsLayoutIssue;

  private constructor(
    private readonly root: FileSystemDirectoryHandle,
    guard: FileSystemSyncAccessHandle,
    loaded: LoadedReplica,
    issue?: OpfsLayoutIssue,
  ) {
    this.#guard = guard;
    this.#entries = loaded.entries;
    this.#segments = loaded.segments;
    this.#sizes = loaded.sizes;
    if (issue) this.layoutIssue = issue;
  }

  static async open(
    root: FileSystemDirectoryHandle,
    timeoutMs = PERSIST_OPERATION_REPORT_TIMEOUT_MS,
  ): Promise<{
    readonly store: OpfsReplicaStore;
    readonly images: readonly ReplicaImage[];
  }> {
    const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
    let guard: FileSystemSyncAccessHandle;
    try {
      guard = await acquireGuard(directory, timeoutMs);
    } catch (cause) {
      // A competing owner must not become an apparently successful memory owner.
      throw new OpfsPreloadError(
        new Error('OPFS replica writer is unavailable or already occupied', { cause }),
      );
    }
    try {
      let loaded: LoadedReplica;
      let issue: OpfsLayoutIssue | undefined;
      try {
        loaded = await load(directory);
      } catch (cause) {
        if (!(cause instanceof ReplicaCorruptionError))
          throw cause instanceof OpfsPreloadError ? cause : new OpfsPreloadError(cause);
        // Keep physical evidence; the next genuine mutation publishes the fresh tree.
        loaded = { segments: [], sizes: [], entries: emptyReplicaEntries(), images: [] };
        issue = {
          kind: 'corrupt',
          summary: `Stored replica could not be restored: ${cause.message}. Projects must be materialized again; old bytes remain.`,
        };
      }
      if (!issue && loaded.segments.length === 0) {
        for await (const [name] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
          if (name === DIRECTORY) continue;
          issue = {
            kind: 'legacy',
            summary:
              'Legacy per-file storage was not carried over. Old bytes remain; projects must be materialized from their definitions.',
          };
          break;
        }
      }
      return {
        store: new OpfsReplicaStore(directory, guard, loaded, issue),
        images: loaded.images,
      };
    } catch (error) {
      guard.close();
      throw error;
    }
  }

  assertWritable(): void {
    if (this.#closing || this.#guard === null)
      throw new VfsError('EPERM', '/', 'OPFS replica is closed');
  }

  closeAfter(settled: Promise<void>): void {
    if (this.#closing) return;
    this.#closing = true;
    void settled.then(() => {
      this.#guard?.close();
      this.#guard = null;
    });
  }

  async commit(
    mutations: readonly PersistOperation[],
    records: readonly ReplicaRecord[],
    capture: () => readonly ReplicaImage[],
  ): Promise<{ readonly base: boolean }> {
    if (this.#guard === null) throw new VfsError('EPERM', '/', 'OPFS replica writer was closed');
    const nextBytes = records.reduce(
      (size, entry) => size + (entry.kind === 'file' ? entry.bytes.length : 0),
      0,
    );
    const appended = this.#sizes.slice(1).reduce((sum, size) => sum + size, 0);
    const base =
      this.#forceBase ||
      this.#segments.length === 0 ||
      this.#segments.length >= MAX_SEGMENTS ||
      appended + nextBytes >= Math.max(MIN_COMPACTION_BYTES, this.#sizes[0] ?? 0);
    // Capture is synchronous at the scheduler's batch watermark.
    const images = base ? capture() : records;
    const paths = [...new Set(mutations.flatMap((operation) => operation.paths))];
    const encoded = await encodeSegment(images, paths);
    const entries = base ? emptyReplicaEntries() : new Map(this.#entries);
    applyReplicaRecords(entries, encoded.records);
    const previous = this.#segments;
    const segments = base ? [encoded.digest] : [...previous, encoded.digest];
    await writeNative(this.root, segmentName(encoded.digest), encoded.bytes);
    await writeNative(this.root, HEAD, await encodeHead(segments));
    this.#entries = entries;
    this.#segments = segments;
    this.#sizes = base ? [encoded.bytes.length] : [...this.#sizes, encoded.bytes.length];
    this.#forceBase = false;
    if (base) {
      // HEAD already certifies the tree. Failed reclamation leaves only unreachable bytes.
      for (const digest of previous) {
        if (digest === encoded.digest) continue;
        try {
          await this.root.removeEntry(segmentName(digest));
        } catch {
          /* Reclaim is best-effort. */
        }
      }
    }
    return { base };
  }

  private entry(path: string): CommittedReplicaEntry {
    this.assertWritable();
    const entry = this.#entries.get(path);
    if (entry) return entry;
    let parent = path;
    while (parent !== '/') {
      parent = dirnameNormalized(parent);
      if (this.#entries.get(parent)?.kind === 'file') throw new VfsError('ENOTDIR', path);
    }
    throw new VfsError('ENOENT', path);
  }

  private async nativeEntry(entry: CommittedReplicaEntry): Promise<File | null> {
    const location = entry.location;
    if (!location) return null; // Empty mounted root has no persisted record yet.
    try {
      const file = await (await this.root.getFileHandle(segmentName(location.segment))).getFile();
      const metadata = new Uint8Array(
        await file
          .slice(location.metadataOffset, location.metadataOffset + location.metadata.length)
          .arrayBuffer(),
      );
      if (
        metadata.length !== location.metadata.length ||
        !metadata.every((byte, index) => byte === location.metadata[index])
      )
        throw new ReplicaCorruptionError('Native replica metadata changed');
      return file;
    } catch (error) {
      this.#forceBase = true;
      throw error;
    }
  }

  async readFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const normalized = normalizeAbsolute(path);
    const entry = this.entry(normalized);
    if (entry.kind !== 'file') throw new VfsError('EISDIR', path);
    const file = await this.nativeEntry(entry);
    const location = entry.location;
    if (!file || !location || location.digest === null)
      throw new VfsError('EIO', path, 'Missing native file record');
    const bytes = new Uint8Array(
      await file.slice(location.offset, location.offset + location.size).arrayBuffer(),
    );
    if (bytes.length !== location.size || (await replicaDigest(bytes)) !== location.digest) {
      this.#forceBase = true;
      throw new VfsError('EIO', path, 'Native replica content checksum mismatch');
    }
    return bytes;
  }

  async stat(path: string): Promise<VfsStat> {
    const entry = this.entry(normalizeAbsolute(path));
    await this.nativeEntry(entry);
    if (entry.kind === 'file' && entry.location === null)
      throw new VfsError('EIO', path, 'Missing native file record');
    return {
      isFile: entry.kind === 'file',
      isDirectory: entry.kind === 'dir',
      size: entry.location?.size ?? 0,
      mtime: entry.mtime,
    };
  }

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    const normalized = normalizeAbsolute(path);
    const entry = this.entry(normalized);
    if (entry.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    await this.nativeEntry(entry);
    const children: VfsDirent[] = [];
    for (const child of this.#entries.values()) {
      if (child.path !== normalized && dirnameNormalized(child.path) === normalized)
        children.push({
          name: child.path.slice(child.path.lastIndexOf('/') + 1),
          isFile: child.kind === 'file',
          isDirectory: child.kind === 'dir',
        });
    }
    return children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  }
}
