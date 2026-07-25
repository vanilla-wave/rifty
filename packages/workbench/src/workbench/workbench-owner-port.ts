import type { OwnerStoragePersistence, OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import type {
  PlaygroundProjectCatalog,
  PlaygroundProjectOpenOptions,
  PlaygroundSessionTools,
} from './playground.ts';
import type { InspectedProjectDefinition } from './project-definition.ts';
import type { ProjectDefinition } from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';

const WORKSPACE_OWNER_LIFECYCLE_TIMEOUT_MS = 30_000;

export type PlaygroundOwnerOperationalHealth =
  | {
      readonly scope: 'scm' | 'preview';
      readonly status: 'healthy';
    }
  | {
      readonly scope: 'scm' | 'preview';
      readonly status: 'degraded';
      readonly error: { readonly name: string; readonly message: string };
    };

export interface PlaygroundOwnerSessionToolLifecycle {
  readonly tools: PlaygroundSessionTools;
  subscribeOperationalHealth(
    listener: (health: PlaygroundOwnerOperationalHealth) => void,
  ): () => void;
  recoverOperationalHealth(scope: 'scm' | 'preview'): Promise<void>;
  close(): Promise<void>;
}

export type WorkbenchOwnerHealthEvent =
  | Readonly<{
      kind: 'fatal-invariant';
      summary: string;
    }>
  | Readonly<{
      kind: 'persistence';
      status: 'degraded';
      recover: () => Promise<void>;
    }>
  | Readonly<{
      kind: 'persistence';
      status: 'healthy';
    }>;

/** Package-private semantic companion extension on the same physical owner. */
export interface PlaygroundWorkbenchOwnerHandle {
  readonly catalog: PlaygroundProjectCatalog;
  openProject<TReady>(
    definition: ProjectDefinition<TReady>,
    options?: PlaygroundProjectOpenOptions,
  ): Promise<ProjectSession<TReady>>;
  sessionTools(session: ProjectSession<unknown>): PlaygroundOwnerSessionToolLifecycle;
}

export interface WorkbenchOwnerStartInput {
  readonly deployment: {
    readonly workers: {
      readonly owner: string;
      readonly kernel: string;
      readonly node: string;
      readonly devServer: string;
      readonly typescript?: string;
    };
    readonly wasm: {
      readonly sqlite: string;
    };
    readonly previewProbeTimeoutMs: number;
  };
  readonly packageAcquisition: {
    readonly registryUrl: string;
    readonly eddy?: {
      readonly resolverUrl: string;
      readonly bundleBaseUrl: string;
      readonly presetPins: Readonly<Record<string, string>>;
    };
  };
  readonly storage: { readonly persistence: OwnerStoragePersistence };
  /** First-party companion only; captured historical selection, never guest env. */
  readonly legacyWorkspacePrefix?: string;
  /** First-party companion only; one immutable page URL snapshot for definition ingress. */
  readonly playgroundUrlContext?: {
    readonly apiBaseUrl: string;
    readonly clientUrl: string;
  };
}

/** Physical worker handle; the adapter owns it until fully closed. */
export interface RawWorkspaceOwnerHandle {
  readonly ready: Promise<void>;
  readonly closed: Promise<unknown>;
  storageSnapshot(): unknown;
  openProject<TReady>(
    definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
  readonly playground?: PlaygroundWorkbenchOwnerHandle;
  subscribeHealth?: (listener: (event: WorkbenchOwnerHealthEvent) => void) => () => void;
  close(): void;
}

/** Semantic owner surface used directly by the public Workbench facade. */
export interface WorkbenchOwnerHandle {
  /** Settles with the physical owner lifecycle independently of semantic close requests. */
  readonly closed: Promise<unknown>;
  openProject<TReady>(
    definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
  readonly playground?: PlaygroundWorkbenchOwnerHandle;
  subscribeHealth(listener: (event: WorkbenchOwnerHealthEvent) => void): () => void;
  /** Stable/idempotent; settles only after the physical owner has exited. */
  close(): Promise<void>;
}

export interface WorkbenchOwnerStartResult {
  readonly owner: WorkbenchOwnerHandle;
  readonly storage: OwnerStorageSnapshot;
}

export interface WorkbenchOwnerPort {
  start(input: WorkbenchOwnerStartInput): Promise<WorkbenchOwnerStartResult>;
}

/** Worker/process creation is the external effect boundary injected in tests. */
export interface WorkbenchOwnerPortDependencies {
  startWorkspaceOwner(input: WorkbenchOwnerStartInput): RawWorkspaceOwnerHandle;
}

export function createWorkbenchOwnerPort(
  dependencies: WorkbenchOwnerPortDependencies,
): WorkbenchOwnerPort {
  return Object.freeze({
    start(input: WorkbenchOwnerStartInput): Promise<WorkbenchOwnerStartResult> {
      let raw: RawWorkspaceOwnerHandle;
      try {
        raw = dependencies.startWorkspaceOwner(input);
      } catch (error) {
        return Promise.reject(error);
      }
      return admitWorkspaceOwner(raw, input.storage.persistence);
    },
  });
}

function admitWorkspaceOwner(
  raw: RawWorkspaceOwnerHandle,
  requestedPolicy: OwnerStoragePersistence,
): Promise<WorkbenchOwnerStartResult> {
  return new Promise<WorkbenchOwnerStartResult>((resolve, reject) => {
    let startupSettled = false;
    const readyTimer = setTimeout(() => {
      if (startupSettled) return;
      startupSettled = true;
      failAfterCleanup(
        new Error(
          `Workspace owner ready timed out after ${String(WORKSPACE_OWNER_LIFECYCLE_TIMEOUT_MS)}ms`,
        ),
      );
    }, WORKSPACE_OWNER_LIFECYCLE_TIMEOUT_MS);

    const failAfterCleanup = (failure: unknown): void => {
      void cleanupRawOwner(raw, failure).then(resolve, reject);
    };

    void raw.ready.then(
      () => {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(readyTimer);

        let untrustedSnapshot: unknown;
        try {
          untrustedSnapshot = raw.storageSnapshot();
        } catch (error) {
          failAfterCleanup(error);
          return;
        }

        let storage: OwnerStorageSnapshot;
        try {
          storage = validateAndFreezeStorageSnapshot(untrustedSnapshot);
        } catch (error) {
          failAfterCleanup(error);
          return;
        }

        if (storage.policy !== requestedPolicy) {
          failAfterCleanup(
            new Error(
              `Owner storage policy mismatch: requested ${requestedPolicy}, owner reported ${storage.policy}`,
            ),
          );
          return;
        }

        resolve(Object.freeze({ owner: createSemanticOwner(raw), storage }));
      },
      (failure: unknown) => {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(readyTimer);
        failAfterCleanup(failure);
      },
    );

    void raw.closed.then(
      () => {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(readyTimer);
        reject(new Error('Workspace owner exited before readiness'));
      },
      (failure: unknown) => {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(readyTimer);
        reject(failure);
      },
    );
  });
}

function createSemanticOwner(raw: RawWorkspaceOwnerHandle): WorkbenchOwnerHandle {
  let closePromise: Promise<void> | null = null;

  return Object.freeze({
    closed: raw.closed,

    openProject<TReady>(
      definition: InspectedProjectDefinition<TReady>,
    ): Promise<ProjectSession<TReady>> {
      return raw.openProject(definition);
    },

    deleteProject(id: string): Promise<void> {
      return raw.deleteProject(id);
    },

    ...(raw.playground === undefined ? {} : { playground: raw.playground }),

    subscribeHealth(listener: (event: WorkbenchOwnerHealthEvent) => void): () => void {
      if (typeof listener !== 'function') {
        throw new TypeError('Workbench owner health listener must be a function');
      }
      if (raw.subscribeHealth === undefined) {
        throw new Error('Workspace owner health subscription is unavailable');
      }
      return raw.subscribeHealth(listener);
    },

    close(): Promise<void> {
      closePromise ??= closeRawOwner(raw);
      return closePromise;
    },
  });
}

async function cleanupRawOwner(
  raw: RawWorkspaceOwnerHandle,
  startupFailure: unknown,
): Promise<never> {
  const failures: unknown[] = [startupFailure];
  requestRawOwnerClose(raw, failures);
  await observeRawOwnerClose(raw, failures);
  throwFailures(failures, 'Workspace owner startup and cleanup failed');
}

async function closeRawOwner(raw: RawWorkspaceOwnerHandle): Promise<void> {
  const failures: unknown[] = [];
  requestRawOwnerClose(raw, failures);
  await observeRawOwnerClose(raw, failures);
  if (failures.length > 0) throwFailures(failures, 'Workspace owner close failed');
}

function requestRawOwnerClose(raw: RawWorkspaceOwnerHandle, failures: unknown[]): void {
  try {
    raw.close();
  } catch (error) {
    failures.push(error);
  }
}

async function observeRawOwnerClose(
  raw: RawWorkspaceOwnerHandle,
  failures: unknown[],
): Promise<void> {
  try {
    await observeRawOwnerLifecycle(raw.closed, 'exit');
  } catch (error) {
    failures.push(error);
  }
}

function observeRawOwnerLifecycle<T>(observation: Promise<T>, phase: 'ready' | 'exit'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Workspace owner ${phase} timed out after ${String(WORKSPACE_OWNER_LIFECYCLE_TIMEOUT_MS)}ms`,
        ),
      );
    }, WORKSPACE_OWNER_LIFECYCLE_TIMEOUT_MS);
    void observation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function throwFailures(failures: readonly unknown[], message: string): never {
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}

function validateAndFreezeStorageSnapshot(value: unknown): OwnerStorageSnapshot {
  if (!isRecord(value)) throw invalidStorageSnapshot();

  if (
    hasExactKeys(value, ['policy', 'backend', 'durability']) &&
    value.policy === 'required' &&
    value.backend === 'opfs' &&
    value.durability === 'durable'
  ) {
    return Object.freeze(value) as OwnerStorageSnapshot;
  }

  if (value.policy === 'preferred' && value.backend === 'opfs') {
    if (
      !hasExactKeys(value, ['policy', 'backend', 'durability']) ||
      value.durability !== 'durable'
    ) {
      throw invalidStorageSnapshot();
    }
    return Object.freeze(value) as OwnerStorageSnapshot;
  }

  if (value.policy === 'preferred' && value.backend === 'memory') {
    if (
      !hasExactKeys(value, ['policy', 'backend', 'durability', 'fallback']) ||
      value.durability !== 'ephemeral' ||
      !isRecord(value.fallback) ||
      !hasExactKeys(value.fallback, ['reason']) ||
      typeof value.fallback.reason !== 'string'
    ) {
      throw invalidStorageSnapshot();
    }
    Object.freeze(value.fallback);
    return Object.freeze(value) as OwnerStorageSnapshot;
  }

  if (
    hasExactKeys(value, ['policy', 'backend', 'durability']) &&
    value.policy === 'ephemeral' &&
    value.backend === 'memory' &&
    value.durability === 'ephemeral'
  ) {
    return Object.freeze(value) as OwnerStorageSnapshot;
  }

  throw invalidStorageSnapshot();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function invalidStorageSnapshot(): TypeError {
  return new TypeError('Invalid owner storage snapshot');
}
