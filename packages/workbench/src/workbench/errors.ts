import type { ProcessExit } from '@riftydev/shell';

export class WorkbenchOriginOccupiedError extends Error {
  constructor() {
    super("WorkbenchOriginOccupiedError: another page holds this origin's Workbench");
    this.name = 'WorkbenchOriginOccupiedError';
  }
}

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

export type RuntimeAssetStorageClass = 'opfs-persisted' | 'opfs-best-effort' | 'memory-session';

export type RuntimeAssetProgress =
  | Readonly<{
      phase: 'cache-check' | 'fetch' | 'verify' | 'persist';
      assetId: string;
      assetIndex: number;
      assetCount: number;
    }>
  | Readonly<{
      phase: 'ready';
      requiredSetDigest: string;
      assetCount: number;
      storageClass: RuntimeAssetStorageClass;
    }>;

export type RuntimeAssetFailurePhase =
  | 'cache-check'
  | 'fetch'
  | 'verify'
  | 'persist'
  | 'ready'
  | 'inspect'
  | 'clear'
  | 'close';

export type RuntimeAssetRecovery = 'retry' | 'clear-and-retry' | 'none';

export interface RuntimeAssetFailure {
  readonly phase: RuntimeAssetFailurePhase;
  readonly recovery: RuntimeAssetRecovery;
  readonly requiredSetDigest?: string;
  readonly assetId?: string;
  readonly usedBytes?: number;
  readonly requiredBytes?: number;
}

export interface RuntimeAssetCacheInspection {
  readonly storageClass: RuntimeAssetStorageClass;
  readonly entryCount: number;
  readonly storedBytes: number;
  readonly verifiedObjectCount: number;
  readonly verifiedObjectBytes: number;
  readonly readySetCount: number;
}

const RUNTIME_ASSET_MESSAGES = Object.freeze({
  'cache-check': 'Runtime asset cache check failed',
  fetch: 'Runtime asset fetch failed',
  verify: 'Runtime asset verification failed',
  persist: 'Runtime asset persistence failed',
  ready: 'Runtime asset readiness failed',
  inspect: 'Runtime asset inspection failed',
  clear: 'Runtime asset cache clear failed',
  close: 'Runtime asset manager close failed',
} satisfies Record<RuntimeAssetFailurePhase, string>);

const RUNTIME_ASSET_PHASES = new Set<RuntimeAssetFailurePhase>(
  Object.keys(RUNTIME_ASSET_MESSAGES) as RuntimeAssetFailurePhase[],
);
const RUNTIME_ASSET_RECOVERIES = new Set<RuntimeAssetRecovery>([
  'retry',
  'clear-and-retry',
  'none',
]);

export function runtimeAssetMessage(phase: RuntimeAssetFailurePhase): string {
  return RUNTIME_ASSET_MESSAGES[phase];
}

function assertExactRuntimeAssetFailure(value: RuntimeAssetFailure): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('RuntimeAssetFailure must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('RuntimeAssetFailure must not contain symbol fields');
  }
  const required = ['phase', 'recovery'];
  const optional = ['assetId', 'requiredBytes', 'requiredSetDigest', 'usedBytes'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of required) {
    if (!(key in descriptors)) throw new TypeError(`RuntimeAssetFailure is missing ${key}`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new TypeError(`RuntimeAssetFailure has unexpected ${key}`);
    }
    if (!('value' in descriptor)) throw new TypeError('RuntimeAssetFailure must not use accessors');
  }
  if (!RUNTIME_ASSET_PHASES.has(value.phase)) throw new TypeError('Invalid runtime asset phase');
  if (!RUNTIME_ASSET_RECOVERIES.has(value.recovery)) {
    throw new TypeError('Invalid runtime asset recovery');
  }
  for (const field of ['requiredSetDigest', 'assetId'] as const) {
    const candidate = value[field];
    if (candidate !== undefined && (typeof candidate !== 'string' || candidate.length === 0)) {
      throw new TypeError(`RuntimeAssetFailure.${field} must be a non-empty string`);
    }
  }
  for (const field of ['usedBytes', 'requiredBytes'] as const) {
    const candidate = value[field];
    if (candidate !== undefined && (!Number.isSafeInteger(candidate) || candidate < 0)) {
      throw new TypeError(`RuntimeAssetFailure.${field} must be a non-negative safe integer`);
    }
  }
}

/** Stable public projection; owner/store causes and paths never cross this boundary. */
export class RuntimeAssetError extends Error {
  readonly code = 'ESHADOWASSET' as const;
  readonly phase: RuntimeAssetFailurePhase;
  readonly recovery: RuntimeAssetRecovery;
  declare readonly requiredSetDigest?: string;
  declare readonly assetId?: string;
  declare readonly usedBytes?: number;
  declare readonly requiredBytes?: number;

  constructor(failure: RuntimeAssetFailure) {
    assertExactRuntimeAssetFailure(failure);
    super(runtimeAssetMessage(failure.phase));
    this.name = 'RuntimeAssetError';
    this.phase = failure.phase;
    this.recovery = failure.recovery;
    if (failure.requiredSetDigest !== undefined) {
      this.requiredSetDigest = failure.requiredSetDigest;
    }
    if (failure.assetId !== undefined) this.assetId = failure.assetId;
    if (failure.usedBytes !== undefined) this.usedBytes = failure.usedBytes;
    if (failure.requiredBytes !== undefined) this.requiredBytes = failure.requiredBytes;
    Object.freeze(this);
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

export function isRetryableProjectClosePreflightError(
  error: unknown,
): error is DirtyProjectDocumentError | ProjectDocumentSaveInProgressError {
  return (
    error instanceof DirtyProjectDocumentError ||
    error instanceof ProjectDocumentSaveInProgressError
  );
}

export interface SerializedWorkbenchOwnerStandardError {
  readonly name: string;
  readonly message: string;
}

export interface SerializedRuntimeAssetError {
  readonly name: 'RuntimeAssetError';
  readonly code: 'ESHADOWASSET';
  readonly message: string;
  readonly phase: RuntimeAssetFailurePhase;
  readonly recovery: RuntimeAssetRecovery;
  readonly requiredSetDigest?: string;
  readonly assetId?: string;
  readonly usedBytes?: number;
  readonly requiredBytes?: number;
}

export type SerializedWorkbenchOwnerError =
  | SerializedWorkbenchOwnerStandardError
  | SerializedRuntimeAssetError;

/** Clone-safe owner failure payload; protocol inspection owns field validation. */
export function serializeWorkbenchOwnerError(error: unknown): SerializedWorkbenchOwnerError {
  if (error instanceof RuntimeAssetError) {
    return Object.freeze({
      name: error.name,
      code: error.code,
      message: error.message,
      phase: error.phase,
      recovery: error.recovery,
      ...(error.requiredSetDigest === undefined
        ? {}
        : { requiredSetDigest: error.requiredSetDigest }),
      ...(error.assetId === undefined ? {} : { assetId: error.assetId }),
      ...(error.usedBytes === undefined ? {} : { usedBytes: error.usedBytes }),
      ...(error.requiredBytes === undefined ? {} : { requiredBytes: error.requiredBytes }),
    });
  }
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
  if (value.name === 'RuntimeAssetError' && 'code' in value) {
    return new RuntimeAssetError({
      phase: value.phase,
      recovery: value.recovery,
      ...(value.requiredSetDigest === undefined
        ? {}
        : { requiredSetDigest: value.requiredSetDigest }),
      ...(value.assetId === undefined ? {} : { assetId: value.assetId }),
      ...(value.usedBytes === undefined ? {} : { usedBytes: value.usedBytes }),
      ...(value.requiredBytes === undefined ? {} : { requiredBytes: value.requiredBytes }),
    });
  }
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

/** Package-private conversion from arbitrary owner/store failures to the safe public vocabulary. */
export function runtimeAssetError(
  phase: 'inspect' | 'clear' | 'close',
  error: unknown,
): RuntimeAssetError {
  if (error instanceof RuntimeAssetError && error.phase === phase) return error;
  const candidate =
    error !== null && typeof error === 'object'
      ? (error as {
          readonly recovery?: unknown;
          readonly usedBytes?: unknown;
          readonly requiredBytes?: unknown;
        })
      : {};
  const recovery = RUNTIME_ASSET_RECOVERIES.has(candidate.recovery as RuntimeAssetRecovery)
    ? (candidate.recovery as RuntimeAssetRecovery)
    : phase === 'close'
      ? 'none'
      : 'retry';
  return new RuntimeAssetError({
    phase,
    recovery,
    ...(Number.isSafeInteger(candidate.usedBytes) && (candidate.usedBytes as number) >= 0
      ? { usedBytes: candidate.usedBytes as number }
      : {}),
    ...(Number.isSafeInteger(candidate.requiredBytes) && (candidate.requiredBytes as number) >= 0
      ? { requiredBytes: candidate.requiredBytes as number }
      : {}),
  });
}
