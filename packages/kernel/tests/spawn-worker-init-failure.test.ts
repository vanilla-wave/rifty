/**
 * Fault regression: a synchronous init `postMessage` failure happens after
 * the worker, dispatcher attachment, and all stdio/IPC ports exist, but before
 * the caller receives a handle. Spawn must roll the whole acquisition back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSabRing } from '../src/ipc/sab-ring.ts';
import {
  type SpawnWorkerSpec,
  type WorkerLike,
  clearKernelDispatcher,
  clearKernelWorkerUrl,
  clearWorkerFactoryForTests,
  getKernelDispatcher,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
  spawnKernelWorker,
} from '../src/spawn-worker.ts';

class ThrowingInitWorker implements WorkerLike {
  readonly postError = new DOMException('bootstrap payload could not be cloned', 'DataCloneError');
  readonly terminate = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  transferLength: number | undefined;

  postMessage(_message: unknown, transfer?: ReadonlyArray<Transferable>): void {
    this.transferLength = transfer?.length;
    throw this.postError;
  }
}

class SuccessfulInitWorker implements WorkerLike {
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
}

function entryWithThrowingDescriptor(
  field: 'url' | 'bootstrap',
  failure: Error,
  capabilityPorts: Extract<SpawnWorkerSpec['entry'], { kind: 'url' }>['capabilityPorts'],
): SpawnWorkerSpec['entry'] {
  if (field === 'url') {
    return {
      kind: 'url',
      get url(): string {
        throw failure;
      },
      capabilityPorts,
    };
  }
  return {
    kind: 'url',
    url: '/entry.js',
    get bootstrap(): never {
      throw failure;
    },
    capabilityPorts,
  };
}

function entryWithCapability(port: MessagePort): SpawnWorkerSpec['entry'] {
  return {
    kind: 'url',
    url: '/entry.js',
    capabilityPorts: { 'rifty.shadow-assets/v1': port },
  };
}

function spawnEntry(
  entry: SpawnWorkerSpec['entry'],
  overrides: Partial<Omit<SpawnWorkerSpec, 'entry'>> = {},
) {
  return spawnKernelWorker(
    {
      entry,
      argv: ['rifty', '/entry.js'],
      env: {},
      cwd: '/workspace',
      ...overrides,
    },
    { pid: 42, ppid: 1 },
  );
}

describe('spawnKernelWorker init transaction', () => {
  let worker: ThrowingInitWorker;

  beforeEach(() => {
    worker = new ThrowingInitWorker();
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => worker);
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    vi.restoreAllMocks();
  });

  it('rolls back worker, dispatcher ring, and every port when init cannot be cloned', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const capability = new MessageChannel();
    const dispatcher = getKernelDispatcher();
    let thrown: unknown;

    try {
      spawnEntry({
        kind: 'url',
        url: '/entry.js',
        bootstrap: { protocol: 'test/v1', payload: () => undefined },
        capabilityPorts: { 'rifty.shadow-assets/v1': capability.port2 },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(worker.postError);
    expect(worker.transferLength).toBe(5);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.addEventListener).not.toHaveBeenCalled();
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    expect(closePort).toHaveBeenCalledTimes(9);
    capability.port1.close();
  });

  it('closes an adopted capability when SAB allocation fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const capability = new MessageChannel();

    expect(() =>
      spawnEntry(entryWithCapability(capability.port2), { payloadCapacity: 0 }),
    ).toThrow();

    expect(closePort).toHaveBeenCalledTimes(1);
    capability.port1.close();
  });

  it.each(['url', 'bootstrap'] as const)(
    'rolls back every adopted capability without spawning when the %s descriptor throws',
    (field) => {
      const first = new MessageChannel();
      const second = new MessageChannel();
      const firstClose = vi.spyOn(first.port2, 'close');
      const secondClose = vi.spyOn(second.port2, 'close');
      const descriptorFailure = new Error(`${field} descriptor failed`);
      const workerFactory = vi.fn(() => worker);
      setWorkerFactoryForTests(workerFactory);
      let thrown: unknown;

      try {
        spawnEntry(
          entryWithThrowingDescriptor(field, descriptorFailure, {
            'rifty.shadow-assets/v1': first.port2,
            'rifty.shadow-assets.ready/v1': second.port2,
          }),
        );
      } catch (error) {
        thrown = error;
      }

      try {
        expect(thrown).toBe(descriptorFailure);
        expect(workerFactory).not.toHaveBeenCalled();
        expect(firstClose).toHaveBeenCalledTimes(1);
        expect(secondClose).toHaveBeenCalledTimes(1);
      } finally {
        first.port1.close();
        first.port2.close();
        second.port1.close();
        second.port2.close();
      }
    },
  );

  it('rolls back every allocated port when Worker construction fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const capability = new MessageChannel();
    const constructionFailure = new Error('worker construction failed');
    setWorkerFactoryForTests(() => {
      throw constructionFailure;
    });

    expect(() => spawnEntry(entryWithCapability(capability.port2))).toThrow(constructionFailure);

    expect(closePort).toHaveBeenCalledTimes(9);
    capability.port1.close();
  });

  it('rolls back the exact new ring when dispatcher attachment publishes then fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const capability = new MessageChannel();
    const successfulWorker = new SuccessfulInitWorker();
    setWorkerFactoryForTests(() => successfulWorker);
    const dispatcher = getKernelDispatcher();
    const sibling = createSabRing({ payloadCapacity: 64 }).ring;
    dispatcher.attach(sibling);
    const attach = dispatcher.attach.bind(dispatcher);
    const attachFailure = new Error('dispatcher attach failed');
    vi.spyOn(dispatcher, 'attach').mockImplementationOnce((ring) => {
      attach(ring);
      throw attachFailure;
    });

    expect(() => spawnEntry(entryWithCapability(capability.port2))).toThrow(attachFailure);

    expect(successfulWorker.terminate).toHaveBeenCalledTimes(1);
    expect(dispatcher.getAttachmentCount()).toBe(1);
    expect(dispatcher.getActiveTimerCount()).toBe(1);
    expect(closePort).toHaveBeenCalledTimes(9);
    dispatcher.detach(sibling);
    capability.port1.close();
  });

  it('rolls back post-init resources when lifecycle listener installation fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const capability = new MessageChannel();
    const successfulWorker = new SuccessfulInitWorker();
    const listenerFailure = new Error('listener installation failed');
    successfulWorker.addEventListener.mockImplementation((type: string) => {
      if (type === 'error') throw listenerFailure;
    });
    setWorkerFactoryForTests(() => successfulWorker);
    const dispatcher = getKernelDispatcher();

    expect(() => spawnEntry(entryWithCapability(capability.port2))).toThrow(listenerFailure);

    expect(successfulWorker.postMessage).toHaveBeenCalledTimes(1);
    expect(successfulWorker.terminate).toHaveBeenCalledTimes(1);
    expect(successfulWorker.removeEventListener).toHaveBeenCalledTimes(3);
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    expect(closePort).toHaveBeenCalledTimes(9);
    capability.port1.close();
  });
});
