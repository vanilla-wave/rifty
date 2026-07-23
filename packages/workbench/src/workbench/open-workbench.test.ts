import { SW_FRAME_VERSION, SW_PING, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { describe, expect, it, vi } from 'vitest';
import { ClosedHandleError, WorkbenchOriginOccupiedError } from './errors.ts';
import { type WorkbenchStorageSnapshot, createOpenWorkbench } from './open-workbench.ts';
import { createUnusedOwnerProjectHandles } from './project-content.test-fixture.ts';
import { type InspectedProjectDefinition, projects } from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';

type OpenWorkbench = ReturnType<typeof createOpenWorkbench>;
type WorkbenchOptions = Parameters<OpenWorkbench>[0];
type OpenWorkbenchDependencies = Parameters<typeof createOpenWorkbench>[0];
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

interface UrlContext {
  readonly apiBaseUrl: string;
  readonly clientUrl: string;
}

const URL_CONTEXT: UrlContext = Object.freeze({
  apiBaseUrl: 'https://workbench.invalid/app/index.html',
  clientUrl: 'https://workbench.invalid/app/index.html',
});

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
      wasm: { sqlite: '/assets/sqlite.wasm', esbuild: '/assets/esbuild.wasm' },
      previewProbeTimeoutMs: 50,
    },
    packageAcquisition: {
      registryUrl: '/npm-registry',
      eddy: {
        resolverUrl: 'https://eddy.invalid/resolve',
        bundleBaseUrl: 'https://eddy.invalid/bundles',
        presetPins: { vite: '8.0.16' },
      },
    },
    storage: { persistence: 'required' },
  };
}

function withOption(path: readonly string[], value: unknown): WorkbenchOptions {
  const root = structuredClone(validOptions()) as unknown as Record<string, unknown>;
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    const child = parent[segment];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      throw new Error(`test path does not name an object: ${path.join('.')}`);
    }
    parent = child as Record<string, unknown>;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error('test path must not be empty');
  parent[last] = value;
  return root as unknown as WorkbenchOptions;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition did not become true');
}

async function settledOr<T>(promise: Promise<T>, pending: T): Promise<T> {
  return Promise.race([promise, Promise.resolve().then(() => pending)]);
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
    const callbacks = [...this.#callbacks.entries()];
    this.#callbacks.clear();
    for (const [, callback] of callbacks) callback();
  }
}

class ExclusiveLockHost {
  held = false;
  unavailable = false;

  readonly request = vi.fn<LockRequest>(async (name, options, callback) => {
    if (this.unavailable || this.held) {
      await callback(null);
      return;
    }

    this.held = true;
    try {
      await callback({ name, mode: options.mode });
    } finally {
      this.held = false;
    }
  });
}

function harness(sharedLocks = new ExclusiveLockHost()) {
  const clock = new TestClock();
  const capabilities: CapabilitySnapshot = {
    dom: true,
    worker: true,
    crossOriginIsolated: true,
    webLocks: true,
  };
  const listeners = {
    controllerchange: new Set<EventListener>(),
    message: new Set<EventListener>(),
  };
  let automaticPong: unknown = {
    type: SW_PONG,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
    from: 'service-worker',
  };
  let opfsOpenFailure: unknown;
  let durabilityFailure: unknown;
  let ownerStartFailure: unknown;
  let ownerStorageSnapshot: WorkbenchStorageSnapshot = Object.freeze({
    policy: 'required',
    backend: 'opfs',
    durability: 'durable',
  });
  let rejectOwnerClosed!: (error: unknown) => void;
  const ownerClosed = new Promise<unknown>((_resolve, reject) => {
    rejectOwnerClosed = reject;
  });
  const ownerHealthListeners = new Set<Parameters<OwnerHandle['subscribeHealth']>[0]>();
  let urlContext = URL_CONTEXT;

  const controller = {
    postMessage: vi.fn((_message: unknown, transfer: Transferable[]): void => {
      if (automaticPong === null) return;
      const replyPort = transfer[0];
      if (!(replyPort instanceof MessagePort)) throw new Error('missing SW control reply port');
      replyPort.postMessage(automaticPong);
    }),
  };
  const serviceWorker = {
    register: vi.fn(
      async (_url: string, _options: { readonly scope: string }): Promise<void> => {},
    ),
    get controller() {
      return controller;
    },
    addEventListener(type: 'controllerchange' | 'message', listener: EventListener): void {
      listeners[type].add(listener);
    },
    removeEventListener(type: 'controllerchange' | 'message', listener: EventListener): void {
      listeners[type].delete(listener);
    },
  };

  const opfsBackend = { kind: 'opfs' as const, token: Symbol('opfs') };
  const memoryBackend = { kind: 'memory' as const, token: Symbol('memory') };
  const storage = {
    openOpfs: vi.fn(async () => {
      if (opfsOpenFailure !== undefined) throw opfsOpenFailure;
      return opfsBackend;
    }),
    proveDurability: vi.fn(async (_backend: typeof opfsBackend): Promise<void> => {
      if (durabilityFailure !== undefined) throw durabilityFailure;
    }),
    openMemory: vi.fn(async () => memoryBackend),
  };

  const ownerProjectCloses: ReturnType<typeof vi.fn>[] = [];
  const openOwnerProject = async <TReady>(
    _definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>> => {
    const close = vi.fn(async (): Promise<void> => {});
    ownerProjectCloses.push(close);
    return {
      ...createUnusedOwnerProjectHandles('openWorkbench owner session'),
      run() {
        throw new Error('not used by openWorkbench tests');
      },
      terminals: Object.freeze({
        open() {
          throw new Error('not used by openWorkbench tests');
        },
      }),
      close,
    };
  };
  const ownerHandleCalls = {
    openProject: vi.fn((definition: InspectedProjectDefinition) => openOwnerProject(definition)),
    deleteProject: vi.fn(async (_id: string): Promise<void> => {}),
    close: vi.fn(async (): Promise<void> => {}),
  };
  const ownerHandle: OwnerHandle = {
    closed: ownerClosed,
    subscribeHealth(listener) {
      ownerHealthListeners.add(listener);
      return () => ownerHealthListeners.delete(listener);
    },
    openProject<TReady>(definition: InspectedProjectDefinition<TReady>) {
      return ownerHandleCalls.openProject(definition) as Promise<ProjectSession<TReady>>;
    },
    deleteProject: ownerHandleCalls.deleteProject,
    close: ownerHandleCalls.close,
  };
  const owner = {
    start: vi.fn(async (_input: Parameters<OpenWorkbenchDependencies['owner']['start']>[0]) => {
      if (ownerStartFailure !== undefined) throw ownerStartFailure;
      return Object.freeze({
        owner: ownerHandle,
        storage: ownerStorageSnapshot,
      });
    }),
  } satisfies OpenWorkbenchDependencies['owner'];
  const reload = vi.fn();

  const dependencies = {
    urlContext: () => urlContext,
    capabilities: () => ({ ...capabilities }),
    locks: { request: sharedLocks.request },
    serviceWorker,
    owner,
    reload,
    timers: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  } satisfies OpenWorkbenchDependencies & {
    readonly urlContext: () => UrlContext;
  };

  return {
    open: createOpenWorkbench(dependencies),
    capabilities,
    locks: sharedLocks,
    clock,
    controller,
    serviceWorker,
    storage,
    owner,
    reload,
    ownerHandle: ownerHandleCalls,
    ownerProjectCloses,
    opfsBackend,
    memoryBackend,
    setAutomaticPong(message: unknown) {
      automaticPong = message;
    },
    failOpfsOpen(error: unknown) {
      opfsOpenFailure = error;
    },
    failDurabilityProof(error: unknown) {
      durabilityFailure = error;
    },
    failOwnerStart(error: unknown) {
      ownerStartFailure = error;
    },
    failOwnerClosed(error: unknown) {
      rejectOwnerClosed(error);
    },
    failOwnerInvariant(summary: string) {
      for (const listener of [...ownerHealthListeners]) {
        listener({ kind: 'fatal-invariant', summary });
      }
    },
    failOwnerPersistence(recover: () => Promise<void>) {
      for (const listener of [...ownerHealthListeners]) {
        listener({ kind: 'persistence', status: 'degraded', recover });
      }
    },
    setOwnerStorageSnapshot(snapshot: WorkbenchStorageSnapshot) {
      ownerStorageSnapshot = Object.freeze(snapshot);
    },
    setUrlContext(value: { readonly apiBaseUrl: string; readonly clientUrl: string }) {
      urlContext = Object.freeze({ ...value });
    },
    get listenerCount() {
      return listeners.controllerchange.size + listeners.message.size;
    },
  };
}

const invalidConfigurationCases: readonly {
  readonly label: string;
  readonly path: readonly string[];
  readonly value: unknown;
  readonly expectedPath: RegExp;
}[] = [
  {
    label: 'owner Worker URL',
    path: ['deployment', 'workers', 'owner'],
    value: ' ',
    expectedPath: /deployment\.workers\.owner/,
  },
  {
    label: 'kernel Worker URL',
    path: ['deployment', 'workers', 'kernel'],
    value: '',
    expectedPath: /deployment\.workers\.kernel/,
  },
  {
    label: 'Node Worker URL',
    path: ['deployment', 'workers', 'node'],
    value: undefined,
    expectedPath: /deployment\.workers\.node/,
  },
  {
    label: 'dev-server Worker URL',
    path: ['deployment', 'workers', 'devServer'],
    value: '',
    expectedPath: /deployment\.workers\.devServer/,
  },
  {
    label: 'service Worker URL',
    path: ['deployment', 'serviceWorker', 'url'],
    value: '',
    expectedPath: /deployment\.serviceWorker\.url/,
  },
  {
    label: 'service Worker scope',
    path: ['deployment', 'serviceWorker', 'scope'],
    value: ' ',
    expectedPath: /deployment\.serviceWorker\.scope/,
  },
  {
    label: 'SQLite WASM URL',
    path: ['deployment', 'wasm', 'sqlite'],
    value: '',
    expectedPath: /deployment\.wasm\.sqlite/,
  },
  {
    label: 'esbuild WASM URL',
    path: ['deployment', 'wasm', 'esbuild'],
    value: '',
    expectedPath: /deployment\.wasm\.esbuild/,
  },
  {
    label: 'zero preview timeout',
    path: ['deployment', 'previewProbeTimeoutMs'],
    value: 0,
    expectedPath: /deployment\.previewProbeTimeoutMs/,
  },
  {
    label: 'non-finite preview timeout',
    path: ['deployment', 'previewProbeTimeoutMs'],
    value: Number.POSITIVE_INFINITY,
    expectedPath: /deployment\.previewProbeTimeoutMs/,
  },
  {
    label: 'registry URL',
    path: ['packageAcquisition', 'registryUrl'],
    value: '',
    expectedPath: /packageAcquisition\.registryUrl/,
  },
  {
    label: 'Eddy resolver URL',
    path: ['packageAcquisition', 'eddy', 'resolverUrl'],
    value: '',
    expectedPath: /packageAcquisition\.eddy\.resolverUrl/,
  },
  {
    label: 'Eddy bundle base URL',
    path: ['packageAcquisition', 'eddy', 'bundleBaseUrl'],
    value: ' ',
    expectedPath: /packageAcquisition\.eddy\.bundleBaseUrl/,
  },
  {
    label: 'Eddy preset pin',
    path: ['packageAcquisition', 'eddy', 'presetPins', 'vite'],
    value: '',
    expectedPath: /packageAcquisition\.eddy\.presetPins\.vite/,
  },
  {
    label: 'storage policy',
    path: ['storage', 'persistence'],
    value: 'durable',
    expectedPath: /storage\.persistence/,
  },
];

const malformedUrlCases = [
  ['deployment.workers.owner', ['deployment', 'workers', 'owner']],
  ['deployment.workers.kernel', ['deployment', 'workers', 'kernel']],
  ['deployment.workers.node', ['deployment', 'workers', 'node']],
  ['deployment.workers.devServer', ['deployment', 'workers', 'devServer']],
  ['deployment.serviceWorker.url', ['deployment', 'serviceWorker', 'url']],
  ['deployment.serviceWorker.scope', ['deployment', 'serviceWorker', 'scope']],
  ['deployment.wasm.sqlite', ['deployment', 'wasm', 'sqlite']],
  ['deployment.wasm.esbuild', ['deployment', 'wasm', 'esbuild']],
  ['packageAcquisition.registryUrl', ['packageAcquisition', 'registryUrl']],
  ['packageAcquisition.eddy.resolverUrl', ['packageAcquisition', 'eddy', 'resolverUrl']],
  ['packageAcquisition.eddy.bundleBaseUrl', ['packageAcquisition', 'eddy', 'bundleBaseUrl']],
] as const;

const invalidDestinationCases: readonly {
  readonly label: string;
  readonly options: () => WorkbenchOptions;
  readonly expectedPath: RegExp;
}[] = [
  {
    label: 'cross-origin owner Worker',
    options: () => withOption(['deployment', 'workers', 'owner'], 'https://other.invalid/owner.js'),
    expectedPath: /deployment\.workers\.owner/,
  },
  {
    label: 'data kernel Worker without cross-origin isolation',
    options: () =>
      withOption(['deployment', 'workers', 'kernel'], 'data:text/javascript,self.close()'),
    expectedPath: /deployment\.workers\.kernel/,
  },
  {
    label: 'opaque blob Node Worker',
    options: () => withOption(['deployment', 'workers', 'node'], 'blob:opaque-node-worker'),
    expectedPath: /deployment\.workers\.node/,
  },
  {
    label: 'unsupported dev-server Worker scheme',
    options: () => withOption(['deployment', 'workers', 'devServer'], 'ftp://host/dev.js'),
    expectedPath: /deployment\.workers\.devServer/,
  },
  {
    label: 'data service Worker script',
    options: () =>
      withOption(['deployment', 'serviceWorker', 'url'], 'data:text/javascript,self.skipWaiting()'),
    expectedPath: /deployment\.serviceWorker\.url/,
  },
  {
    label: 'cross-origin service Worker script',
    options: () =>
      withOption(['deployment', 'serviceWorker', 'url'], 'https://other.invalid/sw.js'),
    expectedPath: /deployment\.serviceWorker\.url/,
  },
  {
    label: 'encoded separator in service Worker script path',
    options: () => withOption(['deployment', 'serviceWorker', 'url'], '/workers%2Fsw.js'),
    expectedPath: /deployment\.serviceWorker\.url/,
  },
  {
    label: 'blob service Worker scope',
    options: () =>
      withOption(['deployment', 'serviceWorker', 'scope'], 'blob:https://workbench.invalid/id'),
    expectedPath: /deployment\.serviceWorker\.scope/,
  },
  {
    label: 'cross-origin service Worker scope',
    options: () =>
      withOption(['deployment', 'serviceWorker', 'scope'], 'https://other.invalid/app/'),
    expectedPath: /deployment\.serviceWorker\.scope/,
  },
  {
    label: 'encoded separator in service Worker scope path',
    options: () => withOption(['deployment', 'serviceWorker', 'scope'], '/app%5Cscope/'),
    expectedPath: /deployment\.serviceWorker\.scope/,
  },
  {
    label: 'service Worker scope that cannot control the client',
    options: () => withOption(['deployment', 'serviceWorker', 'scope'], '/other/'),
    expectedPath: /deployment\.serviceWorker\.scope/,
  },
  {
    label: 'unsupported SQLite WASM scheme',
    options: () => withOption(['deployment', 'wasm', 'sqlite'], 'ftp://host/sqlite.wasm'),
    expectedPath: /deployment\.wasm\.sqlite/,
  },
  {
    label: 'non-trustworthy HTTP SQLite WASM asset',
    options: () =>
      withOption(['deployment', 'wasm', 'sqlite'], 'http://assets.invalid/sqlite.wasm'),
    expectedPath: /deployment\.wasm\.sqlite/,
  },
  {
    label: 'cross-origin blob SQLite WASM asset',
    options: () =>
      withOption(['deployment', 'wasm', 'sqlite'], 'blob:https://other.invalid/sqlite-wasm'),
    expectedPath: /deployment\.wasm\.sqlite/,
  },
  {
    label: 'credentialed esbuild WASM URL',
    options: () =>
      withOption(['deployment', 'wasm', 'esbuild'], 'https://user:secret@host/esbuild.wasm'),
    expectedPath: /deployment\.wasm\.esbuild/,
  },
  {
    label: 'non-trustworthy HTTP esbuild WASM asset',
    options: () =>
      withOption(['deployment', 'wasm', 'esbuild'], 'http://assets.invalid/esbuild.wasm'),
    expectedPath: /deployment\.wasm\.esbuild/,
  },
  {
    label: 'data registry base',
    options: () => withOption(['packageAcquisition', 'registryUrl'], 'data:application/json,{}'),
    expectedPath: /packageAcquisition\.registryUrl/,
  },
  {
    label: 'registry base with a query',
    options: () => withOption(['packageAcquisition', 'registryUrl'], '/registry?tenant=one'),
    expectedPath: /packageAcquisition\.registryUrl/,
  },
  {
    label: 'non-trustworthy HTTP registry base',
    options: () => withOption(['packageAcquisition', 'registryUrl'], 'http://registry.invalid/npm'),
    expectedPath: /packageAcquisition\.registryUrl/,
  },
  {
    label: 'hostname that only resembles an IPv4 loopback address',
    options: () =>
      withOption(['packageAcquisition', 'registryUrl'], 'http://127.evil.example.com/npm'),
    expectedPath: /packageAcquisition\.registryUrl/,
  },
  {
    label: 'blob Eddy resolver',
    options: () =>
      withOption(
        ['packageAcquisition', 'eddy', 'resolverUrl'],
        'blob:https://workbench.invalid/resolver',
      ),
    expectedPath: /packageAcquisition\.eddy\.resolverUrl/,
  },
  {
    label: 'non-trustworthy HTTP Eddy resolver',
    options: () =>
      withOption(['packageAcquisition', 'eddy', 'resolverUrl'], 'http://eddy.invalid/resolve'),
    expectedPath: /packageAcquisition\.eddy\.resolverUrl/,
  },
  {
    label: 'Eddy bundle base with a fragment',
    options: () =>
      withOption(
        ['packageAcquisition', 'eddy', 'bundleBaseUrl'],
        'https://eddy.invalid/bundles#v1',
      ),
    expectedPath: /packageAcquisition\.eddy\.bundleBaseUrl/,
  },
  {
    label: 'non-trustworthy HTTP Eddy bundle base',
    options: () =>
      withOption(['packageAcquisition', 'eddy', 'bundleBaseUrl'], 'http://cdn.invalid/bundles'),
    expectedPath: /packageAcquisition\.eddy\.bundleBaseUrl/,
  },
  {
    label: 'default Eddy bundle base with a resolver query',
    options: () => {
      const options = validOptions();
      const eddy = options.packageAcquisition.eddy;
      if (eddy === undefined) throw new Error('test options must contain Eddy configuration');
      return {
        ...options,
        packageAcquisition: {
          ...options.packageAcquisition,
          eddy: {
            resolverUrl: 'https://eddy.invalid/resolve?tenant=one',
            presetPins: eddy.presetPins,
          },
        },
      };
    },
    expectedPath: /packageAcquisition\.eddy\.resolverUrl/,
  },
];

describe('openWorkbench configuration and host admission', () => {
  it.each(invalidConfigurationCases)(
    'rejects invalid $label before lock, SW, storage, or owner effects',
    async ({ path, value, expectedPath }) => {
      const h = harness();

      await expect(h.open(withOption(path, value))).rejects.toThrow(expectedPath);
      expect(h.locks.request).not.toHaveBeenCalled();
      expect(h.serviceWorker.register).not.toHaveBeenCalled();
      expect(h.storage.openOpfs).not.toHaveBeenCalled();
      expect(h.storage.openMemory).not.toHaveBeenCalled();
      expect(h.owner.start).not.toHaveBeenCalled();

      const workbench = await h.open(validOptions());
      await workbench.close();
    },
  );

  it.each(malformedUrlCases)(
    'rejects malformed URL reference at %s before every external effect',
    async (pathLabel, path) => {
      const h = harness();

      await expect(h.open(withOption(path, 'http://['))).rejects.toThrow(pathLabel);
      expect(h.locks.request).not.toHaveBeenCalled();
      expect(h.serviceWorker.register).not.toHaveBeenCalled();
      expect(h.storage.openOpfs).not.toHaveBeenCalled();
      expect(h.storage.openMemory).not.toHaveBeenCalled();
      expect(h.owner.start).not.toHaveBeenCalled();

      const workbench = await h.open(validOptions());
      await workbench.close();
    },
  );

  it.each(invalidDestinationCases)(
    'rejects $label before every external effect',
    async ({ options, expectedPath }) => {
      const h = harness();

      await expect(h.open(options())).rejects.toThrow(expectedPath);
      expect(h.locks.request).not.toHaveBeenCalled();
      expect(h.serviceWorker.register).not.toHaveBeenCalled();
      expect(h.storage.openOpfs).not.toHaveBeenCalled();
      expect(h.storage.openMemory).not.toHaveBeenCalled();
      expect(h.owner.start).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid document base before every external effect', async () => {
    const h = harness();
    h.setUrlContext({
      apiBaseUrl: 'data:text/html,workbench',
      clientUrl: 'data:text/html,workbench',
    });

    await expect(h.open(validOptions())).rejects.toThrow(/document.*URL/i);
    expect(h.locks.request).not.toHaveBeenCalled();
    expect(h.serviceWorker.register).not.toHaveBeenCalled();
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.owner.start).not.toHaveBeenCalled();
  });

  it('canonicalizes relative deployment and acquisition references against the document URL', async () => {
    const h = harness();
    h.setUrlContext({
      apiBaseUrl: 'https://workbench.invalid/config/',
      clientUrl: 'https://workbench.invalid/app/index.html',
    });
    const options = validOptions();
    const workbench = await h.open({
      ...options,
      deployment: {
        ...options.deployment,
        workers: {
          owner: './owner.js',
          kernel: './kernel.js',
          node: './node.js',
          devServer: './dev-server.js',
        },
        serviceWorker: { url: './service-worker.js', scope: '/app/' },
        wasm: { sqlite: './sqlite.wasm', esbuild: './esbuild.wasm' },
      },
      packageAcquisition: {
        registryUrl: './npm-registry',
        eddy: {
          resolverUrl: './eddy/resolve',
          bundleBaseUrl: './eddy/bundles',
          presetPins: {},
        },
      },
    });

    try {
      expect(h.serviceWorker.register).toHaveBeenCalledWith(
        'https://workbench.invalid/config/service-worker.js',
        { scope: 'https://workbench.invalid/app/' },
      );
      expect(h.owner.start).toHaveBeenCalledWith(
        expect.objectContaining({
          deployment: expect.objectContaining({
            workers: {
              owner: 'https://workbench.invalid/config/owner.js',
              kernel: 'https://workbench.invalid/config/kernel.js',
              node: 'https://workbench.invalid/config/node.js',
              devServer: 'https://workbench.invalid/config/dev-server.js',
            },
            wasm: {
              sqlite: 'https://workbench.invalid/config/sqlite.wasm',
              esbuild: 'https://workbench.invalid/config/esbuild.wasm',
            },
          }),
          packageAcquisition: {
            registryUrl: 'https://workbench.invalid/config/npm-registry',
            eddy: {
              resolverUrl: 'https://workbench.invalid/config/eddy/resolve',
              bundleBaseUrl: 'https://workbench.invalid/config/eddy/bundles',
              presetPins: {},
            },
          },
        }),
      );
    } finally {
      await workbench.close();
    }
  });

  it('keeps same-origin blob Workers and blob/data WASM assets valid', async () => {
    const h = harness();
    const options = validOptions();
    const workbench = await h.open({
      ...options,
      deployment: {
        ...options.deployment,
        workers: {
          ...options.deployment.workers,
          owner: 'blob:https://workbench.invalid/owner-worker',
        },
        wasm: {
          sqlite: 'blob:https://workbench.invalid/sqlite-wasm',
          esbuild: 'data:application/wasm;base64,AGFzbQEAAAA=',
        },
      },
    });

    await workbench.close();
  });

  it('keeps a queried Eddy resolver valid when a separate path base is explicit', async () => {
    const h = harness();
    const options = validOptions();
    const eddy = options.packageAcquisition.eddy;
    if (eddy === undefined) throw new Error('test options must contain Eddy configuration');
    const workbench = await h.open({
      ...options,
      packageAcquisition: {
        ...options.packageAcquisition,
        eddy: {
          ...eddy,
          resolverUrl: 'https://eddy.invalid/resolve?tenant=one',
          bundleBaseUrl: 'https://cdn.invalid/bundles',
        },
      },
    });

    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        packageAcquisition: {
          registryUrl: 'https://workbench.invalid/npm-registry',
          eddy: {
            ...eddy,
            resolverUrl: 'https://eddy.invalid/resolve?tenant=one',
            bundleBaseUrl: 'https://cdn.invalid/bundles',
          },
        },
      }),
    );
    await workbench.close();
  });

  it('strips service Worker fragments before registration like the browser algorithm', async () => {
    const h = harness();
    const options = validOptions();
    const workbench = await h.open({
      ...options,
      deployment: {
        ...options.deployment,
        serviceWorker: { url: '/service-worker.js#ignored', scope: '/#ignored' },
      },
    });

    expect(h.serviceWorker.register).toHaveBeenCalledWith(
      'https://workbench.invalid/service-worker.js',
      { scope: 'https://workbench.invalid/' },
    );
    await workbench.close();
  });

  it.each([
    'http://localhost:4873/npm',
    'http://dev.localhost./npm',
    'http://127.23.45.67:4873/npm',
    'http://[::1]:4873/npm',
  ])('keeps the potentially trustworthy local HTTP base %s valid', async (registryUrl) => {
    const h = harness();
    const options = validOptions();
    const workbench = await h.open({
      ...options,
      packageAcquisition: { ...options.packageAcquisition, registryUrl },
    });

    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({
        packageAcquisition: expect.objectContaining({ registryUrl }),
      }),
    );
    await workbench.close();
  });

  it.each([
    ['dom', /DOM/i],
    ['worker', /Worker/i],
    ['crossOriginIsolated', /cross-origin isolation/i],
    ['webLocks', /Web Locks/i],
  ] as const)(
    'rejects missing %s capability before the first external side effect',
    async (capability, expected) => {
      const h = harness();
      h.capabilities[capability] = false;

      await expect(h.open(validOptions())).rejects.toThrow(expected);
      expect(h.locks.request).not.toHaveBeenCalled();
      expect(h.serviceWorker.register).not.toHaveBeenCalled();
      expect(h.storage.openOpfs).not.toHaveBeenCalled();
      expect(h.owner.start).not.toHaveBeenCalled();

      h.capabilities[capability] = true;
      const workbench = await h.open(validOptions());
      await workbench.close();
    },
  );

  it('claims the page in the same tick and holds the exact origin Web Lock until close', async () => {
    const h = harness();

    const first = h.open(validOptions());
    const sameTickSecond = h.open(validOptions());

    await expect(sameTickSecond).rejects.toThrow(/Workbench.*busy|already.*open/i);
    const workbench = await first;
    expect(h.locks.request).toHaveBeenCalledTimes(1);
    expect(h.locks.request).toHaveBeenCalledWith(
      'rifty:workbench:v1',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
    expect(h.locks.held).toBe(true);

    await workbench.close();
    expect(h.locks.held).toBe(false);

    const reopened = await h.open(validOptions());
    await reopened.close();
  });

  it('rejects origin contention, releases the failed page claim, then acquires after release', async () => {
    const locks = new ExclusiveLockHost();
    const firstPage = harness(locks);
    const secondPage = harness(locks);
    const first = await firstPage.open(validOptions());

    const contention = await secondPage.open(validOptions()).catch((error: unknown) => error);
    expect(contention).toBeInstanceOf(WorkbenchOriginOccupiedError);
    expect(contention).toMatchObject({
      name: 'WorkbenchOriginOccupiedError',
      message: expect.stringContaining('another page'),
    });
    expect(secondPage.serviceWorker.register).not.toHaveBeenCalled();
    expect(secondPage.storage.openOpfs).not.toHaveBeenCalled();
    expect(secondPage.owner.start).not.toHaveBeenCalled();

    await first.close();
    const second = await secondPage.open(validOptions());
    expect(locks.held).toBe(true);
    await second.close();
  });

  it.each(['throw', 'reject'] as const)(
    'preserves a lock request %s as fatal instead of classifying it occupied',
    async (kind) => {
      const h = harness();
      const cause = new DOMException('storage bucket denied', 'SecurityError');
      h.locks.request.mockImplementationOnce(() => {
        if (kind === 'throw') throw cause;
        return Promise.reject(cause);
      });

      const failure = await h.open(validOptions()).catch((error: unknown) => error);

      expect(failure).toBe(cause);
      expect(failure).not.toBeInstanceOf(WorkbenchOriginOccupiedError);
      expect(h.serviceWorker.register).not.toHaveBeenCalled();
      expect(h.owner.start).not.toHaveBeenCalled();

      const retried = await h.open(validOptions());
      await retried.close();
    },
  );
});

describe('openWorkbench service-worker proof', () => {
  it('accepts only a controller PONG with both local versions and cancels proof resources', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());

    expect(h.serviceWorker.register).toHaveBeenCalledWith(
      'https://workbench.invalid/service-worker.js',
      { scope: 'https://workbench.invalid/' },
    );
    expect(h.controller.postMessage).toHaveBeenCalledWith(
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
      'wrong frame version',
      {
        type: SW_PONG,
        frameVersion: 'stale',
        routingVersion: SW_ROUTING_VERSION,
        from: 'service-worker',
      },
    ],
    [
      'wrong routing version',
      {
        type: SW_PONG,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: 'stale',
        from: 'service-worker',
      },
    ],
    [
      'wrong sender',
      {
        type: SW_PONG,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        from: 'window',
      },
    ],
  ] as const)('ignores %s and rejects on the bounded timeout', async (_label, pong) => {
    const h = harness();
    h.setAutomaticPong(pong);

    const opening = h.open(validOptions());
    await waitUntil(
      () => h.clock.pending === 1 && h.controller.postMessage.mock.calls.length === 1,
    );
    expect(h.listenerCount).toBe(1);
    h.clock.fireAll();

    await expect(opening).rejects.toThrow(/service-worker.*timed out/i);
    expect(h.listenerCount).toBe(0);
    expect(h.clock.pending).toBe(0);
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.owner.start).not.toHaveBeenCalled();
    expect(h.locks.held).toBe(false);
  });
});

describe('openWorkbench storage and project cardinality', () => {
  it('publishes an unexpected physical owner exit as persistent unavailable health', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const observed: string[] = [];
    workbench.health.subscribe((snapshot) => observed.push(snapshot.disposition));

    h.failOwnerClosed(new Error('worker exited with private transport detail'));
    await waitUntil(() => workbench.health.snapshot().disposition === 'unavailable');

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
    expect(observed).toEqual(['healthy', 'unavailable']);
    expect(h.ownerHandle.close).not.toHaveBeenCalled();

    await workbench.close();
  });

  it('publishes owner protocol corruption through the distinct fatal invariant adapter', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());

    h.failOwnerInvariant('Workbench protocol invariant failed');

    expect(workbench.health.snapshot()).toEqual({
      disposition: 'fatal',
      issues: [
        {
          kind: 'fatal',
          scope: 'invariant',
          summary: 'Workbench protocol invariant failed',
          recovery: 'reload',
        },
      ],
    });
    await expect(workbench.health.recover('reload')).resolves.toBeUndefined();
    expect(h.reload).toHaveBeenCalledTimes(1);
    await workbench.close();
  });

  it('publishes automatic project durability failure through the active health generation', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const session = await workbench.openProject(
      projects.vite({ id: 'project-a', files: { '/index.html': '<main>A</main>' } }),
    );
    const recover = vi.fn(async () => {});

    h.failOwnerPersistence(recover);

    expect(workbench.health.snapshot()).toEqual({
      disposition: 'degraded',
      issues: [
        {
          kind: 'degraded',
          scope: 'persistence',
          summary: 'Workspace persistence failed',
          recovery: 'persistence',
        },
      ],
    });
    await expect(workbench.health.recover('persistence')).resolves.toBeUndefined();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(workbench.health.snapshot()).toEqual({ disposition: 'healthy', issues: [] });

    await session.close();
    await workbench.close();
  });

  it('required exposes the owner-selected durable OPFS snapshot and owner failures', async () => {
    const success = harness();
    const workbench = await success.open(validOptions());
    expect(workbench.snapshot().storage).toEqual({
      policy: 'required',
      backend: 'opfs',
      durability: 'durable',
    });
    expect(success.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'required' } }),
    );
    expect(success.storage.openOpfs).not.toHaveBeenCalled();
    expect(success.storage.proveDurability).not.toHaveBeenCalled();
    expect(success.storage.openMemory).not.toHaveBeenCalled();
    await workbench.close();

    const openFailure = harness();
    openFailure.failOwnerStart(new Error('OPFS permission denied'));
    await expect(openFailure.open(validOptions())).rejects.toThrow(/OPFS permission denied/);
    expect(openFailure.storage.openOpfs).not.toHaveBeenCalled();
    expect(openFailure.storage.proveDurability).not.toHaveBeenCalled();
    expect(openFailure.storage.openMemory).not.toHaveBeenCalled();
    expect(openFailure.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'required' } }),
    );
    expect(openFailure.locks.held).toBe(false);

    const proofFailure = harness();
    proofFailure.failOwnerStart(new Error('OPFS durability proof failed'));
    await expect(proofFailure.open(validOptions())).rejects.toThrow(/OPFS durability proof failed/);
    expect(proofFailure.storage.openOpfs).not.toHaveBeenCalled();
    expect(proofFailure.storage.proveDurability).not.toHaveBeenCalled();
    expect(proofFailure.storage.openMemory).not.toHaveBeenCalled();
    expect(proofFailure.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'required' } }),
    );
    expect(proofFailure.locks.held).toBe(false);
  });

  it('preferred publishes the exact visible fallback selected by the owner', async () => {
    const h = harness();
    h.setOwnerStorageSnapshot({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: 'quota exhausted' },
    });
    const options = withOption(['storage', 'persistence'], 'preferred');

    const workbench = await h.open(options);

    expect(workbench.snapshot().storage).toEqual({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: 'quota exhausted' },
    });
    expect(h.storage.openOpfs).not.toHaveBeenCalled();
    expect(h.storage.proveDurability).not.toHaveBeenCalled();
    expect(h.storage.openMemory).not.toHaveBeenCalled();
    expect(h.owner.start).toHaveBeenCalledWith(
      expect.objectContaining({ storage: { persistence: 'preferred' } }),
    );

    await workbench.close();
  });

  it('ephemeral intentionally uses memory and never touches OPFS state', async () => {
    const h = harness();
    h.setOwnerStorageSnapshot({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });
    const options = withOption(['storage', 'persistence'], 'ephemeral');
    const workbench = await h.open(options);

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

  it('permits one active session, rejects delete while active, and retains the lock on project close', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const firstDefinition = projects.vite({
      id: 'first',
      files: { '/index.html': '<h1>first</h1>' },
    });
    const secondDefinition = projects.vite({
      id: 'second',
      files: { '/index.html': '<h1>second</h1>' },
    });
    const first = await workbench.openProject(firstDefinition);

    await expect(workbench.openProject(secondDefinition)).rejects.toThrow(/ProjectBusyError/);
    await expect(workbench.deleteProject('first')).rejects.toThrow(/ProjectBusyError/);
    expect(h.ownerHandle.openProject).toHaveBeenCalledTimes(1);
    expect(h.ownerHandle.deleteProject).not.toHaveBeenCalled();

    await first.close();
    expect(h.ownerProjectCloses[0]).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(true);

    await workbench.deleteProject('first');
    expect(h.ownerHandle.deleteProject).toHaveBeenCalledWith('first');
    const second = await workbench.openProject(secondDefinition);
    await second.close();
    expect(h.locks.held).toBe(true);

    await workbench.close();
    expect(h.locks.held).toBe(false);
  });

  it('does not resolve Workbench close before the held lock callback has released', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    const close = workbench.close();

    expect(
      await settledOr(
        close.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    await close;
    expect(h.locks.held).toBe(false);
  });

  // Fault class: observable-order. Workbench close deliberately starts owner
  // termination while admitted session teardown is still draining. A
  // ClosedHandleError caused by that successful termination is cancellation,
  // not a second close failure.
  it('completes public Workbench close when owner termination cancels active teardown', async () => {
    const h = harness();
    const workbench = await h.open(validOptions());
    await workbench.openProject(
      projects.vite({ id: 'active', files: { '/index.html': '<h1>active</h1>' } }),
    );
    const closeProject = h.ownerProjectCloses[0];
    if (closeProject === undefined) throw new Error('missing active project close');
    closeProject.mockRejectedValueOnce(
      new AggregateError(
        [new ClosedHandleError('Workbench owner teardown')],
        'owner termination cancelled session drains',
      ),
    );

    await expect(workbench.close()).resolves.toBeUndefined();
    expect(h.ownerHandle.close).toHaveBeenCalledTimes(1);
    expect(h.locks.held).toBe(false);
  });
});
