import { Writable } from '@riftydev/io';
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
  publishKernelEntryBootstrap,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  buildNodeEntryWorkerEntry,
} from './node-entry-runtime-config.ts';
import * as nodeEntryUrl from './node-entry-url.ts';
import { NodeProcess, setProcessCwd } from './process.ts';
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
type NodeEntryUrlContract = typeof nodeEntryUrl & {
  configureNodeEntryWorker(url: string | URL, runtimeEnv: Readonly<Record<string, string>>): void;
};

const { resetNodeEntryWorkerUrl, setNodeEntryWorkerUrl } = nodeEntryUrl;
const configureNodeEntryWorker = (nodeEntryUrl as NodeEntryUrlContract).configureNodeEntryWorker;
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const HOST_RUNTIME = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
  RIFTY_NODE_ENTRY_WORKER_URL: 'https://rifty.test/node-entry.js',
  RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
});

beforeEach(() => {
  _resetFallbackWarnState();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  (globalThis as Coi).crossOriginIsolated = false;
  publishKernelEntryBootstrap(null);
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

  it('runs ESM worker scripts with live parentPort, workerData, and Node message events', async () => {
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
        worker.once('message', (data) => {
          messages.push(data);
          resolve(data);
        });
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

  it("delivers one kernel child frame once through emnapi's Node bridge", async () => {
    const fakeHandle = makeFakeWorkerHandle([]);
    vi.spyOn(globalProcessManager, 'spawnWorker').mockReturnValue(fakeHandle);

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);
    const parent = new NodeProcess();

    await withProcessGlobal(parent, async () => {
      const worker = new Worker('/workspace/w-emnapi-message.mjs');
      const online = new Promise<void>((resolve) => worker.once('online', () => resolve()));
      const browserExpando = worker as unknown as {
        onmessage?: (event: { readonly data: unknown }) => void;
      };
      const received: unknown[] = [];

      // @emnapi/wasi-threads detects Node and installs this exact bridge after
      // assigning its browser-shaped handler as an ordinary expando. Real Node
      // emits only the EventEmitter event, so the handler runs once.
      browserExpando.onmessage = ({ data }) => received.push(data);
      worker.on('message', (data) => browserExpando.onmessage?.({ data }));

      await online;
      fakeHandle.emit('message', { type: 'spawn-thread', startArg: 41 });

      expect(received).toEqual([{ type: 'spawn-thread', startArg: 41 }]);
      await worker.terminate();
    });
  });

  it('keeps kernel construction failures on the asynchronous error surface', async () => {
    const constructionError = new Error('kernel spawn failed');
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(() => {
      throw constructionError;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);
    const parent = new NodeProcess();

    await withProcessGlobal(parent, async () => {
      const errors: unknown[] = [];
      const worker = new Worker('/workspace/w-construction-error.mjs');
      worker.on('error', (error) => errors.push(error));

      expect(errors).toEqual([]);
      await Promise.resolve();
      expect(errors).toEqual([constructionError]);
    });
  });

  it("delivers one kernel construction fault once through emnapi's Node bridge", async () => {
    const constructionError = new Error('kernel spawn failed once');
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(() => {
      throw constructionError;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);
    const parent = new NodeProcess();

    await withProcessGlobal(parent, async () => {
      const worker = new Worker('/workspace/w-emnapi-error.mjs');
      const browserExpando = worker as unknown as { onerror?: (error: unknown) => void };
      const received: unknown[] = [];
      browserExpando.onerror = (error) => received.push(error);
      worker.on('error', (error) => browserExpando.onerror?.(error));

      await Promise.resolve();

      expect(received).toEqual([constructionError]);
    });
  });

  it('snapshots omitted env and cwd for a kernel-backed worker', async () => {
    const sent: unknown[] = [];
    let capturedSpec: SpawnWorkerSpec | undefined;
    const fakeHandle = makeFakeWorkerHandle(sent);
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, spec) => {
      capturedSpec = spec;
      return fakeHandle;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);
    const parent = new NodeProcess();
    parent.env.PARENT_ONLY = 'parent';
    parent.env.RIFTY_SQLITE_WASM_URL = 'https://parent.test/sqlite.wasm';
    setProcessCwd('/parent');

    await withProcessGlobal(parent, async () => {
      const worker = new Worker('/workspace/worker.mjs');
      parent.env.PARENT_ONLY = 'mutated';
      setProcessCwd('/mutated');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(capturedSpec).toMatchObject({
        cwd: '/parent',
        env: {
          PARENT_ONLY: 'parent',
        },
      });
      expect(capturedSpec?.env).toEqual({
        PARENT_ONLY: 'parent',
        RIFTY_SQLITE_WASM_URL: 'https://parent.test/sqlite.wasm',
      });
      expect(capturedSpec?.entry).toEqual(
        buildNodeEntryWorkerEntry('https://rifty.test/node-entry.js', HOST_RUNTIME, {
          kind: 'worker-thread',
          remoteFs: true,
          threadId: worker.threadId,
        }),
      );
      await worker.terminate();
    });
  });

  it('inherits the parent remote-FS root while the worker process spec stays public', async () => {
    let capturedSpec: SpawnWorkerSpec | undefined;
    const fakeHandle = makeFakeWorkerHandle([]);
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, spec) => {
      capturedSpec = spec;
      return fakeHandle;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);
    const parentEntry = buildNodeEntryWorkerEntry(
      'https://rifty.test/node-entry.js',
      HOST_RUNTIME,
      {
        kind: 'program',
        bin: false,
        remoteFs: true,
        remoteFsRoot: REMOTE_FS_ROOT,
        nodeServe: true,
      },
    );
    publishKernelEntryBootstrap(parentEntry.bootstrap ?? null);
    const parent = new NodeProcess();
    setProcessCwd('/');

    await withProcessGlobal(parent, async () => {
      const worker = new Worker('/src/worker.mjs');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(capturedSpec).toMatchObject({
        argv: ['rifty', '/src/worker.mjs'],
        cwd: '/',
        entry: {
          bootstrap: {
            payload: {
              launch: { kind: 'worker-thread', remoteFsRoot: REMOTE_FS_ROOT },
            },
          },
        },
      });
      expect(
        JSON.stringify({
          argv: capturedSpec?.argv,
          cwd: capturedSpec?.cwd,
          env: capturedSpec?.env,
        }),
      ).not.toContain(REMOTE_FS_ROOT);
      await worker.terminate();
    });
  });

  it('uses explicit env as an exact replacement while host/control metadata stays out of band', async () => {
    const sent: unknown[] = [];
    let capturedSpec: SpawnWorkerSpec | undefined;
    const fakeHandle = makeFakeWorkerHandle(sent);
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, spec) => {
      capturedSpec = spec;
      return fakeHandle;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);
    const parent = new NodeProcess();
    parent.env.PARENT_ONLY = 'parent';
    setProcessCwd('/project');

    await withProcessGlobal(parent, async () => {
      const worker = new Worker(
        '/workspace/node_modules/@rolldown/binding-wasm32-wasi/wasi-worker.mjs',
        {
          env: {
            ROLLDOWN_TEST: '1',
            RIFTY_BIN: 'guest-visible-not-authoritative',
            RIFTY_SQLITE_WASM_URL: 'https://user.test/sqlite.wasm',
            RIFTY_REMOTE_FS: 'user-poison',
            RIFTY_WORKER_THREADS: 'user-poison',
          },
        },
      );
      worker.postMessage({ __emnapi__: { type: 'load' } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warnSpy).not.toHaveBeenCalled();
      expect(capturedSpec).toMatchObject({
        argv: ['rifty', '/workspace/node_modules/@rolldown/binding-wasm32-wasi/wasi-worker.mjs'],
        cwd: '/project',
        serve: true,
      });
      expect(capturedSpec?.env).toEqual({
        ROLLDOWN_TEST: '1',
        RIFTY_BIN: 'guest-visible-not-authoritative',
        RIFTY_SQLITE_WASM_URL: 'https://user.test/sqlite.wasm',
        RIFTY_REMOTE_FS: 'user-poison',
        RIFTY_WORKER_THREADS: 'user-poison',
      });
      expect(capturedSpec?.entry).toEqual(
        buildNodeEntryWorkerEntry('https://rifty.test/node-entry.js', HOST_RUNTIME, {
          kind: 'worker-thread',
          remoteFs: true,
          threadId: worker.threadId,
        }),
      );
      expect(sent).toEqual([{ __emnapi__: { type: 'load' } }]);

      const child = seededWorkerProcess(capturedSpec?.env ?? {});
      const childStdin = child.stdin as NodeProcess['stdin'] & {
        pipe(destination: unknown): unknown;
        setRawMode(enabled: boolean): unknown;
      };
      expect(() => childStdin.pipe(new Writable())).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'process.stdin.pipe',
        }),
      );
      expect(() => childStdin.setRawMode(true)).toThrow(NotImplementedError);

      await worker.terminate();
    });
  });

  it('fails loud before kernel spawn when only the URL seam was configured', async () => {
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, _spec) =>
      makeFakeWorkerHandle([]),
    );

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    setNodeEntryWorkerUrl('https://rifty.test/node-entry.js');

    const errors: unknown[] = [];
    const worker = new Worker('/workspace/w.mjs');
    worker.on('error', (error) => errors.push(error));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/node-entry.*bootstrap config.*not configured/i),
      }),
    ]);
    expect(globalProcessManager.spawnWorker).not.toHaveBeenCalled();
  });

  it('throws loudly instead of JSON-shaping non-plain workerData on the kernel path', async () => {
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, _spec) =>
      makeFakeWorkerHandle([]),
    );

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);

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

  it('loud-rejects -0 workerData instead of silently dropping the sign (JSON would)', async () => {
    // JSON.stringify(-0) === '0' — a silent sign loss vs Node's structuredClone
    // (which preserves -0). The guard must throw, not corrupt + spawn.
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((_command, _spec) =>
      makeFakeWorkerHandle([]),
    );

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', HOST_RUNTIME);

    const worker = new Worker('/workspace/w.mjs', { workerData: { z: -0 } });
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

    proc.env.RIFTY_WORKER_THREADS = 'guest-poison';
    proc.env.RIFTY_WORKER_THREAD_ID = '999';
    proc.env.RIFTY_WORKER_DATA_JSON = '{"mode":"guest-poison"}';
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: HOST_RUNTIME,
        launch: {
          kind: 'worker-thread',
          remoteFs: true,
          threadId: 77,
          workerDataJson: '{"mode":"rolldown"}',
        },
      },
    });
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
      publishKernelEntryBootstrap(null);
      proc.send = originalSend;
      proc.on = originalOn;
      _resetFallbackWarnState();
    }
  });
});

const onceEvent = <T = unknown>(emitter: EventEmitter, event: string): Promise<T> =>
  new Promise<T>((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args[0] as T)));

describe('worker_threads Node parity (threadId / online / terminate)', () => {
  it('keeps unsupported eval and data-URL success paths loud', async () => {
    expect(() => new Worker('parentPort.postMessage("ok")', { eval: true })).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'worker_threads.Worker.eval',
      }),
    );

    const worker = new Worker(new URL('data:text/javascript,0'));
    const error = onceEvent<NotImplementedError>(worker, 'error');
    const exit = onceEvent<number>(worker, 'exit');
    expect(await error).toEqual(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'worker_threads.Worker.data-url',
      }),
    );
    expect(await exit).toBe(1);
  });

  it('keeps the eval filename error ahead of the unsupported eval gap', () => {
    expect(() => new Worker(new URL('file:///w-eval.js'), { eval: true })).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' }),
    );
  });

  it('rejects an invalid string entry before allocating a threadId', async () => {
    _resetThreadIdCounterForTests();
    expect(() => new Worker('FiLe:///w-invalid.js')).toThrow(
      expect.objectContaining({ code: 'ERR_WORKER_PATH' }),
    );

    writeFileSync('/w-after-invalid.js', ';');
    const worker = new Worker('/w-after-invalid.js');
    const exited = onceEvent(worker, 'exit');
    expect(worker.threadId).toBe(1);
    await exited;
  });

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

  it('a post-exit terminate() resolves with undefined (Node: the worker handle is gone)', async () => {
    // Verified vs Node v24: terminate() on an already-exited worker resolves
    // `undefined` (PromiseResolve() when kHandle === null) — NOT the exit code and
    // NOT the caller's argument. The natural exit still fires 'exit' 0 first.
    writeFileSync('/w-natural-exit.js', 'parentPort.postMessage("ok");');
    const w = new Worker('/w-natural-exit.js');
    expect(await onceEvent<number>(w, 'exit')).toBe(0);
    expect(await w.terminate()).toBeUndefined();
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

function seededWorkerProcess(env: Readonly<Record<string, string>>): NodeProcess {
  const port = (): MessagePort => new MessageChannel().port1;
  return new NodeProcess({
    pid: 3,
    ppid: 2,
    argv: ['rifty', '/workspace/worker.mjs'],
    env,
    cwd: '/workspace',
    stdio: { stdout: port(), stderr: port(), stdin: port(), ipc: port() },
  });
}

async function withProcessGlobal<T>(process: NodeProcess, run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  Object.defineProperty(globalThis, 'process', {
    value: process,
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'process');
    } else {
      Object.defineProperty(globalThis, 'process', descriptor);
    }
  }
}
