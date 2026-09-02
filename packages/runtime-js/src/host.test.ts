import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnRuntime, spawnToolchainRuntime } from './host.ts';
import * as runtimeJs from './index.ts';
import {
  SANDBOX_TOOLCHAIN_PROTOCOL,
  type ToolchainHostMessage,
  type ToolchainWorkerMessage,
} from './protocol.ts';
// @ts-expect-error raw sandbox toolchain controller is package-internal
type RawToolchainRuntimeController = import('./index.ts').ToolchainRuntimeController;
// @ts-expect-error raw sandbox toolchain interface is package-internal
type RawRuntimeToolchain = import('./index.ts').RuntimeToolchain;
// @ts-expect-error raw sandbox toolchain install input is package-internal
type RawToolchainInstallRequest = import('./index.ts').ToolchainInstallRequest;
// @ts-expect-error raw sandbox toolchain requests are package-internal
type RawToolchainRequest = import('./index.ts').ToolchainRequest;
// @ts-expect-error raw sandbox toolchain results are package-internal
type RawToolchainResult = import('./index.ts').ToolchainResult;
// @ts-expect-error raw sandbox toolchain run-bin input is package-internal
type RawToolchainRunBinRequest = import('./index.ts').ToolchainRunBinRequest;
// @ts-expect-error bounded gap projection stays off the runtime root
type RootDeclaredGapCause = typeof import('./index.ts')['declaredGapCause'];

const forbiddenRootTypeProof:
  | readonly [
      RawToolchainRuntimeController,
      RawRuntimeToolchain,
      RawToolchainInstallRequest,
      RawToolchainRequest,
      RawToolchainResult,
      RawToolchainRunBinRequest,
      RootDeclaredGapCause,
    ]
  | null = null;
void forbiddenRootTypeProof;

type Listener<T> = (event: MessageEvent<T>) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly sent: ToolchainHostMessage[] = [];
  readonly listeners = {
    message: new Set<Listener<ToolchainWorkerMessage>>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };
  terminated = false;

  constructor(
    readonly url: string,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: ToolchainHostMessage): void {
    this.sent.push(message);
  }

  addEventListener(type: 'message', listener: Listener<ToolchainWorkerMessage>): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: 'message' | 'error',
    listener: Listener<ToolchainWorkerMessage> | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') {
      this.listeners.message.add(listener as Listener<ToolchainWorkerMessage>);
    } else {
      this.listeners.error.add(listener as (event: ErrorEvent) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: ToolchainWorkerMessage): void {
    const event = { data: message } as MessageEvent<ToolchainWorkerMessage>;
    for (const listener of this.listeners.message) listener(event);
  }

  emitUnknown(message: unknown): void {
    const event = { data: message } as MessageEvent<ToolchainWorkerMessage>;
    for (const listener of this.listeners.message) listener(event);
  }

  crash(message: string) {
    const preventDefault = vi.fn();
    const event = { message, preventDefault } as unknown as ErrorEvent;
    for (const listener of this.listeners.error) listener(event);
    return preventDefault;
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

describe('runtime-js root surface', () => {
  it('does not publish the keepalive initialization bootstrap detail', () => {
    expect('initializeEventLoopKeepalive' in runtimeJs).toBe(false);
    expect(typeof runtimeJs.installEventLoopKeepalive).toBe('function');
  });

  it('does not publish the sandbox toolchain control plane', () => {
    expect(
      ['spawnToolchainRuntime', 'SANDBOX_TOOLCHAIN_PROTOCOL', 'declaredGapCause'].filter(
        (name) => name in runtimeJs,
      ),
    ).toEqual([]);
  });
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
    const errorResult = errorRead.catch((error: unknown) => error);
    const preventDefault = fakeWorker(1).crash('boom');
    expect(preventDefault).toHaveBeenCalledOnce();
    await expect(errorResult).resolves.toMatchObject({ code: 'WORKER_CRASHED' });

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

// T15 — vm-config host option + diagnostic surfacing.
describe('spawnRuntime vm-config + diagnostic', () => {
  it('sends vm-config on ready when vmEngine is set', () => {
    installFakeWorker();
    spawnRuntime({ workerUrl: '/worker.js', vmEngine: 'quickjs' });
    const worker = fakeWorker(0);
    worker.emit({ type: 'ready' });
    expect(worker.sent).toContainEqual({ type: 'vm-config', engine: 'quickjs' });
  });

  it('does NOT send vm-config when vmEngine is absent', () => {
    installFakeWorker();
    spawnRuntime({ workerUrl: '/worker.js' });
    const worker = fakeWorker(0);
    worker.emit({ type: 'ready' });
    expect(worker.sent.some((m) => m.type === 'vm-config')).toBe(false);
  });

  it('surfaces a diagnostic WorkerMessage as a diagnostic RuntimeEvent', () => {
    installFakeWorker();
    const runtime = spawnRuntime({ workerUrl: '/worker.js' });
    const events: unknown[] = [];
    runtime.on((e) => {
      if (e.type === 'diagnostic') events.push(e.payload);
    });
    const payload = [
      { feature: 'vm.engine.rewrite-active', kind: 'divergence', count: 2 },
    ] as const;
    fakeWorker(0).emit({ type: 'diagnostic', payload });
    expect(events).toEqual([payload]);
  });
});

function admitToolchain(runtime: ReturnType<typeof spawnToolchainRuntime>): FakeWorker {
  void runtime;
  const worker = fakeWorker(0);
  worker.emit({ type: 'ready' });
  worker.emit({
    type: 'toolchain-ready',
    protocol: SANDBOX_TOOLCHAIN_PROTOCOL,
    vfsBackend: 'memory',
  });
  return worker;
}

describe('spawnToolchainRuntime trust boundary', () => {
  it('rejects and tears down a handshake with a valid protocol but bogus backend', async () => {
    installFakeWorker();
    const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
    const worker = fakeWorker(0);
    worker.emit({ type: 'ready' });
    worker.emitUnknown({
      type: 'toolchain-ready',
      protocol: SANDBOX_TOOLCHAIN_PROTOCOL,
      vfsBackend: 'indexeddb',
    });

    await expect(runtime.toolchainReady).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'sandbox.toolchain.worker',
    });
    expect(worker.terminated).toBe(true);
  });

  it('rejects and tears down a handshake with a valid backend but mismatched protocol', async () => {
    installFakeWorker();
    const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
    const worker = fakeWorker(0);
    worker.emit({ type: 'ready' });
    worker.emitUnknown({
      type: 'toolchain-ready',
      protocol: 'rifty.sandbox-toolchain/v0',
      vfsBackend: 'memory',
    });

    await expect(runtime.toolchainReady).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'sandbox.toolchain.worker',
    });
    expect(worker.terminated).toBe(true);
  });

  it('rejects arbitrary protocol shapes and quarantines every later frame — designed RED', async () => {
    const invalidFrames: ReadonlyArray<readonly [string, () => unknown]> = [
      [
        'prior version',
        () => ({
          type: 'toolchain-ready',
          protocol: 'rifty.sandbox-toolchain/v0',
          vfsBackend: 'memory',
        }),
      ],
      [
        'later version',
        () => ({
          type: 'toolchain-ready',
          protocol: 'rifty.sandbox-toolchain/v2',
          vfsBackend: 'memory',
        }),
      ],
      ['numeric protocol', () => ({ type: 'toolchain-ready', protocol: 1, vfsBackend: 'memory' })],
      ['null protocol', () => ({ type: 'toolchain-ready', protocol: null, vfsBackend: 'memory' })],
      ['object protocol', () => ({ type: 'toolchain-ready', protocol: {}, vfsBackend: 'memory' })],
      ['missing protocol', () => ({ type: 'toolchain-ready', vfsBackend: 'memory' })],
      [
        'extra field',
        () => ({
          type: 'toolchain-ready',
          protocol: SANDBOX_TOOLCHAIN_PROTOCOL,
          vfsBackend: 'memory',
          extra: true,
        }),
      ],
      [
        'accessor protocol',
        () =>
          Object.defineProperty({ type: 'toolchain-ready', vfsBackend: 'memory' }, 'protocol', {
            enumerable: true,
            get: () => SANDBOX_TOOLCHAIN_PROTOCOL,
          }),
      ],
    ];
    const outcomes: Array<Record<string, unknown>> = [];

    for (const [label, frame] of invalidFrames) {
      installFakeWorker();
      const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
      const events: unknown[] = [];
      runtime.on((event) => events.push(event));
      const worker = fakeWorker(0);
      worker.emit({ type: 'ready' });
      const pendingEval = runtime.eval('41 + 1').then(
        () => ({ name: 'resolved' }),
        (error: Error & { feature?: string }) => ({
          name: error.name,
          feature: error.feature,
        }),
      );
      const handshake = runtime.toolchainReady.then(
        () => ({ name: 'resolved' }),
        (error: Error & { feature?: string }) => ({
          name: error.name,
          feature: error.feature,
        }),
      );
      worker.emitUnknown(frame());
      const rejectedHandshake = await handshake;
      const rejectedEval = await pendingEval;
      const eventsAtTermination = events.length;

      worker.emitUnknown({
        type: 'toolchain-ready',
        protocol: SANDBOX_TOOLCHAIN_PROTOCOL,
        vfsBackend: 'opfs',
      });
      worker.emit({ type: 'ready' });
      worker.emit({ type: 'result', result: { id: 1, ok: true, value: 42 } });
      await Promise.resolve();
      outcomes.push({
        label,
        handshake: rejectedHandshake,
        pendingEval: rejectedEval,
        terminated: worker.terminated,
        readyAfterLaterFrames: runtime.isReady(),
        eventsAtTermination,
        eventsAfterLaterFrames: events.length,
      });
      runtime.dispose();
    }

    expect(outcomes).toEqual(
      invalidFrames.map(([label]) => ({
        label,
        handshake: {
          name: 'NotImplementedError',
          feature: 'sandbox.toolchain.worker',
        },
        pendingEval: {
          name: 'NotImplementedError',
          feature: 'sandbox.toolchain.worker',
        },
        terminated: true,
        readyAfterLaterFrames: false,
        eventsAtTermination: 1,
        eventsAfterLaterFrames: 1,
      })),
    );
  });

  it('admits only the exact protocol/backend frame', async () => {
    installFakeWorker();
    const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
    admitToolchain(runtime);
    await expect(runtime.toolchainReady).resolves.toBe('memory');
  });

  it.each(['dispose', 'crash', 'clean-close'] as const)(
    'rejects an admitted request when its peer ends by %s',
    async (ending) => {
      installFakeWorker();
      const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
      const worker = admitToolchain(runtime);
      await runtime.toolchainReady;
      const pending = runtime.toolchain.install({ cwd: '/project', registryUrl: '/registry' });
      await Promise.resolve();
      expect(worker.sent).toEqual([
        {
          type: 'toolchain',
          request: {
            id: 1,
            op: 'install',
            input: { cwd: '/project', registryUrl: '/registry' },
          },
        },
      ]);

      if (ending === 'dispose') runtime.dispose();
      if (ending === 'crash') worker.crash('toolchain boom');
      if (ending === 'clean-close') {
        worker.emitUnknown({ type: 'toolchain-terminal', reason: 'closed' });
      }

      await expect(pending).rejects.toMatchObject(
        ending === 'crash' ? { code: 'WORKER_CRASHED' } : { name: 'WorkerTerminated' },
      );
    },
  );

  it.each([
    ['dispose', { status: 'rejected', name: 'WorkerTerminated', message: 'Worker was disposed' }],
    [
      'crash',
      {
        status: 'rejected',
        name: 'Error',
        code: 'WORKER_CRASHED',
        message: 'Worker crashed: toolchain boom',
      },
    ],
    [
      'clean-close',
      { status: 'rejected', name: 'WorkerTerminated', message: 'Toolchain Worker closed' },
    ],
  ] as const)(
    'settles a pending eval exactly when the toolchain peer ends by %s',
    async (ending, expected) => {
      installFakeWorker();
      const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
      const worker = admitToolchain(runtime);
      await runtime.toolchainReady;
      const pending = runtime.eval('await new Promise(() => {})');
      let outcome: unknown = { status: 'pending' };
      void pending.then(
        () => {
          outcome = { status: 'resolved' };
        },
        (error: Error & { code?: string }) => {
          outcome = {
            status: 'rejected',
            name: error.name,
            ...(error.code === undefined ? {} : { code: error.code }),
            message: error.message,
          };
        },
      );

      if (ending === 'dispose') runtime.dispose();
      if (ending === 'crash') worker.crash('toolchain boom');
      if (ending === 'clean-close') {
        worker.emitUnknown({ type: 'toolchain-terminal', reason: 'closed' });
      }
      await Promise.resolve();

      expect(outcome).toEqual(expected);
    },
  );

  it('validates exact install/run-bin input before posting any mutation', async () => {
    installFakeWorker();
    const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain-worker.js' });
    const worker = admitToolchain(runtime);
    await runtime.toolchainReady;
    const symbol = Symbol('extra');
    const accessor = Object.defineProperty({ registryUrl: '/registry' }, 'cwd', {
      enumerable: true,
      get: () => '/project',
    });
    const symbolInput = { cwd: '/project', registryUrl: '/registry', [symbol]: true };
    const sparseArgs = new Array<string>(1);
    const missingInstallField = { cwd: '/project' };
    const extraInstallField = { cwd: '/project', registryUrl: '/registry', extra: 'ordinary' };
    const missingRunBinField = {
      cwd: '/project',
      binPath: '/project/node_modules/.bin/vite',
    };
    const extraRunBinField = {
      cwd: '/project',
      binPath: '/project/node_modules/.bin/vite',
      args: ['build'],
      extra: 'ordinary',
    };

    const calls = [
      () => runtime.toolchain.install(missingInstallField as { cwd: string; registryUrl: string }),
      () => runtime.toolchain.install(extraInstallField),
      () => runtime.toolchain.install({ cwd: 'relative', registryUrl: '/registry' }),
      () => runtime.toolchain.install(accessor as { cwd: string; registryUrl: string }),
      () => runtime.toolchain.install(symbolInput),
      () =>
        runtime.toolchain.runBin(
          missingRunBinField as { cwd: string; binPath: string; args: readonly string[] },
        ),
      () => runtime.toolchain.runBin(extraRunBinField),
      () =>
        runtime.toolchain.runBin({
          cwd: '/project',
          binPath: '/other/node_modules/.bin/vite',
          args: ['build'],
        }),
      () =>
        runtime.toolchain.runBin({
          cwd: '/project',
          binPath: '/project/node_modules/.bin/vite',
          args: sparseArgs,
        }),
      () =>
        runtime.toolchain.runBin({
          cwd: '/project',
          binPath: '/project/node_modules/.bin/vite',
          args: Object.defineProperty(['build'], '0', { get: () => 'build' }),
        }),
    ];

    for (const call of calls) {
      const pending = call();
      const assertion = expect(pending).rejects.toMatchObject({ name: 'TypeError' });
      await Promise.resolve();
      const posted = worker.sent.at(-1);
      if (posted?.type === 'toolchain') {
        worker.emit({
          type: 'toolchain-result',
          result:
            posted.request.op === 'install'
              ? { id: posted.request.id, ok: true }
              : { id: posted.request.id, ok: true, value: { exitCode: 0 } },
        });
      }
      await assertion;
    }
    expect(worker.sent).toEqual([]);
  });
});
