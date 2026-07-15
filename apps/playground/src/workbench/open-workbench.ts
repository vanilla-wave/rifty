import { DEFAULT_READY_TIMEOUT_MS } from '@riftydev/service-worker';
import type { OwnerStoragePersistence, OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import { ClosedHandleError, ProjectBusyError } from './errors.ts';
import {
  type InspectedProjectDefinition,
  type ProjectDefinition,
  inspectProjectDefinition,
  projectStorageSegment,
} from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';
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

export interface Workbench {
  snapshot(): WorkbenchSnapshot;
  openProject<TReady>(definition: ProjectDefinition<TReady>): Promise<ProjectSession<TReady>>;
  deleteProject(id: string): Promise<void>;
  close(): Promise<void>;
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

type ProjectOperation =
  | { readonly kind: 'idle' }
  | { readonly kind: 'opening'; readonly ownerPromise: Promise<CloseableProject> }
  | { readonly kind: 'active'; readonly project: CloseableProject }
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
    return createWorkbench(owner, started.storage, lease, releasePageClaim);
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
): Workbench {
  const snapshot = Object.freeze({ storage }) satisfies WorkbenchSnapshot;
  let state: ProjectOperation = { kind: 'idle' };

  const assertIdle = (): void => {
    if (state.kind === 'closing' || state.kind === 'closed') {
      throw new ClosedHandleError('Workbench');
    }
    if (state.kind !== 'idle') throw new ProjectBusyError('Workbench project operations');
  };

  const trackSession = <TReady>(session: ProjectSession<TReady>): ProjectSession<TReady> => {
    let closePromise: Promise<void> | null = null;
    const tracked: ProjectSession<TReady> = Object.freeze({
      run: () => session.run(),
      terminals: session.terminals,
      close() {
        if (closePromise !== null) return closePromise;
        const completion = deferred<void>();
        const promise = completion.promise;
        closePromise = promise;
        void promise.catch(() => {});
        let rawClose: Promise<void>;
        try {
          rawClose = session.close();
        } catch (error) {
          rawClose = Promise.reject(error);
        }
        void rawClose.then(
          () => {
            if (state.kind === 'active' && state.project === tracked) state = { kind: 'idle' };
            completion.resolve(undefined);
          },
          (error: unknown) => completion.reject(error),
        );
        return promise;
      },
    });
    return tracked;
  };

  const workbench: Workbench = {
    snapshot: () => snapshot,

    openProject<TReady>(definition: ProjectDefinition<TReady>): Promise<ProjectSession<TReady>> {
      let inspected: InspectedProjectDefinition<TReady>;
      try {
        inspected = inspectProjectDefinition(definition);
        assertIdle();
      } catch (error) {
        return Promise.reject(error);
      }

      const ownerPromise = Promise.resolve().then(() => owner.openProject(inspected));
      const opening = { kind: 'opening', ownerPromise } as const;
      state = opening;
      const result = ownerPromise.then(
        (session) => {
          if (state !== opening) throw new ClosedHandleError('Workbench project open');
          const tracked = trackSession(session);
          state = { kind: 'active', project: tracked };
          return tracked;
        },
        (error: unknown) => {
          if (state === opening) state = { kind: 'idle' };
          throw error;
        },
      );
      void result.catch(() => {});
      return result;
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
      const teardown = closeWorkbench(previous, owner, lease, releasePageClaim);
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
      return promise;
    },
  };

  return workbench;
}

async function closeWorkbench(
  admitted: Exclude<ProjectOperation, { readonly kind: 'closing' | 'closed' }>,
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
    admittedClose = attemptClose(() => admitted.project.close());
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
  const deployment = record(root.deployment, 'deployment');
  const workers = record(deployment.workers, 'deployment.workers');
  const serviceWorker = record(deployment.serviceWorker, 'deployment.serviceWorker');
  const wasm = record(deployment.wasm, 'deployment.wasm');
  const acquisition = record(root.packageAcquisition, 'packageAcquisition');
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
