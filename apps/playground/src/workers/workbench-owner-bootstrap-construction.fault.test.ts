import { beforeEach, describe, expect, it, vi } from 'vitest';

type BootBoundary =
  | 'storage'
  | 'registry'
  | 'cache'
  | 'source'
  | 'manager'
  | 'port'
  | 'runtime-config'
  | 'package-state'
  | 'core-materializer'
  | 'companion-authority'
  | 'core-controller'
  | 'companion-controller';
type BootMode = 'core-memory' | 'companion-opfs';
type CleanupBoundary = 'source' | 'storage' | 'authority';

const bootFault = vi.hoisted(() => ({
  boundary: 'storage' as BootBoundary,
  mode: 'core-memory' as BootMode,
  events: [] as string[],
  constructionFailure: new Error('unconfigured construction failure'),
  sourceCleanupFailure: new Error('unconfigured source cleanup failure'),
  storageCleanupFailure: new Error('unconfigured storage cleanup failure'),
  authorityCleanupFailure: new Error('unconfigured authority cleanup failure'),
  cleanupFailures: new Set<CleanupBoundary>(),
  closeCounts: {
    source: 0,
    storage: 0,
    authority: 0,
    manager: 0,
    packages: 0,
    materializer: 0,
    companion: 0,
    unsubscribe: 0,
  },
  managerCloseFailure: null as AggregateError | null,
}));

function bootConfig(): Readonly<Record<string, unknown>> {
  const base = {
    deployment: {
      workers: {
        kernel: '/kernel.js',
        node: '/node.js',
        devServer: '/dev-server.js',
        typescript: '/typescript.js',
      },
      wasm: { sqlite: '/sqlite.wasm', esbuild: '/esbuild.wasm' },
      previewProbeTimeoutMs: 1_000,
    },
    packageAcquisition: { registryUrl: '/registry' },
    storage: {
      persistence:
        bootFault.mode === 'core-memory' ? ('ephemeral' as const) : ('required' as const),
    },
  };
  return bootFault.mode === 'core-memory'
    ? base
    : {
        ...base,
        legacyWorkspacePrefix: '/workspaces/legacy',
        playgroundUrlContext: {
          apiBaseUrl: 'https://playground.invalid/app/',
          clientUrl: 'https://playground.invalid/app/index.html',
        },
      };
}

function resetFault(mode: BootMode, boundary: BootBoundary): void {
  bootFault.mode = mode;
  bootFault.boundary = boundary;
  bootFault.events.length = 0;
  bootFault.constructionFailure = new Error(`${mode} ${boundary} construction failed`);
  bootFault.sourceCleanupFailure = new Error('source cleanup failed');
  bootFault.storageCleanupFailure = new Error('storage cleanup failed');
  bootFault.authorityCleanupFailure = new Error('authority cleanup failed');
  bootFault.cleanupFailures.clear();
  bootFault.closeCounts = {
    source: 0,
    storage: 0,
    authority: 0,
    manager: 0,
    packages: 0,
    materializer: 0,
    companion: 0,
    unsubscribe: 0,
  };
  bootFault.managerCloseFailure = null;
}

async function closeSource(): Promise<void> {
  bootFault.closeCounts.source += 1;
  bootFault.events.push('source:close');
  if (bootFault.cleanupFailures.has('source')) throw bootFault.sourceCleanupFailure;
}

async function closeStorage(): Promise<void> {
  bootFault.closeCounts.storage += 1;
  bootFault.events.push('storage:close');
  if (bootFault.cleanupFailures.has('storage')) throw bootFault.storageCleanupFailure;
}

async function flushAuthority(): Promise<undefined> {
  bootFault.closeCounts.authority += 1;
  bootFault.events.push('authority:flush');
  if (bootFault.cleanupFailures.has('authority')) throw bootFault.authorityCleanupFailure;
  return undefined;
}

vi.mock('@riftydev/net/register-builtins', () => ({ registerNetBuiltins: () => undefined }));
vi.mock('@riftydev/net/sqlite/register-builtins', () => ({
  registerSqliteBuiltin: () => undefined,
}));
vi.mock('@riftydev/runtime-js/builtins/process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riftydev/runtime-js/builtins/process')>()),
  setProcessCwd: () => undefined,
}));

vi.mock('./worker-runtime-globals.ts', () => ({
  installBundleLocalBuffer: () => undefined,
  installRuntimeGlobals: () => ({
    onMessage(receive: (message: unknown) => void) {
      queueMicrotask(() =>
        receive({
          type: 'workbench:initialize',
          config: bootConfig(),
        }),
      );
    },
    send: () => true,
  }),
}));

vi.mock('./workbench-owner-storage-composition.ts', () => ({
  async createWorkbenchOwnerStorageComposition() {
    bootFault.events.push('storage:create');
    if (bootFault.boundary === 'storage') throw bootFault.constructionFailure;
    const runtimeAssets = {
      storageClass:
        bootFault.mode === 'core-memory'
          ? ('memory-session' as const)
          : ('opfs-best-effort' as const),
      read: async () => null,
      write: async () => undefined,
      remove: async () => undefined,
      inspect: async () => ({ entryCount: 0, storedBytes: 0, entries: [] }),
      clear: async () => undefined,
      close: closeStorage,
    };
    return {
      storage:
        bootFault.mode === 'core-memory'
          ? { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' }
          : { policy: 'required', backend: 'opfs', durability: 'durable' },
      retention:
        bootFault.mode === 'core-memory'
          ? { available: false }
          : { available: true, persistedAfter: false },
      owner: {
        authority: { flush: flushAuthority },
        appliedMutations: {},
        installStampClaims: {},
      },
      runtimeAssets,
    };
  },
}));

vi.mock('../glue/registry-fetch.ts', () => ({
  createProxiedRegistryClient() {
    bootFault.events.push('registry:create');
    if (bootFault.boundary === 'registry') throw bootFault.constructionFailure;
    return {};
  },
}));

vi.mock('@riftydev/npm-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riftydev/npm-client')>();
  return {
    ...actual,
    VfsTarballCache: class FaultInjectedTarballCache {
      constructor() {
        bootFault.events.push('cache:create');
        if (bootFault.boundary === 'cache') throw bootFault.constructionFailure;
      }
    },
    createStandardShadowAssetSource() {
      bootFault.events.push('source:create');
      if (bootFault.boundary === 'source') throw bootFault.constructionFailure;
      return {
        acquire: async () => [],
        close: closeSource,
      };
    },
    createShadowAssetManager(options: {
      readonly storage: { close(): Promise<void> };
      readonly source: { close(): Promise<void> };
    }) {
      bootFault.events.push('manager:create');
      if (bootFault.boundary === 'manager') throw bootFault.constructionFailure;
      return {
        installer: {},
        admin: {},
        runtimeReader: () => ({}),
        async close(): Promise<void> {
          bootFault.closeCounts.manager += 1;
          bootFault.events.push('manager:close');
          const failures: unknown[] = [];
          try {
            await options.source.close();
          } catch (error) {
            failures.push(error);
          }
          try {
            await options.storage.close();
          } catch (error) {
            failures.push(error);
          }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) {
            const failure = new AggregateError(failures, 'manager cleanup failed');
            bootFault.managerCloseFailure = failure;
            throw failure;
          }
        },
      };
    },
  };
});

vi.mock('./workbench-runtime-assets.ts', () => ({
  createNpmPackageRuntimeAssetPort() {
    bootFault.events.push('port:create');
    if (bootFault.boundary === 'port') throw bootFault.constructionFailure;
    return {};
  },
}));

vi.mock('@riftydev/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riftydev/kernel')>()),
  getKernelDispatcher: () => ({}),
}));

vi.mock('./node-worker-runtime-config.ts', () => ({
  installNodeWorkerRuntimeConfig() {
    bootFault.events.push('runtime-config:create');
    if (bootFault.boundary === 'runtime-config') throw bootFault.constructionFailure;
    return {};
  },
}));

vi.mock('../glue/sqlite-wasm-provider.ts', () => ({
  installSqliteWasmSyncProvider() {
    bootFault.events.push('sqlite-provider:install');
  },
}));

vi.mock('./owner-package-state.ts', () => ({
  createOwnerPackageState() {
    bootFault.events.push('package-state:create');
    if (bootFault.boundary === 'package-state') throw bootFault.constructionFailure;
    return {
      activateAndEnsure: async () => undefined,
      mutations: {},
      async quiesce(): Promise<void> {
        bootFault.closeCounts.packages += 1;
        bootFault.events.push('package-state:quiesce');
      },
    };
  },
}));

vi.mock('./workbench-project-store.ts', () => ({
  createWorkbenchProjectStore() {
    bootFault.events.push('project-store:create');
    return {};
  },
}));

vi.mock('../workbench/project-materialization.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workbench/project-materialization.ts')>()),
  createProjectMaterializer() {
    bootFault.events.push('materializer:create');
    if (bootFault.boundary === 'core-materializer') throw bootFault.constructionFailure;
    return {
      open: async () => {
        throw new Error('materializer open is outside construction rollback');
      },
      delete: async () => undefined,
      async close(): Promise<void> {
        bootFault.closeCounts.materializer += 1;
        bootFault.events.push('materializer:close');
      },
    };
  },
}));

vi.mock('./playground-project-authority.ts', () => ({
  async createPlaygroundProjectAuthority() {
    bootFault.events.push('companion-authority:create');
    if (bootFault.boundary === 'companion-authority') throw bootFault.constructionFailure;
    return {
      subscribeCatalog(listener: (catalog: unknown) => void) {
        bootFault.events.push('companion-catalog:subscribe');
        listener(Object.freeze({ activeProjectId: null, projects: Object.freeze([]) }));
        return () => {
          bootFault.closeCounts.unsubscribe += 1;
          bootFault.events.push('companion-catalog:unsubscribe');
        };
      },
      async close(): Promise<void> {
        bootFault.closeCounts.companion += 1;
        bootFault.events.push('companion-authority:close');
      },
    };
  },
}));

vi.mock('../glue/owner-sync-runtime-handlers.ts', () => ({
  installOwnerSyncRuntimeHandlers() {
    bootFault.events.push('sync-handlers:install');
  },
}));

vi.mock('./workbench-owner-child-vfs.ts', () => ({
  createWorkbenchOwnerChildVfsMutationGuard() {
    bootFault.events.push('child-guard:create');
    return {};
  },
}));

vi.mock('./workbench-owner-controller.ts', () => ({
  createWorkbenchOwnerController() {
    bootFault.events.push('controller:create');
    if (bootFault.boundary === 'core-controller' || bootFault.boundary === 'companion-controller') {
      throw bootFault.constructionFailure;
    }
    throw new Error('test did not select a terminal construction boundary');
  },
}));

function constructionPrefix(mode: BootMode, boundary: BootBoundary): readonly string[] {
  const prefix = ['storage:create'];
  if (boundary === 'storage') return prefix;
  prefix.push('registry:create');
  if (boundary === 'registry') return prefix;
  prefix.push('cache:create');
  if (boundary === 'cache') return prefix;
  prefix.push('source:create');
  if (boundary === 'source') return prefix;
  prefix.push('manager:create');
  if (boundary === 'manager') return prefix;
  prefix.push('port:create');
  if (boundary === 'port') return prefix;
  prefix.push('runtime-config:create');
  if (boundary === 'runtime-config') return prefix;
  prefix.push('sqlite-provider:install', 'package-state:create');
  if (boundary === 'package-state') return prefix;
  if (mode === 'core-memory') {
    prefix.push('project-store:create', 'materializer:create');
    if (boundary === 'core-materializer') return prefix;
  } else {
    prefix.push('companion-authority:create');
    if (boundary === 'companion-authority') return prefix;
    prefix.push('companion-catalog:subscribe');
  }
  return [...prefix, 'child-guard:create', 'sync-handlers:install', 'controller:create'];
}

function expectedCleanup(boundary: BootBoundary): readonly string[] {
  if (boundary === 'storage') return [];
  if (boundary === 'registry' || boundary === 'cache' || boundary === 'source') {
    return ['storage:close', 'authority:flush'];
  }
  if (boundary === 'manager') return ['source:close', 'storage:close', 'authority:flush'];
  if (boundary === 'runtime-config' || boundary === 'package-state') {
    return ['manager:close', 'source:close', 'storage:close', 'authority:flush'];
  }
  if (boundary === 'core-materializer' || boundary === 'companion-authority') {
    return [
      'package-state:quiesce',
      'manager:close',
      'source:close',
      'storage:close',
      'authority:flush',
    ];
  }
  if (boundary === 'core-controller') {
    return [
      'materializer:close',
      'package-state:quiesce',
      'manager:close',
      'source:close',
      'storage:close',
      'authority:flush',
    ];
  }
  if (boundary === 'companion-controller') {
    return [
      'companion-catalog:unsubscribe',
      'companion-authority:close',
      'package-state:quiesce',
      'manager:close',
      'source:close',
      'storage:close',
      'authority:flush',
    ];
  }
  return ['manager:close', 'source:close', 'storage:close', 'authority:flush'];
}

function closeCounts(
  overrides: Partial<typeof bootFault.closeCounts> = {},
): typeof bootFault.closeCounts {
  return {
    source: 0,
    storage: 0,
    authority: 0,
    manager: 0,
    packages: 0,
    materializer: 0,
    companion: 0,
    unsubscribe: 0,
    ...overrides,
  };
}

function expectedCloseCounts(boundary: BootBoundary): typeof bootFault.closeCounts {
  if (boundary === 'storage') return closeCounts();
  if (boundary === 'registry' || boundary === 'cache' || boundary === 'source') {
    return closeCounts({ storage: 1, authority: 1 });
  }
  if (boundary === 'manager') return closeCounts({ source: 1, storage: 1, authority: 1 });
  if (boundary === 'runtime-config' || boundary === 'package-state' || boundary === 'port') {
    return closeCounts({ source: 1, storage: 1, authority: 1, manager: 1 });
  }
  if (boundary === 'core-materializer' || boundary === 'companion-authority') {
    return closeCounts({
      source: 1,
      storage: 1,
      authority: 1,
      manager: 1,
      packages: 1,
    });
  }
  if (boundary === 'core-controller') {
    return closeCounts({
      source: 1,
      storage: 1,
      authority: 1,
      manager: 1,
      packages: 1,
      materializer: 1,
    });
  }
  return closeCounts({
    source: 1,
    storage: 1,
    authority: 1,
    manager: 1,
    packages: 1,
    companion: 1,
    unsubscribe: 1,
  });
}

async function runBootstrap(): Promise<unknown> {
  return import('./workbench-owner-bootstrap.ts').catch((error: unknown) => error);
}

beforeEach(() => {
  vi.resetModules();
});

describe('torn-state: Workbench owner construction transaction', () => {
  it.each([
    ['core-memory', 'storage'],
    ['core-memory', 'registry'],
    ['core-memory', 'cache'],
    ['core-memory', 'source'],
    ['core-memory', 'manager'],
    ['core-memory', 'port'],
    ['core-memory', 'runtime-config'],
    ['core-memory', 'package-state'],
    ['core-memory', 'core-materializer'],
    ['core-memory', 'core-controller'],
    ['companion-opfs', 'storage'],
    ['companion-opfs', 'registry'],
    ['companion-opfs', 'cache'],
    ['companion-opfs', 'source'],
    ['companion-opfs', 'manager'],
    ['companion-opfs', 'port'],
    ['companion-opfs', 'runtime-config'],
    ['companion-opfs', 'package-state'],
    ['companion-opfs', 'companion-authority'],
    ['companion-opfs', 'companion-controller'],
  ] as const)(
    'rolls back the exact %s ownership prefix when %s construction fails',
    async (mode, boundary) => {
      resetFault(mode, boundary);

      const failure = await runBootstrap();

      expect(failure).toBe(bootFault.constructionFailure);
      expect(bootFault.events).toEqual([
        ...constructionPrefix(mode, boundary),
        ...expectedCleanup(boundary),
      ]);
      expect(bootFault.closeCounts).toEqual(expectedCloseCounts(boundary));
    },
  );

  it.each([
    ['core-memory', 'source'],
    ['companion-opfs', 'source'],
  ] as const)(
    'keeps the %s source failure first, then storage and authority cleanup failures',
    async (mode, boundary) => {
      resetFault(mode, boundary);
      bootFault.cleanupFailures.add('storage');
      bootFault.cleanupFailures.add('authority');

      const failure = await runBootstrap();

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        bootFault.constructionFailure,
        bootFault.storageCleanupFailure,
        bootFault.authorityCleanupFailure,
      ]);
      expect(bootFault.events).toEqual([
        ...constructionPrefix(mode, boundary),
        ...expectedCleanup(boundary),
      ]);
      expect(bootFault.closeCounts).toEqual(expectedCloseCounts(boundary));
    },
  );

  it('keeps manager-construction plus every directly-owned cleanup failure in causal order', async () => {
    resetFault('companion-opfs', 'manager');
    bootFault.cleanupFailures.add('source');
    bootFault.cleanupFailures.add('storage');
    bootFault.cleanupFailures.add('authority');

    const failure = await runBootstrap();

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      bootFault.constructionFailure,
      bootFault.sourceCleanupFailure,
      bootFault.storageCleanupFailure,
      bootFault.authorityCleanupFailure,
    ]);
    expect(bootFault.events).toEqual([
      ...constructionPrefix('companion-opfs', 'manager'),
      ...expectedCleanup('manager'),
    ]);
    expect(bootFault.closeCounts).toEqual(expectedCloseCounts('manager'));
  });

  it('closes an admitted manager once and preserves its aggregate before durability cleanup', async () => {
    resetFault('core-memory', 'port');
    bootFault.cleanupFailures.add('source');
    bootFault.cleanupFailures.add('storage');
    bootFault.cleanupFailures.add('authority');

    const failure = await runBootstrap();

    expect(bootFault.managerCloseFailure).toBeInstanceOf(AggregateError);
    expect(bootFault.managerCloseFailure?.errors).toEqual([
      bootFault.sourceCleanupFailure,
      bootFault.storageCleanupFailure,
    ]);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      bootFault.constructionFailure,
      bootFault.managerCloseFailure,
      bootFault.authorityCleanupFailure,
    ]);
    expect(bootFault.events).toEqual([
      ...constructionPrefix('core-memory', 'port'),
      ...expectedCleanup('port'),
    ]);
    expect(bootFault.closeCounts).toEqual(expectedCloseCounts('port'));
  });
});
