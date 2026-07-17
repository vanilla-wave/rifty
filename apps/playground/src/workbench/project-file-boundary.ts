import type { PersistFailure } from '@riftydev/vfs';
import {
  type HostCommitAck,
  VfsCommitAppliedError,
  VfsVersionConflictError,
} from '../glue/owner-vfs-protocol.ts';
import { VfsCommitTimeoutError } from '../glue/vfs-commit-coordinator.ts';
import {
  FileConflictError,
  type ProjectFileEntry,
  type ProjectFileOperation,
  ProjectFileOperationError,
} from './errors.ts';

export interface ProjectPathOptions {
  readonly allowRoot?: boolean;
}

export interface ProjectFileFailureContext {
  readonly operation: ProjectFileOperation;
  readonly path: string;
  readonly targetPath?: string;
}

export interface ProjectFileVersionBoundary {
  toPublic(ownerVersion: string): string;
  toOwner(publicVersion: string, label: string): string;
}

export function createProjectFileVersionSessionNonce(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Project file versions require cryptographic randomUUID support');
  }
  return globalThis.crypto.randomUUID();
}

/** Session-local bijection; raw owner authority never crosses the public API. */
export function createProjectFileVersionBoundary(sessionNonce: string): ProjectFileVersionBoundary {
  if (typeof sessionNonce !== 'string' || sessionNonce.length === 0) {
    throw new TypeError('Project file version session nonce must be non-empty');
  }
  const ownerToPublic = new Map<string, string>();
  const publicToOwner = new Map<string, string>();
  let sequence = 0n;

  return Object.freeze({
    toPublic(ownerVersion: string) {
      if (typeof ownerVersion !== 'string' || ownerVersion.length === 0) {
        throw new TypeError('Owner file version must be non-empty');
      }
      const known = ownerToPublic.get(ownerVersion);
      if (known !== undefined) return known;
      sequence += 1n;
      const publicVersion = `project-version:${sessionNonce}:${sequence.toString(36)}`;
      ownerToPublic.set(ownerVersion, publicVersion);
      publicToOwner.set(publicVersion, ownerVersion);
      return publicVersion;
    },

    toOwner(publicVersion: string, label: string) {
      if (typeof publicVersion !== 'string' || publicVersion.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
      }
      const ownerVersion = publicToOwner.get(publicVersion);
      if (ownerVersion === undefined) {
        throw new TypeError(`${label} is not from this ProjectSession`);
      }
      return ownerVersion;
    },
  });
}

/** Owner-rooted metadata accepted from either an atomic read or directory listing. */
export interface OwnerProjectFileEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly version: string;
}

/** Strict public logical path. No normalization: ambiguous input is rejected. */
export function assertProjectPath(path: string, options: ProjectPathOptions = {}): string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path[0] !== '/' ||
    path.includes('\0') ||
    (path !== '/' && path.endsWith('/'))
  ) {
    throw new TypeError('Invalid project path');
  }
  if (path === '/') {
    if (options.allowRoot === true) return path;
    throw new TypeError('Project root cannot be mutated');
  }

  const segments = path.slice(1).split('/');
  if (
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments[0] === '.rifty'
  ) {
    throw new TypeError('Invalid project path');
  }
  return path;
}

/** Map a public logical path into the private owner tree. */
export function toOwnerProjectPath(
  projectRoot: string,
  path: string,
  options: ProjectPathOptions = {},
): string {
  const logicalPath = assertProjectPath(path, options);
  return logicalPath === '/' ? projectRoot : `${projectRoot}${logicalPath}`;
}

/** Map a private owner path into the public logical namespace. */
export function toProjectPath(projectRoot: string, ownerPath: string): string {
  if (ownerPath === projectRoot) return '/';
  if (!ownerPath.startsWith(`${projectRoot}/`)) {
    throw new TypeError('Owner entry is outside the project');
  }
  return assertProjectPath(ownerPath.slice(projectRoot.length), { allowRoot: true });
}

/** Owner paths with no public project representation stay opaque. */
export function projectPathOrOutside(projectRoot: string, ownerPath: string): string {
  try {
    return toProjectPath(projectRoot, ownerPath);
  } catch {
    return '[outside active project]';
  }
}

/** One owner durability sample translated into the public project namespace. */
export function formatProjectPersistenceFailure(
  projectRoot: string,
  failure: PersistFailure,
): string {
  const path = projectPathOrOutside(projectRoot, failure.path);
  const message = failure.message.replaceAll(failure.path, path).replaceAll(projectRoot, '');
  return `${failure.op} ${path}: ${message}`;
}

/** Strip owner-only entry fields and clone the stable public metadata. */
export function toProjectFileEntry(
  projectRoot: string,
  entry: OwnerProjectFileEntry,
  versions: ProjectFileVersionBoundary,
): ProjectFileEntry {
  if (
    (entry.kind !== 'file' && entry.kind !== 'dir') ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    typeof entry.version !== 'string' ||
    entry.version.length === 0
  ) {
    throw new TypeError('Invalid owner file entry');
  }
  return Object.freeze({
    path: toProjectPath(projectRoot, entry.path),
    kind: entry.kind,
    size: entry.size,
    version: versions.toPublic(entry.version),
  });
}

/** Exact conflict evidence, translated once at the public boundary. */
export function toFileConflict(
  projectRoot: string,
  error: VfsVersionConflictError,
  versions: ProjectFileVersionBoundary,
): FileConflictError {
  const actualEntry =
    error.actualEntry === null
      ? null
      : toProjectFileEntry(projectRoot, error.actualEntry, versions);
  return new FileConflictError({
    path: toProjectPath(projectRoot, error.path),
    expectedVersion:
      error.expectedVersion === null ? null : versions.toPublic(error.expectedVersion),
    actualVersion: error.actualVersion === null ? null : versions.toPublic(error.actualVersion),
    actualEntry,
    actualBytes: error.actualBytes,
  });
}

function appliedAck(error: unknown) {
  if (error instanceof VfsCommitAppliedError) return error.applied;
  if (error instanceof VfsCommitTimeoutError) return error.ack;
  return null;
}

/** One document write ACK may prove exactly one non-null file version. */
export function exactSingletonFileVersion(
  ack: Pick<HostCommitAck, 'versions'>,
  ownerPath: string,
): string | undefined {
  if (ack.versions.length !== 1) return undefined;
  const update = ack.versions[0];
  return update?.path === ownerPath &&
    typeof update.version === 'string' &&
    update.version.length > 0
    ? update.version
    : undefined;
}

/** Version proven by the ACK even when reflection or durability later failed. */
export function appliedVersionForPath(error: unknown, ownerPath: string): string | undefined {
  const ack = appliedAck(error);
  return ack === null ? undefined : exactSingletonFileVersion(ack, ownerPath);
}

/** Sanitize every owner/transport failure before it crosses Workbench's API. */
export function projectFileFailure(
  projectRoot: string,
  versions: ProjectFileVersionBoundary,
  error: unknown,
  context: ProjectFileFailureContext,
): Error {
  if (error instanceof FileConflictError || error instanceof ProjectFileOperationError) {
    return error;
  }
  if (error instanceof VfsVersionConflictError) {
    try {
      return toFileConflict(projectRoot, error, versions);
    } catch {
      // Malformed private evidence must not escape through a public error.
    }
  }

  const isRead =
    context.operation === 'readFile' ||
    context.operation === 'readdir' ||
    context.operation === 'openDocument';
  return new ProjectFileOperationError({
    operation: context.operation,
    path: context.path,
    ...(context.targetPath === undefined ? {} : { targetPath: context.targetPath }),
    mutationOutcome: isRead ? null : appliedAck(error) === null ? 'unknown' : 'applied',
  });
}
