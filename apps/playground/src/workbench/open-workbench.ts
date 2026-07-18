import { NotImplementedError } from '@riftydev/io';
import { DEFAULT_READY_TIMEOUT_MS } from '@riftydev/service-worker';
import type { OwnerStoragePersistence, OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import {
  ClosedHandleError,
  ProjectBusyError,
  type RuntimeAssetCacheInspection,
  isRetryableProjectClosePreflightError,
} from './errors.ts';
import {
  type InspectedProjectDefinition,
  type ProjectDefinition,
  inspectProjectDefinition,
  projectStorageSegment,
} from './project-definition.ts';
import { type ProjectSession, registerProjectSessionBeforeClose } from './project-session.ts';
import {
  type ServiceWorkerControlContainer,
  type ServiceWorkerControlTimers,
  proveRiftyServiceWorkerControl,
} from './service-worker-control.ts';
import type {
  WorkbenchOwnerHandle,
  WorkbenchOwnerPort,
  WorkbenchOwnerStartInput,
} from './workbench-owner-port.ts';

export type StoragePersistence = OwnerStoragePersistence;

export interface WorkbenchOptions {
  readonly deployment: {
    readonly workers: {
      readonly owner: string;
      readonly kernel: string;
      readonly node: string;
      readonly devServer: string;
    };
    readonly serviceWorker: {
      readonly url: string;
      readonly scope: string;
    };
    readonly wasm: {
      readonly sqlite: string;
      readonly esbuild: string;
    };
    readonly previewProbeTimeoutMs?: number;
  };
  readonly packageAcquisition: {
    readonly registryUrl: string;
    readonly eddy?: {
      readonly resolverUrl: string;
      readonly bundleBaseUrl?: string;
      readonly presetPins?: Readonly<Record<string, string>>;
    };
  };
  readonly storage: {
    readonly persistence: StoragePersistence;
  };
}

export type WorkbenchStorageSnapshot = OwnerStorageSnapshot;

export interface WorkbenchSnapshot {
  readonly storage: WorkbenchStorageSnapshot;
}

export interface WorkbenchRuntimeAssets {
  inspect(): Promise<RuntimeAssetCacheInspection>;
  clear(): Promise<RuntimeAssetCacheInspection>;
}

export interface Workbench {
  readonly runtimeAssets: WorkbenchRuntimeAssets;
  snapshot(): WorkbenchSnapshot;
  openProject<TReady>(definition: ProjectDefinition<TReady>): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface WorkbenchInternals {
  readonly owner: WorkbenchOwnerHandle;
  openProjectWithOwner<TReady>(
    definition: ProjectDefinition<TReady>,
    openOwner: (inspected: InspectedProjectDefinition<TReady>) => Promise<ProjectSession<TReady>>,
  ): Promise<ProjectSession<TReady>>;
  rawSession<TReady>(session: ProjectSession<TReady>): ProjectSession<TReady>;
  registerBeforeClose(session: ProjectSession<unknown>, hook: () => Promise<void>): void;
  deleteProjectWithOwner(id: string, deleteOwner: () => Promise<void>): Promise<void>;
}

const workbenchInternals = new WeakMap<object, WorkbenchInternals>();

/** Package-private companion composition; no owner handle crosses the public Workbench. */
export function inspectWorkbenchInternals(workbench: Workbench): WorkbenchInternals {
  const internals =
    typeof workbench === 'object' && workbench !== null
      ? workbenchInternals.get(workbench)
      : undefined;
  if (internals === undefined) throw new TypeError('Invalid or forged Workbench');
  return internals;
}

export type NormalizedWorkbenchOwnerInput = WorkbenchOwnerStartInput;

interface CapabilitySnapshot {
  readonly dom: boolean;
  readonly worker: boolean;
  readonly crossOriginIsolated: boolean;
  readonly webLocks: boolean;
}

interface LockLike {
  readonly name: string;
  readonly mode: 'exclusive';
}

interface LockPort {
  request(
    name: string,
    options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
    callback: (lock: LockLike | null) => void | Promise<void>,
  ): Promise<void>;
}

interface WorkbenchServiceWorkerPort extends ServiceWorkerControlContainer {
  register(url: string, options: { readonly scope: string }): Promise<void>;
}

export interface OpenWorkbenchDependencies {
  readonly urlContext: () => {
    readonly apiBaseUrl: string;
    readonly clientUrl: string;
  };
  readonly capabilities: () => CapabilitySnapshot;
  readonly locks: LockPort;
  readonly serviceWorker: WorkbenchServiceWorkerPort;
  readonly owner: WorkbenchOwnerPort;
  readonly openOwnerProject?: <TReady>(input: {
    readonly owner: WorkbenchOwnerHandle;
    readonly definition: ProjectDefinition<TReady>;
    readonly inspected: InspectedProjectDefinition<TReady>;
  }) => Promise<ProjectSession<TReady>>;
  readonly timers: ServiceWorkerControlTimers;
}

interface ValidatedOptions {
  readonly serviceWorker: {
    readonly url: string;
    readonly scope: string;
  };
  readonly owner: Omit<NormalizedWorkbenchOwnerInput, 'storage'>;
  readonly storage: StoragePersistence;
}

interface ValidatedUrlContext {
  readonly apiBaseUrl: URL;
  readonly clientUrl: URL;
}

interface OriginLease {
  release(): Promise<void>;
}

interface CloseableProject {
  close(): Promise<void>;
}

type ProjectClosePreflight =
  | { readonly retryable: false }
  | { readonly retryable: true; readonly error: unknown };

interface ActiveProjectClose {
  readonly promise: Promise<void>;
  readonly preflight: Promise<ProjectClosePreflight>;
}

interface ActiveProject {
  readonly session: CloseableProject;
  beginClose(): ActiveProjectClose;
}

interface TrackedProject<TReady> extends ActiveProject {
  readonly session: ProjectSession<TReady>;
}

type ProjectOperation =
  | { readonly kind: 'idle' }
  | { readonly kind: 'opening'; readonly ownerPromise: Promise<CloseableProject> }
  | { readonly kind: 'active'; readonly project: ActiveProject }
  | { readonly kind: 'deleting'; readonly ownerPromise: Promise<void> }
  | {
      readonly kind: 'clearing';
      readonly ownerPromise: Promise<RuntimeAssetCacheInspection>;
    }
  | { readonly kind: 'closing'; readonly promise: Promise<void> }
  | { readonly kind: 'closed'; readonly promise: Promise<void> };

export function createOpenWorkbench(
  dependencies: OpenWorkbenchDependencies,
): (options: WorkbenchOptions) => Promise<Workbench> {
  let pageClaimed = false;

  return (options: WorkbenchOptions): Promise<Workbench> => {
    let validated: ValidatedOptions;
    try {
      const urlContext = validateUrlContext(dependencies.urlContext());
      validated = validateWorkbenchOptions(options, urlContext);
      assertCapabilities(dependencies.capabilities());
      if (pageClaimed) throw new Error('Workbench is busy: this page already has one open');
      pageClaimed = true;
    } catch (error) {
      return Promise.reject(error);
    }

    const opening = initializeWorkbench(dependencies, validated, () => {
      pageClaimed = false;
    });
    void opening.catch(() => {});
    return opening;
  };
}

async function initializeWorkbench(
  dependencies: OpenWorkbenchDependencies,
  options: ValidatedOptions,
  releasePageClaim: () => void,
): Promise<Workbench> {
  let lease: OriginLease | null = null;
  let owner: WorkbenchOwnerHandle | null = null;
  try {
    lease = await acquireOriginLease(dependencies.locks);
    await dependencies.serviceWorker.register(options.serviceWorker.url, {
      scope: options.serviceWorker.scope,
    });
    await proveRiftyServiceWorkerControl({
      container: dependencies.serviceWorker,
      timeoutMs: options.owner.deployment.previewProbeTimeoutMs,
      timers: dependencies.timers,
    });
    const started = await dependencies.owner.start(
      Object.freeze({
        ...options.owner,
        storage: Object.freeze({ persistence: options.storage }),
      }),
    );
    owner = started.owner;
    return createWorkbench(
      owner,
      started.storage,
      lease,
      releasePageClaim,
      dependencies.openOwnerProject,
    );
  } catch (error) {
    const failures: unknown[] = [error];
    if (owner !== null) {
      try {
        await owner.close();
      } catch (closeError) {
        failures.push(closeError);
      }
    }
    if (lease !== null) {
      try {
        await lease.release();
      } catch (releaseError) {
        failures.push(releaseError);
      }
    }
    releasePageClaim();
    throwFailures(failures, 'Workbench initialization and cleanup failed');
  }
}

function createWorkbench(
  owner: WorkbenchOwnerHandle,
  storage: WorkbenchStorageSnapshot,
  lease: OriginLease,
  releasePageClaim: () => void,
  openOwnerProject: OpenWorkbenchDependencies['openOwnerProject'],
): Workbench {
  const snapshot = Object.freeze({ storage }) satisfies WorkbenchSnapshot;
  const rawSessions = new WeakMap<object, ProjectSession<unknown>>();
  let state: ProjectOperation = { kind: 'idle' };

  const assertIdle = (): void => {
    if (state.kind === 'closing' || state.kind === 'closed') {
      throw new ClosedHandleError('Workbench');
    }
    if (state.kind !== 'idle') throw new ProjectBusyError('Workbench project operations');
  };

  const trackSession = <TReady>(session: ProjectSession<TReady>): TrackedProject<TReady> => {
    let closeAttempt: ActiveProjectClose | null = null;

    const beginClose = (): ActiveProjectClose => {
      if (closeAttempt !== null) return closeAttempt;
      const completion = deferred<void>();
      const preflight = deferred<ProjectClosePreflight>();
      let preflightSettled = false;
      const settlePreflight = (result: ProjectClosePreflight): void => {
        if (preflightSettled) return;
        preflightSettled = true;
        preflight.resolve(result);
      };
      const attempt = Object.freeze({ promise: completion.promise, preflight: preflight.promise });
      closeAttempt = attempt;
      void completion.promise.catch(() => {});
      let rawClose: Promise<void>;
      try {
        rawClose = session.close();
      } catch (error) {
        rawClose = Promise.reject(error);
      }
      void rawClose.then(
        () => {
          settlePreflight(CLOSE_PREFLIGHT_PASSED);
          if (state.kind === 'active' && state.project.session === trackedSession) {
            state = { kind: 'idle' };
          }
          completion.resolve(undefined);
        },
        (error: unknown) => {
          if (isRetryableProjectClosePreflightError(error)) {
            closeAttempt = null;
            settlePreflight({ retryable: true, error });
          } else {
            settlePreflight(CLOSE_PREFLIGHT_PASSED);
          }
          completion.reject(error);
        },
      );
      // Synchronous close preflight settles before this checkpoint; later failures are terminal.
      queueMicrotask(() => settlePreflight(CLOSE_PREFLIGHT_PASSED));
      return attempt;
    };

    const trackedSession: ProjectSession<TReady> = Object.freeze({
      files: session.files,
      documents: session.documents,
      run: () => session.run(),
      terminals: session.terminals,
      close: () => beginClose().promise,
    });
    rawSessions.set(trackedSession, session);
    const trackedProject = Object.freeze({ session: trackedSession, beginClose });
    return trackedProject;
  };

  const openTrackedProject = <TReady>(
    definition: ProjectDefinition<TReady>,
    explicitOwnerOpen?: (
      inspected: InspectedProjectDefinition<TReady>,
    ) => Promise<ProjectSession<TReady>>,
  ): Promise<ProjectSession<TReady>> => {
    let inspected: InspectedProjectDefinition<TReady>;
    try {
      inspected = inspectProjectDefinition(definition);
      assertIdle();
    } catch (error) {
      return Promise.reject(error);
    }

    const ownerPromise = Promise.resolve().then(() => {
      if (explicitOwnerOpen !== undefined) return explicitOwnerOpen(inspected);
      return openOwnerProject === undefined
        ? owner.openProject(inspected)
        : openOwnerProject({ owner, definition, inspected });
    });
    const opening = { kind: 'opening', ownerPromise } as const;
    state = opening;
    const result = ownerPromise.then(
      (session) => {
        if (state !== opening) throw new ClosedHandleError('Workbench project open');
        const tracked = trackSession(session);
        state = { kind: 'active', project: tracked };
        return tracked.session;
      },
      (error: unknown) => {
        if (state === opening) state = { kind: 'idle' };
        throw error;
      },
    );
    void result.catch(() => {});
    return result;
  };

  const deleteProjectWithOwner = (id: string, deleteOwner: () => Promise<void>): Promise<void> => {
    try {
      projectStorageSegment(id);
      if (typeof deleteOwner !== 'function') {
        throw new TypeError('Workbench owner deleter must be a function');
      }
      assertIdle();
    } catch (error) {
      return Promise.reject(error);
    }

    const ownerPromise = Promise.resolve().then(deleteOwner);
    const deleting = { kind: 'deleting', ownerPromise } as const;
    state = deleting;
    const result = ownerPromise.then(
      () => {
        if (state === deleting) state = { kind: 'idle' };
      },
      (error: unknown) => {
        if (state === deleting) state = { kind: 'idle' };
        throw error;
      },
    );
    void result.catch(() => {});
    return result;
  };

  const runtimeAssets: WorkbenchRuntimeAssets = Object.freeze({
    inspect(): Promise<RuntimeAssetCacheInspection> {
      if (state.kind === 'closing' || state.kind === 'closed') {
        return Promise.reject(new ClosedHandleError('Workbench'));
      }
      try {
        return owner.inspectRuntimeAssets();
      } catch (error) {
        return Promise.reject(error);
      }
    },

    clear(): Promise<RuntimeAssetCacheInspection> {
      try {
        assertIdle();
      } catch (error) {
        return Promise.reject(error);
      }
      const completion = deferred<RuntimeAssetCacheInspection>();
      const ownerPromise = completion.promise;
      const clearing = { kind: 'clearing', ownerPromise } as const;
      state = clearing;
      let requested: Promise<RuntimeAssetCacheInspection>;
      try {
        requested = owner.clearRuntimeAssets();
      } catch (error) {
        requested = Promise.reject(error);
      }
      void requested.then(completion.resolve, completion.reject);
      const result = completion.promise.then(
        (inspection) => {
          if (state === clearing) state = { kind: 'idle' };
          return inspection;
        },
        (error: unknown) => {
          if (state === clearing) state = { kind: 'idle' };
          throw error;
        },
      );
      void result.catch(() => {});
      return result;
    },
  });

  const workbench: Workbench = {
    runtimeAssets,
    snapshot: () => snapshot,

    openProject<TReady>(definition: ProjectDefinition<TReady>): Promise<ProjectSession<TReady>> {
      return openTrackedProject(definition);
    },

    deleteProject(id: string): Promise<void> {
      return deleteProjectWithOwner(id, () => owner.deleteProject(id));
    },

    close(): Promise<void> {
      if (state.kind === 'closing' || state.kind === 'closed') return state.promise;
      const previous = state;
      const completion = deferred<void>();
      const promise = completion.promise;
      state = { kind: 'closing', promise };
      void promise.catch(() => {});

      const finishTerminalClose = (activeClose: Promise<void> | null): void => {
        const teardown = closeWorkbench(previous, activeClose, owner, lease, releasePageClaim);
        void teardown.then(
          () => {
            state = { kind: 'closed', promise };
            completion.resolve(undefined);
          },
          (error: unknown) => {
            state = { kind: 'closed', promise };
            completion.reject(error);
          },
        );
      };

      if (previous.kind !== 'active') {
        finishTerminalClose(null);
        return promise;
      }

      const activeClose = previous.project.beginClose();
      void activeClose.preflight.then((preflight) => {
        if (preflight.retryable) {
          state = previous;
          completion.reject(preflight.error);
          return;
        }
        finishTerminalClose(activeClose.promise);
      });
      return promise;
    },
  };

  workbenchInternals.set(
    workbench,
    Object.freeze({
      owner,
      openProjectWithOwner<TReady>(
        definition: ProjectDefinition<TReady>,
        openOwner: (
          inspected: InspectedProjectDefinition<TReady>,
        ) => Promise<ProjectSession<TReady>>,
      ): Promise<ProjectSession<TReady>> {
        if (typeof openOwner !== 'function') {
          return Promise.reject(new TypeError('Workbench owner opener must be a function'));
        }
        return openTrackedProject(definition, openOwner);
      },
      rawSession<TReady>(session: ProjectSession<TReady>): ProjectSession<TReady> {
        const raw =
          typeof session === 'object' && session !== null ? rawSessions.get(session) : undefined;
        if (raw === undefined) throw new TypeError('Foreign or forged Workbench ProjectSession');
        return raw as ProjectSession<TReady>;
      },
      registerBeforeClose(session: ProjectSession<unknown>, hook: () => Promise<void>): void {
        const raw =
          typeof session === 'object' && session !== null ? rawSessions.get(session) : undefined;
        if (raw === undefined) throw new TypeError('Foreign or forged Workbench ProjectSession');
        registerProjectSessionBeforeClose(raw, hook);
      },
      deleteProjectWithOwner,
    }),
  );

  return workbench;
}

async function closeWorkbench(
  admitted: Exclude<ProjectOperation, { readonly kind: 'closing' | 'closed' }>,
  activeClose: Promise<void> | null,
  owner: WorkbenchOwnerHandle,
  lease: OriginLease,
  releasePageClaim: () => void,
): Promise<void> {
  const failures: unknown[] = [];
  let admittedClose: Promise<CloseOutcome>;
  if (admitted.kind === 'opening') {
    admittedClose = admitted.ownerPromise.then(
      (project) => attemptClose(() => project.close()),
      () => CLOSE_SUCCEEDED,
    );
  } else if (admitted.kind === 'active') {
    if (activeClose === null) throw new Error('Active project close was not admitted');
    admittedClose = attemptClose(() => activeClose);
  } else if (admitted.kind === 'deleting') {
    admittedClose = admitted.ownerPromise.then(
      () => CLOSE_SUCCEEDED,
      () => CLOSE_SUCCEEDED,
    );
  } else if (admitted.kind === 'clearing') {
    admittedClose = admitted.ownerPromise.then(
      () => CLOSE_SUCCEEDED,
      () => CLOSE_SUCCEEDED,
    );
  } else {
    admittedClose = Promise.resolve(CLOSE_SUCCEEDED);
  }

  // Owner termination cancels pending open/install, delete, and process work.
  // An admitted clear is different: it already mutated owner storage and must
  // publish its terminal acknowledgement before shutdown can fence replies.
  const ownerClose =
    admitted.kind === 'clearing'
      ? admittedClose.then(() => attemptClose(() => owner.close()))
      : attemptClose(() => owner.close());
  const admittedOutcome = await admittedClose;
  if (!admittedOutcome.ok) failures.push(admittedOutcome.error);
  const ownerOutcome = await ownerClose;
  if (!ownerOutcome.ok) failures.push(ownerOutcome.error);

  try {
    await lease.release();
  } catch (error) {
    failures.push(error);
  } finally {
    releasePageClaim();
  }
  if (failures.length > 0) throwFailures(failures, 'Workbench close failed');
}

type CloseOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

const CLOSE_SUCCEEDED = Object.freeze({ ok: true }) satisfies CloseOutcome;
const CLOSE_PREFLIGHT_PASSED = Object.freeze({ retryable: false }) satisfies ProjectClosePreflight;

function attemptClose(operation: () => Promise<void>): Promise<CloseOutcome> {
  try {
    return operation().then(
      () => CLOSE_SUCCEEDED,
      (error: unknown) => ({ ok: false, error }),
    );
  } catch (error) {
    return Promise.resolve({ ok: false, error });
  }
}

function acquireOriginLease(locks: LockPort): Promise<OriginLease> {
  let resolveAcquired!: (lease: OriginLease) => void;
  let rejectAcquired!: (error: unknown) => void;
  let acquiredSettled = false;
  const acquired = new Promise<OriginLease>((resolve, reject) => {
    resolveAcquired = (lease) => {
      if (acquiredSettled) return;
      acquiredSettled = true;
      resolve(lease);
    };
    rejectAcquired = (error) => {
      if (acquiredSettled) return;
      acquiredSettled = true;
      reject(error);
    };
  });
  const hold = deferred<void>();
  let releasePromise: Promise<void> | null = null;
  let requestPromise: Promise<void>;

  try {
    requestPromise = locks.request(
      'rifty:workbench:v1',
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock === null) {
          rejectAcquired(new Error('Workbench is busy: origin Web Lock unavailable'));
          return;
        }
        resolveAcquired({
          release() {
            if (releasePromise !== null) return releasePromise;
            hold.resolve(undefined);
            releasePromise = requestPromise;
            return releasePromise;
          },
        });
        await hold.promise;
      },
    );
  } catch (error) {
    rejectAcquired(error);
    return acquired;
  }

  void requestPromise.then(
    () => {
      if (!acquiredSettled) {
        rejectAcquired(new Error('Web Lock request completed without invoking its callback'));
      }
    },
    (error: unknown) => rejectAcquired(error),
  );
  return acquired;
}

function validateWorkbenchOptions(
  value: unknown,
  urlContext: ValidatedUrlContext,
): ValidatedOptions {
  const root = record(value, 'options');
  if (Reflect.ownKeys(root).includes('runtimeAssets')) {
    throw new NotImplementedError('workbench.runtimeAssets.externalAdapter');
  }
  const deployment = record(root.deployment, 'deployment');
  const workers = record(deployment.workers, 'deployment.workers');
  const serviceWorker = record(deployment.serviceWorker, 'deployment.serviceWorker');
  const wasm = record(deployment.wasm, 'deployment.wasm');
  const acquisition = record(root.packageAcquisition, 'packageAcquisition');
  if (Reflect.ownKeys(acquisition).includes('snapshotUrl')) {
    throw new TypeError(
      'packageAcquisition.snapshotUrl is retired; trusted snapshots belong to Playground definitions',
    );
  }
  const storage = record(root.storage, 'storage');

  const timeoutValue = deployment.previewProbeTimeoutMs;
  const previewProbeTimeoutMs =
    timeoutValue === undefined
      ? DEFAULT_READY_TIMEOUT_MS
      : positiveFinite(timeoutValue, 'deployment.previewProbeTimeoutMs');

  const eddyValue = acquisition.eddy;
  let eddy: NormalizedWorkbenchOwnerInput['packageAcquisition']['eddy'];
  if (eddyValue !== undefined) {
    const input = record(eddyValue, 'packageAcquisition.eddy');
    const hasExplicitBundleBase = input.bundleBaseUrl !== undefined;
    const resolverUrl = httpEndpointUrl(
      input.resolverUrl,
      'packageAcquisition.eddy.resolverUrl',
      urlContext.apiBaseUrl,
      { pathBase: !hasExplicitBundleBase },
    );
    const presetPins = stringMap(input.presetPins, 'packageAcquisition.eddy.presetPins');
    eddy = Object.freeze({
      resolverUrl,
      bundleBaseUrl: !hasExplicitBundleBase
        ? resolverUrl
        : httpEndpointUrl(
            input.bundleBaseUrl,
            'packageAcquisition.eddy.bundleBaseUrl',
            urlContext.apiBaseUrl,
            { pathBase: true },
          ),
      presetPins,
    });
  }

  const persistence = storage.persistence;
  if (persistence !== 'required' && persistence !== 'preferred' && persistence !== 'ephemeral') {
    throw new TypeError('storage.persistence must be required, preferred, or ephemeral');
  }

  const serviceWorkerUrl = riftyServiceWorkerUrl(
    serviceWorker.url,
    'deployment.serviceWorker.url',
    urlContext,
  );
  const serviceWorkerScope = riftyServiceWorkerUrl(
    serviceWorker.scope,
    'deployment.serviceWorker.scope',
    urlContext,
  );
  const clientUrl = new URL(urlContext.clientUrl.href);
  clientUrl.hash = '';
  if (!clientUrl.href.startsWith(serviceWorkerScope)) {
    throw new TypeError('deployment.serviceWorker.scope must contain the Workbench document URL');
  }

  return Object.freeze({
    serviceWorker: Object.freeze({
      url: serviceWorkerUrl,
      scope: serviceWorkerScope,
    }),
    owner: Object.freeze({
      deployment: Object.freeze({
        workers: Object.freeze({
          owner: isolatedWorkerUrl(workers.owner, 'deployment.workers.owner', urlContext),
          kernel: isolatedWorkerUrl(workers.kernel, 'deployment.workers.kernel', urlContext),
          node: isolatedWorkerUrl(workers.node, 'deployment.workers.node', urlContext),
          devServer: isolatedWorkerUrl(
            workers.devServer,
            'deployment.workers.devServer',
            urlContext,
          ),
          ...(workers.typescript === undefined
            ? {}
            : {
                typescript: isolatedWorkerUrl(
                  workers.typescript,
                  'deployment.workers.typescript',
                  urlContext,
                ),
              }),
        }),
        wasm: Object.freeze({
          sqlite: wasmAssetUrl(wasm.sqlite, 'deployment.wasm.sqlite', urlContext),
          esbuild: wasmAssetUrl(wasm.esbuild, 'deployment.wasm.esbuild', urlContext),
        }),
        previewProbeTimeoutMs,
      }),
      packageAcquisition: Object.freeze({
        registryUrl: httpEndpointUrl(
          acquisition.registryUrl,
          'packageAcquisition.registryUrl',
          urlContext.apiBaseUrl,
          { pathBase: true },
        ),
        ...(eddy === undefined ? {} : { eddy }),
      }),
    }),
    storage: persistence,
  });
}

function assertCapabilities(capabilities: CapabilitySnapshot): void {
  if (!capabilities.dom) throw new Error('Workbench requires a DOM');
  if (!capabilities.worker) throw new Error('Workbench requires Worker support');
  if (!capabilities.crossOriginIsolated) {
    throw new Error('Workbench requires cross-origin isolation');
  }
  if (!capabilities.webLocks) throw new Error('Workbench requires Web Locks');
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function validateUrlContext(value: {
  readonly apiBaseUrl: string;
  readonly clientUrl: string;
}): ValidatedUrlContext {
  return Object.freeze({
    apiBaseUrl: absoluteHttpUrl(value.apiBaseUrl, 'Workbench document API base URL'),
    clientUrl: absoluteHttpUrl(value.clientUrl, 'Workbench document URL'),
  });
}

function absoluteHttpUrl(value: unknown, path: string): URL {
  const candidate = nonEmptyString(value, path);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError(`${path} must be an absolute HTTP(S) URL`);
  }
  if (!isHttp(url)) throw new TypeError(`${path} must be an absolute HTTP(S) URL`);
  return url;
}

function resolveUrlReference(value: unknown, path: string, baseUrl: URL): URL {
  const candidate = nonEmptyString(value, path);
  try {
    return new URL(candidate, baseUrl);
  } catch {
    throw new TypeError(`${path} must be a valid URL reference`);
  }
}

function isolatedWorkerUrl(value: unknown, path: string, context: ValidatedUrlContext): string {
  const url = resolveUrlReference(value, path, context.apiBaseUrl);
  const supportedScheme = isHttp(url) || url.protocol === 'blob:';
  if (!supportedScheme || url.origin !== context.clientUrl.origin) {
    throw new TypeError(`${path} must be a same-origin isolated Worker URL`);
  }
  return url.href;
}

function riftyServiceWorkerUrl(value: unknown, path: string, context: ValidatedUrlContext): string {
  const url = resolveUrlReference(value, path, context.apiBaseUrl);
  url.hash = '';
  if (!isHttp(url) || url.origin !== context.clientUrl.origin) {
    throw new TypeError(`${path} must be a same-origin HTTP(S) URL`);
  }
  if (/%2f|%5c/i.test(url.pathname)) {
    throw new TypeError(`${path} path must not contain encoded separators`);
  }
  return url.href;
}

function wasmAssetUrl(value: unknown, path: string, context: ValidatedUrlContext): string {
  const url = resolveUrlReference(value, path, context.apiBaseUrl);
  const supportedScheme = isHttp(url) || url.protocol === 'blob:' || url.protocol === 'data:';
  if (!supportedScheme) {
    throw new TypeError(`${path} must use an HTTP(S), blob, or data URL`);
  }
  if (isHttp(url)) assertPotentiallyTrustworthyNetworkUrl(url, path);
  if (url.protocol === 'blob:' && url.origin !== context.clientUrl.origin) {
    throw new TypeError(`${path} must use a same-origin blob URL`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(`${path} must not include URL credentials`);
  }
  url.hash = '';
  return url.href;
}

function httpEndpointUrl(
  value: unknown,
  path: string,
  baseUrl: URL,
  options: { readonly pathBase: boolean },
): string {
  const url = resolveUrlReference(value, path, baseUrl);
  if (!isHttp(url)) throw new TypeError(`${path} must be an HTTP(S) URL`);
  assertPotentiallyTrustworthyNetworkUrl(url, path);
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(`${path} must not include URL credentials`);
  }
  if (hasFragmentDelimiter(url)) {
    throw new TypeError(`${path} must not include a fragment`);
  }
  if (options.pathBase && hasQueryDelimiter(url)) {
    throw new TypeError(`${path} must not include a query`);
  }
  return url.href;
}

function isHttp(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function assertPotentiallyTrustworthyNetworkUrl(url: URL, path: string): void {
  if (url.protocol === 'https:' || isLoopbackHttpUrl(url)) return;
  throw new TypeError(`${path} must use HTTPS or a potentially trustworthy local HTTP origin`);
}

function isLoopbackHttpUrl(url: URL): boolean {
  if (url.protocol !== 'http:') return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === '[::1]') return true;
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.localhost.')
  ) {
    return true;
  }
  const ipv4 = hostname.split('.');
  return (
    ipv4.length === 4 &&
    ipv4[0] === '127' &&
    ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function hasFragmentDelimiter(url: URL): boolean {
  return url.href.includes('#');
}

function hasQueryDelimiter(url: URL): boolean {
  const fragmentIndex = url.href.indexOf('#');
  const beforeFragment = fragmentIndex === -1 ? url.href : url.href.slice(0, fragmentIndex);
  return beforeFragment.includes('?');
}

function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return value;
}

function stringMap(value: unknown, path: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const input = record(value, path);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (key.length === 0 || typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TypeError(`${path}.${key || '<empty>'} must be a non-empty string`);
    }
    Object.defineProperty(result, key, {
      value: entry,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(result);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolved, rejected) => {
    resolve = resolved;
    reject = rejected;
  });
  return { promise, resolve, reject };
}

function throwFailures(failures: readonly unknown[], message: string): never {
  if (failures.length === 0) throw new Error('Expected at least one failure');
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
