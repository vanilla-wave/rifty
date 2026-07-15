import type {
  HostCommitOperation,
  OwnerVfsRevisionFrame,
  OwnerVfsSnapshotEntry,
} from '../glue/owner-vfs-protocol.ts';
import { VfsCommitAppliedError } from '../glue/owner-vfs-protocol.ts';
import type { SnapshotFs } from '../glue/snapshot-fs.ts';
import type { VfsCommitCoordinator, VfsCommitReceipt } from '../glue/vfs-commit-coordinator.ts';
import { ClosedHandleError, type ProjectFileEntry } from './errors.ts';
import {
  type OwnerProjectFileEntry,
  type ProjectFileVersionBoundary,
  assertProjectPath,
  projectFileFailure,
  toOwnerProjectPath,
  toProjectFileEntry,
} from './project-file-boundary.ts';

const EXCLUDED_DIRECTORY_NAMES = Object.freeze(['node_modules', '.git', '.vite', 'dist'] as const);
const EXCLUDED_DIRECTORIES = new Set<string>(EXCLUDED_DIRECTORY_NAMES);

export interface ProjectFileRead {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly version: string;
}

export interface ProjectFileMutationResult {
  readonly path: string;
  readonly version: string;
}

export interface ProjectFilesSnapshot {
  readonly excludedDirectoryNames: readonly string[];
  readonly entries: readonly ProjectFileEntry[];
}

export type ProjectFilesListener = (snapshot: ProjectFilesSnapshot) => void;

export interface ProjectWriteFileOptions {
  readonly expectedVersion: string | null;
}

export interface ProjectMkdirOptions {
  readonly expectedVersion: null;
}

export interface ProjectRenameOptions {
  readonly expectedSourceVersion: string;
  readonly expectedTargetVersion: string | null;
}

export interface ProjectRemoveOptions {
  readonly expectedVersion: string;
  readonly recursive?: boolean;
}

export interface ProjectFiles {
  readFile(path: string): Promise<ProjectFileRead>;
  readdir(path: string): Promise<readonly ProjectFileEntry[]>;
  writeFile(
    path: string,
    data: Uint8Array,
    options: ProjectWriteFileOptions,
  ): Promise<ProjectFileMutationResult>;
  mkdir(path: string, options: ProjectMkdirOptions): Promise<ProjectFileMutationResult>;
  rename(
    sourcePath: string,
    targetPath: string,
    options: ProjectRenameOptions,
  ): Promise<ProjectFileMutationResult>;
  remove(path: string, options: ProjectRemoveOptions): Promise<void>;
  snapshot(): ProjectFilesSnapshot;
  subscribe(listener: ProjectFilesListener): () => void;
}

export type ProjectFilesAppliedMutation =
  | {
      readonly kind: 'rename';
      readonly sourcePath: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: 'remove';
      readonly path: string;
      readonly recursive: boolean;
    };

export interface ProjectFilesControllerOptions {
  readonly projectRoot: string;
  readonly versions: ProjectFileVersionBoundary;
  readonly snapshots: Pick<SnapshotFs, 'entries' | 'subscribe'>;
  readonly committer: Pick<VfsCommitCoordinator, 'commit'>;
  readonly readVersionedFile: (path: string) => Promise<OwnerVfsSnapshotEntry>;
  readonly readVersionedDirectory: (path: string) => Promise<readonly OwnerProjectFileEntry[]>;
  readonly onAppliedMutation?: (
    mutation: ProjectFilesAppliedMutation,
    revision: OwnerVfsRevisionFrame,
  ) => void;
}

export interface ProjectFilesController {
  readonly files: ProjectFiles;
  close(): void;
}

interface MutationFailureContext {
  readonly operation: 'writeFile' | 'mkdir' | 'rename' | 'remove';
  readonly path: string;
  readonly targetPath?: string;
}

function assertVersion(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertVersionOrAbsent(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertVersion(value, label);
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error('Invalid project mutation receipt');
}

function exactUpdate(
  receipt: VfsCommitReceipt,
  path: string,
  expected: 'present' | 'absent',
): string | null {
  const updates = receipt.versions.filter((candidate) => candidate.path === path);
  if (updates.length !== 1) throw new Error('Invalid project mutation receipt');
  const version = updates[0]?.version;
  if (expected === 'absent') {
    if (version !== null) throw new Error('Invalid project mutation receipt');
    return null;
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Invalid project mutation receipt');
  }
  return version;
}

function assertExactUpdateCount(receipt: VfsCommitReceipt, count: number): void {
  if (receipt.versions.length !== count) throw new Error('Invalid project mutation receipt');
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === 0 ? '/' : path.slice(0, separator);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function sortEntries(entries: readonly ProjectFileEntry[]): readonly ProjectFileEntry[] {
  return [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/**
 * Project-rooted file authority. Physical paths, owner evidence, commit
 * sequencing, snapshot exclusions, and failure translation stay behind this
 * handle.
 */
export function createProjectFilesController(
  options: ProjectFilesControllerOptions,
): ProjectFilesController {
  const listeners = new Set<ProjectFilesListener>();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new ClosedHandleError('Project files');
  };

  const currentSnapshot = (): ProjectFilesSnapshot => {
    const entries = sortEntries(
      options.snapshots
        .entries()
        .map((entry) => toProjectFileEntry(options.projectRoot, entry, options.versions)),
    );
    const excludedRoots = entries
      .filter((entry) => entry.kind === 'dir' && EXCLUDED_DIRECTORIES.has(baseName(entry.path)))
      .map((entry) => entry.path);
    const visible = entries.filter(
      (entry) =>
        !excludedRoots.some((root) => entry.path === root || entry.path.startsWith(`${root}/`)),
    );
    return Object.freeze({
      excludedDirectoryNames: EXCLUDED_DIRECTORY_NAMES,
      entries: Object.freeze(visible),
    });
  };

  const publish = (): void => {
    if (closed) return;
    const snapshot = currentSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Host listener faults cannot suppress sibling state delivery.
      }
    }
  };

  let detachSnapshots = options.snapshots.subscribe(publish);

  const commit = async <Result>(
    operation: HostCommitOperation,
    context: MutationFailureContext,
    finish: (receipt: VfsCommitReceipt) => Result,
    appliedMutation?: ProjectFilesAppliedMutation,
  ): Promise<Result> => {
    let receipt: VfsCommitReceipt;
    try {
      receipt = await options.committer.commit(
        operation,
        appliedMutation === undefined || options.onAppliedMutation === undefined
          ? undefined
          : {
              onApplied: (revision) => {
                options.onAppliedMutation?.(appliedMutation, revision);
              },
            },
      );
    } catch (error) {
      throw projectFileFailure(options.projectRoot, options.versions, error, context);
    }

    try {
      return finish(receipt);
    } catch (error) {
      throw projectFileFailure(
        options.projectRoot,
        options.versions,
        new VfsCommitAppliedError(receipt, errorFrom(error)),
        context,
      );
    }
  };

  const files: ProjectFiles = Object.freeze({
    async readFile(path: string) {
      assertOpen();
      const logicalPath = assertProjectPath(path, { allowRoot: true });
      const ownerPath = toOwnerProjectPath(options.projectRoot, logicalPath, { allowRoot: true });
      try {
        const entry = await options.readVersionedFile(ownerPath);
        if (
          entry.path !== ownerPath ||
          entry.kind !== 'file' ||
          !(entry.content instanceof Uint8Array) ||
          entry.content.byteLength !== entry.size
        ) {
          throw new TypeError('Invalid atomic file read');
        }
        const metadata = toProjectFileEntry(options.projectRoot, entry, options.versions);
        return Object.freeze({
          path: metadata.path,
          bytes: entry.content.slice(),
          version: metadata.version,
        });
      } catch (error) {
        throw projectFileFailure(options.projectRoot, options.versions, error, {
          operation: 'readFile',
          path: logicalPath,
        });
      }
    },

    async readdir(path: string) {
      assertOpen();
      const logicalPath = assertProjectPath(path, { allowRoot: true });
      const ownerPath = toOwnerProjectPath(options.projectRoot, logicalPath, { allowRoot: true });
      try {
        const ownerEntries = await options.readVersionedDirectory(ownerPath);
        const seen = new Set<string>();
        const entries = ownerEntries.map((entry) => {
          const mapped = toProjectFileEntry(options.projectRoot, entry, options.versions);
          if (parentPath(mapped.path) !== logicalPath || seen.has(mapped.path)) {
            throw new TypeError('Invalid atomic directory read');
          }
          if (mapped.kind === 'dir' && mapped.size !== 0) {
            throw new TypeError('Invalid atomic directory read');
          }
          seen.add(mapped.path);
          return mapped;
        });
        return Object.freeze(entries);
      } catch (error) {
        throw projectFileFailure(options.projectRoot, options.versions, error, {
          operation: 'readdir',
          path: logicalPath,
        });
      }
    },

    async writeFile(path: string, data: Uint8Array, mutationOptions: ProjectWriteFileOptions) {
      assertOpen();
      const logicalPath = assertProjectPath(path);
      if (!(data instanceof Uint8Array)) throw new TypeError('File data must be Uint8Array');
      if (typeof mutationOptions !== 'object' || mutationOptions === null) {
        throw new TypeError('writeFile options are required');
      }
      assertVersionOrAbsent(mutationOptions.expectedVersion, 'expectedVersion');
      const ownerPath = toOwnerProjectPath(options.projectRoot, logicalPath);
      const expectedVersion =
        mutationOptions.expectedVersion === null
          ? null
          : options.versions.toOwner(mutationOptions.expectedVersion, 'expectedVersion');
      return commit(
        {
          kind: 'write',
          path: ownerPath,
          data: data.slice(),
          expectedVersion,
        },
        { operation: 'writeFile', path: logicalPath },
        (receipt) => {
          assertExactUpdateCount(receipt, 1);
          const version = exactUpdate(receipt, ownerPath, 'present');
          if (version === null) throw new Error('Invalid project mutation receipt');
          return Object.freeze({ path: logicalPath, version: options.versions.toPublic(version) });
        },
      );
    },

    async mkdir(path: string, mutationOptions: ProjectMkdirOptions) {
      assertOpen();
      const logicalPath = assertProjectPath(path);
      if (
        typeof mutationOptions !== 'object' ||
        mutationOptions === null ||
        mutationOptions.expectedVersion !== null
      ) {
        throw new TypeError('mkdir requires expectedVersion null');
      }
      const ownerPath = toOwnerProjectPath(options.projectRoot, logicalPath);
      return commit(
        { kind: 'mkdir', path: ownerPath, expectedVersion: null },
        { operation: 'mkdir', path: logicalPath },
        (receipt) => {
          assertExactUpdateCount(receipt, 1);
          const version = exactUpdate(receipt, ownerPath, 'present');
          if (version === null) throw new Error('Invalid project mutation receipt');
          return Object.freeze({ path: logicalPath, version: options.versions.toPublic(version) });
        },
      );
    },

    async rename(sourcePath: string, targetPath: string, mutationOptions: ProjectRenameOptions) {
      assertOpen();
      const logicalSource = assertProjectPath(sourcePath);
      const logicalTarget = assertProjectPath(targetPath);
      if (logicalSource === logicalTarget) {
        throw new TypeError('rename source and target must differ');
      }
      if (typeof mutationOptions !== 'object' || mutationOptions === null) {
        throw new TypeError('rename options are required');
      }
      assertVersion(mutationOptions.expectedSourceVersion, 'expectedSourceVersion');
      assertVersionOrAbsent(mutationOptions.expectedTargetVersion, 'expectedTargetVersion');
      const ownerSource = toOwnerProjectPath(options.projectRoot, logicalSource);
      const ownerTarget = toOwnerProjectPath(options.projectRoot, logicalTarget);
      const expectedSourceVersion = options.versions.toOwner(
        mutationOptions.expectedSourceVersion,
        'expectedSourceVersion',
      );
      const expectedTargetVersion =
        mutationOptions.expectedTargetVersion === null
          ? null
          : options.versions.toOwner(
              mutationOptions.expectedTargetVersion,
              'expectedTargetVersion',
            );
      return commit(
        {
          kind: 'rename',
          sourcePath: ownerSource,
          targetPath: ownerTarget,
          expectedSourceVersion,
          expectedTargetVersion,
        },
        { operation: 'rename', path: logicalSource, targetPath: logicalTarget },
        (receipt) => {
          assertExactUpdateCount(receipt, 2);
          exactUpdate(receipt, ownerSource, 'absent');
          const version = exactUpdate(receipt, ownerTarget, 'present');
          if (version === null) throw new Error('Invalid project mutation receipt');
          return Object.freeze({
            path: logicalTarget,
            version: options.versions.toPublic(version),
          });
        },
        Object.freeze({
          kind: 'rename',
          sourcePath: logicalSource,
          targetPath: logicalTarget,
        }),
      );
    },

    async remove(path: string, mutationOptions: ProjectRemoveOptions) {
      assertOpen();
      const logicalPath = assertProjectPath(path);
      if (typeof mutationOptions !== 'object' || mutationOptions === null) {
        throw new TypeError('remove options are required');
      }
      assertVersion(mutationOptions.expectedVersion, 'expectedVersion');
      if (
        mutationOptions.recursive !== undefined &&
        typeof mutationOptions.recursive !== 'boolean'
      ) {
        throw new TypeError('recursive must be boolean');
      }
      const recursive = mutationOptions.recursive ?? false;
      const ownerPath = toOwnerProjectPath(options.projectRoot, logicalPath);
      const expectedVersion = options.versions.toOwner(
        mutationOptions.expectedVersion,
        'expectedVersion',
      );
      return commit(
        {
          kind: 'remove',
          path: ownerPath,
          expectedVersion,
          ...(mutationOptions.recursive === undefined ? {} : { recursive }),
        },
        { operation: 'remove', path: logicalPath },
        (receipt) => {
          assertExactUpdateCount(receipt, 1);
          exactUpdate(receipt, ownerPath, 'absent');
        },
        Object.freeze({ kind: 'remove', path: logicalPath, recursive }),
      );
    },

    snapshot() {
      assertOpen();
      return currentSnapshot();
    },

    subscribe(listener: ProjectFilesListener) {
      assertOpen();
      if (typeof listener !== 'function') throw new TypeError('File listener must be a function');
      const snapshot = currentSnapshot();
      listeners.add(listener);
      try {
        listener(snapshot);
      } catch {
        // Initial delivery obeys the same sibling-fault isolation rule.
      }
      return () => {
        listeners.delete(listener);
      };
    },
  });

  return Object.freeze({
    files,
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      const detach = detachSnapshots;
      detachSnapshots = (): void => {};
      detach();
    },
  });
}
