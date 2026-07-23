import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeProcess } from './process.ts';

const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');

function installLocalProcess(): NodeProcess {
  const process = new NodeProcess();
  process.env = { KEPT: 'cross-bundle', OMITTED: undefined };
  Object.defineProperty(globalThis, 'process', {
    value: process,
    writable: true,
    configurable: true,
  });
  return process;
}

afterEach(() => {
  if (originalProcessDescriptor === undefined) Reflect.deleteProperty(globalThis, 'process');
  else Object.defineProperty(globalThis, 'process', originalProcessDescriptor);
  vi.resetModules();
});

describe('runtime-owned process survives production worker bundle duplication', () => {
  it('snapshots the live process through a separately loaded runtime copy', async () => {
    const process = installLocalProcess();

    vi.resetModules();
    const foreignRuntime = await import('./process.ts');
    const foreignContext = await import('./process-context.ts');
    expect(foreignRuntime.NodeProcess).not.toBe(process.constructor);

    expect(foreignContext.snapshotNodeProcessContext()).toEqual({
      cwd: '/workspace',
      env: { KEPT: 'cross-bundle' },
    });
  });

  it('rejects a structural host-process lookalike without the runtime brand', async () => {
    Object.defineProperty(globalThis, 'process', {
      value: { cwd: () => '/host', env: { KEPT: 'not-runtime-owned' } },
      writable: true,
      configurable: true,
    });

    vi.resetModules();
    const foreignContext = await import('./process-context.ts');

    expect(foreignContext.snapshotNodeProcessContext()).toBeNull();
  });

  it('does not replace the live process through a separately loaded runtime copy', async () => {
    const process = installLocalProcess();

    vi.resetModules();
    const foreignRuntime = await import('./process.ts');
    foreignRuntime.installProcessGlobals();

    expect(globalThis.process).toBe(process);
  });

  it('registers the live process builtin through a separately loaded runtime copy', async () => {
    const process = installLocalProcess();

    vi.resetModules();
    const foreignBuiltins = await import('./index.ts');
    foreignBuiltins.refreshRuntimeJsProcessBuiltin();

    expect(foreignBuiltins.loadBuiltin('process')).toBe(process);
  });

  it('validates util streams against the live process through a separate runtime copy', async () => {
    const process = installLocalProcess();

    vi.resetModules();
    const foreignUtil = await import('./util.ts');

    expect(() => foreignUtil.styleText('red', 'text', { stream: process.stdout })).not.toThrow();
  });

  it('routes nextTick faults to the live process through a separate runtime copy', async () => {
    const process = installLocalProcess();
    const failure = new Error('cross-bundle nextTick fault');
    const observed: unknown[] = [];
    process.once('uncaughtException', (error) => observed.push(error));

    vi.resetModules();
    const foreignRuntime = await import('./process.ts');
    foreignRuntime.riftyProcess.nextTick(() => {
      throw failure;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observed).toEqual([failure]);
  });
});
