import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnRuntime } from './host.ts';
import type { HostMessage, WorkerMessage } from './protocol.ts';

type Listener<T> = (event: MessageEvent<T>) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly sent: HostMessage[] = [];
  readonly listeners = {
    message: new Set<Listener<WorkerMessage>>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };
  terminated = false;

  constructor(
    readonly url: string,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: HostMessage): void {
    this.sent.push(message);
  }

  addEventListener(type: 'message', listener: Listener<WorkerMessage>): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: 'message' | 'error',
    listener: Listener<WorkerMessage> | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.listeners.message.add(listener as Listener<WorkerMessage>);
    } else {
      this.listeners.error.add(listener as (event: ErrorEvent) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerMessage): void {
    const event = { data: message } as MessageEvent<WorkerMessage>;
    for (const listener of this.listeners.message) listener(event);
  }

  crash(message: string): void {
    const event = { message } as ErrorEvent;
    for (const listener of this.listeners.error) listener(event);
  }
}

function installFakeWorker(): void {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
}

function fakeWorker(index: number): FakeWorker {
  const worker = FakeWorker.instances[index];
  if (!worker) throw new Error(`Missing fake worker ${index}`);
  return worker;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('spawnRuntime fs controller', () => {
  it('posts correlated readFile/writeFile fs messages', async () => {
    installFakeWorker();
    const runtime = spawnRuntime({ workerUrl: '/worker.js' });

    const read = runtime.fs.readFile('/a.txt', 'utf8');
    const write = runtime.fs.writeFile('/b.bin', Uint8Array.from([1, 2]));
    const worker = fakeWorker(0);

    expect(worker.sent).toEqual([
      { type: 'fs', request: { id: 1, op: 'readFile', path: '/a.txt', encoding: 'utf8' } },
      {
        type: 'fs',
        request: { id: 2, op: 'writeFile', path: '/b.bin', data: Uint8Array.from([1, 2]) },
      },
    ]);

    worker.emit({ type: 'fs-result', result: { id: 2, ok: true } });
    worker.emit({ type: 'fs-result', result: { id: 1, ok: true, value: 'alpha' } });

    await expect(read).resolves.toBe('alpha');
    await expect(write).resolves.toBeUndefined();
  });

  it('rejects readFile when fs-result fails', async () => {
    installFakeWorker();
    const runtime = spawnRuntime({ workerUrl: '/worker.js' });
    const read = runtime.fs.readFile('/missing.txt');

    fakeWorker(0).emit({
      type: 'fs-result',
      result: {
        id: 1,
        ok: false,
        error: {
          name: 'VfsError',
          message: 'ENOENT: /missing.txt',
          code: 'ENOENT',
          path: '/missing.txt',
        },
      },
    });

    await expect(read).rejects.toMatchObject({
      name: 'VfsError',
      message: 'ENOENT: /missing.txt',
      code: 'ENOENT',
      path: '/missing.txt',
    });
  });

  it('rejects pending fs calls on reset, worker error, and dispose', async () => {
    installFakeWorker();
    const runtime = spawnRuntime({ workerUrl: '/worker.js' });

    const resetRead = runtime.fs.readFile('/reset.txt');
    await runtime.reset();
    await expect(resetRead).rejects.toMatchObject({ name: 'WorkerTerminated' });

    const errorRead = runtime.fs.readFile('/error.txt');
    fakeWorker(1).crash('boom');
    await expect(errorRead).rejects.toMatchObject({ code: 'WORKER_CRASHED' });

    const disposable = spawnRuntime({ workerUrl: '/worker.js' });
    const disposeRead = disposable.fs.readFile('/dispose.txt');
    disposable.dispose();
    await expect(disposeRead).rejects.toMatchObject({ name: 'WorkerTerminated' });
  });

  it('rejects fs calls issued after teardown with a typed error', async () => {
    installFakeWorker();
    const runtime = spawnRuntime({ workerUrl: '/worker.js' });
    runtime.dispose();

    await expect(runtime.fs.readFile('/late.txt')).rejects.toMatchObject({
      name: 'WorkerTerminated',
      code: 'RUNTIME_NOT_RUNNING',
    });
    await expect(runtime.fs.writeFile('/late.txt', 'x')).rejects.toMatchObject({
      name: 'WorkerTerminated',
      code: 'RUNTIME_NOT_RUNNING',
    });
  });
});
