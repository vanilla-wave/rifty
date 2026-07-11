import { COI_REQUIRED_MESSAGE, type CapabilityCheck } from '@riftydev/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyDevServer, PtyPreview } from './glue/pty-protocol.ts';
import type { WorkspaceOwnerHandle, WorkspaceOwnerOptions } from './glue/realVite.ts';
import type { VfsSnapshotFrame } from './glue/vfs-snapshot-port.ts';
import {
  WORKBENCH_SINGLETON_ERROR,
  type WorkbenchSessionDependencies,
  createWorkbenchSessionForTesting,
} from './session.ts';
import { TEST_PROJECT_CATALOG } from './test-project.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function config(registryUrl = '/registry') {
  return {
    assets: {
      ownerWorkerUrl: '/owner.js',
      kernelWorkerUrl: '/kernel.js',
      nodeWorkerUrl: '/node.js',
      devServerWorkerUrl: '/dev.js',
      serviceWorkerUrl: '/sw.js',
      sqliteWasmUrl: '/sqlite.wasm',
      esbuildWasmUrl: '/esbuild.wasm',
    },
    registry: { registryUrl },
    project: { catalog: TEST_PROJECT_CATALOG, root: '/workspace' },
  };
}

function capabilities(crossOriginIsolated = true): CapabilityCheck {
  return {
    capabilities: {
      crossOriginIsolated,
      sharedArrayBuffer: crossOriginIsolated,
      atomicsWaitAsync: crossOriginIsolated,
      opfsSyncAccessHandle: true,
      serviceWorker: true,
      worker: true,
    },
    missing: crossOriginIsolated
      ? []
      : ['crossOriginIsolated', 'sharedArrayBuffer', 'atomicsWaitAsync'],
    sufficient: true,
    summary: 'test capabilities',
  };
}

class Owner implements WorkspaceOwnerHandle {
  readonly workspaceId = 'workspace-id';
  readonly root = '/workspace';
  readonly ready: Promise<void>;
  readonly previewOwnerToken = 'preview-owner';
  readonly snapshotPort = 'snapshot-key';
  readonly closed: Promise<number | null>;
  readonly devListeners = new Set<(frame: PtyDevServer) => void>();
  readonly previewListeners = new Set<(frame: PtyPreview) => void>();
  readonly signals: string[] = [];
  readonly closedSessions: string[] = [];
  closeCalls = 0;
  alive = true;
  backend: 'opfs' | 'memory' = 'opfs';
  private readonly closedGate = deferred<number | null>();

  constructor(ready: Promise<void> = Promise.resolve()) {
    this.ready = ready;
    this.closed = this.closedGate.promise;
  }

  storageBackend() {
    return this.backend;
  }
  isAlive() {
    return this.alive;
  }
  async openSession() {}
  async exec(_sid: string, _line: string, opts: Parameters<WorkspaceOwnerHandle['exec']>[2]) {
    opts.onStart?.('run-1');
    return 0;
  }
  writeStdin() {}
  signal(sid: string) {
    this.signals.push(sid);
  }
  resize() {}
  closeSession(sid: string) {
    this.closedSessions.push(sid);
  }
  writeFile() {}
  writeFrame() {}
  async writeFrameAcked() {}
  async flushDurable() {}
  async exportArchive() {
    return '{}';
  }
  async importArchive() {}
  async readFileBytes() {
    return new TextEncoder().encode('hello');
  }
  snapshot() {
    return { cwd: '/workspace', env: {} };
  }
  onDevServer(cb: (frame: PtyDevServer) => void) {
    this.devListeners.add(cb);
    return () => this.devListeners.delete(cb);
  }
  onPreview(cb: (frame: PtyPreview) => void) {
    this.previewListeners.add(cb);
    return () => this.previewListeners.delete(cb);
  }
  requestPreview() {}
  async setDevConfig() {}
  async sendRawMessage() {}
  onRawMessage() {
    return () => {};
  }
  close() {
    this.closeCalls += 1;
    if (!this.alive) return;
    this.alive = false;
    this.closedGate.resolve(0);
  }
  emitPreview(frame: PtyPreview) {
    for (const listener of this.previewListeners) listener(frame);
  }
}

function deps(owner: Owner, overrides: Partial<WorkbenchSessionDependencies> = {}) {
  const startWorkspaceOwner = vi.fn((_options: WorkspaceOwnerOptions) => owner);
  const subscribeSnapshot = vi.fn(
    (_key: string | number, _listener: (frame: VfsSnapshotFrame) => void) => () => {},
  );
  const result: WorkbenchSessionDependencies = {
    checkCapabilities: () => capabilities(),
    registerServiceWorker: vi.fn(async () => {}),
    proveServiceWorkerControl: vi.fn(async () => {}),
    startWorkspaceOwner,
    probeStoragePersistence: vi.fn(async () => ({
      available: true as const,
      persistedBefore: true,
      persistedAfter: true,
    })),
    mountPreviewBridge: vi.fn(() => () => {}),
    fetch: vi.fn(async () => new Response('ok')),
    subscribeSnapshot,
    requestSnapshot: vi.fn(),
    ...overrides,
  };
  return { result, startWorkspaceOwner };
}

beforeEach(() => {
  vi.stubGlobal('document', {});
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('location', {
    href: 'https://host.test/embed/',
    origin: 'https://host.test',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workbench session', () => {
  it('exposes capabilities and rejects non-COI boot with the canonical error before spawning', async () => {
    const owner = new Owner();
    const injected = deps(owner, { checkCapabilities: () => capabilities(false) });
    const session = createWorkbenchSessionForTesting(config(), injected.result);

    expect(session.snapshot().capabilities.capabilities.crossOriginIsolated).toBe(false);
    await expect(session.boot()).rejects.toThrow(COI_REQUIRED_MESSAGE);
    expect(injected.startWorkspaceOwner).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('validates registry config synchronously before any worker can spawn', () => {
    const owner = new Owner();
    const injected = deps(owner);
    expect(() => createWorkbenchSessionForTesting(config(''), injected.result)).toThrow(
      /registryUrl is required/,
    );
    expect(injected.startWorkspaceOwner).not.toHaveBeenCalled();
  });

  it('surfaces memory fallback and never claims preview LIVE after SW registration failure', async () => {
    const owner = new Owner();
    owner.backend = 'memory';
    const injected = deps(owner, {
      registerServiceWorker: vi.fn(async () => {
        throw new Error('scope rejected');
      }),
    });
    const session = createWorkbenchSessionForTesting(config(), injected.result);
    const controllers = await session.boot();

    expect(session.snapshot()).toMatchObject({
      status: 'ready',
      storage: { backend: 'memory', degraded: true },
      serviceWorkerError: 'scope rejected',
    });
    expect(controllers.preview.snapshot()).toMatchObject({
      status: 'error',
      port: null,
      error: 'service worker registration failed: scope rejected',
    });
    owner.emitPreview({
      type: 'pty:preview',
      ports: [
        {
          port: 5174,
          url: '/preview/5174/',
          label: 'Vite',
          source: 'dev-server',
          sid: 'terminal-1',
        },
      ],
    });
    await vi.waitFor(() => expect(controllers.preview.snapshot().status).toBe('error'));
    expect(controllers.preview.snapshot().error).toContain('scope rejected');
    await session.dispose();
  });

  it('reports a throwing host logger without turning a recoverable SW failure into boot failure', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const loggerError = new Error('host logger failed');
    const owner = new Owner();
    const injected = deps(owner, {
      registerServiceWorker: vi.fn(async () => {
        throw new Error('scope rejected');
      }),
    });
    const session = createWorkbenchSessionForTesting(
      {
        ...config(),
        onLog: () => {
          throw loggerError;
        },
      },
      injected.result,
    );

    await expect(session.boot()).resolves.toBeDefined();
    expect(session.snapshot().serviceWorkerError).toBe('scope rejected');
    expect(reportError).toHaveBeenCalledWith(loggerError);
    await session.dispose();
  });

  it('never accepts an HTTP 200 fallback when rifty service-worker control proof fails', async () => {
    const owner = new Owner();
    const fetch = vi.fn(async () => new Response('host SPA fallback'));
    const injected = deps(owner, {
      proveServiceWorkerControl: vi.fn(async () => {
        throw new Error('no controlling rifty service worker');
      }),
      fetch,
    });
    const session = createWorkbenchSessionForTesting(config(), injected.result);
    const controllers = await session.boot();

    owner.emitPreview({
      type: 'pty:preview',
      ports: [
        {
          port: 5174,
          url: '/preview/5174/',
          label: 'Vite',
          source: 'dev-server',
          sid: 'terminal-1',
        },
      ],
    });

    await vi.waitFor(() => expect(controllers.preview.snapshot().status).toBe('error'));
    expect(controllers.preview.snapshot().error).toContain('no controlling rifty service worker');
    expect(fetch).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('proves LIVE through the registered SW and revokes routes/stops PTYs before owner exit', async () => {
    const owner = new Owner();
    const fetchGate = deferred<Response>();
    const runGate = deferred<number>();
    let runStarted = false;
    owner.exec = async (_sid, _line, options) => {
      options.onStart?.('run-live');
      runStarted = true;
      return runGate.promise;
    };
    const tearRoute = vi.fn();
    const fetch = vi.fn(async () => fetchGate.promise);
    const injected = deps(owner, {
      mountPreviewBridge: vi.fn(() => tearRoute),
      fetch,
    });
    const session = createWorkbenchSessionForTesting(config(), injected.result);
    const controllers = await session.boot();
    owner.emitPreview({
      type: 'pty:preview',
      ports: [
        {
          port: 5174,
          url: '/preview/5174/',
          label: 'Vite',
          source: 'dev-server',
          sid: 'terminal-1',
        },
      ],
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(controllers.preview.snapshot().status).toBe('starting');
    fetchGate.resolve(new Response('real owner response'));
    await vi.waitFor(() => expect(controllers.preview.snapshot().status).toBe('live'));

    const run = controllers.terminal.run('terminal-1', 'npm install');
    await vi.waitFor(() => expect(runStarted).toBe(true));
    await session.dispose();
    expect(owner.signals).toContain('terminal-1');
    expect(tearRoute).toHaveBeenCalledOnce();
    expect(owner.closeCalls).toBe(1);
    runGate.resolve(130);
    await expect(run).resolves.toBe(130);
  });

  it('throws on a concurrent second boot and releases the realm claim after full dispose', async () => {
    const firstOwner = new Owner();
    const first = createWorkbenchSessionForTesting(config(), deps(firstOwner).result);
    await first.boot();

    const secondOwner = new Owner();
    const second = createWorkbenchSessionForTesting(config(), deps(secondOwner).result);
    await expect(second.boot()).rejects.toThrow('one active workbench session per page');

    await first.dispose();
    await expect(second.boot()).resolves.toBeDefined();
    await second.dispose();
  });

  it('reuses one in-flight boot when a booting subscriber calls boot re-entrantly', async () => {
    const owner = new Owner();
    const serviceWorkerGate = deferred<void>();
    const registerServiceWorker = vi.fn(() => serviceWorkerGate.promise);
    const injected = deps(owner, { registerServiceWorker });
    const session = createWorkbenchSessionForTesting(config(), injected.result);
    let reentrantBoot: ReturnType<typeof session.boot> | undefined;
    let bootingObserved = false;
    const unsubscribe = session.subscribe((snapshot) => {
      if (snapshot.status !== 'booting' || bootingObserved) return;
      bootingObserved = true;
      reentrantBoot = session.boot();
    });

    const primaryBoot = session.boot();
    await vi.waitFor(() => expect(reentrantBoot).toBeDefined());
    serviceWorkerGate.resolve();
    const [primaryControllers, reentrantControllers] = await Promise.all([
      primaryBoot,
      reentrantBoot!,
    ]);

    expect(reentrantBoot).toBe(primaryBoot);
    expect(reentrantControllers).toBe(primaryControllers);
    expect(registerServiceWorker).toHaveBeenCalledOnce();
    expect(injected.startWorkspaceOwner).toHaveBeenCalledOnce();

    unsubscribe();
    await session.dispose();
  });

  it('releases the singleton after failed owner readiness and closes the failed owner', async () => {
    const ready = deferred<void>();
    ready.reject(new Error('owner boot failed'));
    const failedOwner = new Owner(ready.promise);
    const failed = createWorkbenchSessionForTesting(config(), deps(failedOwner).result);
    await expect(failed.boot()).rejects.toThrow('owner boot failed');
    expect(failedOwner.closeCalls).toBe(1);

    const replacement = createWorkbenchSessionForTesting(config(), deps(new Owner()).result);
    await expect(replacement.boot()).resolves.toBeDefined();
    await replacement.dispose();
    await failed.dispose();
  });

  it('rolls back partial controllers when the final files subscription fails', async () => {
    const failedOwner = new Owner();
    const failed = createWorkbenchSessionForTesting(
      config(),
      deps(failedOwner, {
        subscribeSnapshot: () => {
          throw new Error('snapshot channel unavailable');
        },
      }).result,
    );

    await expect(failed.boot()).rejects.toThrow('snapshot channel unavailable');
    expect(failedOwner.closedSessions).toEqual(['terminal-1']);
    expect(failedOwner.devListeners.size).toBe(0);
    expect(failedOwner.previewListeners.size).toBe(0);
    expect(failedOwner.closeCalls).toBe(1);

    const replacement = createWorkbenchSessionForTesting(config(), deps(new Owner()).result);
    await expect(replacement.boot()).resolves.toBeDefined();
    await replacement.dispose();
    await failed.dispose();
  });

  it('attempts every teardown and releases the claim after owner exit even when a route teardown throws', async () => {
    const owner = new Owner();
    const routeError = new Error('route teardown failed');
    const first = createWorkbenchSessionForTesting(
      config(),
      deps(owner, {
        mountPreviewBridge: () => () => {
          throw routeError;
        },
      }).result,
    );
    const controllers = await first.boot();
    owner.emitPreview({
      type: 'pty:preview',
      ports: [
        {
          port: 5174,
          url: '/preview/5174/',
          label: 'Vite',
          source: 'dev-server',
          sid: 'terminal-1',
        },
      ],
    });
    await vi.waitFor(() => expect(controllers.preview.snapshot().status).toBe('live'));

    await expect(first.dispose()).rejects.toThrow('route teardown failed');
    expect(owner.closedSessions).toEqual(['terminal-1']);
    expect(owner.closeCalls).toBe(1);
    expect(owner.devListeners.size).toBe(0);
    expect(owner.previewListeners.size).toBe(0);

    const replacement = createWorkbenchSessionForTesting(config(), deps(new Owner()).result);
    await expect(replacement.boot()).resolves.toBeDefined();
    await replacement.dispose();
  });

  it('isolates a throwing status subscriber so dispose still kills the owner and releases the claim', async () => {
    const subscriberFailure = new Error('host subscriber failed');
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const owner = new Owner();
    const session = createWorkbenchSessionForTesting(config(), deps(owner).result);
    session.subscribe((snapshot) => {
      if (snapshot.status === 'disposed') throw subscriberFailure;
    });
    await session.boot();

    await expect(session.dispose()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(subscriberFailure);
    expect(owner.closeCalls).toBe(1);

    const replacement = createWorkbenchSessionForTesting(config(), deps(new Owner()).result);
    await expect(replacement.boot()).resolves.toBeDefined();
    await replacement.dispose();
  });

  it('waits for owner exit and releases the claim even when owner close reports cleanup errors', async () => {
    const owner = new Owner();
    const close = owner.close.bind(owner);
    owner.close = () => {
      close();
      throw new Error('owner bridge dispose failed');
    };
    const session = createWorkbenchSessionForTesting(config(), deps(owner).result);
    await session.boot();

    await expect(session.dispose()).rejects.toThrow('owner bridge dispose failed');
    expect(owner.closeCalls).toBe(1);

    const replacement = createWorkbenchSessionForTesting(config(), deps(new Owner()).result);
    await expect(replacement.boot()).resolves.toBeDefined();
    await replacement.dispose();
  });

  it('keeps the singleton claimed until dispose observes a pending owner exit', async () => {
    const ready = deferred<void>();
    const closed = deferred<number | null>();
    const owner = new Owner(ready.promise);
    Object.defineProperty(owner, 'closed', { value: closed.promise });
    owner.close = () => {
      owner.closeCalls += 1;
      owner.alive = false;
    };
    const injected = deps(owner);
    const session = createWorkbenchSessionForTesting(config(), injected.result);
    const boot = session.boot();
    await vi.waitFor(() => expect(injected.startWorkspaceOwner).toHaveBeenCalledOnce());

    const disposal = session.dispose();
    await expect(boot).rejects.toThrow('workbench session disposed');

    const replacement = createWorkbenchSessionForTesting(config(), deps(new Owner()).result);
    await expect(replacement.boot()).rejects.toThrow(WORKBENCH_SINGLETON_ERROR);

    closed.resolve(0);
    await expect(disposal).resolves.toBeUndefined();
    expect(owner.closeCalls).toBe(1);
    await expect(replacement.boot()).resolves.toBeDefined();
    await replacement.dispose();
  });
});
