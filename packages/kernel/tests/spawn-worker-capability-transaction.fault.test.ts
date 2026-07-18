import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
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

const NativeMessageChannel = globalThis.MessageChannel;
type WorkerListener = (event: MessageEvent) => void;

class TrackingPort {
  readonly close = vi.fn();
}

class FaultingWorker implements WorkerLike {
  readonly terminate = vi.fn();
  readonly removeEventListener = vi.fn((_type: string, _listener: WorkerListener) => {});
  readonly listeners: Array<{ readonly type: string; readonly listener: WorkerListener }> = [];
  readonly transfers: ReadonlyArray<Transferable>[] = [];
  addCount = 0;
  failAddAt: number | null = null;
  postError: Error | null = null;

  postMessage(_message: unknown, transfer?: ReadonlyArray<Transferable>): void {
    if (transfer !== undefined) this.transfers.push(transfer);
    if (this.postError !== null) throw this.postError;
  }

  addEventListener(type: string, listener: WorkerListener): void {
    this.addCount += 1;
    if (this.failAddAt === this.addCount) throw new Error(`listener-${this.addCount}-failed`);
    this.listeners.push({ type, listener });
  }
}

function spawnWithCapability(port: MessagePort, payloadCapacity?: number) {
  return spawnKernelWorker(
    {
      entry: {
        kind: 'url',
        url: 'https://example.invalid/entry.js',
        capabilityPorts: { 'test.capability': port },
      } as WorkerEntryDescriptor,
      argv: ['rifty', '/entry.js'],
      env: {},
      cwd: '/workspace',
      payloadCapacity,
    },
    { pid: 42, ppid: 1 },
  );
}

describe('spawnKernelWorker capability resource transaction', () => {
  const nativeChannels: MessageChannel[] = [];
  let worker: FaultingWorker;

  function capability(): {
    readonly channel: MessageChannel;
    readonly close: ReturnType<typeof vi.spyOn>;
  } {
    const channel = new NativeMessageChannel();
    nativeChannels.push(channel);
    return { channel, close: vi.spyOn(channel.port2, 'close') };
  }

  beforeEach(() => {
    worker = new FaultingWorker();
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => worker);
  });

  afterEach(() => {
    for (const channel of nativeChannels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
    }
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('closes adopted capabilities when SAB allocation rejects', () => {
    const cap = capability();

    expect(() => spawnWithCapability(cap.channel.port2, 0)).toThrow(RangeError);

    expect(cap.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(getKernelDispatcher().getAttachmentCount()).toBe(0);
  });

  it.each([1, 2, 3, 4])(
    'rolls back capabilities and every acquired fixed port when MessageChannel #%i throws',
    (failAt) => {
      const cap = capability();
      const created: TrackingPort[] = [];
      let construction = 0;
      class FaultingMessageChannel {
        readonly port1: MessagePort;
        readonly port2: MessagePort;
        constructor() {
          construction += 1;
          if (construction === failAt) throw new Error(`channel-${failAt}-failed`);
          const port1 = new TrackingPort();
          const port2 = new TrackingPort();
          created.push(port1, port2);
          this.port1 = port1 as unknown as MessagePort;
          this.port2 = port2 as unknown as MessagePort;
        }
      }
      vi.stubGlobal('MessageChannel', FaultingMessageChannel);

      expect(() => spawnWithCapability(cap.channel.port2)).toThrow(`channel-${failAt}-failed`);

      expect(cap.close).toHaveBeenCalledTimes(1);
      for (const port of created) expect(port.close).toHaveBeenCalledTimes(1);
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(getKernelDispatcher().getAttachmentCount()).toBe(0);
    },
  );

  it('rolls back all ports when Worker construction throws', () => {
    const cap = capability();
    const created: TrackingPort[] = [];
    class TrackingMessageChannel {
      readonly port1: MessagePort;
      readonly port2: MessagePort;
      constructor() {
        const port1 = new TrackingPort();
        const port2 = new TrackingPort();
        created.push(port1, port2);
        this.port1 = port1 as unknown as MessagePort;
        this.port2 = port2 as unknown as MessagePort;
      }
    }
    vi.stubGlobal('MessageChannel', TrackingMessageChannel);
    const constructionError = new Error('worker-construction-failed');
    setWorkerFactoryForTests(() => {
      throw constructionError;
    });

    let thrown: unknown;
    try {
      spawnWithCapability(cap.channel.port2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(constructionError);
    expect(cap.close).toHaveBeenCalledTimes(1);
    for (const port of created) expect(port.close).toHaveBeenCalledTimes(1);
    expect(getKernelDispatcher().getAttachmentCount()).toBe(0);
  });

  it('detaches a partially attached dispatcher and preserves its original attach error', () => {
    const cap = capability();
    const dispatcher = getKernelDispatcher();
    const originalAttach = dispatcher.attach.bind(dispatcher);
    const attachError = new Error('dispatcher-attach-failed');
    vi.spyOn(dispatcher, 'attach').mockImplementation((ring) => {
      originalAttach(ring);
      throw attachError;
    });

    let thrown: unknown;
    try {
      spawnWithCapability(cap.channel.port2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(attachError);
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(dispatcher.getActiveTimerCount()).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(cap.close).toHaveBeenCalledTimes(1);
  });

  it('does not detach when dispatcher attach fails before publishing the ring', () => {
    const cap = capability();
    const dispatcher = getKernelDispatcher();
    const attachError = new Error('dispatcher-attach-failed-before-publication');
    vi.spyOn(dispatcher, 'attach').mockImplementation(() => {
      throw attachError;
    });
    const detach = vi.spyOn(dispatcher, 'detach');

    let thrown: unknown;
    try {
      spawnWithCapability(cap.channel.port2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(attachError);
    expect(detach).not.toHaveBeenCalled();
    expect(dispatcher.getAttachmentCount()).toBe(0);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(cap.close).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3])(
    'rolls back post-init resources when lifecycle listener #%i cannot attach',
    (failAt) => {
      const cap = capability();
      worker.failAddAt = failAt;

      expect(() => spawnWithCapability(cap.channel.port2)).toThrow(`listener-${failAt}-failed`);

      expect(worker.transfers[0]?.length).toBe(5);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.removeEventListener).toHaveBeenCalledTimes(failAt - 1);
      expect(cap.close).toHaveBeenCalledTimes(1);
      expect(getKernelDispatcher().getAttachmentCount()).toBe(0);
    },
  );

  it('attempts every rollback step without replacing the first failure', () => {
    const cap = capability();
    worker.failAddAt = 2;
    worker.terminate.mockImplementation(() => {
      throw new Error('terminate-cleanup-failed');
    });
    worker.removeEventListener.mockImplementation(() => {
      throw new Error('listener-cleanup-failed');
    });
    const dispatcher = getKernelDispatcher();
    const originalDetach = dispatcher.detach.bind(dispatcher);
    vi.spyOn(dispatcher, 'detach').mockImplementation((ring) => {
      originalDetach(ring);
      throw new Error('dispatcher-cleanup-failed');
    });

    let thrown: unknown;
    try {
      spawnWithCapability(cap.channel.port2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('listener-2-failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.removeEventListener).toHaveBeenCalledTimes(1);
    expect(cap.close).toHaveBeenCalledTimes(1);
    expect(dispatcher.getAttachmentCount()).toBe(0);
  });

  it('publishes no ProcessManager record when spawn fails', () => {
    const cap = capability();
    worker.failAddAt = 1;
    const manager = new ProcessManager();

    expect(() =>
      manager.spawnWorker('node', {
        entry: {
          kind: 'url',
          url: 'https://example.invalid/entry.js',
          capabilityPorts: { 'test.capability': cap.channel.port2 },
        } as WorkerEntryDescriptor,
        argv: ['rifty', '/entry.js'],
        env: {},
        cwd: '/workspace',
      }),
    ).toThrow('listener-1-failed');
    expect(manager.list()).toEqual([]);
  });
});
