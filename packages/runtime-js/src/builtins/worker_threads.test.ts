/**
 * Same-realm fallback contract for `worker_threads.Worker`.
 *
 * When the kernel.spawnWorker capability isn't wired (no SAB / no
 * `kernelWorkerUrl`), the fallback used to be silent — review found this
 * violates the "no silent stubs" rule. Now we emit one console.warn per
 * module import with a clear remediation hint. Functional behaviour
 * (workerData/parentPort propagation) is unchanged and stays covered by
 * `tests/conformance/builtins/worker_threads.test.ts`.
 */
import {
  type ProcessHandle,
  type SpawnWorkerSpec,
  globalProcessManager,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { resetNodeEntryWorkerUrl, setNodeEntryWorkerUrl } from './node-entry-url.ts';
import { setProcessCwd } from './process.ts';
import workerThreadsModule, {
  Worker,
  _resetFallbackWarnState,
  _resetThreadIdCounterForTests,
} from './worker_threads.ts';
import '../module-loader/loader.ts';

let warnSpy: ReturnType<typeof vi.spyOn>;
type Coi = { crossOriginIsolated?: boolean };
type WorkerProcessHandle = Extract<ProcessHandle, { kind: 'worker' }>;
type ProcessWithWorkerIpc = NodeJS.Process & {
  send?: (message: unknown) => unknown;
};

beforeEach(() => {
  _resetFallbackWarnState();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  (globalThis as Coi).crossOriginIsolated = false;
  resetNodeEntryWorkerUrl();
  setProcessCwd('/workspace');
  resetSyncMirror();
});

describe('worker_threads same-realm fallback warning (no silent stubs)', () => {
  it('warns on the first Worker that hits the same-realm fallback', async () => {
    writeFileSync('/w-warn-1.js', 'parentPort.postMessage("ok");');
    const w = new Worker('/w-warn-1.js');
    await new Promise<void>((resolve) => w.on('exit', () => resolve()));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/\[rifty:worker_threads\]/);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Falling back to same-realm/);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/setKernelWorkerUrl/);
  });

  it('does not warn again on subsequent Workers (one-shot guard)', async () => {
    writeFileSync('/w-warn-2.js', 'parentPort.postMessage("ok");');
    const w1 = new Worker('/w-warn-2.js');
    await new Promise<void>((resolve) => w1.on('exit', () => resolve()));
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const w2 = new Worker('/w-warn-2.js');
    await new Promise<void>((resolve) => w2.on('exit', () => resolve()));
    // Still 1 — the second worker must not re-warn.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('runs ESM worker scripts with live parentPort, workerData, and onmessage', async () => {
    writeFileSync(
      '/w-esm.mjs',
      `
import { isMainThread, parentPort, threadId, workerData } from 'node:worker_threads';

parentPort.postMessage({ type: 'ready', isMainThread, threadId, workerData });
parentPort.on('message', (data) => {
  parentPort.postMessage({ type: 'echo', data, isMainThread, threadId, workerData });
});
`,
    );

    const worker = new Worker(new URL('file:///w-esm.mjs'), {
      workerData: { answer: 42 },
    });
    expect(worker.unref()).toBe(worker);
    expect(worker.ref()).toBe(worker);

    const messages: unknown[] = [];
    const nextMessage = () =>
      new Promise<unknown>((resolve) => {
        worker.onmessage = ({ data }) => {
          messages.push(data);
          resolve(data);
        };
      });

    const readyPromise = nextMessage();
    const ready = await readyPromise;
    expect(ready).toEqual({
      type: 'ready',
      isMainThread: false,
      threadId: expect.any(Number),
      workerData: { answer: 42 },
    });

    const echoPromise = nextMessage();
    worker.postMessage('ping');
    expect(await echoPromise).toEqual({
      type: 'echo',
      data: 'ping',
      isMainThread: false,
      threadId: expect.any(Number),
      workerData: { answer: 42 },
    });
    expect(messages).toHaveLength(2);

    await worker.terminate();
  });

  it('buffers parent messages posted before an ESM worker installs handlers', async () => {
    writeFileSync(
      '/w-buffered-message.mjs',
      `
import { parentPort } from 'node:worker_threads';

globalThis.onmessage = ({ data }) => {
  parentPort.postMessage({ type: 'got', data });
};
`,
    );

    const worker = new Worker('/w-buffered-message.mjs');
    const received = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker message was not buffered')), 200);
      worker.once('message', (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    worker.postMessage({ kind: 'early' });

    expect(await received).toEqual({ type: 'got', data: { kind: 'early' } });
    await worker.terminate();
  });

  it('uses kernel-backed workers when SAB and worker URLs are configured', async () => {
    const sent: unknown[] = [];
    let capturedSpec: SpawnWorkerSpec | undefined;
    const fakeHandle = makeFakeWorkerHandle(sent);
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, spec) => {
      capturedSpec = spec;
      return fakeHandle;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    setNodeEntryWorkerUrl('https://rifty.test/node-entry.js');
    setProcessCwd('/project');

    const worker = new Worker(
      '/workspace/node_modules/@rolldown/binding-wasm32-wasi/wasi-worker.mjs',
      {
        env: { ROLLDOWN_TEST: '1' },
      },
    );
    worker.postMessage({ __emnapi__: { type: 'load' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(capturedSpec).toMatchObject({
      entry: { kind: 'url', url: 'https://rifty.test/node-entry.js' },
      argv: ['rifty', '/workspace/node_modules/@rolldown/binding-wasm32-wasi/wasi-worker.mjs'],
      cwd: '/project',
      serve: true,
    });
    expect(capturedSpec?.env).toMatchObject({
      RIFTY_REMOTE_FS: '1',
      RIFTY_WORKER_THREADS: '1',
      RIFTY_WORKER_THREAD_ID: String(worker.threadId),
      ROLLDOWN_TEST: '1',
    });
    expect(sent).toEqual([{ __emnapi__: { type: 'load' } }]);

    await worker.terminate();
  });

  it('throws loudly instead of JSON-shaping non-plain workerData on the kernel path', async () => {
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, _spec) =>
      makeFakeWorkerHandle([]),
    );

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    setNodeEntryWorkerUrl('https://rifty.test/node-entry.js');

    const worker = new Worker('/workspace/w.mjs', { workerData: new Date(0) });
    const error = await new Promise<unknown>((resolve) => {
      worker.once('error', resolve);
    });

    expect(error).toEqual(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'worker_threads.workerData.structuredClone',
      }),
    );
    expect(globalProcessManager.spawnWorker).not.toHaveBeenCalled();
  });

  it('exposes parentPort and workerData inside a kernel-backed worker child', () => {
    const proc = globalThis.process as ProcessWithWorkerIpc;
    const originalSend = proc.send;
    const originalOn = proc.on;
    const sent: unknown[] = [];
    let capturedMessageHandler: ((message: unknown) => void) | undefined;

    proc.env.RIFTY_WORKER_THREADS = '1';
    proc.env.RIFTY_WORKER_THREAD_ID = '77';
    proc.env.RIFTY_WORKER_DATA_JSON = '{"mode":"rolldown"}';
    proc.send = (message: unknown) => {
      sent.push(message);
      return true;
    };
    proc.on = ((event: string | symbol, handler: (...args: unknown[]) => void) => {
      if (event === 'message') {
        capturedMessageHandler = handler as (message: unknown) => void;
        return proc;
      }
      return originalOn.call(proc, event, handler as never);
    }) as NodeJS.Process['on'];

    try {
      _resetFallbackWarnState();
      const wt = workerThreadsModule as {
        isMainThread: boolean;
        parentPort: EventEmitter & { postMessage(message: unknown): void };
        threadId: number;
        workerData: unknown;
      };
      const received: unknown[] = [];
      wt.parentPort.on('message', (message) => {
        received.push(message);
      });

      expect(wt.isMainThread).toBe(false);
      expect(wt.threadId).toBe(77);
      expect(wt.workerData).toEqual({ mode: 'rolldown' });
      wt.parentPort.postMessage({ from: 'child' });
      capturedMessageHandler?.({ from: 'parent' });

      expect(sent).toEqual([{ from: 'child' }]);
      expect(received).toEqual([{ from: 'parent' }]);
    } finally {
      proc.env.RIFTY_WORKER_THREADS = undefined;
      proc.env.RIFTY_WORKER_THREAD_ID = undefined;
      proc.env.RIFTY_WORKER_DATA_JSON = undefined;
      proc.send = originalSend;
      proc.on = originalOn;
      _resetFallbackWarnState();
    }
  });
});

const onceEvent = <T = unknown>(emitter: EventEmitter, event: string): Promise<T> =>
  new Promise<T>((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args[0] as T)));

describe('worker_threads Node parity (threadId / online / terminate)', () => {
  it('numbers threadId like Node: main thread 0, workers 1, 2, …', async () => {
    // Main-thread view (what `require('node:worker_threads').threadId` returns).
    expect(workerThreadsModule.threadId).toBe(0);

    _resetThreadIdCounterForTests();
    writeFileSync('/w-tid.js', 'parentPort.postMessage("ok");');
    const w1 = new Worker('/w-tid.js');
    const w2 = new Worker('/w-tid.js');
    // Node assigns the first Worker threadId 1 (NOT 0, which is the main thread).
    expect(w1.threadId).toBe(1);
    expect(w2.threadId).toBe(2);
    await Promise.all([onceEvent(w1, 'exit'), onceEvent(w2, 'exit')]);
  });

  it('emits "online" before "exit" (Node Worker lifecycle event)', async () => {
    writeFileSync('/w-online.js', 'parentPort.postMessage("ok");');
    const w = new Worker('/w-online.js');
    const order: string[] = [];
    w.on('online', () => order.push('online'));
    w.on('exit', () => order.push('exit'));
    await onceEvent(w, 'exit');
    expect(order).toEqual(['online', 'exit']);
  });

  it('terminate() with no argument resolves and exits with code 1 (Node parity)', async () => {
    // A worker that keeps a message listener stays alive until we terminate it,
    // so the exit code is OUR terminate() default, not a natural 0 completion.
    writeFileSync(
      '/w-term.mjs',
      `import { parentPort } from 'node:worker_threads';\nparentPort.on('message', () => {});\n`,
    );
    const w = new Worker('/w-term.mjs');
    await onceEvent(w, 'online');
    const exited = onceEvent<number>(w, 'exit');
    const code = await w.terminate();
    expect(code).toBe(1);
    expect(await exited).toBe(1);
  });
});

function makeFakeWorkerHandle(sent: unknown[]): WorkerProcessHandle {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = new EventEmitter();
  const handle = Object.assign(new EventEmitter(), {
    kind: 'worker' as const,
    pid: 2,
    ppid: 1,
    command: 'node',
    exitCode: null as number | null,
    signalCode: null as string | null,
    ports: {} as WorkerProcessHandle['ports'],
    cwd: '/workspace',
    setCwd(this: { cwd: string }, next: string): void {
      this.cwd = next;
    },
    stdout(): ReturnType<WorkerProcessHandle['stdout']> {
      return stdout as unknown as ReturnType<WorkerProcessHandle['stdout']>;
    },
    stderr(): ReturnType<WorkerProcessHandle['stderr']> {
      return stderr as unknown as ReturnType<WorkerProcessHandle['stderr']>;
    },
    stdin(): ReturnType<WorkerProcessHandle['stdin']> {
      return stdin as unknown as ReturnType<WorkerProcessHandle['stdin']>;
    },
    send(message: unknown): boolean {
      sent.push(message);
      return true;
    },
    disconnect(this: EventEmitter): void {
      this.emit('disconnect');
    },
    kill(
      this: EventEmitter & { exitCode: number | null; signalCode: string | null },
      signal = 'SIGTERM',
    ): void {
      this.signalCode = signal;
      this.exitCode = 1;
      this.emit('exit', 1, signal);
    },
  });
  return handle as unknown as WorkerProcessHandle;
}
