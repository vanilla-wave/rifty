import { describe, expect, it, vi } from 'vitest';
import {
  type WorkbenchOptions,
  validateUrlContext,
  validateWorkbenchOptions,
} from './internal/workbench-options.ts';
import { inspectPageToWorkbenchOwnerMessage } from './owner-protocol.ts';
import {
  type RawWorkspaceOwnerHandle,
  type WorkbenchOwnerStartInput,
  createWorkbenchOwnerPort,
} from './workbench-owner-port.ts';

const CONTEXT = validateUrlContext({
  apiBaseUrl: 'https://workbench.invalid/app/index.html',
  clientUrl: 'https://workbench.invalid/app/index.html',
});

function options(): WorkbenchOptions {
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
    packageAcquisition: {},
    storage: { persistence: 'required' },
  };
}

function admit(deployment: WorkbenchOptions['deployment']) {
  return validateWorkbenchOptions({ ...options(), deployment }, CONTEXT);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolved, rejected) => {
    resolve = resolved;
    reject = rejected;
  });
  return { promise, reject, resolve };
}

const REQUIRED_STORAGE = Object.freeze({
  policy: 'required' as const,
  backend: 'opfs' as const,
  durability: 'durable' as const,
});

function ownerInput(): WorkbenchOwnerStartInput {
  return Object.freeze({
    deployment: Object.freeze({
      workers: Object.freeze({
        owner: 'https://workbench.invalid/owner.js',
        kernel: 'https://workbench.invalid/kernel.js',
        node: 'https://workbench.invalid/node.js',
        devServer: 'https://workbench.invalid/dev-server.js',
      }),
      wasm: Object.freeze({
        sqlite: 'https://workbench.invalid/sqlite.wasm',
      }),
      previewProbeTimeoutMs: 3_000,
    }),
    packageAcquisition: Object.freeze({}),
    storage: Object.freeze({ persistence: 'required' as const }),
  });
}

function portHarness() {
  const ready = deferred<void>();
  const closed = deferred<unknown>();
  void ready.promise.catch(() => {});
  void closed.promise.catch(() => {});
  const close = vi.fn<() => void>();
  const raw: RawWorkspaceOwnerHandle = {
    ready: ready.promise,
    closed: closed.promise,
    storageSnapshot: () => REQUIRED_STORAGE,
    openProject: async () => {
      throw new Error('openProject is not configured');
    },
    deleteProject: async () => {},
    close,
  };
  const startWorkspaceOwner = vi.fn((_input: WorkbenchOwnerStartInput) => raw);
  return {
    close,
    closed,
    port: createWorkbenchOwnerPort({ startWorkspaceOwner }),
    ready,
    startWorkspaceOwner,
  };
}

async function settlement(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    ),
    Promise.resolve().then(() => ({ kind: 'pending' as const })),
  ]);
}

const BOOT_CONFIG = Object.freeze({
  deployment: Object.freeze({
    workers: Object.freeze({
      kernel: 'https://workbench.invalid/kernel.js',
      node: 'https://workbench.invalid/node.js',
      devServer: 'https://workbench.invalid/dev-server.js',
    }),
    wasm: Object.freeze({ sqlite: 'https://workbench.invalid/sqlite.wasm' }),
    previewProbeTimeoutMs: 3_000,
  }),
  packageAcquisition: Object.freeze({}),
  storage: Object.freeze({ persistence: 'ephemeral' as const }),
});

describe('Workbench operation budgets (I7)', () => {
  it('keeps omitted duration budgets off the admitted owner deployment', () => {
    const admitted = admit(options().deployment);
    expect(admitted.owner.deployment.ownerStartupTimeoutMs).toBeUndefined();
    expect(admitted.owner.deployment.projectFileTimeoutMs).toBeUndefined();
    expect(admitted.owner.deployment.sessionToolsTimeoutMs).toBeUndefined();
  });

  it('admits the three public duration budgets on owner start input', () => {
    const admitted = admit({
      ...options().deployment,
      ownerStartupTimeoutMs: 80,
      projectFileTimeoutMs: 80,
      sessionToolsTimeoutMs: 80,
    });
    expect(admitted.owner.deployment.ownerStartupTimeoutMs).toBe(80);
    expect(admitted.owner.deployment.projectFileTimeoutMs).toBe(80);
    expect(admitted.owner.deployment.sessionToolsTimeoutMs).toBe(80);
    expect(admitted.owner.deployment.ownerOperationSilenceTimeoutMs).toBeUndefined();
  });

  it('rejects hung owner ready at ownerStartupTimeoutMs, not 30 000 ms', async () => {
    vi.useFakeTimers();
    try {
      const admitted = admit({
        ...options().deployment,
        ownerStartupTimeoutMs: 80,
      });
      expect(admitted.owner.deployment.ownerStartupTimeoutMs).toBe(80);
      const h = portHarness();
      const opening = h.port.start({
        ...ownerInput(),
        deployment: {
          ...ownerInput().deployment,
          ownerStartupTimeoutMs: admitted.owner.deployment.ownerStartupTimeoutMs,
        },
      });
      void opening.catch(() => {});
      await vi.advanceTimersByTimeAsync(80);
      const short = await settlement(opening);
      expect(short.kind).toBe('rejected');
      if (short.kind !== 'rejected') return;
      expect(String((short.error as Error).message)).toMatch(/ready.*timed out after 80ms/i);
      expect(h.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps owner ready pending at 30 000 ms when ownerStartupTimeoutMs is 60 000', async () => {
    vi.useFakeTimers();
    try {
      const admitted = admit({
        ...options().deployment,
        ownerStartupTimeoutMs: 60_000,
      });
      expect(admitted.owner.deployment.ownerStartupTimeoutMs).toBe(60_000);
      const h = portHarness();
      const opening = h.port.start({
        ...ownerInput(),
        deployment: {
          ...ownerInput().deployment,
          ownerStartupTimeoutMs: admitted.owner.deployment.ownerStartupTimeoutMs,
        },
      });
      void opening.catch(() => {});
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await settlement(opening)).toEqual({ kind: 'pending' });
      await vi.advanceTimersByTimeAsync(30_000);
      const outcome = await settlement(opening);
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(String((outcome.error as Error).message)).toMatch(/ready.*timed out after 60000ms/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects hung owner close/exit observe at ownerStartupTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const admitted = admit({
        ...options().deployment,
        ownerStartupTimeoutMs: 80,
      });
      expect(admitted.owner.deployment.ownerStartupTimeoutMs).toBe(80);
      const h = portHarness();
      const opening = h.port.start({
        ...ownerInput(),
        deployment: {
          ...ownerInput().deployment,
          ownerStartupTimeoutMs: admitted.owner.deployment.ownerStartupTimeoutMs,
        },
      });
      h.ready.resolve(undefined);
      const { owner } = await opening;
      const closing = owner.close();
      void closing.catch(() => {});
      await vi.advanceTimersByTimeAsync(80);
      const outcome = await settlement(closing);
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind !== 'rejected') return;
      expect(String((outcome.error as Error).message)).toMatch(/exit.*timed out after 80ms/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('admits ownerStartupTimeoutMs on initialize', () => {
    const inspected = inspectPageToWorkbenchOwnerMessage({
      type: 'workbench:initialize',
      config: {
        ...BOOT_CONFIG,
        deployment: {
          ...BOOT_CONFIG.deployment,
          ownerStartupTimeoutMs: 80,
        },
      },
    });
    if (inspected.type !== 'workbench:initialize') {
      throw new Error('expected initialize');
    }
    const startupMs = (inspected.config.deployment as { readonly ownerStartupTimeoutMs?: number })
      .ownerStartupTimeoutMs;
    expect(startupMs).toBe(80);
  });
});
