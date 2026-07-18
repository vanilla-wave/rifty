import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as kernelPublic from '../src/index.ts';
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

const sourceEntryCannotCarryBootstrap: WorkerEntryDescriptor = {
  kind: 'source',
  code: 'void 0;',
  sourceUrl: '/entry.js',
  // @ts-expect-error entry bootstrap belongs only to a URL entry descriptor.
  bootstrap: { protocol: 'test:forbidden', payload: null },
};
void sourceEntryCannotCarryBootstrap;

interface CapabilityPublicApi {
  readonly KERNEL_ENTRY_CAPABILITY_PORTS_KEY: string;
  publishKernelEntryCapabilityPorts(
    ports: Readonly<Record<string, MessagePort>> | null | undefined,
  ): void;
  readKernelEntryCapabilityPorts(): Readonly<Record<string, MessagePort>>;
}

const capabilityApi = kernelPublic as unknown as CapabilityPublicApi;

function makeSpec(entry: WorkerEntryDescriptor): WorkerSpawnSpec {
  return {
    entry,
    argv: [],
    env: {},
    cwd: '/',
    stdio: {} as WorkerSpawnSpec['stdio'],
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
    if (typeof capabilityApi.KERNEL_ENTRY_CAPABILITY_PORTS_KEY === 'string') {
      Reflect.deleteProperty(globalThis, capabilityApi.KERNEL_ENTRY_CAPABILITY_PORTS_KEY);
    }
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    worker = null;
  });

  it('forwards a structured URL-entry descriptor in the existing init message', () => {
    const bootstrap: KernelEntryBootstrapEnvelope = {
      protocol: 'test:owner-bootstrap/v1',
      payload: {
        urls: ['https://example.invalid/runtime.js'],
        nested: { enabled: true },
      },
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
    expect(worker?.posted[0]?.message).toMatchObject({
      type: 'init',
      spec: { entry },
    });
    expect(worker?.posted[0]?.transfer).toHaveLength(4);
    expect(result.spec.entry).toEqual(entry);
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
      makeSpec({
        kind: 'url',
        url: 'https://example.invalid/entry.js',
        bootstrap,
      }),
      makeDeps({
        preEntryHook: () => {
          seen.push({ phase: 'pre-entry', value: readKernelEntryBootstrap() });
        },
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

  it('publishes null before pre-entry when the entry has no envelope', async () => {
    publishKernelEntryBootstrap({
      protocol: 'test:stale/v1',
      payload: { mustNotLeak: true },
    });
    const seen: Array<KernelEntryBootstrapEnvelope | null> = [];

    await runEntryLifecycle(
      makeSpec({ kind: 'url', url: 'https://example.invalid/plain-entry.js' }),
      makeDeps({
        preEntryHook: () => {
          seen.push(readKernelEntryBootstrap());
        },
      }),
    );

    expect(seen).toEqual([null]);
  });

  it('publishes a frozen null-prototype capability snapshot before pre-entry and entry', async () => {
    const alpha = new MessageChannel();
    const beta = new MessageChannel();
    const seen: Readonly<Record<string, MessagePort>>[] = [];

    const outcome = await runEntryLifecycle(
      makeSpec({
        kind: 'url',
        url: 'https://example.invalid/capability-entry.js',
        capabilityPorts: {
          'test.alpha': alpha.port2,
          'Test.Beta': beta.port2,
        },
      } as WorkerEntryDescriptor),
      makeDeps({
        preEntryHook: () => {
          seen.push(capabilityApi.readKernelEntryCapabilityPorts());
        },
        runEntry: async () => {
          seen.push(capabilityApi.readKernelEntryCapabilityPorts());
        },
      }),
    );

    expect(outcome).toEqual({ threw: false, code: 0 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(Object.getPrototypeOf(seen[0])).toBeNull();
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(Object.entries(seen[0] ?? {})).toEqual([
      ['test.alpha', alpha.port2],
      ['Test.Beta', beta.port2],
    ]);
    expect(kernelPublic.readKernelEntryBootstrap()).toBeNull();

    alpha.port1.close();
    alpha.port2.close();
    beta.port1.close();
    beta.port2.close();
  });

  it('publishes independent non-null bootstrap and capability snapshots before pre-entry', async () => {
    const capability = new MessageChannel();
    const bootstrap: KernelEntryBootstrapEnvelope = {
      protocol: 'test:bootstrap-and-capability/v1',
      payload: { project: 'alpha' },
    };
    let seenBootstrap: KernelEntryBootstrapEnvelope | null = null;
    let seenCapabilities: Readonly<Record<string, MessagePort>> | null = null;

    const outcome = await runEntryLifecycle(
      makeSpec({
        kind: 'url',
        url: 'https://example.invalid/capability-entry.js',
        bootstrap,
        capabilityPorts: { 'test.independent': capability.port2 },
      }),
      makeDeps({
        preEntryHook: () => {
          seenBootstrap = readKernelEntryBootstrap();
          seenCapabilities = capabilityApi.readKernelEntryCapabilityPorts();
        },
      }),
    );

    expect(outcome).toEqual({ threw: false, code: 0 });
    expect(seenBootstrap).toBe(bootstrap);
    expect(seenCapabilities).not.toBe(bootstrap);
    expect(Object.entries(seenCapabilities ?? {})).toEqual([
      ['test.independent', capability.port2],
    ]);

    capability.port1.close();
    capability.port2.close();
  });

  it('publishes frozen empty capabilities for absent URL and source entries, clearing stale state', async () => {
    const stale = new MessageChannel();
    capabilityApi.publishKernelEntryCapabilityPorts({ stale: stale.port2 });
    const seen: Readonly<Record<string, MessagePort>>[] = [];

    await runEntryLifecycle(
      makeSpec({ kind: 'url', url: 'https://example.invalid/plain-entry.js' }),
      makeDeps({
        preEntryHook: () => seen.push(capabilityApi.readKernelEntryCapabilityPorts()),
      }),
    );
    await runEntryLifecycle(
      makeSpec({ kind: 'source', code: 'void 0;', sourceUrl: '/source-entry.js' }),
      makeDeps({
        preEntryHook: () => seen.push(capabilityApi.readKernelEntryCapabilityPorts()),
      }),
    );

    expect(seen).toHaveLength(2);
    for (const value of seen) {
      expect(Object.keys(value)).toEqual([]);
      expect(Object.getPrototypeOf(value)).toBeNull();
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.keys(globalThis)).not.toContain(capabilityApi.KERNEL_ENTRY_CAPABILITY_PORTS_KEY);

    stale.port1.close();
    stale.port2.close();
  });
});
