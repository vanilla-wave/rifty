import {
  DEFAULT_READY_TIMEOUT_MS,
  SW_FRAME_VERSION,
  SW_PING,
  SW_PONG,
  SW_ROUTING_VERSION,
} from '@riftydev/service-worker';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ClosedHandleError,
  DirtyProjectDocumentError,
  ProjectBusyError,
  ProjectDocumentSaveInProgressError,
} from './errors.ts';
import { type WorkbenchStorageSnapshot, createOpenWorkbench } from './open-workbench.ts';
import type { PreviewHandle } from './preview-readiness.ts';
import { createUnusedOwnerProjectHandles } from './project-content.test-fixture.ts';
import {
  type InspectedProjectDefinition,
  inspectProjectDefinition,
  projects,
} from './project-definition.ts';
import type { ProjectRun, ProjectSession } from './project-session.ts';
import type { ProjectTerminal } from './project-terminal.ts';
import type { ServiceWorkerControlWorker } from './service-worker-control.ts';

type OpenWorkbench = ReturnType<typeof createOpenWorkbench>;
type WorkbenchOptions = Parameters<OpenWorkbench>[0];
type OpenWorkbenchDependencies = Parameters<typeof createOpenWorkbench>[0];
type OwnerStartInput = Parameters<OpenWorkbenchDependencies['owner']['start']>[0];
type OwnerStartValue = Awaited<ReturnType<OpenWorkbenchDependencies['owner']['start']>>;
type OwnerHandle = OwnerStartValue['owner'];
type CapabilityName = 'dom' | 'worker' | 'crossOriginIsolated' | 'webLocks';
type CapabilitySnapshot = Record<CapabilityName, boolean>;
type TimerCallback = () => void;
type LockLike = { readonly name: string; readonly mode: 'exclusive' };
type LockRequest = (
  name: string,
  options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
  callback: (lock: LockLike | null) => void | Promise<void>,
) => Promise<void>;
type ServiceWorkerEventType = 'controllerchange' | 'message';

const URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://workbench.invalid/app/index.html',
  clientUrl: 'https://workbench.invalid/app/index.html',
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

interface TestServiceWorkerController extends ServiceWorkerControlWorker {
  readonly label: string;
  readonly postMessage: ReturnType<
    typeof vi.fn<(message: unknown, transfer: Transferable[]) => void>
  >;
}

interface TestSession<TReady> {
  readonly session: ProjectSession<TReady>;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  setCloseImplementation(implementation: () => Promise<void>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function validOptions(): WorkbenchOptions {
  return {
    deployment: {
      workers: {
        owner: '/assets/owner.js',
        kernel: '/assets/kernel.js',
        node: '/assets/node.js',
        devServer: '/assets/dev-server.js',
      },
      serviceWorker: { url: '/service-worker.js', scope: '/' },
      wasm: { sqlite: '/assets/sqlite.wasm' },
      previewProbeTimeoutMs: 50,
    },
    packageAcquisition: {
      registryUrl: '/npm-registry',
      eddy: {
        resolverUrl: 'https://eddy.invalid/resolve',
        bundleBaseUrl: 'https://eddy.invalid/bundles',
        presetPins: { vite: 'sha256-vite' },
      },
    },
    storage: { persistence: 'required' },
  };
}

function optionsWithDefaults(): WorkbenchOptions {
  return {
    deployment: {
      workers: {
        owner: '/assets/owner.js',
        kernel: '/assets/kernel.js',
        node: '/assets/node.js',
        devServer: '/assets/dev-server.js',
      },
      serviceWorker: { url: '/service-worker.js', scope: '/' },
      wasm: { sqlite: '/assets/sqlite.wasm' },
    },
    packageAcquisition: {
      registryUrl: '/npm-registry',
      eddy: { resolverUrl: 'https://eddy.invalid/resolve' },
    },
    storage: { persistence: 'required' },
  };
}

function withPersistence(
  persistence: WorkbenchOptions['storage']['persistence'],
): WorkbenchOptions {
  const options = structuredClone(validOptions()) as unknown as {
    storage: { persistence: WorkbenchOptions['storage']['persistence'] };
  };
  options.storage.persistence = persistence;
  return options as WorkbenchOptions;
}

function definition(id: string): ReturnType<typeof projects.vite> {
  return projects.vite({
    id,
    files: { '/index.html': `<h1>${id}</h1>` },
  });
}

function createTestSession<TReady>(): TestSession<TReady> {
  let closeImplementation = async (): Promise<void> => {};
  const close = vi.fn(() => closeImplementation());
  const session = {
    ...createUnusedOwnerProjectHandles('openWorkbench contract owner session'),
    run(): ProjectRun<TReady> {
      throw new Error('test session run is not used by openWorkbench tests');
    },
    terminals: Object.freeze({
      open(): ProjectTerminal {
        throw new Error('test terminal is not used by openWorkbench tests');
      },
    }),
    close,
  } satisfies ProjectSession<TReady>;
  return {
    session,
    close,
    setCloseImplementation(implementation) {
      closeImplementation = implementation;
    },
  };
}

async function settledOr<T>(promise: Promise<T>, pending: T): Promise<T> {
  return Promise.race([promise, Promise.resolve().then(() => pending)]);
}

async function waitUntilOrRethrow<T>(promise: Promise<T>, predicate: () => boolean): Promise<void> {
  let settled = false;
  let rejection: unknown;
  void promise.then(
    () => {
      settled = true;
    },
    (error: unknown) => {
      settled = true;
      rejection = error;
    },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    if (settled) {
      if (rejection !== undefined) throw rejection;
      throw new Error('operation settled before reaching the expected boundary');
    }
    await Promise.resolve();
  }
  throw new Error('condition did not become true');
}

class TestClock {
  readonly #callbacks = new Map<number, TimerCallback>();
  #nextId = 1;

  readonly setTimeout = vi.fn((callback: TimerCallback, _delayMs: number): number => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#callbacks.set(id, callback);
    return id;
  });

  readonly clearTimeout = vi.fn((id: number): void => {
    this.#callbacks.delete(id);
  });

  get pending(): number {
    return this.#callbacks.size;
  }

  fireAll(): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

class ExclusiveLockHost {
  held = false;
  unavailable = false;
  #releaseGate: Promise<void> | null = null;
  #releaseFailure: unknown;
  #onRelease: (() => void) | null = null;

  readonly request = vi.fn<LockRequest>(async (name, options, callback) => {
    if (this.unavailable || this.held) {
      await callback(null);
      return;
    }
    this.held = true;
    try {
      await callback({ name, mode: options.mode });
      if (this.#releaseGate !== null) await this.#releaseGate;
      this.#onRelease?.();
      if (this.#releaseFailure !== undefined) throw this.#releaseFailure;
    } finally {
      this.held = false;
    }
  });

  delayRelease(): () => void {
    const gate = deferred<void>();
    this.#releaseGate = gate.promise;
    return () => gate.resolve(undefined);
  }

  failRelease(error: unknown): void {
    this.#releaseFailure = error;
  }

  clearReleaseFailure(): void {
    this.#releaseFailure = undefined;
  }

  onRelease(callback: () => void): void {
    this.#onRelease = callback;
  }
}

class TestServiceWorkerContainer {
  controller: TestServiceWorkerController | null = null;
  readonly #listeners: Record<ServiceWorkerEventType, Set<EventListener>> = {
    controllerchange: new Set(),
    message: new Set(),
  };

  addEventListener(type: ServiceWorkerEventType, listener: EventListener): void {
    this.#listeners[type].add(listener);
  }

  removeEventListener(type: ServiceWorkerEventType, listener: EventListener): void {
    this.#listeners[type].delete(listener);
  }

  listenerCount(type: ServiceWorkerEventType): number {
    return this.#listeners[type].size;
  }

  setController(controller: TestServiceWorkerController | null, dispatch = true): void {
    this.controller = controller;
    if (!dispatch) return;
    for (const listener of [...this.#listeners.controllerchange]) {
      listener(new Event('controllerchange'));
    }
  }

  dispatchMessage(source: TestServiceWorkerController | null, data: unknown): void {
    const event = new MessageEvent('message', { data });
    Object.defineProperty(event, 'source', { value: source });
    for (const listener of [...this.#listeners.message]) listener(event);
  }
}

function harness(sharedLocks = new ExclusiveLockHost()) {
  const clock = new TestClock();
  const capabilities: CapabilitySnapshot = {
    dom: true,
    worker: true,
    crossOriginIsolated: true,
    webLocks: true,
  };
  const container = new TestServiceWorkerContainer();
  let controllerNumber = 0;
  let automaticPong: unknown | null = {
    type: SW_PONG,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
    from: 'service-worker',
  };
  let automaticPongSource: TestServiceWorkerController | null | undefined;
  let postMessageImplementation:
    | ((
        controller: TestServiceWorkerController,
        message: unknown,
        transfer: Transferable[],
      ) => void)
    | null = null;
  let opfsOpenFailure: unknown;
  let durabilityFailure: unknown;
  let memoryOpenFailure: unknown;
  let ownerStartFailure: unknown;
  let ownerStorageSnapshot: WorkbenchStorageSnapshot = Object.freeze({
    policy: 'required',
    backend: 'opfs',
    durability: 'durable',
  });
  const ownerClosed = deferred<unknown>();
  void ownerClosed.promise.catch(() => {});
  let ownerCloseImplementation = async (): Promise<void> => {};
  let ownerDeleteProjectImplementation = async (_id: string): Promise<void> => {};
  const ownerProjectSessions: TestSession<unknown>[] = [];
  let ownerOpenProjectImplementation = async (
    _definition: InspectedProjectDefinition,
  ): Promise<ProjectSession<unknown>> => {
    const created = createTestSession<unknown>();
    ownerProjectSessions.push(created);
    return created.session;
  };

  const createController = (label = `controller-${controllerNumber + 1}`) => {
    controllerNumber += 1;
    const controller: TestServiceWorkerController = {
      label,
      postMessage: vi.fn((message: unknown, transfer: Transferable[]): void => {
        if (postMessageImplementation !== null) {
          postMessageImplementation(controller, message, transfer);
          return;
        }
        if (automaticPong === null) return;
        if (automaticPongSource !== undefined) {
          container.dispatchMessage(automaticPongSource, automaticPong);
          return;
        }
        const replyPort = transfer[0];
        if (!(replyPort instanceof MessagePort)) throw new Error('missing SW control reply port');
        replyPort.postMessage(automaticPong);
      }),
    };
    return controller;
  };
  const controller = createController();
  container.setController(controller, false);

  const serviceWorker = {
    register: vi.fn(
      async (_url: string, _options: { readonly scope: string }): Promise<void> => {},
    ),
    container,
    get controller() {
      return container.controller;
    },
    addEventListener(type: ServiceWorkerEventType, listener: EventListener): void {
      container.addEventListener(type, listener);
    },
    removeEventListener(type: ServiceWorkerEventType, listener: EventListener): void {
      container.removeEventListener(type, listener);
    },
  };

  const opfsBackend = Object.freeze({ kind: 'opfs' as const, token: Symbol('opfs') });
  const memoryBackend = Object.freeze({ kind: 'memory' as const, token: Symbol('memory') });
  const storage = {
    openOpfs: vi.fn(async () => {
      if (opfsOpenFailure !== undefined) throw opfsOpenFailure;
      return opfsBackend;
    }),
    proveDurability: vi.fn(async (_backend: typeof opfsBackend): Promise<void> => {
      if (durabilityFailure !== undefined) throw durabilityFailure;
    }),
    openMemory: vi.fn(async () => {
      if (memoryOpenFailure !== undefined) throw memoryOpenFailure;
      return memoryBackend;
    }),
  };

  const ownerHandleCalls = {
    openProject: vi.fn((definition: InspectedProjectDefinition) =>
      ownerOpenProjectImplementation(definition),
    ),
    deleteProject: vi.fn((id: string) => ownerDeleteProjectImplementation(id)),
    close: vi.fn(() => ownerCloseImplementation()),
  };
  const ownerHandle: OwnerHandle = {
    closed: ownerClosed.promise,
    subscribeHealth: () => () => {},
    // The inspected definition carries TReady only as a phantom; the test
    // boundary records an erased call, then restores that same phantom here.
    openProject<TReady>(definition: InspectedProjectDefinition<TReady>) {
      return ownerHandleCalls.openProject(definition) as Promise<ProjectSession<TReady>>;
    },
    deleteProject: ownerHandleCalls.deleteProject,
    close: ownerHandleCalls.close,
  };
  const owner = {
    start: vi.fn(async (_input: OwnerStartInput) => {
      if (ownerStartFailure !== undefined) throw ownerStartFailure;
      return Object.freeze({
        owner: ownerHandle,
        storage: ownerStorageSnapshot,
      });
    }),
  } satisfies OpenWorkbenchDependencies['owner'];

  const dependencies = {
    urlContext: () => URL_CONTEXT,
    capabilities: () => ({ ...capabilities }),
    locks: { request: sharedLocks.request },
    serviceWorker,
    owner,
    timers: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  } satisfies OpenWorkbenchDependencies;

  return {
    open: createOpenWorkbench(dependencies),
    capabilities,
    locks: sharedLocks,
    clock,
    controller,
    container,
    createController,
    serviceWorker,
    storage,
    owner,
    ownerHandle: ownerHandleCalls,
    ownerProjectSessions,
    opfsBackend,
    memoryBackend,
    setAutomaticPong(message: unknown | null, source?: TestServiceWorkerController | null): void {
      automaticPong = message;
      automaticPongSource = source;
    },
    setPostMessageImplementation(
      implementation: (
        controller: TestServiceWorkerController,
        message: unknown,
        transfer: Transferable[],
      ) => void,
    ): void {
      postMessageImplementation = implementation;
    },
    resetPostMessageImplementation(): void {
      postMessageImplementation = null;
      automaticPongSource = undefined;
    },
    failOpfsOpen(error: unknown): void {
      opfsOpenFailure = error;
    },
    clearOpfsOpenFailure(): void {
      opfsOpenFailure = undefined;
    },
    failDurabilityProof(error: unknown): void {
      durabilityFailure = error;
    },
    clearDurabilityFailure(): void {
      durabilityFailure = undefined;
    },
    failMemoryOpen(error: unknown): void {
      memoryOpenFailure = error;
    },
    clearMemoryOpenFailure(): void {
      memoryOpenFailure = undefined;
    },
    failOwnerStart(error: unknown): void {
      ownerStartFailure = error;
    },
    failOwnerClosed(error: unknown): void {
      ownerClosed.reject(error);
    },
    clearOwnerStartFailure(): void {
      ownerStartFailure = undefined;
    },
    setOwnerStorageSnapshot(snapshot: WorkbenchStorageSnapshot): void {
      ownerStorageSnapshot = Object.freeze(snapshot);
    },
    setOwnerOpenProjectImplementation(
      implementation: (inspected: InspectedProjectDefinition) => Promise<ProjectSession<unknown>>,
    ): void {
      ownerOpenProjectImplementation = implementation;
    },
    setOwnerDeleteProjectImplementation(implementation: (id: string) => Promise<void>): void {
      ownerDeleteProjectImplementation = implementation;
    },
    setOwnerCloseImplementation(implementation: () => Promise<void>): void {
      ownerCloseImplementation = implementation;
    },
    get listenerCount(): number {
      return container.listenerCount('controllerchange') + container.listenerCount('message');
    },
  };
}

describe('openWorkbench normalized composition', () => {
  it('uses the exact 3s default for SW proof and passes one normalized owner input', async () => {
    const h = harness();
    const workbench = await h.open(optionsWithDefaults());

    expect(DEFAULT_READY_TIMEOUT_MS).toBe(3_000);
    expect(h.clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 3_000);
    expect(h.owner.start).toHaveBeenCalledTimes(1);
    expect(h.owner.start).toHaveBeenCalledWith({
      deployment: {
        workers: {
          owner: 'https://workbench.invalid/assets/owner.js',
          kernel: 'https://workbench.invalid/assets/kernel.js',
          node: 'https://workbench.invalid/assets/node.js',
          devServer: 'https://workbench.invalid/assets/dev-server.js',
        },
        wasm: {
          sqlite: 'https://workbench.invalid/assets/sqlite.wasm',
        },
        previewProbeTimeoutMs: 3_000,
      },
      packageAcquisition: {
        registryUrl: 'https://workbench.invalid/npm-registry',
        eddy: {
          resolverUrl: 'https://eddy.invalid/resolve',
          bundleBaseUrl: 'https://eddy.invalid/resolve',
          presetPins: {},
        },
      },
      storage: { persistence: 'required' },
    });
    const input = h.owner.start.mock.calls[0]?.[0] as {
      readonly packageAcquisition?: {
        readonly eddy?: { readonly presetPins?: Readonly<Record<string, string>> };
      };
    };
    expect(Object.isFrozen(input.packageAcquisition?.eddy?.presetPins)).toBe(true);

    await workbench.close();
  });

  it('carries an optional companion TypeScript worker through the normalized owner input', async () => {
    const h = harness();
    const base = optionsWithDefaults();
    const workbench = await h.open({
      ...base,
      deployment: {
        ...base.deployment,
        workers: { ...base.deployment.workers, typescript: './typescript.js' },
      },
    } as WorkbenchOptions);

    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: expect.objectContaining({
          workers: expect.objectContaining({
            typescript: 'https://workbench.invalid/app/typescript.js',
          }),
        }),
      }),
    );
    await workbench.close();
  });

  it('preserves own preset-pin keys that collide with Object.prototype', async () => {
    const h = harness();
    const base = validOptions();
    const eddy = base.packageAcquisition.eddy;
    if (eddy === undefined) throw new Error('test options must contain Eddy configuration');
    const parsedPins: unknown = JSON.parse('{"__proto__":"sha256-prototype"}');
    if (parsedPins === null || typeof parsedPins !== 'object' || Array.isArray(parsedPins)) {
      throw new Error('test preset pins must be an object');
    }
    const workbench = await h.open({
      ...base,
      packageAcquisition: {
        ...base.packageAcquisition,
        eddy: { ...eddy, presetPins: parsedPins as Readonly<Record<string, string>> },
      },
    });

    const ownerInput = h.owner.start.mock.calls[0]?.[0] as {
      readonly packageAcquisition?: {
        readonly eddy?: { readonly presetPins?: Readonly<Record<string, string>> };
      };
    };
    const normalizedPins = ownerInput.packageAcquisition?.eddy?.presetPins;
    expect(Object.prototype.hasOwnProperty.call(normalizedPins, '__proto__')).toBe(true);
    expect(Reflect.get(normalizedPins ?? {}, '__proto__')).toBe('sha256-prototype');

    await workbench.close();
  });

  it('inspects the opaque definition before owner ingress and preserves TReady on the full session', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const vite = definition('typed-vite');

    const opening: Promise<ProjectSession<PreviewHandle>> = workbench.openProject(vite);
    const session = await opening;

    expectTypeOf<Extract<keyof PreviewHandle, 'ownerToken'>>().toEqualTypeOf<never>();
    expect(h.ownerHandle.openProject).toHaveBeenCalledWith(inspectProjectDefinition(vite));
    const typedRun: () => ProjectRun<PreviewHandle> = session.run;
    expect(typedRun).toBe(session.run);
    expect(session).toEqual(
      expect.objectContaining({
        run: expect.any(Function),
        terminals: expect.objectContaining({ open: expect.any(Function) }),
        close: expect.any(Function),
      }),
    );

    await session.close();
    await workbench.close();
  });
});

describe('openWorkbench controlling service-worker proof', () => {
  it('waits on controllerchange, PINGs the claimed controller, and removes both listener kinds', async () => {
    const h = harness();
    const replacement = h.createController('replacement');
    h.container.setController(null, false);

    const opening = h.open(validOptions());
    await waitUntilOrRethrow(
      opening,
      () => h.container.listenerCount('controllerchange') === 1 && h.clock.pending === 1,
    );
    expect(replacement.postMessage).not.toHaveBeenCalled();

    h.container.setController(replacement);
    const workbench = await opening;

    expect(replacement.postMessage).toHaveBeenCalledWith(
      {
        type: SW_PING,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      [expect.any(MessagePort)],
    );
    expect(h.listenerCount).toBe(0);
    expect(h.clock.pending).toBe(0);
    await workbench.close();
  });

  it.each([
    [
      'frame version',
      {
        type: SW_PONG,
        frameVersion: 'stale',
        routingVersion: SW_ROUTING_VERSION,
        from: 'service-worker',
      },
    ],
    [
      'routing version',
      {
        type: SW_PONG,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: 'stale',
        from: 'service-worker',
      },
    ],
    [
      'sender provenance',
      {
        type: SW_PONG,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        from: 'window',
      },
    ],
  ] as const)('ignores a PONG with the wrong %s under one bounded timer', async (_label, pong) => {
    const h = harness();
    h.setAutomaticPong(pong);

    const opening = h.open(validOptions());
    await waitUntilOrRethrow(opening, () => h.clock.pending === 1 && h.listenerCount > 0);
    h.clock.fireAll();

    await expect(opening).rejects.toThrow(/service worker.*timed out|timed out.*PONG/i);
    expect(h.clock.setTimeout).toHaveBeenCalledTimes(1);
    expect(h.listenerCount).toBe(0);
    expect(h.locks.held).toBe(false);
  });

  it('ignores an exact PONG carried by a MessageEvent from the wrong source', async () => {
    const h = harness();
    const foreign = h.createController('foreign');
    h.setAutomaticPong(
      {
        type: SW_PONG,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        from: 'service-worker',
      },
      foreign,
    );

    const opening = h.open(validOptions());
    await waitUntilOrRethrow(opening, () => h.clock.pending === 1 && h.listenerCount > 0);
    h.clock.fireAll();

    await expect(opening).rejects.toThrow(/service worker.*timed out|timed out.*PONG/i);
    expect(h.listenerCount).toBe(0);
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.owner.start).not.toHaveBeenCalled();
  });

  it('re-PINGs a replacement controller and ignores the old controller late PONG', async () => {
    const h = harness();
    const replacement = h.createController('replacement');
    const exactPong = {
      type: SW_PONG,
      frameVersion: SW_FRAME_VERSION,
      routingVersion: SW_ROUTING_VERSION,
      from: 'service-worker',
    };
    let replacementReplyPort: MessagePort | undefined;
    h.setPostMessageImplementation((controller, _message, transfer) => {
      const replyPort = transfer[0];
      if (!(replyPort instanceof MessagePort)) throw new Error('missing SW control reply port');
      if (controller === h.controller) {
        h.container.setController(replacement);
        replyPort.postMessage(exactPong);
        replacementReplyPort?.postMessage(exactPong);
        return;
      }
      replacementReplyPort = replyPort;
    });

    const workbench = await h.open(validOptions());

    expect(h.controller.postMessage).toHaveBeenCalledTimes(1);
    expect(replacement.postMessage).toHaveBeenCalledTimes(1);
    expect(h.clock.setTimeout).toHaveBeenCalledTimes(1);
    expect(h.listenerCount).toBe(0);
    await workbench.close();
  });

  it('propagates postMessage failure, cleans the proof, releases admission, and can retry', async () => {
    const h = harness();
    const failure = new Error('controller postMessage failed');
    h.setPostMessageImplementation(() => {
      throw failure;
    });

    await expect(h.open(validOptions())).rejects.toBe(failure);
    expect(h.listenerCount).toBe(0);
    expect(h.clock.pending).toBe(0);
    expect(h.locks.held).toBe(false);
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.owner.start).not.toHaveBeenCalled();

    h.resetPostMessageImplementation();
    const retried = await h.open(validOptions());
    await retried.close();
  });
});

describe('openWorkbench project operation admission', () => {
  it('claims open synchronously so open/open admits only the first call', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<ProjectSession<unknown>>();
    const session = createTestSession<unknown>();
    h.setOwnerOpenProjectImplementation(() => pending.promise);

    const first = workbench.openProject(definition('first'));
    const second = workbench.openProject(definition('second'));

    await expect(second).rejects.toBeInstanceOf(ProjectBusyError);
    expect(h.ownerHandle.openProject).toHaveBeenCalledTimes(1);
    pending.resolve(session.session);
    const opened = await first;
    await opened.close();
    await workbench.close();
  });

  it('claims open synchronously against same-tick delete', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<ProjectSession<unknown>>();
    const session = createTestSession<unknown>();
    h.setOwnerOpenProjectImplementation(() => pending.promise);

    const opening = workbench.openProject(definition('opening'));
    const deleting = workbench.deleteProject('opening');

    await expect(deleting).rejects.toBeInstanceOf(ProjectBusyError);
    expect(h.ownerHandle.deleteProject).not.toHaveBeenCalled();
    pending.resolve(session.session);
    const opened = await opening;
    await opened.close();
    await workbench.close();
  });

  it('claims delete synchronously against same-tick open and releases after exact completion', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<void>();
    h.setOwnerDeleteProjectImplementation(() => pending.promise);

    const deleting = workbench.deleteProject('old');
    const opening = workbench.openProject(definition('new'));

    await expect(opening).rejects.toBeInstanceOf(ProjectBusyError);
    expect(h.ownerHandle.openProject).not.toHaveBeenCalled();
    pending.resolve(undefined);
    await deleting;

    const opened = await workbench.openProject(definition('new'));
    await opened.close();
    await workbench.close();
  });

  it('releases the operation claim after open failure without replacing the original error', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const failure = new Error('owner open failed');
    const session = createTestSession<unknown>();
    let attempts = 0;
    h.setOwnerOpenProjectImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw failure;
      return session.session;
    });

    await expect(workbench.openProject(definition('retry-open'))).rejects.toBe(failure);
    const opened = await workbench.openProject(definition('retry-open'));
    await opened.close();
    await workbench.close();
  });

  it('releases the operation claim after delete failure without replacing the original error', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const failure = new Error('owner delete failed');
    let attempts = 0;
    h.setOwnerDeleteProjectImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw failure;
    });

    await expect(workbench.deleteProject('retry-delete')).rejects.toBe(failure);
    await workbench.deleteProject('retry-delete');
    await workbench.close();
  });

  it('fences a session arriving after close, closes it, and rejects open with ClosedHandleError', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<ProjectSession<unknown>>();
    const session = createTestSession<unknown>();
    h.setOwnerOpenProjectImplementation(() => pending.promise);

    const opening = workbench.openProject(definition('late'));
    const closing = workbench.close();
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');

    pending.resolve(session.session);
    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await closing;
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);
  });

  it('waits for an admitted delete, preserves its success, then closes owner and lock', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<void>();
    h.setOwnerDeleteProjectImplementation(() => pending.promise);

    const deleting = workbench.deleteProject('deleting');
    const closing = workbench.close();
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');

    pending.resolve(undefined);
    await deleting;
    await closing;
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);
  });

  it('preserves an admitted delete failure while close continues teardown', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<void>();
    const failure = new Error('late delete failure');
    h.setOwnerDeleteProjectImplementation(() => pending.promise);

    const deleting = workbench.deleteProject('deleting');
    const closing = workbench.close();
    pending.reject(failure);

    await expect(deleting).rejects.toBe(failure);
    await closing;
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);
  });

  it('returns one stable close promise and rejects every post-close operation by class', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());

    const firstClose = workbench.close();
    const secondClose = workbench.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;

    await expect(workbench.openProject(definition('closed'))).rejects.toBeInstanceOf(
      ClosedHandleError,
    );
    await expect(workbench.deleteProject('closed')).rejects.toBeInstanceOf(ClosedHandleError);
    expect(h.ownerHandle.openProject).not.toHaveBeenCalled();
    expect(h.ownerHandle.deleteProject).not.toHaveBeenCalled();
  });
});

describe('openWorkbench close fault contract', () => {
  it('reserves a tracked session close promise before calling the raw session', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const session = createTestSession<unknown>();
    h.setOwnerOpenProjectImplementation(async () => session.session);
    const opened = await workbench.openProject(definition('reentrant-session-close'));
    let reentered: Promise<void> | null = null;
    let didReenter = false;
    session.setCloseImplementation(async () => {
      if (didReenter) return;
      didReenter = true;
      reentered = opened.close();
    });

    const closing = opened.close();

    expect(reentered).toBe(closing);
    expect(opened.close()).toBe(closing);
    await closing;
    expect(session.close).toHaveBeenCalledTimes(1);
    await workbench.close();
  });

  it('reserves Workbench close state before project teardown can reenter close', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const session = createTestSession<unknown>();
    h.setOwnerOpenProjectImplementation(async () => session.session);
    await workbench.openProject(definition('reentrant-workbench-close'));
    let reentered: Promise<void> | null = null;
    let didReenter = false;
    session.setCloseImplementation(async () => {
      if (didReenter) return;
      didReenter = true;
      reentered = workbench.close();
    });

    const closing = workbench.close();

    expect(reentered).toBe(closing);
    expect(workbench.close()).toBe(closing);
    await closing;
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);
  });

  it.each([
    ['dirty document', new DirtyProjectDocumentError('/src/main.ts')],
    ['document save in progress', new ProjectDocumentSaveInProgressError('/src/main.ts')],
  ])(
    'keeps Workbench and its active session retryable after %s preflight rejection',
    async (_scenario, failure) => {
      const h = harness();
      const workbench = await h.open(validOptions());
      const session = createTestSession<unknown>();
      let allowClose = false;
      session.setCloseImplementation(async () => {
        if (!allowClose) throw failure;
      });
      h.setOwnerOpenProjectImplementation(async () => session.session);
      await workbench.openProject(definition('retryable-close-preflight'));

      const rejected = workbench.close();

      await expect(rejected).rejects.toBe(failure);
      expect(h.ownerHandle.close).not.toHaveBeenCalled();
      expect(h.locks.held).toBe(true);
      await expect(workbench.deleteProject('still-active')).rejects.toBeInstanceOf(
        ProjectBusyError,
      );

      allowClose = true;
      const retry = workbench.close();
      expect(retry).not.toBe(rejected);
      await retry;
      expect(session.close).toHaveBeenCalledTimes(2);
      expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
      expect(h.locks.held).toBe(false);
    },
  );

  it('retains an owner exit that races a retryable close preflight rollback', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const session = createTestSession<unknown>();
    const preflightFailure = new DirtyProjectDocumentError('/src/main.ts');
    const ownerExit = new Error('owner exited during close preflight');
    let allowClose = false;
    session.setCloseImplementation(() => {
      if (allowClose) return Promise.resolve();
      h.failOwnerClosed(ownerExit);
      return Promise.reject(preflightFailure);
    });
    h.setOwnerOpenProjectImplementation(async () => session.session);
    await workbench.openProject(definition('owner-exit-close-preflight'));

    await expect(workbench.close()).rejects.toBe(preflightFailure);
    expect(workbench.health.snapshot()).toEqual({
      disposition: 'unavailable',
      issues: [
        {
          kind: 'unavailable',
          scope: 'owner',
          summary: 'Workbench owner exited unexpectedly',
          recovery: 'reload',
        },
      ],
    });

    allowClose = true;
    await workbench.close();
  });

  it('starts owner close to cancel an admitted open instead of waiting on that open', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<ProjectSession<unknown>>();
    const cancellation = new Error('owner close cancelled project open');
    h.setOwnerOpenProjectImplementation(() => pending.promise);
    h.setOwnerCloseImplementation(async () => pending.reject(cancellation));

    const opening = workbench.openProject(definition('cancelled-open'));
    const closing = workbench.close();

    await waitUntilOrRethrow(closing, () => h.ownerHandle.close.mock.calls.length === 1);
    await expect(opening).rejects.toBe(cancellation);
    await closing;
    expect(h.locks.held).toBe(false);
  });

  it('starts owner close to cancel an admitted delete instead of waiting on that delete', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const pending = deferred<void>();
    const cancellation = new Error('owner close cancelled project delete');
    h.setOwnerDeleteProjectImplementation(() => pending.promise);
    h.setOwnerCloseImplementation(async () => pending.reject(cancellation));

    const deleting = workbench.deleteProject('cancelled-delete');
    const closing = workbench.close();

    await waitUntilOrRethrow(closing, () => h.ownerHandle.close.mock.calls.length === 1);
    await expect(deleting).rejects.toBe(cancellation);
    await closing;
    expect(h.locks.held).toBe(false);
  });

  it('starts owner close after project close is invoked so either side can cancel the other', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const session = createTestSession<unknown>();
    const projectClosed = deferred<void>();
    session.setCloseImplementation(() => projectClosed.promise);
    h.setOwnerOpenProjectImplementation(async () => session.session);
    h.setOwnerCloseImplementation(async () => projectClosed.resolve(undefined));
    await workbench.openProject(definition('mutual-close'));

    const closing = workbench.close();

    await waitUntilOrRethrow(closing, () => h.ownerHandle.close.mock.calls.length === 1);
    await closing;
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);
  });

  it('attempts project, owner, and lock release once; rejects one stable AggregateError', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const session = createTestSession<unknown>();
    const projectFailure = new Error('project close failed');
    const ownerFailure = new Error('owner close failed');
    const lockFailure = new Error('lock release failed');
    const events: string[] = [];
    session.setCloseImplementation(async () => {
      events.push('project');
      throw projectFailure;
    });
    h.setOwnerOpenProjectImplementation(async () => session.session);
    h.setOwnerCloseImplementation(async () => {
      events.push('owner');
      throw ownerFailure;
    });
    h.locks.onRelease(() => events.push('lock'));
    h.locks.failRelease(lockFailure);
    await workbench.openProject(definition('faulty-close'));

    const firstClose = workbench.close();
    const secondClose = workbench.close();
    expect(secondClose).toBe(firstClose);
    const error = await firstClose.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([projectFailure, ownerFailure, lockFailure]);
    expect(events).toEqual(['project', 'owner', 'lock']);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);

    h.setOwnerCloseImplementation(async () => {});
    h.locks.clearReleaseFailure();
    const retried = await h.open(validOptions());
    await retried.close();
  });

  it('does not settle close before the Web Lock request confirms release', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const release = h.locks.delayRelease();

    const closing = workbench.close();
    await waitUntilOrRethrow(closing, () => h.ownerHandle.close.mock.calls.length === 1);
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    expect(h.locks.held).toBe(true);

    release();
    await closing;
    expect(h.locks.held).toBe(false);
  });
});

describe('openWorkbench storage fault contract', () => {
  it('preferred publishes the exact durable snapshot selected by the owner', async () => {
    const h = harness();
    h.setOwnerStorageSnapshot({
      policy: 'preferred',
      backend: 'opfs',
      durability: 'durable',
    });
    const workbench = await h.open(withPersistence('preferred'));

    expect(workbench.snapshot().storage).toEqual({
      policy: 'preferred',
      backend: 'opfs',
      durability: 'durable',
    });
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'preferred' } }),
    );
    await workbench.close();
  });

  it('preferred exposes the exact owner-reported OPFS-open fallback reason', async () => {
    const h = harness();
    const failure = new Error('OPFS permission denied');
    h.setOwnerStorageSnapshot({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: failure.message },
    });

    const workbench = await h.open(withPersistence('preferred'));

    expect(workbench.snapshot().storage).toEqual({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: failure.message },
    });
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'preferred' } }),
    );
    await workbench.close();
  });

  it('preferred exposes the exact owner-reported OPFS-proof fallback reason', async () => {
    const h = harness();
    const failure = new Error('OPFS durability proof failed');
    h.setOwnerStorageSnapshot({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: failure.message },
    });

    const workbench = await h.open(withPersistence('preferred'));

    expect(workbench.snapshot().storage).toEqual({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: failure.message },
    });
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'preferred' } }),
    );
    await workbench.close();
  });

  it.each(['open', 'proof'] as const)(
    'preserves both owner OPFS-%s and memory failures when preferred initialization fails',
    async (boundary) => {
      const h = harness();
      const opfsFailure = new Error(`OPFS ${boundary} failed`);
      const memoryFailure = new Error('memory open failed');
      const ownerFailure = new AggregateError(
        [opfsFailure, memoryFailure],
        `Preferred storage failed: ${opfsFailure.message}; ${memoryFailure.message}`,
      );
      h.failOwnerStart(ownerFailure);

      const error = await h.open(withPersistence('preferred')).catch((caught: unknown) => caught);

      expect(error).toBe(ownerFailure);
      expect((error as AggregateError).errors).toEqual([opfsFailure, memoryFailure]);
      expect(h.owner.start).toHaveBeenCalledWith(
        expect.objectContaining({ storage: { persistence: 'preferred' } }),
      );
      expect(h.storage.openOpfs).not.toHaveBeenCalled();
      expect(h.storage.proveDurability).not.toHaveBeenCalled();
      expect(h.storage.openMemory).not.toHaveBeenCalled();
      expect(h.locks.held).toBe(false);
    },
  );

  it('ephemeral delegates selection to the owner and never page-probes OPFS or memory', async () => {
    const h = harness();
    h.setOwnerStorageSnapshot({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });

    const workbench = await h.open(withPersistence('ephemeral'));

    expect(workbench.snapshot().storage).toEqual({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'ephemeral' } }),
    );
    await workbench.close();
  });

  it('required preserves owner storage failure and releases Web Lock and page claim for retry', async () => {
    const h = harness();
    const failure = new Error('required OPFS unavailable');
    h.failOwnerStart(failure);

    await expect(h.open(validOptions())).rejects.toBe(failure);
    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'required' } }),
    );
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.locks.held).toBe(false);

    h.clearOwnerStartFailure();
    const retried = await h.open(validOptions());
    await retried.close();
  });

  it('releases admission after preferred owner storage failure and can retry selection', async () => {
    const h = harness();
    const opfsFailure = new Error('OPFS denied');
    const memoryFailure = new Error('memory denied');
    h.failOwnerStart(new AggregateError([opfsFailure, memoryFailure]));

    await expect(h.open(withPersistence('preferred'))).rejects.toBeInstanceOf(AggregateError);
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.locks.held).toBe(false);

    h.clearOwnerStartFailure();
    h.setOwnerStorageSnapshot({
      policy: 'preferred',
      backend: 'opfs',
      durability: 'durable',
    });
    const retried = await h.open(withPersistence('preferred'));
    expect(retried.snapshot().storage.backend).toBe('opfs');
    await retried.close();
  });

  it('releases admission after owner start failure and retries with the same normalized input', async () => {
    const h = harness();
    const failure = new Error('owner worker failed to start');
    h.failOwnerStart(failure);

    await expect(h.open(validOptions())).rejects.toBe(failure);
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.locks.held).toBe(false);

    h.clearOwnerStartFailure();
    const retried = await h.open(validOptions());
    expect(h.owner.start).toHaveBeenCalledTimes(2);
    expect(h.owner.start.mock.calls[1]?.[0]).toEqual(h.owner.start.mock.calls[0]?.[0]);
    await retried.close();
  });
});
