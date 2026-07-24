import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KERNEL_ENTRY_BOOTSTRAP_KEY,
  type KernelEntryBootstrapEnvelope,
  type KernelEntryCapabilityPorts,
  consumeKernelEntryCapabilityPorts,
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

const sourceEntryCannotCarryCapabilities: WorkerEntryDescriptor = {
  kind: 'source',
  code: 'void 0;',
  sourceUrl: '/entry.js',
  // @ts-expect-error entry capabilities belong only to a URL entry descriptor.
  capabilityPorts: {},
};
void sourceEntryCannotCarryCapabilities;

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

function clearEntryCapabilities(): void {
  for (const port of Object.values(consumeKernelEntryCapabilityPorts())) {
    port.close();
  }
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

interface InvalidCapabilityRecordCase {
  readonly name: string;
  readonly message: string;
  make(): {
    readonly record: unknown;
    readonly channels: readonly MessageChannel[];
  };
}

const INVALID_CAPABILITY_RECORD_CASES: readonly InvalidCapabilityRecordCase[] = [
  {
    name: 'accessor',
    message:
      "WorkerEntryDescriptor.capabilityPorts 'asset' must be a data property; accessors are forbidden",
    make: () => {
      const record = {};
      Object.defineProperty(record, 'asset', {
        enumerable: true,
        get: () => {
          throw new Error('capability accessor must not run');
        },
      });
      return { record, channels: [] };
    },
  },
  {
    name: 'enumerable symbol',
    message: 'WorkerEntryDescriptor.capabilityPorts Symbol(asset) must not be an enumerable symbol',
    make: () => {
      const channel = new MessageChannel();
      return {
        record: { [Symbol('asset')]: channel.port2 },
        channels: [channel],
      };
    },
  },
  {
    name: 'non-port',
    message: "WorkerEntryDescriptor.capabilityPorts 'asset' must be a MessagePort",
    make: () => ({ record: { asset: {} }, channels: [] }),
  },
  {
    name: 'duplicate port',
    message:
      "WorkerEntryDescriptor.capabilityPorts 'second' duplicates a MessagePort already used by another name",
    make: () => {
      const channel = new MessageChannel();
      return {
        record: { first: channel.port2, second: channel.port2 },
        channels: [channel],
      };
    },
  },
];

describe('entry-scoped bootstrap envelope', () => {
  let worker: RecordingWorker | null = null;

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, KERNEL_ENTRY_BOOTSTRAP_KEY);
    clearEntryCapabilities();
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => {
      worker = new RecordingWorker();
      return worker;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, KERNEL_ENTRY_BOOTSTRAP_KEY);
    clearEntryCapabilities();
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

  it.each(INVALID_CAPABILITY_RECORD_CASES)(
    'rejects a capability record containing an $name',
    ({ message, make }) => {
      const { record, channels } = make();
      const closeSpies = channels.map((channel) => vi.spyOn(channel.port2, 'close'));
      let thrown: unknown;

      try {
        spawnKernelWorker(
          {
            entry: {
              kind: 'url',
              url: 'https://example.invalid/entry.js',
              capabilityPorts: record as KernelEntryCapabilityPorts,
            },
            argv: ['rifty', '/entry.js'],
            env: {},
            cwd: '/workspace',
          },
          { pid: 42, ppid: 7 },
        );
      } catch (error) {
        thrown = error;
      }

      try {
        expect(thrown).toBeInstanceOf(TypeError);
        expect((thrown as Error).message).toBe(message);
        expect(worker).toBeNull();
        for (const close of closeSpies) expect(close).not.toHaveBeenCalled();
      } finally {
        for (const channel of channels) {
          channel.port1.close();
          channel.port2.close();
        }
      }
    },
  );

  it('detaches the normalized capability map from caller mutation', () => {
    const adopted = new MessageChannel();
    const replacement = new MessageChannel();
    const late = new MessageChannel();
    const callerRecord = Object.create(null) as Record<string, MessagePort>;
    callerRecord.asset = adopted.port2;
    let result: ReturnType<typeof spawnKernelWorker> | undefined;

    try {
      result = spawnKernelWorker(
        {
          entry: {
            kind: 'url',
            url: 'https://example.invalid/entry.js',
            capabilityPorts: callerRecord,
          },
          argv: ['rifty', '/entry.js'],
          env: {},
          cwd: '/workspace',
        },
        { pid: 42, ppid: 7 },
      );
      callerRecord.asset = replacement.port2;
      callerRecord.late = late.port2;

      expect(result.spec.entry.kind).toBe('url');
      if (result.spec.entry.kind !== 'url') throw new Error('expected URL entry');
      const normalized = result.spec.entry.capabilityPorts;
      expect(normalized?.asset).toBe(adopted.port2);
      expect(Object.keys(normalized ?? {})).toEqual(['asset']);
      expect(Object.isFrozen(normalized)).toBe(true);
      expect(Object.getPrototypeOf(normalized)).toBeNull();
      expect(worker?.posted[0]?.transfer).toHaveLength(5);
      expect(worker?.posted[0]?.transfer?.[4]).toBe(adopted.port2);
    } finally {
      result?.terminate();
      for (const channel of [adopted, replacement, late]) {
        channel.port1.close();
        channel.port2.close();
      }
    }
  });

  it('publishes a frozen capability snapshot before pre-entry and consumes once', async () => {
    const asset = new MessageChannel();
    const seen: unknown[] = [];

    const outcome = await runEntryLifecycle(
      makeSpec({
        kind: 'url',
        url: 'https://example.invalid/capability-entry.js',
        capabilityPorts: { 'rifty.shadow-assets/v1': asset.port2 },
      }),
      makeDeps({
        preEntryHook: () => {
          const consumed = consumeKernelEntryCapabilityPorts();
          seen.push({
            phase: 'pre-entry',
            names: Object.keys(consumed),
            port: consumed['rifty.shadow-assets/v1'],
            frozen: Object.isFrozen(consumed),
            prototype: Object.getPrototypeOf(consumed),
          });
        },
        runEntry: async () => {
          seen.push({
            phase: 'entry',
            names: Object.keys(consumeKernelEntryCapabilityPorts()),
          });
        },
      }),
    );

    expect(outcome).toEqual({ threw: false, code: 0 });
    expect(seen).toEqual([
      {
        phase: 'pre-entry',
        names: ['rifty.shadow-assets/v1'],
        port: asset.port2,
        frozen: true,
        prototype: null,
      },
      {
        phase: 'entry',
        names: [],
      },
    ]);
    asset.port1.close();
    asset.port2.close();
  });
});
