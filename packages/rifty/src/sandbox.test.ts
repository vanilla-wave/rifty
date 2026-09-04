import type { RuntimeController } from '@riftydev/runtime-js';
import type { FsReadEncoding } from '@riftydev/runtime-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityCheck } from './capabilities.ts';
import {
  COI_REQUIRED_MESSAGE,
  type CreateSandboxOptions,
  type Sandbox,
  type SandboxDeps,
  type SandboxResidentBin,
  type SandboxRestartReport,
  type SandboxStartBinInput,
  type ToolchainCreateSandboxOptions,
  type ToolchainSandbox,
  createSandbox,
} from './sandbox.ts';

function publicCreateSandboxTypeCarrier(options: CreateSandboxOptions): void {
  const union: Promise<Sandbox | ToolchainSandbox> = createSandbox(options);
  const generic: Promise<Sandbox> = createSandbox({ workerUrl: '/generic-worker.js' });
  const toolchain: Promise<ToolchainSandbox> = createSandbox({
    requireCrossOriginIsolation: false,
    toolchain: { workerUrl: '/toolchain-worker.js' },
  });
  // @ts-expect-error toolchain admission requires an explicit literal false.
  const omittedFalse: ToolchainCreateSandboxOptions = {
    toolchain: { workerUrl: '/toolchain-worker.js' },
  };
  const trueFlag: ToolchainCreateSandboxOptions = {
    // @ts-expect-error true cannot admit the shared-memory-free toolchain tier.
    requireCrossOriginIsolation: true,
    toolchain: { workerUrl: '/toolchain-worker.js' },
  };
  const legacyTopLevelWorker: ToolchainCreateSandboxOptions = {
    requireCrossOriginIsolation: false,
    toolchain: { workerUrl: '/toolchain-worker.js' },
    // @ts-expect-error toolchain mode selects only its nested Worker URL.
    workerUrl: '/legacy-worker.js',
  };
  const spawnToolchainIsNotPublic: false = false as 'spawnToolchain' extends keyof SandboxDeps
    ? true
    : false;
  void [
    union,
    generic,
    toolchain,
    omittedFalse,
    trueFlag,
    legacyTopLevelWorker,
    spawnToolchainIsNotPublic,
  ];
}
void publicCreateSandboxTypeCarrier;

async function publicResidentLifecycleTypeCarrier(
  sandbox: ToolchainSandbox,
  input: SandboxStartBinInput,
): Promise<void> {
  const resident: SandboxResidentBin = await sandbox.toolchain.startBin(input);
  const report: SandboxRestartReport = await sandbox.restart({
    preview: { src: resident.previewUrl },
    beforeStart: async (fs) => fs.writeFile('/project/repair.js', 'export const ok = true;'),
  });
  void report;
}
void publicResidentLifecycleTypeCarrier;

/** A typed no-op controller — these tests assert wiring, never drive eval. */
function fakeRuntime(onDispose: () => void = () => {}): RuntimeController {
  function readFile(path: string): Promise<Uint8Array>;
  function readFile(path: string, encoding: FsReadEncoding): Promise<string>;
  function readFile(_path: string, encoding?: FsReadEncoding): Promise<Uint8Array | string> {
    return Promise.resolve(encoding === undefined ? new Uint8Array() : '');
  }

  return {
    eval: () => Promise.resolve({ id: 0, ok: true, value: undefined }),
    fs: {
      readFile,
      writeFile: () => Promise.resolve(),
    },
    reset: () => Promise.resolve(),
    dispose: onDispose,
    on: () => () => {},
    writeFile: () => {},
    writeStdin: () => {},
    isReady: () => true,
  };
}

function capabilityCheck(crossOriginIsolated: boolean): CapabilityCheck {
  return {
    capabilities: {
      crossOriginIsolated,
      sharedArrayBuffer: crossOriginIsolated,
      atomicsWaitAsync: crossOriginIsolated,
      opfsSyncAccessHandle: true,
      serviceWorker: true,
      worker: true,
    },
    missing: crossOriginIsolated ? [] : ['crossOriginIsolated'],
    sufficient: true,
    summary: 'test',
  };
}

/** Default happy-path seams; each test overrides the field it exercises. */
function deps(over: Partial<SandboxDeps> = {}): SandboxDeps {
  return {
    detect: () => capabilityCheck(true),
    initVfs: () => Promise.resolve('opfs'),
    registerSw: () => Promise.resolve(),
    spawn: () => fakeRuntime(),
    logger: { warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSandbox', () => {
  it('wires capabilities, OPFS backend, and the runtime on the happy path', async () => {
    const runtime = fakeRuntime();
    const spawn = vi.fn(() => runtime);
    const sandbox = await createSandbox({ workerUrl: 'http://x/worker.js' }, deps({ spawn }));

    expect(spawn).toHaveBeenCalledWith({ workerUrl: 'http://x/worker.js' });
    expect(sandbox.fs).toBe(runtime.fs);
    expect(sandbox.vfs).toEqual({ backend: 'opfs' });
    expect(sandbox.capabilities.capabilities.crossOriginIsolated).toBe(true);
    expect(sandbox.swError).toBeUndefined();
  });

  it('coerces a URL workerUrl to a string for spawn', async () => {
    const spawn = vi.fn(() => fakeRuntime());
    await createSandbox({ workerUrl: new URL('http://x/worker.js') }, deps({ spawn }));
    expect(spawn).toHaveBeenCalledWith({ workerUrl: 'http://x/worker.js' });
  });

  it.each([undefined, true] as const)(
    'throws and boots nothing when COI is required but absent (%s)',
    async (requireCrossOriginIsolation) => {
      const initVfs = vi.fn(() => Promise.resolve<'opfs' | 'memory'>('opfs'));
      const spawn = vi.fn(() => fakeRuntime());
      const error = await createSandbox(
        {
          workerUrl: 'w',
          ...(requireCrossOriginIsolation === undefined ? {} : { requireCrossOriginIsolation }),
        },
        deps({ detect: () => capabilityCheck(false), initVfs, spawn }),
      ).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(COI_REQUIRED_MESSAGE);
      expect(initVfs).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('boots without COI when requireCrossOriginIsolation is false', async () => {
    const spawn = vi.fn(() => fakeRuntime());
    const sandbox = await createSandbox(
      { workerUrl: 'w', requireCrossOriginIsolation: false },
      deps({ detect: () => capabilityCheck(false), spawn }),
    );
    expect(spawn).toHaveBeenCalledOnce();
    expect(sandbox.capabilities.capabilities.crossOriginIsolated).toBe(false);
    expect('toolchain' in sandbox).toBe(false);
    expect('capabilityReport' in sandbox).toBe(false);
  });

  it.each([undefined, true] as const)(
    'rejects toolchain admission unless the runtime flag is literal false (%s)',
    async (requireCrossOriginIsolation) => {
      const options = {
        ...(requireCrossOriginIsolation === undefined ? {} : { requireCrossOriginIsolation }),
        toolchain: { workerUrl: '/toolchain-worker.js' },
      };
      const error = await createSandbox(
        options as unknown as CreateSandboxOptions,
        deps({ detect: () => capabilityCheck(false) }),
      ).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({
        name: 'TypeError',
        message: expect.stringContaining('false'),
      });
    },
  );

  it('rejects every non-boolean no-COI admission before boot — designed RED', async () => {
    const values = [
      { label: 'explicit-undefined', value: undefined },
      { label: 'zero', value: 0 },
      { label: 'empty-string', value: '' },
      { label: 'NaN', value: Number.NaN },
      { label: 'null', value: null },
      { label: 'one', value: 1 },
      { label: 'string-false', value: 'false' },
      { label: 'bigint-zero', value: 0n },
      { label: 'bigint-one', value: 1n },
      { label: 'symbol', value: Symbol('isolation') },
      { label: 'function', value: () => false },
      { label: 'object', value: {} },
      { label: 'array', value: [] },
    ] as const;
    const outcomes: Array<Record<string, unknown>> = [];

    for (const mode of ['generic', 'toolchain'] as const) {
      for (const { label, value } of values) {
        const trace: string[] = [];
        let workerConstructions = 0;
        class UnexpectedWorker {
          constructor() {
            trace.push('toolchain-worker');
            workerConstructions += 1;
          }
        }
        vi.stubGlobal('Worker', UnexpectedWorker);
        const initVfs = vi.fn(() => Promise.resolve<'opfs' | 'memory'>('opfs'));
        const registerSw = vi.fn(() => Promise.resolve());
        const spawn = vi.fn(() => fakeRuntime());
        const options =
          mode === 'generic'
            ? { workerUrl: '/generic-worker.js', requireCrossOriginIsolation: value }
            : {
                requireCrossOriginIsolation: value,
                toolchain: { workerUrl: '/toolchain-worker.js' },
              };
        let error: unknown;
        try {
          await createSandbox(
            options as unknown as CreateSandboxOptions,
            deps({
              detect: () => {
                trace.push('detect');
                return capabilityCheck(false);
              },
              initVfs: () => {
                trace.push('vfs');
                return initVfs();
              },
              registerSw: () => {
                trace.push('sw');
                return registerSw();
              },
              spawn: () => {
                trace.push('generic-worker');
                return spawn();
              },
            }),
          );
        } catch (caught) {
          error = caught;
        }
        outcomes.push({
          mode,
          value: label,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  canonicalTypeError: error instanceof TypeError,
                }
              : {
                  name: typeof error,
                  message: String(error),
                  canonicalTypeError: false,
                },
          sideEffects: {
            initVfs: initVfs.mock.calls.length,
            registerSw: registerSw.mock.calls.length,
            spawn: spawn.mock.calls.length,
            worker: workerConstructions,
            order: trace,
          },
        });
      }
    }

    expect(outcomes).toEqual(
      (['generic', 'toolchain'] as const).flatMap((mode) =>
        values.map(({ label }) => ({
          mode,
          value: label,
          error: {
            name: 'TypeError',
            message: expect.stringMatching(/boolean.*false/u),
            canonicalTypeError: true,
          },
          sideEffects: { initVfs: 0, registerSw: 0, spawn: 0, worker: 0, order: [] },
        })),
      ),
    );
  });

  it('pins exact boot-effect vectors for omitted, true, false and invalid admission', async () => {
    const cases = [
      {
        mode: 'generic',
        flag: 'omitted',
        own: false,
        value: undefined,
        expected: { status: 'rejected', name: 'Error', trace: ['detect'] },
      },
      {
        mode: 'generic',
        flag: 'true',
        own: true,
        value: true,
        expected: { status: 'rejected', name: 'Error', trace: ['detect'] },
      },
      {
        mode: 'generic',
        flag: 'false',
        own: true,
        value: false,
        expected: {
          status: 'resolved',
          name: undefined,
          trace: ['detect', 'vfs', 'sw', 'generic-worker'],
        },
      },
      {
        mode: 'generic',
        flag: 'bigint-zero',
        own: true,
        value: 0n,
        expected: { status: 'rejected', name: 'TypeError', trace: [] },
      },
      {
        mode: 'toolchain',
        flag: 'omitted',
        own: false,
        value: undefined,
        expected: { status: 'rejected', name: 'TypeError', trace: ['detect'] },
      },
      {
        mode: 'toolchain',
        flag: 'true',
        own: true,
        value: true,
        expected: { status: 'rejected', name: 'TypeError', trace: ['detect'] },
      },
      {
        mode: 'toolchain',
        flag: 'false',
        own: true,
        value: false,
        expected: {
          status: 'resolved',
          name: undefined,
          trace: ['detect', 'sw', 'toolchain-worker'],
        },
      },
      {
        mode: 'toolchain',
        flag: 'bigint-zero',
        own: true,
        value: 0n,
        expected: { status: 'rejected', name: 'TypeError', trace: [] },
      },
    ] as const;
    const outcomes: Array<Record<string, unknown>> = [];

    for (const testCase of cases) {
      const trace: string[] = [];
      let resolveWorker: (worker: VectorWorker) => void = () => {};
      const workerConstructed = new Promise<VectorWorker>((resolve) => {
        resolveWorker = resolve;
      });
      class VectorWorker {
        readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

        constructor() {
          trace.push('toolchain-worker');
          resolveWorker(this);
        }

        addEventListener(type: string, listener: EventListener): void {
          if (type === 'message') {
            this.listeners.add(listener as (event: MessageEvent<unknown>) => void);
          }
        }

        postMessage(): void {}

        terminate(): void {}

        emit(data: unknown): void {
          const event = { data } as MessageEvent<unknown>;
          for (const listener of this.listeners) listener(event);
        }
      }
      vi.stubGlobal('Worker', VectorWorker);
      const flag = testCase.own ? { requireCrossOriginIsolation: testCase.value } : {};
      const options =
        testCase.mode === 'generic'
          ? { workerUrl: '/generic-worker.js', ...flag }
          : { ...flag, toolchain: { workerUrl: '/toolchain-worker.js' } };
      const creating = createSandbox(
        options as unknown as CreateSandboxOptions,
        deps({
          detect: () => {
            trace.push('detect');
            return capabilityCheck(false);
          },
          initVfs: () => {
            trace.push('vfs');
            return Promise.resolve('opfs');
          },
          registerSw: () => {
            trace.push('sw');
            return Promise.resolve();
          },
          spawn: () => {
            trace.push('generic-worker');
            return fakeRuntime();
          },
        }),
      ).then(
        (sandbox) => ({ status: 'resolved', name: undefined, sandbox }),
        (error: Error) => ({ status: 'rejected', name: error.name, sandbox: undefined }),
      );
      if (testCase.mode === 'toolchain' && testCase.value === false) {
        const worker = await workerConstructed;
        worker.emit({ type: 'ready' });
        worker.emit({
          type: 'toolchain-ready',
          protocol: 'rifty.sandbox-toolchain/v1',
          vfsBackend: 'opfs',
        });
      }
      const result = await creating;
      outcomes.push({
        mode: testCase.mode,
        flag: testCase.flag,
        status: result.status,
        name: result.name,
        trace,
      });
      result.sandbox?.dispose();
    }

    expect(outcomes).toEqual(
      cases.map((testCase) => ({
        mode: testCase.mode,
        flag: testCase.flag,
        ...testCase.expected,
      })),
    );
  });

  it('projects either admitted Worker backend through one public runtime authority', async () => {
    for (const workerBackend of ['opfs', 'memory'] as const) {
      const workers: Array<{
        readonly url: string;
        emit(data: unknown): void;
        terminate(): void;
      }> = [];
      let resolveWorker: (worker: (typeof workers)[number]) => void = () => {};
      const workerConstructed = new Promise<(typeof workers)[number]>((resolve) => {
        resolveWorker = resolve;
      });
      class ProjectedBackendWorker {
        readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

        constructor(readonly url: string) {
          workers.push(this);
          resolveWorker(this);
        }

        addEventListener(type: string, listener: EventListener): void {
          if (type === 'message') {
            this.listeners.add(listener as (event: MessageEvent<unknown>) => void);
          }
        }

        postMessage(): void {}

        terminate(): void {}

        emit(data: unknown): void {
          const event = { data } as MessageEvent<unknown>;
          for (const listener of this.listeners) listener(event);
        }
      }
      vi.stubGlobal('Worker', ProjectedBackendWorker);
      const pageBackend = workerBackend === 'opfs' ? 'memory' : 'opfs';
      const initVfs = vi.fn(() => Promise.resolve<'opfs' | 'memory'>(pageBackend));
      const genericSpawn = vi.fn(() => fakeRuntime());
      const creating = createSandbox(
        {
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: { workerUrl: `/toolchain-${workerBackend}.js` },
        },
        deps({ detect: () => capabilityCheck(false), initVfs, spawn: genericSpawn }),
      );
      const worker = await workerConstructed;
      worker.emit({ type: 'ready' });
      worker.emit({
        type: 'toolchain-ready',
        protocol: 'rifty.sandbox-toolchain/v1',
        vfsBackend: workerBackend,
      });
      const sandbox = await creating;

      expect(workers).toHaveLength(1);
      expect(worker.url).toBe(`/toolchain-${workerBackend}.js`);
      expect(initVfs).not.toHaveBeenCalled();
      expect(genericSpawn).not.toHaveBeenCalled();
      expect(sandbox.vfs).toEqual({ backend: workerBackend });
      expect(sandbox.vfs.backend).not.toBe(pageBackend);
      expect(sandbox.fs).toBe(sandbox.runtime.fs);
      expect(sandbox.toolchain).toBe(
        (sandbox.runtime as RuntimeController & { readonly toolchain: unknown }).toolchain,
      );
      sandbox.dispose();
    }
  });

  it('public admission rejects and terminates a valid-backend mismatched-protocol Worker', async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const terminate = vi.fn();
    let resolveConstructed: (worker: MismatchedProtocolWorker) => void = () => {};
    const constructed = new Promise<MismatchedProtocolWorker>((resolve) => {
      resolveConstructed = resolve;
    });
    class MismatchedProtocolWorker {
      constructor() {
        resolveConstructed(this);
      }

      addEventListener(type: string, listener: EventListener): void {
        if (type === 'message') {
          listeners.add(listener as (event: MessageEvent<unknown>) => void);
        }
      }

      postMessage(): void {}

      terminate(): void {
        terminate();
      }

      emit(data: unknown): void {
        const event = { data } as MessageEvent<unknown>;
        for (const listener of listeners) listener(event);
      }
    }
    vi.stubGlobal('Worker', MismatchedProtocolWorker);
    const creating = createSandbox(
      {
        requireCrossOriginIsolation: false,
        toolchain: { workerUrl: '/toolchain-worker.js' },
      },
      deps({ detect: () => capabilityCheck(false) }),
    );
    const worker = await constructed;
    worker.emit({ type: 'ready' });
    worker.emit({
      type: 'toolchain-ready',
      protocol: 'rifty.sandbox-toolchain/v0',
      vfsBackend: 'memory',
    });

    await expect(creating).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'sandbox.toolchain.worker',
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('falls back to memory and records the reason when VFS init throws', async () => {
    const warn = vi.fn();
    const sandbox = await createSandbox(
      { workerUrl: 'w' },
      deps({
        initVfs: () => Promise.reject(new Error('opfs blocked')),
        logger: { warn, error: vi.fn() },
      }),
    );
    expect(sandbox.vfs).toEqual({ backend: 'memory', reason: 'opfs blocked' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('opfs blocked'));
  });

  it('surfaces swError but still returns a runtime when SW registration rejects', async () => {
    const sandbox = await createSandbox(
      { workerUrl: 'w' },
      deps({ registerSw: () => Promise.reject(new Error('no SW')) }),
    );
    expect(sandbox.swError).toBe('no SW');
    expect(sandbox.runtime.isReady()).toBe(true);
  });

  it('passes serviceWorkerUrl through, defaulting to /sw.js', async () => {
    const registerSw = vi.fn(() => Promise.resolve());
    await createSandbox({ workerUrl: 'w' }, deps({ registerSw }));
    expect(registerSw).toHaveBeenCalledWith('/sw.js');

    registerSw.mockClear();
    await createSandbox(
      { workerUrl: 'w', serviceWorkerUrl: '/custom-sw.js' },
      deps({ registerSw }),
    );
    expect(registerSw).toHaveBeenCalledWith('/custom-sw.js');
  });

  it('skips service-worker registration when skipServiceWorker is set', async () => {
    const registerSw = vi.fn(() => Promise.resolve());
    const sandbox = await createSandbox(
      { workerUrl: 'w', skipServiceWorker: true },
      deps({ registerSw }),
    );
    expect(registerSw).not.toHaveBeenCalled();
    expect(sandbox.swError).toBeUndefined();
  });

  it('dispose tears down the runtime worker', async () => {
    const onDispose = vi.fn();
    const sandbox = await createSandbox(
      { workerUrl: 'w' },
      deps({ spawn: () => fakeRuntime(onDispose) }),
    );
    sandbox.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it('falls back to options.logger when deps.logger is absent', async () => {
    const optWarn = vi.fn();
    await createSandbox(
      { workerUrl: 'w', logger: { warn: optWarn, error: vi.fn() } },
      deps({ logger: undefined, initVfs: () => Promise.reject(new Error('opfs x')) }),
    );
    expect(optWarn).toHaveBeenCalledWith(expect.stringContaining('opfs x'));
  });

  it('prefers deps.logger over options.logger when both are supplied', async () => {
    const depWarn = vi.fn();
    const optWarn = vi.fn();
    await createSandbox(
      { workerUrl: 'w', logger: { warn: optWarn, error: vi.fn() } },
      deps({
        logger: { warn: depWarn, error: vi.fn() },
        initVfs: () => Promise.reject(new Error('opfs x')),
      }),
    );
    expect(depWarn).toHaveBeenCalled();
    expect(optWarn).not.toHaveBeenCalled();
  });
});
