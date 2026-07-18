import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KernelProcessSpec } from '../src/shared-globals.ts';
import * as workerEntryPublic from '../src/worker-entry.ts';
import type { EntryLifecycleDeps } from '../src/worker-entry.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  getKernelDispatcher,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
  spawnKernelWorker,
} from '../src/spawn-worker.ts';
import type { WorkerEntryDescriptor } from '../src/worker-entry.ts';

const sourceEntryCannotCarryCapabilityPorts: WorkerEntryDescriptor = {
  kind: 'source',
  code: 'void 0;',
  sourceUrl: '/entry.js',
  // @ts-expect-error capability ports belong only to URL entries.
  capabilityPorts: {},
};
void sourceEntryCannotCarryCapabilityPorts;

const processSpecCannotCarryCapabilityPorts: KernelProcessSpec = {
  pid: 2,
  ppid: 1,
  argv: [],
  env: {},
  cwd: '/',
  stdio: {} as KernelProcessSpec['stdio'],
  // @ts-expect-error entry capabilities are not process identity.
  capabilityPorts: {},
};
void processSpecCannotCarryCapabilityPorts;

const publicLifecycleDepsCannotPrepare: EntryLifecycleDeps = {
  // @ts-expect-error child bootstrap setup is an internal kernel seam.
  prepareEntry() {},
  preEntryHook: null,
  drainHook: null,
  async runEntry() {},
  writeStderr() {},
};
void publicLifecycleDepsCannotPrepare;

type WorkerListener = (event: MessageEvent) => void;

class RecordingWorker implements WorkerLike {
  readonly posted: Array<{
    readonly message: unknown;
    readonly transfer: ReadonlyArray<Transferable> | undefined;
  }> = [];
  readonly terminate = vi.fn();
  readonly addEventListener = vi.fn((_type: string, _listener: WorkerListener) => {});
  readonly removeEventListener = vi.fn((_type: string, _listener: WorkerListener) => {});

  postMessage(message: unknown, transfer?: ReadonlyArray<Transferable>): void {
    this.posted.push({ message, transfer });
  }
}

function baseSpawn(entry: WorkerEntryDescriptor) {
  return spawnKernelWorker(
    {
      entry,
      argv: ['rifty', '/entry.js'],
      env: {},
      cwd: '/workspace',
    },
    { pid: 42, ppid: 1 },
  );
}

describe('URL-entry capability ports contract', () => {
  let worker: RecordingWorker;
  const channels: MessageChannel[] = [];

  function channel(): MessageChannel {
    const value = new MessageChannel();
    channels.push(value);
    return value;
  }

  beforeEach(() => {
    worker = new RecordingWorker();
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => worker);
  });

  afterEach(() => {
    for (const value of channels.splice(0)) {
      value.port1.close();
      value.port2.close();
    }
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    vi.restoreAllMocks();
  });

  it('snapshots two exact named ports and transfers them once after the four fixed endpoints', () => {
    const alpha = channel();
    const beta = channel();
    const supplied: Record<string, MessagePort> = {
      'test.alpha': alpha.port2,
      'Test.Beta': beta.port2,
    };

    const result = baseSpawn({
      kind: 'url',
      url: 'https://example.invalid/entry.js',
      capabilityPorts: supplied,
    } as WorkerEntryDescriptor);

    const posted = worker.posted[0];
    expect(posted?.transfer?.length).toBe(6);
    expect(posted?.transfer?.slice(4)).toEqual([alpha.port2, beta.port2]);
    expect(result.spec.entry.kind).toBe('url');
    if (result.spec.entry.kind !== 'url') throw new Error('expected URL entry');
    const snapshot = result.spec.entry.capabilityPorts;
    expect(snapshot).not.toBe(supplied);
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.entries(snapshot ?? {})).toEqual([
      ['test.alpha', alpha.port2],
      ['Test.Beta', beta.port2],
    ]);

    Reflect.deleteProperty(supplied, 'test.alpha');
    supplied.late = channel().port2;
    expect(Object.keys(snapshot ?? {})).toEqual(['test.alpha', 'Test.Beta']);

    result.terminate();
  });

  it('keeps the no-capability transfer shape at exactly four fixed endpoints', () => {
    const result = baseSpawn({
      kind: 'url',
      url: 'https://example.invalid/plain-entry.js',
    });

    expect(worker.posted[0]?.transfer?.length).toBe(4);
    result.terminate();
  });

  it('does not expose the spawn-only normalizer from the public worker-entry subpath', () => {
    expect(Object.hasOwn(workerEntryPublic, 'normalizeWorkerEntryDescriptor')).toBe(false);
  });

  it.each([
    ['null', () => null, '<root>'],
    ['array', () => [], '<root>'],
    ['custom prototype', () => Object.create({ inherited: true }), '<root>'],
    [
      'accessor',
      () => {
        const value = {};
        Object.defineProperty(value, 'secret', {
          enumerable: true,
          get: vi.fn(() => channel().port2),
        });
        return value;
      },
      'secret',
    ],
    [
      'enumerable symbol',
      () => {
        const value = {};
        Object.defineProperty(value, Symbol('secret'), {
          enumerable: true,
          value: channel().port2,
        });
        return value;
      },
      'Symbol(secret)',
    ],
    ['empty name', () => ({ '': channel().port2 }), "''"],
    ['non-port', () => ({ broken: {} }), 'broken'],
    [
      'duplicate identity',
      () => {
        const shared = channel().port2;
        return { first: shared, second: shared };
      },
      'second',
    ],
  ])('rejects malformed %s before SAB/channel/Worker allocation', (_label, makeValue, key) => {
    const value = makeValue();
    let thrown: unknown;

    try {
      baseSpawn({
        kind: 'url',
        url: 'https://example.invalid/entry.js',
        capabilityPorts: value,
      } as unknown as WorkerEntryDescriptor);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toContain('capabilityPorts');
    expect((thrown as Error).message).toContain(key);
    expect(worker.posted).toHaveLength(0);
    expect(worker.addEventListener).not.toHaveBeenCalled();
    expect(getKernelDispatcher().getAttachmentCount()).toBe(0);
  });

  it('does not invoke a rejected accessor or adopt a valid sibling port', async () => {
    const retained = channel();
    const getter = vi.fn(() => retained.port2);
    const supplied = { retained: retained.port2 };
    Object.defineProperty(supplied, 'hidden', { enumerable: true, get: getter });

    expect(() =>
      baseSpawn({
        kind: 'url',
        url: 'https://example.invalid/entry.js',
        capabilityPorts: supplied,
      } as unknown as WorkerEntryDescriptor),
    ).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();

    const received = new Promise<unknown>((resolve) => {
      retained.port1.onmessage = (event) => resolve(event.data);
      retained.port1.start();
    });
    retained.port2.postMessage({ still: 'caller-owned' });
    await expect(received).resolves.toEqual({ still: 'caller-owned' });
  });
});
