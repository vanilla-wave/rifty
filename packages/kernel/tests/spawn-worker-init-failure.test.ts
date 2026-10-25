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
    const dispatcher = getKernelDispatcher();
    let thrown: unknown;

    try {
      spawnEntry({
        kind: 'url',
        url: '/entry.js',
        bootstrap: { protocol: 'test/v1', payload: () => undefined },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(worker.postError);
    expect(worker.transferLength).toBe(4);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.addEventListener).not.toHaveBeenCalled();
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    expect(closePort).toHaveBeenCalledTimes(8);
  });

  it('rolls back every allocated port when Worker construction fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const constructionFailure = new Error('worker construction failed');
    setWorkerFactoryForTests(() => {
      throw constructionFailure;
    });

    expect(() => spawnEntry({ kind: 'url', url: '/entry.js' })).toThrow(constructionFailure);

    expect(closePort).toHaveBeenCalledTimes(8);
  });

  it('rolls back the exact new ring when dispatcher attachment publishes then fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
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

    expect(() => spawnEntry({ kind: 'url', url: '/entry.js' })).toThrow(attachFailure);

    expect(successfulWorker.terminate).toHaveBeenCalledTimes(1);
    expect(dispatcher.getAttachmentCount()).toBe(1);
    expect(dispatcher.getActiveTimerCount()).toBe(1);
    expect(closePort).toHaveBeenCalledTimes(8);
    dispatcher.detach(sibling);
  });

  it('rolls back post-init resources when lifecycle listener installation fails', () => {
    const closePort = vi.spyOn(MessagePort.prototype, 'close');
    const successfulWorker = new SuccessfulInitWorker();
    const listenerFailure = new Error('listener installation failed');
    successfulWorker.addEventListener.mockImplementation((type: string) => {
      if (type === 'error') throw listenerFailure;
    });
    setWorkerFactoryForTests(() => successfulWorker);
    const dispatcher = getKernelDispatcher();

    expect(() => spawnEntry({ kind: 'url', url: '/entry.js' })).toThrow(listenerFailure);

    expect(successfulWorker.postMessage).toHaveBeenCalledTimes(1);
    expect(successfulWorker.terminate).toHaveBeenCalledTimes(1);
    expect(successfulWorker.removeEventListener.mock.calls.map(([type]) => type)).toEqual([
      'message',
      'messageerror',
    ]);
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    expect(closePort).toHaveBeenCalledTimes(8);
  });
});
