import type { VfsDirent } from '@riftydev/vfs';
import {
  type AsyncFsOpsTarget,
  copyTreeAsync,
  createDirAsync,
  createFileAsync,
  deletePathAsync,
  renamePathAsync,
} from './fs-ops.ts';
import {
  type OwnerMutationCoordinator,
  createOwnerMutationCoordinator,
} from './owner-mutation-coordinator.ts';
import type { OwnerWritePort } from './owner-write-barrier.ts';
import type { SnapshotFs } from './snapshot-fs.ts';
import type { VfsWriteFrame } from './vfs-write-port.ts';

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export interface OwnerRpcFsWriter extends OwnerWritePort<VfsWriteFrame> {}

interface OwnerRpcFsOptions {
  readonly timeoutMs?: number;
}

/**
 * Page-side writable target for explorer mutations.
 *
 * Reads come from the read-only snapshot. Writes emit owner frames and resolve
 * only after a later snapshot publish reflects the owner-side result.
 */
export class OwnerRpcFs implements AsyncFsOpsTarget {
  readonly readOnly = false;

  #snapshot: SnapshotFs;
  #coordinator: OwnerMutationCoordinator<VfsWriteFrame>;

  constructor(
    snapshot: SnapshotFs,
    owner: () => OwnerRpcFsWriter,
    options: OwnerRpcFsOptions = {},
  ) {
    this.#snapshot = snapshot;
    this.#coordinator = createOwnerMutationCoordinator({
      currentOwner: owner,
      subscribeSnapshot: (listener) => snapshot.subscribe(listener),
      timeoutMs: options.timeoutMs ?? 5_000,
      label: 'owner RPC fs write',
    });
  }

  existsSync(path: string): boolean {
    return this.#snapshot.existsSync(path);
  }

  readFileBytesSync(path: string): Uint8Array {
    return this.#snapshot.readFileBytesSync(path);
  }

  readdirSync(path: string): readonly VfsDirent[] {
    return this.#snapshot.readdirSync(path);
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    return this.#snapshot.statSync(path);
  }

  createFile(path: string): Promise<void> {
    return createFileAsync(this, path);
  }

  createDir(path: string): Promise<void> {
    return createDirAsync(this, path);
  }

  deletePath(path: string): Promise<void> {
    return deletePathAsync(this, path);
  }

  renamePath(from: string, to: string): Promise<void> {
    return renamePathAsync(this, from, to);
  }

  copyTree(from: string, to: string): Promise<void> {
    return copyTreeAsync(this, from, to);
  }

  writeFile(path: string, data: Uint8Array, options: { recursive?: boolean } = {}): Promise<void> {
    return this.#sendAndWait({ type: 'write', path, data, recursive: options.recursive }, () =>
      this.#isFileWithData(path, data),
    );
  }

  writeFiles(
    entries: readonly {
      readonly path: string;
      readonly data: Uint8Array;
      readonly recursive?: boolean;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    if (entries.length === 1) {
      const entry = entries[0]!;
      return this.writeFile(entry.path, entry.data, { recursive: entry.recursive });
    }
    return this.#sendAndWait(
      {
        type: 'batch',
        frames: entries.map((entry) => ({
          type: 'write',
          path: entry.path,
          data: entry.data,
          recursive: entry.recursive,
        })),
      },
      () => entries.every((entry) => this.#isFileWithData(entry.path, entry.data)),
    );
  }

  mkdir(path: string, options: { recursive?: boolean }): Promise<void> {
    return this.#sendAndWait({ type: 'mkdir', path, recursive: options.recursive ?? false }, () =>
      this.#isDirectory(path),
    );
  }

  rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void> {
    return this.#sendAndWait(
      {
        type: 'rm',
        path,
        recursive: options.recursive ?? false,
        force: options.force ?? false,
      },
      () => !this.existsSync(path),
    );
  }

  rename(from: string, to: string): Promise<void> {
    return this.#sendAndWait(
      { type: 'rename', from, to },
      () => !this.existsSync(from) && this.existsSync(to),
    );
  }

  renameMany(entries: readonly { readonly from: string; readonly to: string }[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    if (entries.length === 1) {
      const entry = entries[0]!;
      return this.rename(entry.from, entry.to);
    }
    return this.#sendAndWait(
      {
        type: 'batch',
        frames: entries.map((entry) => ({ type: 'rename', from: entry.from, to: entry.to })),
      },
      () => entries.every((entry) => !this.existsSync(entry.from) && this.existsSync(entry.to)),
    );
  }

  copy(from: string, to: string): Promise<void> {
    return this.#sendAndWait(
      { type: 'copy', from, to },
      () => this.existsSync(from) && this.existsSync(to),
    );
  }

  dispose(): void {
    this.#coordinator.dispose(new Error('owner RPC fs disposed'));
  }

  #sendAndWait(frame: VfsWriteFrame, reflected: () => boolean): Promise<void> {
    return this.#coordinator.mutate(frame, reflected);
  }

  #isFileWithData(path: string, data: Uint8Array): boolean {
    try {
      const st = this.statSync(path);
      if (!st.isFile || st.size !== data.byteLength) return false;
      try {
        return bytesEqual(this.readFileBytesSync(path), data);
      } catch {
        return true;
      }
    } catch {
      return false;
    }
  }

  #isDirectory(path: string): boolean {
    try {
      return this.statSync(path).isDirectory;
    } catch {
      return false;
    }
  }
}
