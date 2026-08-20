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
  KERNEL_PROCESS_SPEC_KEY,
  type ProcessHandle,
  type SpawnWorkerSpec,
  type WorkerInitMessage,
  globalProcessManager,
  publishKernelEntryBootstrap,
  publishKernelProcessSpec,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeKernelWorkerPeer,
  installKernelWorkerBoundary,
} from '../internal/kernel-worker-boundary.test-helper.ts';
import { EventEmitter } from './events.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  buildNodeEntryWorkerEntry,
} from './node-entry-runtime-config.ts';
import * as nodeEntryUrl from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
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
type NodeEntryUrlContract = typeof nodeEntryUrl & {
  configureNodeEntryWorker(url: string | URL, runtimeEnv: Readonly<Record<string, string>>): void;
};

const { resetNodeEntryWorkerUrl, setNodeEntryWorkerUrl } = nodeEntryUrl;
const configureNodeEntryWorker = (nodeEntryUrl as NodeEntryUrlContract).configureNodeEntryWorker;
const REMOTE_FS_ROOT = '/.rifty/workbench/v1/projects/project-a/tree';

beforeEach(() => {
  _resetFallbackWarnState();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  (globalThis as Coi).crossOriginIsolated = false;
  publishKernelEntryBootstrap(null);
  Reflect.deleteProperty(globalThis, KERNEL_PROCESS_SPEC_KEY);
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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
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

  it('closes the public Worker lifecycle when its kernel peer dies', async () => {
    const restoreWorker = installKernelWorkerBoundary(closeKernelWorkerPeer);
    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
    const parent = new NodeProcess();

    try {
      await withProcessGlobal(parent, async () => {
        const events: unknown[] = [];
        const worker = new Worker('/workspace/w-peer-death.mjs');
        worker.on('error', (error) => events.push(['error', error]));
        worker.on('exit', (code) => events.push(['exit', code]));
        await onceEvent(worker, 'exit');

        expect(events).toEqual([
          ['error', expect.objectContaining({ message: expect.stringMatching(/peer.*closed/i) })],
          ['exit', 1],
        ]);
      });
    } finally {
      restoreWorker();
    }
  });

  it('publishes trusted stdout and stderr before a kernel-backed Worker settles', async () => {
    let publishInit!: (init: WorkerInitMessage) => void;
    const initReady = new Promise<WorkerInitMessage>((resolve) => {
      publishInit = resolve;
    });
    const restoreWorker = installKernelWorkerBoundary((init) => {
      publishInit(init as unknown as WorkerInitMessage);
    });
    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
    const parent = new NodeProcess();

    try {
      await withProcessGlobal(parent, async () => {
        const events: string[] = [];
        const worker = new Worker('/workspace/w-output-carrier.mjs');
        worker.on('stdout', (chunk) => events.push(`stdout:${decodeOutput(chunk)}`));
        worker.on('stderr', (chunk) => events.push(`stderr:${decodeOutput(chunk)}`));
        worker.on('error', () => events.push('error'));
        worker.on('exit', (code) => events.push(`exit:${String(code)}`));
        const userMessages: unknown[] = [];
        worker.on('message', (message) => userMessages.push(message));
        const exited = onceEvent<number>(worker, 'exit');

        const init = await initReady;
        const kernelHandle = (
          worker as unknown as {
            readonly workerHandle: ProcessHandle | null;
          }
        ).workerHandle;
        if (kernelHandle?.kind !== 'worker') {
          throw new Error('expected kernel-backed Worker process handle');
        }
        const controlFrames: unknown[] = [];
        kernelHandle.ports.ipc.addEventListener('message', (event) =>
          controlFrames.push(event.data),
        );
        kernelHandle.ports.ipc.start();
        const stdio = await vi.importActual<{
          bindWorkerStdioOutput(
            port: MessagePort,
            state: WorkerInitMessage['spec']['outputState'],
            output: 'stdout' | 'stderr',
            controlPort: MessagePort,
          ): { write(bytes: Uint8Array): void };
          sealWorkerOutput(state: WorkerInitMessage['spec']['outputState']): boolean;
          workerOutputAttestation(state: WorkerInitMessage['spec']['outputState']): string;
        }>('../../../kernel/src/worker-stdio-drain.ts');
        stdio
          .bindWorkerStdioOutput(
            init.spec.stdio.stdout,
            init.spec.outputState,
            'stdout',
            init.spec.stdio.ipc,
          )
          .write(new TextEncoder().encode('thread-out'));
        stdio
          .bindWorkerStdioOutput(
            init.spec.stdio.stderr,
            init.spec.outputState,
            'stderr',
            init.spec.stdio.ipc,
          )
          .write(new TextEncoder().encode('thread-err'));
        stdio.sealWorkerOutput(init.spec.outputState);
        closeKernelWorkerPeer(init);

        expect(await exited).toBe(1);
        expect(events).toContain('stdout:thread-out');
        expect(events).toContain('stderr:thread-err');
        expect(events.indexOf('stdout:thread-out')).toBeLessThan(events.indexOf('error'));
        expect(events.indexOf('stderr:thread-err')).toBeLessThan(events.indexOf('error'));
        expect(events.at(-1)).toBe('exit:1');
        expect(controlFrames).toStrictEqual([
          {
            kind: 'control:stdio-order',
            stream: 'stdout',
            order: 0,
            attestation: stdio.workerOutputAttestation(init.spec.outputState),
          },
          {
            kind: 'control:stdio-order',
            stream: 'stderr',
            order: 1,
            attestation: stdio.workerOutputAttestation(init.spec.outputState),
          },
          { kind: 'control:peer-closing' },
        ]);
        expect(userMessages).toEqual([]);
      });
    } finally {
      restoreWorker();
    }
  });

  it("delivers one kernel construction fault once through emnapi's Node bridge", async () => {
    const constructionError = new Error('kernel spawn failed once');
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(() => {
      throw constructionError;
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
    });
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
        buildNodeEntryWorkerEntry(
          'https://rifty.test/node-entry.js',
          { RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm' },
          {
            kind: 'worker-thread',
            remoteFs: true,
            threadId: worker.threadId,
          },
        ),
      );
      await worker.terminate();
    });
  });

  it('rejects inherited eval execArgv before allocating a lossy worker thread', async () => {
    _resetThreadIdCounterForTests();
    const spawn = vi
      .spyOn(globalProcessManager, 'spawnWorker')
      .mockImplementation(() => makeFakeWorkerHandle([]));
    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
    const parentEntry = buildNodeEntryWorkerEntry(
      'https://rifty.test/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js' },
      {
        kind: 'eval',
        source: '42',
        print: false,
        execArgv: ['-e', '42'],
        remoteFs: true,
        remoteFsRoot: REMOTE_FS_ROOT,
      },
    );
    publishKernelEntryBootstrap(parentEntry.bootstrap ?? null);
    const parent = new NodeProcess();
    parent.execArgv.length = 0;
    let worker: Worker | undefined;
    let thrown: unknown;

    await withProcessGlobal(parent, async () => {
      try {
        worker = new Worker('/workspace/worker.mjs');
      } catch (error) {
        thrown = error;
      }
      await Promise.resolve();
      await worker?.terminate();
    });

    expect(thrown).toEqual(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'worker_threads.Worker.execArgv',
      }),
    );
    expect(spawn).not.toHaveBeenCalled();

    publishKernelEntryBootstrap(null);
    (globalThis as Coi).crossOriginIsolated = false;
    writeFileSync('/worker-after-inherited-gap.js', ';');
    const valid = new Worker('/worker-after-inherited-gap.js');
    const exit = onceEvent(valid, 'exit');
    expect(valid.threadId).toBe(1);
    await exit;
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects an explicit execArgv override before allocating a worker thread', async () => {
    _resetThreadIdCounterForTests();
    const spawn = vi
      .spyOn(globalProcessManager, 'spawnWorker')
      .mockImplementation(() => makeFakeWorkerHandle([]));
    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });

    expect(() => new Worker('/workspace/worker.mjs', { execArgv: [] })).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'worker_threads.Worker.execArgv',
      }),
    );
    expect(spawn).not.toHaveBeenCalled();

    (globalThis as Coi).crossOriginIsolated = false;
    writeFileSync('/worker-after-explicit-gap.js', ';');
    const valid = new Worker('/worker-after-explicit-gap.js');
    const exit = onceEvent(valid, 'exit');
    expect(valid.threadId).toBe(1);
    await exit;
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps bootstrap ancestry when guest pid fields and the public spec are poisoned', async () => {
    let identity: { readonly pid: number; readonly ppid: number } | undefined;
    const restoreWorker = installKernelWorkerBoundary((init) => {
      identity = { pid: init.spec.pid, ppid: init.spec.ppid };
      closeKernelWorkerPeer(init);
    });

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
    const channels = Array.from({ length: 4 }, () => new MessageChannel());
    const trustedSpec = {
      pid: 41,
      ppid: 7,
      argv: ['rifty', '/workspace/parent.mjs'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: { write: (bytes: Uint8Array) => channels[0]!.port1.postMessage(bytes) },
        stderr: { write: (bytes: Uint8Array) => channels[1]!.port1.postMessage(bytes) },
        stdin: channels[2]!.port1,
        ipc: channels[3]!.port1,
      },
    };
    const parent = new NodeProcess(trustedSpec);
    parent.pid = 98_765;
    parent.ppid = 98_764;
    publishKernelProcessSpec({ ...trustedSpec, pid: 87_654, ppid: 87_653 });
    const guestReplacement = Object.assign(Object.create(parent) as Record<string, unknown>, {
      pid: 76_543,
      ppid: 76_542,
      argv: ['poison', '/poison/parent.mjs'],
      env: { POISON: '1' },
      cwd: () => '/poison',
    });
    try {
      await withProcessGlobal(
        guestReplacement,
        async () => {
          const worker = new Worker('/workspace/w-trusted-parent.mjs');
          worker.on('error', () => {});
          await onceEvent(worker, 'exit');

          expect(identity).toEqual({ pid: 41, ppid: 7 });
        },
        parent,
      );
    } finally {
      restoreWorker();
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
    }
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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js',
    });
    const parentEntry = buildNodeEntryWorkerEntry(
      'https://rifty.test/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
      RIFTY_REMOTE_FS: 'host-poison',
      RIFTY_WORKER_THREADS: 'host-poison',
    });
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
        buildNodeEntryWorkerEntry(
          'https://rifty.test/node-entry.js',
          {
            RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
            RIFTY_REMOTE_FS: 'host-poison',
            RIFTY_WORKER_THREADS: 'host-poison',
          },
          {
            kind: 'worker-thread',
            remoteFs: true,
            threadId: worker.threadId,
          },
        ),
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

  it('routes terminate() through an immediate physical worker kill', async () => {
    const killSignals: string[] = [];
    const fakeHandle = makeFakeWorkerHandle([], killSignals);
    vi.spyOn(globalProcessManager, 'spawnWorker').mockReturnValue(fakeHandle);

    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
    const parent = new NodeProcess();

    await withProcessGlobal(parent, async () => {
      const worker = new Worker('/workspace/w-immediate-terminate.mjs');
      await onceEvent(worker, 'online');

      expect(await worker.terminate()).toBe(1);
      expect(killSignals).toEqual(['SIGKILL']);
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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });

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
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });

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

  it('exposes parentPort without exposing process IPC inside a kernel worker child', async () => {
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: { RIFTY_KERNEL_WORKER_URL: 'kernel.js' },
        launch: {
          kind: 'worker-thread',
          remoteFs: true,
          threadId: 77,
          workerDataJson: '{"mode":"rolldown"}',
        },
      },
    });
    const ipc = new MessageChannel();
    const port = (): MessagePort => new MessageChannel().port1;
    const writer = (target: MessagePort) => ({
      write: (bytes: Uint8Array) => target.postMessage(bytes),
    });
    const proc = new NodeProcess({
      pid: 3,
      ppid: 2,
      argv: ['rifty', '/workspace/worker.mjs'],
      env: {
        RIFTY_WORKER_THREADS: 'guest-poison',
        RIFTY_WORKER_THREAD_ID: '999',
        RIFTY_WORKER_DATA_JSON: '{"mode":"guest-poison"}',
      },
      cwd: '/workspace',
      stdio: {
        stdout: writer(port()),
        stderr: writer(port()),
        stdin: port(),
        ipc: ipc.port1,
      },
    });
    const sent: unknown[] = [];
    ipc.port2.onmessage = (event) => sent.push(event.data);
    ipc.port2.start();

    await withProcessGlobal(proc, async () => {
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
      expect(typeof proc.send).toBe('undefined');
      expect(typeof proc.disconnect).toBe('undefined');
      expect(typeof proc.connected).toBe('undefined');
      expect(typeof proc.channel).toBe('undefined');
      wt.parentPort.postMessage({ from: 'child' });
      ipc.port2.postMessage({ kind: 'ipc:message', payload: { from: 'parent' } });

      await vi.waitFor(() =>
        expect(sent).toEqual([{ kind: 'ipc:message', payload: { from: 'child' } }]),
      );
      await vi.waitFor(() => expect(received).toEqual([{ from: 'parent' }]));
      _resetFallbackWarnState();
    });
    ipc.port1.close();
    ipc.port2.close();
  });
});

const onceEvent = <T = unknown>(emitter: EventEmitter, event: string): Promise<T> =>
  new Promise<T>((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args[0] as T)));

function decodeOutput(chunk: unknown): string {
  if (!(chunk instanceof Uint8Array)) throw new TypeError('expected Uint8Array output');
  return new TextDecoder().decode(chunk);
}

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

function makeFakeWorkerHandle(sent: unknown[], killSignals: string[] = []): WorkerProcessHandle {
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
    ): boolean {
      killSignals.push(signal);
      this.signalCode = signal;
      this.exitCode = 1;
      this.emit('exit', 1, signal);
      return true;
    },
  });
  return handle as unknown as WorkerProcessHandle;
}

function seededWorkerProcess(env: Readonly<Record<string, string>>): NodeProcess {
  const port = (): MessagePort => new MessageChannel().port1;
  const writer = (target: MessagePort) => ({
    write: (bytes: Uint8Array) => target.postMessage(bytes),
  });
  return new NodeProcess({
    pid: 3,
    ppid: 2,
    argv: ['rifty', '/workspace/worker.mjs'],
    env,
    cwd: '/workspace',
    stdio: { stdout: writer(port()), stderr: writer(port()), stdin: port(), ipc: port() },
  });
}

async function withProcessGlobal<T>(
  process: unknown,
  run: () => Promise<T>,
  trustedProcess: NodeProcess = process as NodeProcess,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousActive = readActiveNodeProcessBootstrap();
  setActiveNodeProcessBootstrap(trustedProcess, true);
  Object.defineProperty(globalThis, 'process', {
    value: process,
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    setActiveNodeProcessBootstrap(
      previousActive?.process ?? null,
      previousActive?.federated ?? false,
    );
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'process');
    } else {
      Object.defineProperty(globalThis, 'process', descriptor);
    }
  }
}
