/**
 * Fault regression: a synchronous init `postMessage` failure happens after
 * the worker, dispatcher attachment, and all stdio/IPC ports exist, but before
 * the caller receives a handle. Spawn must roll the whole acquisition back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const firstCapability = new MessageChannel();
    const secondCapability = new MessageChannel();
    const dispatcher = getKernelDispatcher();
    let thrown: unknown;

    try {
      spawnKernelWorker(
        {
          entry: {
            kind: 'url',
            url: '/entry.js',
            bootstrap: { protocol: 'test/v1', payload: () => undefined },
            capabilityPorts: {
              'test.first': firstCapability.port2,
              'test.second': secondCapability.port2,
            },
          },
          argv: ['rifty', '/entry.js'],
          env: {},
          cwd: '/workspace',
        },
        { pid: 42, ppid: 1 },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(worker.postError);
    expect(worker.transferLength).toBe(6);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.addEventListener).not.toHaveBeenCalled();
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    expect(closePort).toHaveBeenCalledTimes(10);
    firstCapability.port1.close();
    secondCapability.port1.close();
  });
});
