import type { ProcessExit } from '@riftydev/shell';

export class ProjectBusyError extends Error {
  constructor(scope: string) {
    super(`ProjectBusyError: ${scope} already has an active run`);
    this.name = 'ProjectBusyError';
  }
}

export class ClosedHandleError extends Error {
  constructor(scope: string, cause?: unknown) {
    super(`ClosedHandleError: ${scope} is closed`);
    this.name = 'ClosedHandleError';
    this.cause = cause;
  }
}

export class ProjectDefinitionMismatchError extends Error {
  constructor(id: string) {
    super(
      `ProjectDefinitionMismatchError: project ${JSON.stringify(id)} has a different definition`,
    );
    this.name = 'ProjectDefinitionMismatchError';
  }
}

export class ProjectRunExitedBeforeReadyError extends Error {
  readonly exit: ProcessExit;

  constructor(exit: ProcessExit) {
    super(
      `Project run exited before readiness with code ${String(exit.code)} and signal ${String(exit.signal)}`,
    );
    this.name = 'ProjectRunExitedBeforeReadyError';
    this.exit = exit;
  }
}

export class StdinClosedError extends Error {
  constructor() {
    super('Terminal stdin is closed');
    this.name = 'StdinClosedError';
  }
}

export interface ProjectFileEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly version: string;
}

export interface FileConflictDetails {
  readonly path: string;
  readonly expectedVersion: string | null;
  readonly actualVersion: string | null;
  readonly actualEntry: ProjectFileEntry | null;
  readonly actualBytes: Uint8Array | null;
}

/** Public, project-rooted CAS evidence. Owner identity and revisions stay private. */
export class FileConflictError extends Error {
  readonly path: string;
  readonly expectedVersion: string | null;
  readonly actualVersion: string | null;
  readonly actualEntry: ProjectFileEntry | null;
  readonly actualBytes: Uint8Array | null;

  constructor(details: FileConflictDetails) {
    super(
      `FileConflictError: ${details.path} expected ${details.expectedVersion ?? '<absent>'}, actual ${details.actualVersion ?? '<absent>'}`,
    );
    this.name = 'FileConflictError';
    this.path = details.path;
    this.expectedVersion = details.expectedVersion;
    this.actualVersion = details.actualVersion;
    this.actualEntry =
      details.actualEntry === null ? null : Object.freeze({ ...details.actualEntry });
    this.actualBytes = details.actualBytes?.slice() ?? null;
  }
}

export type ProjectFileOperation =
  | 'readFile'
  | 'readdir'
  | 'writeFile'
  | 'mkdir'
  | 'rename'
  | 'remove'
  | 'openDocument'
  | 'saveDocument';

export type ProjectMutationOutcome = 'applied' | 'unknown' | null;

export interface ProjectFileOperationFailure {
  readonly operation: ProjectFileOperation;
  readonly path: string;
  readonly targetPath?: string;
  readonly mutationOutcome: ProjectMutationOutcome;
}

/** Stable safe failure: loud outcome semantics without leaking owner evidence. */
export class ProjectFileOperationError extends Error {
  readonly operation: ProjectFileOperation;
  readonly path: string;
  readonly targetPath?: string;
  readonly mutationOutcome: ProjectMutationOutcome;

  constructor(details: ProjectFileOperationFailure) {
    const target = details.targetPath === undefined ? '' : ` -> ${details.targetPath}`;
    const outcome = details.mutationOutcome === null ? 'read' : details.mutationOutcome;
    super(
      `ProjectFileOperationError: ${details.operation} ${details.path}${target} failed (${outcome})`,
    );
    this.name = 'ProjectFileOperationError';
    this.operation = details.operation;
    this.path = details.path;
    if (details.targetPath !== undefined) this.targetPath = details.targetPath;
    this.mutationOutcome = details.mutationOutcome;
  }
}

export type ProjectDocumentInvalidation = 'rename' | 'delete' | 'reset';

export class DirtyProjectDocumentError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`DirtyProjectDocumentError: ${path} has unsaved changes; choose save or discard`);
    this.name = 'DirtyProjectDocumentError';
    this.path = path;
  }
}

export class StaleProjectDocumentError extends Error {
  readonly path: string;
  readonly reason: ProjectDocumentInvalidation;

  constructor(path: string, reason: ProjectDocumentInvalidation) {
    super(`StaleProjectDocumentError: ${path} became stale after ${reason}`);
    this.name = 'StaleProjectDocumentError';
    this.path = path;
    this.reason = reason;
  }
}

export class ProjectDocumentSaveInProgressError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`ProjectDocumentSaveInProgressError: ${path} already has a save in progress`);
    this.name = 'ProjectDocumentSaveInProgressError';
    this.path = path;
  }
}

export interface SerializedWorkbenchOwnerError {
  readonly name: string;
  readonly message: string;
}

/** Clone-safe owner failure payload; protocol inspection owns field validation. */
export function serializeWorkbenchOwnerError(error: unknown): SerializedWorkbenchOwnerError {
  if (error instanceof Error) {
    return Object.freeze({
      name: error.name.length > 0 ? error.name : 'Error',
      message: error.message,
    });
  }
  return Object.freeze({ name: 'Error', message: String(error) });
}

/** Restore owner-crossing public domain prototypes without guessing constructor data. */
export function deserializeWorkbenchOwnerError(value: SerializedWorkbenchOwnerError): Error {
  const error = new Error(value.message);
  const prototype =
    value.name === 'ProjectDefinitionMismatchError'
      ? ProjectDefinitionMismatchError.prototype
      : value.name === 'ProjectBusyError'
        ? ProjectBusyError.prototype
        : value.name === 'ClosedHandleError'
          ? ClosedHandleError.prototype
          : Error.prototype;
  Object.setPrototypeOf(error, prototype);
  error.name = value.name;
  return error;
}
