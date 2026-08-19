import type { OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import {
  ClosedHandleError,
  ProjectBusyError,
  WorkbenchOriginOccupiedError,
  isRetryableProjectClosePreflightError,
} from './errors.ts';
import type { WorkbenchHealth } from './health.ts';
import {
  type WorkbenchHealthGeneration,
  createWorkbenchHealthAuthority,
} from './internal/workbench-health-authority.ts';
import {
  type ValidatedOptions,
  type WorkbenchOptions,
  validateUrlContext,
  validateWorkbenchOptions,
} from './internal/workbench-options.ts';
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
import type { WorkbenchOwnerHandle, WorkbenchOwnerPort } from './workbench-owner-port.ts';

// One options authority (internal/workbench-options.ts); re-exported so the
// public surface stays `open-workbench.ts`.
export type {
  NormalizedWorkbenchOwnerInput,
  StoragePersistence,
  WorkbenchOptions,
} from './internal/workbench-options.ts';

export type WorkbenchStorageSnapshot = OwnerStorageSnapshot;

export interface WorkbenchSnapshot {
  readonly storage: WorkbenchStorageSnapshot;
}

export interface Workbench {
  readonly health: WorkbenchHealth;
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
  healthGeneration(session: ProjectSession<unknown>): WorkbenchHealthGeneration;
  registerBeforeClose(session: ProjectSession<unknown>, hook: () => Promise<void>): void;
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
  /** Host-owned navigation recovery; browser composition always supplies it. */
  readonly reload?: () => void;
  readonly openOwnerProject?: <TReady>(input: {
    readonly owner: WorkbenchOwnerHandle;
    readonly definition: ProjectDefinition<TReady>;
    readonly inspected: InspectedProjectDefinition<TReady>;
  }) => Promise<ProjectSession<TReady>>;
  readonly timers: ServiceWorkerControlTimers;
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
  readonly healthGeneration: WorkbenchHealthGeneration;
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
      dependencies.reload,
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
  reload: OpenWorkbenchDependencies['reload'],
): Workbench {
  const snapshot = Object.freeze({ storage }) satisfies WorkbenchSnapshot;
  const healthAuthority = createWorkbenchHealthAuthority({
    ...(reload === undefined
      ? {}
      : {
          async recover(scope): Promise<void> {
            if (scope !== 'reload') {
              throw new Error(`Workbench recovery scope ${scope} has no recovery operation`);
            }
            reload();
          },
        }),
  });
  const rawSessions = new WeakMap<object, ProjectSession<unknown>>();
  const healthGenerations = new WeakMap<object, WorkbenchHealthGeneration>();
  let state: ProjectOperation = { kind: 'idle' };
  let ownerCloseAdmitted = false;

  const reportUnexpectedOwnerExit = (): void => {
    if (ownerCloseAdmitted || state.kind === 'closed') return;
    healthAuthority.owner.unavailable({ summary: 'Workbench owner exited unexpectedly' });
  };
  void owner.closed.then(reportUnexpectedOwnerExit, reportUnexpectedOwnerExit);
  const unsubscribeOwnerHealth = owner.subscribeHealth((event) => {
    if (event.kind === 'fatal-invariant') {
      healthAuthority.invariant.fatal({ summary: event.summary });
      return;
    }
    if (event.kind === 'durability-progress' || state.kind !== 'active') return; // ADR-0359 reach
    if (event.status === 'healthy') {
      state.project.healthGeneration.reporter.clear('persistence');
      return;
    }
    state.project.healthGeneration.reporter.degraded({
      scope: 'persistence',
      summary: 'Workspace persistence failed',
      recover: event.recover,
    });
  });
  const closeHealth = (): unknown | null => {
    const failures: unknown[] = [];
    try {
      unsubscribeOwnerHealth();
    } catch (error) {
      failures.push(error);
    }
    try {
      healthAuthority.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 0) return null;
    if (failures.length === 1) return failures[0];
    return new AggregateError(failures, 'Workbench health teardown failed');
  };

  const assertIdle = (): void => {
    if (state.kind === 'closing' || state.kind === 'closed') {
      throw new ClosedHandleError('Workbench');
    }
    if (state.kind !== 'idle') throw new ProjectBusyError('Workbench project operations');
  };

  const trackSession = <TReady>(
    session: ProjectSession<TReady>,
    generationId: string,
  ): TrackedProject<TReady> => {
    const healthGeneration = healthAuthority.openGeneration(generationId);
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
          healthGeneration.close();
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
            healthGeneration.close();
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
    healthGenerations.set(trackedSession, healthGeneration);
    const trackedProject = Object.freeze({ session: trackedSession, healthGeneration, beginClose });
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
        const tracked = trackSession(session, inspected.id);
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

  const workbench: Workbench = {
    health: healthAuthority.health,
    snapshot: () => snapshot,

    openProject<TReady>(definition: ProjectDefinition<TReady>): Promise<ProjectSession<TReady>> {
      return openTrackedProject(definition);
    },

    deleteProject(id: string): Promise<void> {
      try {
        projectStorageSegment(id);
        assertIdle();
      } catch (error) {
        return Promise.reject(error);
      }

      const ownerPromise = Promise.resolve().then(() => owner.deleteProject(id));
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
    },

    close(): Promise<void> {
      if (state.kind === 'closing' || state.kind === 'closed') return state.promise;
      const previous = state;
      const completion = deferred<void>();
      const promise = completion.promise;
      state = { kind: 'closing', promise };
      void promise.catch(() => {});

      const finishTerminalClose = (activeClose: Promise<void> | null): void => {
        ownerCloseAdmitted = true;
        const teardown = closeWorkbench(previous, activeClose, owner, lease, releasePageClaim);
        void teardown.then(
          () => {
            const healthFailure = closeHealth();
            state = { kind: 'closed', promise };
            if (healthFailure === null) completion.resolve(undefined);
            else completion.reject(healthFailure);
          },
          (error: unknown) => {
            const healthFailure = closeHealth();
            state = { kind: 'closed', promise };
            completion.reject(
              healthFailure === null
                ? error
                : new AggregateError([error, healthFailure], 'Workbench close failed'),
            );
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
      healthGeneration(session: ProjectSession<unknown>): WorkbenchHealthGeneration {
        const generation =
          typeof session === 'object' && session !== null
            ? healthGenerations.get(session)
            : undefined;
        if (generation === undefined) {
          throw new TypeError('Foreign or forged Workbench ProjectSession');
        }
        return generation;
      },
      registerBeforeClose(session: ProjectSession<unknown>, hook: () => Promise<void>): void {
        const raw =
          typeof session === 'object' && session !== null ? rawSessions.get(session) : undefined;
        if (raw === undefined) throw new TypeError('Foreign or forged Workbench ProjectSession');
        registerProjectSessionBeforeClose(raw, hook);
      },
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
  } else {
    admittedClose = Promise.resolve(CLOSE_SUCCEEDED);
  }

  // Owner termination is the cancellation mechanism for pending open/install,
  // delete, and process work. Start it after invoking an already-active project
  // close, but before awaiting either side, so neither close can wait forever
  // for the other to begin.
  const ownerClose = attemptClose(() => owner.close());
  const admittedOutcome = await admittedClose;
  const ownerOutcome = await ownerClose;
  if (
    !admittedOutcome.ok &&
    (!ownerOutcome.ok || !isOwnerTerminationCancellation(admittedOutcome.error))
  ) {
    failures.push(admittedOutcome.error);
  }
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

function isOwnerTerminationCancellation(error: unknown): boolean {
  if (error instanceof ClosedHandleError) return true;
  return (
    error instanceof AggregateError &&
    error.errors.length > 0 &&
    error.errors.every(isOwnerTerminationCancellation)
  );
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
          rejectAcquired(new WorkbenchOriginOccupiedError());
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

function assertCapabilities(capabilities: CapabilitySnapshot): void {
  if (!capabilities.dom) throw new Error('Workbench requires a DOM');
  if (!capabilities.worker) throw new Error('Workbench requires Worker support');
  if (!capabilities.crossOriginIsolated) {
    throw new Error('Workbench requires cross-origin isolation');
  }
  if (!capabilities.webLocks) throw new Error('Workbench requires Web Locks');
}

function throwFailures(failures: readonly unknown[], message: string): never {
  if (failures.length === 0) throw new Error('Expected at least one failure');
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
