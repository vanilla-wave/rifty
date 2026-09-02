import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KERNEL_ENTRY_BOOTSTRAP_KEY,
  type KernelEntryBootstrapEnvelope,
  publishKernelEntryBootstrap,
  readKernelEntryBootstrap,
} from '../src/index.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
  spawnKernelWorker,
} from '../src/spawn-worker.ts';
import {
  type EntryLifecycleDeps,
  type WorkerEntryDescriptor,
  type WorkerSpawnSpec,
  runEntryLifecycle,
} from '../src/worker-entry.ts';
import { createWorkerOutputState } from '../src/worker-stdio-drain.ts';

const sourceEntryCannotCarryBootstrap: WorkerEntryDescriptor = {
  kind: 'source',
  code: 'void 0;',
  sourceUrl: '/entry.js',
  // @ts-expect-error entry bootstrap belongs only to a URL entry descriptor.
  bootstrap: { protocol: 'test:forbidden', payload: null },
};
void sourceEntryCannotCarryBootstrap;

function makeSpec(entry: WorkerEntryDescriptor): WorkerSpawnSpec {
  return {
    entry,
    argv: [],
    env: {},
    cwd: '/',
    stdio: {} as WorkerSpawnSpec['stdio'],
    outputState: createWorkerOutputState(),
    syncRing: new SharedArrayBuffer(64),
    pid: 2,
    ppid: 1,
  };
}

function makeDeps(overrides: Partial<EntryLifecycleDeps> = {}): EntryLifecycleDeps {
  return {
    preEntryHook: null,
    drainHook: null,
    runEntry: async () => {},
    writeStderr: vi.fn(),
    ...overrides,
  };
}

class RecordingWorker implements WorkerLike {
  readonly posted: Array<{
    readonly message: unknown;
    readonly transfer: ReadonlyArray<Transferable> | undefined;
  }> = [];
  postMessage(message: unknown, transfer?: ReadonlyArray<Transferable>): void {
    this.posted.push({ message, transfer });
  }
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('entry-scoped bootstrap envelope', () => {
  let worker: RecordingWorker | null = null;

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, KERNEL_ENTRY_BOOTSTRAP_KEY);
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => {
      worker = new RecordingWorker();
      return worker;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, KERNEL_ENTRY_BOOTSTRAP_KEY);
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    worker = null;
  });

  it('forwards a structured URL-entry descriptor in the existing init message', () => {
    const bootstrap: KernelEntryBootstrapEnvelope = {
      protocol: 'test:owner-bootstrap/v1',
      payload: { urls: ['https://example.invalid/runtime.js'], nested: { enabled: true } },
    };
    const entry: WorkerEntryDescriptor = {
      kind: 'url',
      url: 'https://example.invalid/entry.js',
      bootstrap,
    };
    const result = spawnKernelWorker(
      { entry, argv: ['rifty', '/entry.js'], env: {}, cwd: '/workspace' },
      { pid: 42, ppid: 7 },
    );

    expect(worker?.posted).toHaveLength(1);
    expect(worker?.posted[0]?.message).toMatchObject({ type: 'init', spec: { entry } });
    expect(worker?.posted[0]?.transfer).toHaveLength(4);
    expect(result.spec.entry).toBe(entry);
    result.terminate();
  });

  it('publishes and reads the exact envelope as a non-enumerable shared global', () => {
    const bootstrap: KernelEntryBootstrapEnvelope = {
      protocol: 'test:bootstrap/v1',
      payload: { projectId: 'alpha' },
    };
    publishKernelEntryBootstrap(bootstrap);

    expect(readKernelEntryBootstrap()).toBe(bootstrap);
    expect(Object.keys(globalThis)).not.toContain(KERNEL_ENTRY_BOOTSTRAP_KEY);
    expect(Object.getOwnPropertyDescriptor(globalThis, KERNEL_ENTRY_BOOTSTRAP_KEY)).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: true,
    });
  });

  it('reads null when the envelope is missing or explicitly absent', () => {
    expect(readKernelEntryBootstrap()).toBeNull();
    publishKernelEntryBootstrap(null);
    expect(readKernelEntryBootstrap()).toBeNull();
  });

  it('publishes the URL envelope before the pre-entry hook and entry run', async () => {
    const bootstrap: KernelEntryBootstrapEnvelope = {
      protocol: 'test:bootstrap/v1',
      payload: { root: '/workspace' },
    };
    const seen: Array<{ readonly phase: string; readonly value: unknown }> = [];
    const outcome = await runEntryLifecycle(
      makeSpec({ kind: 'url', url: 'https://example.invalid/entry.js', bootstrap }),
      makeDeps({
        preEntryHook: () => seen.push({ phase: 'pre-entry', value: readKernelEntryBootstrap() }),
        runEntry: async () => {
          seen.push({ phase: 'entry', value: readKernelEntryBootstrap() });
        },
      }),
    );

    expect(outcome).toEqual({ threw: false, code: 0 });
    expect(seen).toEqual([
      { phase: 'pre-entry', value: bootstrap },
      { phase: 'entry', value: bootstrap },
    ]);
  });

  it('waits for asynchronous pre-entry readiness before running guest code', async () => {
    const order: string[] = [];
    let resolveReadiness!: () => void;
    const readiness = new Promise<void>((resolve) => {
      resolveReadiness = resolve;
    });
    const lifecycle = runEntryLifecycle(
      makeSpec({ kind: 'source', code: 'void 0;', sourceUrl: '/entry.js' }),
      makeDeps({
        preEntryHook: () => {
          order.push('pre-entry');
          return readiness;
        },
        runEntry: async () => {
          order.push('entry');
        },
      }),
    );

    await Promise.resolve();
    expect(order).toEqual(['pre-entry']);

    resolveReadiness();
    await expect(lifecycle).resolves.toEqual({ threw: false, code: 0 });
    expect(order).toEqual(['pre-entry', 'entry']);
  });

  it('publishes null before pre-entry when the entry has no envelope', async () => {
    publishKernelEntryBootstrap({ protocol: 'test:stale/v1', payload: { mustNotLeak: true } });
    const seen: Array<KernelEntryBootstrapEnvelope | null> = [];
    await runEntryLifecycle(
      makeSpec({ kind: 'url', url: 'https://example.invalid/plain-entry.js' }),
      makeDeps({ preEntryHook: () => seen.push(readKernelEntryBootstrap()) }),
    );
    expect(seen).toEqual([null]);
  });
});
