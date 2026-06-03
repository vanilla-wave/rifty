import type { RuntimeController } from '@riftydev/runtime-js';
import { describe, expect, it, vi } from 'vitest';
import type { CapabilityCheck } from './capabilities.ts';
import { COI_REQUIRED_MESSAGE, type SandboxDeps, createSandbox } from './sandbox.ts';

/** A typed no-op controller — these tests assert wiring, never drive eval. */
function fakeRuntime(onDispose: () => void = () => {}): RuntimeController {
  return {
    eval: () => Promise.resolve({ id: 0, ok: true, value: undefined }),
    reset: () => Promise.resolve(),
    dispose: onDispose,
    on: () => () => {},
    writeFile: () => {},
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

describe('createSandbox', () => {
  it('wires capabilities, OPFS backend, and the runtime on the happy path', async () => {
    const spawn = vi.fn(() => fakeRuntime());
    const sandbox = await createSandbox({ workerUrl: 'http://x/worker.js' }, deps({ spawn }));

    expect(spawn).toHaveBeenCalledWith({ workerUrl: 'http://x/worker.js' });
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
