import type { OwnerStoragePersistence, OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import type { InspectedProjectDefinition } from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';

export interface WorkbenchOwnerStartInput {
  readonly deployment: {
    readonly workers: {
      readonly owner: string;
      readonly kernel: string;
      readonly node: string;
      readonly devServer: string;
    };
    readonly wasm: {
      readonly sqlite: string;
      readonly esbuild: string;
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
  close(): void;
}

/** Semantic owner surface used directly by the public Workbench facade. */
export interface WorkbenchOwnerHandle {
  openProject<TReady>(
    definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
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

    const failAfterCleanup = (failure: unknown): void => {
      void cleanupRawOwner(raw, failure).then(resolve, reject);
    };

    void raw.ready.then(
      () => {
        if (startupSettled) return;
        startupSettled = true;

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
        failAfterCleanup(failure);
      },
    );

    void raw.closed.then(
      () => {
        if (startupSettled) return;
        startupSettled = true;
        reject(new Error('Workspace owner exited before readiness'));
      },
      (failure: unknown) => {
        if (startupSettled) return;
        startupSettled = true;
        reject(failure);
      },
    );
  });
}

function createSemanticOwner(raw: RawWorkspaceOwnerHandle): WorkbenchOwnerHandle {
  let closePromise: Promise<void> | null = null;

  return Object.freeze({
    openProject<TReady>(
      definition: InspectedProjectDefinition<TReady>,
    ): Promise<ProjectSession<TReady>> {
      return raw.openProject(definition);
    },

    deleteProject(id: string): Promise<void> {
      return raw.deleteProject(id);
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
    await raw.closed;
  } catch (error) {
    failures.push(error);
  }
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
