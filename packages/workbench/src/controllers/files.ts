import { dirname, normalizePath } from '@riftydev/vfs';
import { errorsFrom, notifySubscribers } from '../fault-boundary.ts';
import { type TreeChild, readChildren } from '../glue/file-tree.ts';
import { createOwnerMutationCoordinator } from '../glue/owner-mutation-coordinator.ts';
import type { OwnerWritePort } from '../glue/owner-write-barrier.ts';
import { SnapshotFs } from '../glue/snapshot-fs.ts';
import type { VfsSnapshotEntry, VfsSnapshotFrame } from '../glue/vfs-snapshot-port.ts';
import type { VfsWriteFrame } from '../glue/vfs-write-port.ts';

export interface FilesOwnerPort extends OwnerWritePort<VfsWriteFrame> {
  onSnapshot?(listener: (frame: VfsSnapshotFrame) => void): () => void;
  requestSnapshot?(): void;
}

export interface FilesSnapshot {
  readonly root: string;
  readonly revision: number;
  readonly ready: boolean;
  /** True only after the latest controller mutation crossed the owner barrier. */
  readonly durable: boolean;
  readonly nodeModulesPresent: boolean;
  readonly entries: readonly VfsSnapshotEntry[];
  readonly pendingMutations: number;
  readonly error: string | null;
}

export interface FilesControllerOptions {
  readonly root: string;
  readonly storageBackend: 'opfs' | 'memory';
  readonly currentOwner: () => FilesOwnerPort;
  /** Optional session-owned snapshot bridge. Owner methods are used otherwise. */
  readonly subscribeSnapshots?: (listener: (frame: VfsSnapshotFrame) => void) => () => void;
  readonly requestSnapshot?: () => void;
  readonly reflectTimeoutMs?: number;
}

export interface FilesController {
  snapshot(): FilesSnapshot;
  subscribe(listener: (snapshot: FilesSnapshot) => void): () => void;
  /** Alias for `subscribe`, named for file-tree consumers. */
  watch(listener: (snapshot: FilesSnapshot) => void): () => void;
  applySnapshot(frame: VfsSnapshotFrame): void;
  list(path?: string): readonly TreeChild[];
  createFile(path: string, contents?: string | Uint8Array): Promise<void>;
  createDirectory(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  deletePath(
    path: string,
    options?: { readonly recursive?: boolean; readonly force?: boolean },
  ): Promise<void>;
  dispose(): void;
}

const DEFAULT_REFLECT_TIMEOUT_MS = 5_000;
const encoder = new TextEncoder();

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copyEntry(entry: VfsSnapshotEntry): VfsSnapshotEntry {
  return {
    path: entry.path,
    kind: entry.kind,
    size: entry.size,
    ...(entry.content === undefined ? {} : { content: entry.content.slice() }),
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function createFilesController(options: FilesControllerOptions): FilesController {
  const root = normalizePath(options.root);
  const reflectTimeoutMs = options.reflectTimeoutMs ?? DEFAULT_REFLECT_TIMEOUT_MS;
  if (!Number.isFinite(reflectTimeoutMs) || reflectTimeoutMs <= 0) {
    throw new Error('files reflectTimeoutMs must be a positive finite number');
  }
  const fs = new SnapshotFs(root);
  let disposed = false;
  let revision = 0;
  let ready = false;
  let durable = false;
  let pendingMutations = 0;
  let lastError: string | null = null;
  let unsubscribeSnapshots: (() => void) | null = null;
  const listeners = new Set<(snapshot: FilesSnapshot) => void>();
  let state: FilesSnapshot = {
    root,
    revision,
    ready,
    durable,
    nodeModulesPresent: false,
    entries: [],
    pendingMutations,
    error: null,
  };

  const assertAlive = (): void => {
    if (disposed) throw new Error('files controller disposed');
  };

  const buildSnapshot = (): FilesSnapshot => ({
    root,
    revision,
    ready,
    durable,
    nodeModulesPresent: fs.nodeModulesPresent,
    entries: fs.entries().map(copyEntry),
    pendingMutations,
    error: lastError,
  });

  const publish = (): void => {
    if (disposed) return;
    state = buildSnapshot();
    notifySubscribers(listeners, state);
  };

  const canonical = (path: string): string => {
    const normalized = normalizePath(path);
    const inside = root === '/' ? normalized.startsWith('/') : normalized.startsWith(`${root}/`);
    if (normalized !== root && !inside) {
      throw new Error(`path "${path}" is outside workspace root "${root}"`);
    }
    return normalized;
  };

  const assertParentDirectory = (path: string): void => {
    const parent = dirname(path);
    let stat: ReturnType<SnapshotFs['statSync']>;
    try {
      stat = fs.statSync(parent);
    } catch {
      throw new Error(`ENOENT: no such parent directory "${parent}"`);
    }
    if (!stat.isDirectory) throw new Error(`ENOTDIR: parent "${parent}" is not a directory`);
  };

  const fileMatches = (path: string, data: Uint8Array): boolean => {
    try {
      const stat = fs.statSync(path);
      if (!stat.isFile || stat.size !== data.byteLength) return false;
      try {
        return bytesEqual(fs.readFileBytesSync(path), data);
      } catch {
        // Large owner snapshots omit bytes; exact size + owner ack is the strongest
        // available reflection proof for that explicit snapshot contract.
        return true;
      }
    } catch {
      return false;
    }
  };

  const mutationCoordinator = createOwnerMutationCoordinator({
    currentOwner: options.currentOwner,
    subscribeSnapshot: (listener) => fs.subscribe(listener),
    timeoutMs: reflectTimeoutMs,
    label: 'owner VFS mutation',
  });

  const mutate = (frame: VfsWriteFrame, reflected: () => boolean): Promise<void> => {
    assertAlive();
    pendingMutations += 1;
    durable = false;
    lastError = null;
    publish();
    return mutationCoordinator.mutate(frame, reflected).then(
      () => {
        pendingMutations -= 1;
        durable = pendingMutations === 0 && options.storageBackend === 'opfs';
        publish();
      },
      (error: unknown) => {
        const failure = asError(error);
        pendingMutations -= 1;
        durable = false;
        if (!disposed) {
          lastError = failure.message;
          publish();
        }
        throw failure;
      },
    );
  };

  const applySnapshot = (frame: VfsSnapshotFrame): void => {
    assertAlive();
    if (frame.root !== root) {
      throw new Error(`snapshot root "${frame.root}" does not match files root "${root}"`);
    }
    const safeFrame: VfsSnapshotFrame = {
      type: 'snapshot',
      root,
      entries: frame.entries.map((entry) => {
        const path = canonical(entry.path);
        if (path !== entry.path) {
          throw new Error(`snapshot entry path "${entry.path}" is not normalized`);
        }
        return copyEntry(entry);
      }),
      nodeModulesPresent: frame.nodeModulesPresent,
    };
    fs.update(safeFrame);
    revision += 1;
    ready = true;
    durable = false;
    publish();
  };

  const subscribe = (listener: (snapshot: FilesSnapshot) => void): (() => void) => {
    assertAlive();
    listeners.add(listener);
    notifySubscribers([listener], state);
    return () => listeners.delete(listener);
  };

  const owner = options.currentOwner();
  const subscribeSource = options.subscribeSnapshots ?? owner.onSnapshot?.bind(owner);
  if (subscribeSource) {
    unsubscribeSnapshots = subscribeSource((frame) => {
      if (!disposed) applySnapshot(frame);
    });
  }
  const requestSource = options.requestSnapshot ?? owner.requestSnapshot?.bind(owner);
  try {
    requestSource?.();
  } catch (error) {
    const primary = asError(error);
    const unsubscribe = unsubscribeSnapshots;
    unsubscribeSnapshots = null;
    try {
      unsubscribe?.();
    } catch (cleanupError) {
      const failures = [primary, ...errorsFrom(cleanupError)];
      throw new AggregateError(failures, failures.map((failure) => failure.message).join('; '));
    }
    throw primary;
  }

  return {
    snapshot() {
      assertAlive();
      return state;
    },
    subscribe,
    watch: subscribe,
    applySnapshot,
    list(path = root) {
      assertAlive();
      return readChildren(fs, canonical(path));
    },
    async createFile(path, contents = new Uint8Array()) {
      assertAlive();
      const target = canonical(path);
      if (target === root) throw new Error('cannot create a file over the root');
      if (fs.existsSync(target)) throw new Error(`"${target}" already exists`);
      assertParentDirectory(target);
      const data = typeof contents === 'string' ? encoder.encode(contents) : contents.slice();
      await mutate({ type: 'write', path: target, data, recursive: false, ifAbsent: true }, () =>
        fileMatches(target, data),
      );
    },
    async createDirectory(path, mutationOptions = {}) {
      assertAlive();
      const target = canonical(path);
      if (target === root) throw new Error(`"${target}" already exists`);
      if (fs.existsSync(target)) throw new Error(`"${target}" already exists`);
      if (mutationOptions.recursive !== true) assertParentDirectory(target);
      await mutate(
        { type: 'mkdir', path: target, recursive: mutationOptions.recursive ?? false },
        () => {
          try {
            return fs.statSync(target).isDirectory;
          } catch {
            return false;
          }
        },
      );
    },
    async rename(from, to) {
      assertAlive();
      const source = canonical(from);
      const target = canonical(to);
      if (source === target) return;
      if (source === root) throw new Error('cannot rename the workspace root');
      if (!fs.existsSync(source)) {
        throw new Error(`ENOENT: no such file or directory "${source}"`);
      }
      if (fs.existsSync(target)) throw new Error(`"${target}" already exists`);
      assertParentDirectory(target);
      await mutate({ type: 'rename', from: source, to: target }, () => {
        return !fs.existsSync(source) && fs.existsSync(target);
      });
    },
    async deletePath(path, mutationOptions = {}) {
      assertAlive();
      const target = canonical(path);
      if (target === root) throw new Error('cannot delete the workspace root');
      if (!fs.existsSync(target) && mutationOptions.force !== true) {
        throw new Error(`ENOENT: no such file or directory "${target}"`);
      }
      if (!fs.existsSync(target)) return;
      await mutate(
        {
          type: 'rm',
          path: target,
          recursive: mutationOptions.recursive ?? true,
          force: mutationOptions.force ?? false,
        },
        () => !fs.existsSync(target),
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: Error[] = [];
      const unsubscribe = unsubscribeSnapshots;
      unsubscribeSnapshots = null;
      try {
        unsubscribe?.();
      } catch (error) {
        errors.push(asError(error));
      }
      const failure = new Error('files controller disposed');
      try {
        mutationCoordinator.dispose(failure);
      } catch (error) {
        errors.push(asError(error));
      }
      listeners.clear();
      if (errors.length > 0) throw new AggregateError(errors, 'files controller dispose failed');
    },
  };
}
