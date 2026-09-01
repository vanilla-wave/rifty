import type { RuntimeController } from '@riftydev/runtime-js';
import type { FsReadEncoding } from '@riftydev/runtime-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityCheck } from './capabilities.ts';
import {
  COI_REQUIRED_MESSAGE,
  type CreateSandboxOptions,
  type Sandbox,
  type SandboxDeps,
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

  it('throws and boots nothing when COI is required but absent', async () => {
    const initVfs = vi.fn(() => Promise.resolve<'opfs' | 'memory'>('opfs'));
    const spawn = vi.fn(() => fakeRuntime());
    await expect(
      createSandbox(
        { workerUrl: 'w' },
        deps({ detect: () => capabilityCheck(false), initVfs, spawn }),
      ),
    ).rejects.toThrow(COI_REQUIRED_MESSAGE);
    expect(initVfs).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

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
      await expect(
        createSandbox(
          options as unknown as CreateSandboxOptions,
          deps({ detect: () => capabilityCheck(false) }),
        ),
      ).rejects.toMatchObject({
        name: 'TypeError',
        message: expect.stringContaining('false'),
      });
    },
  );

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
