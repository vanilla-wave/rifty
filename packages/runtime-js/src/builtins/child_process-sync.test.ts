import { KERNEL_SYNC_CALL_KEY, publishKernelSyncApi, setKernelWorkerUrl } from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execSync } from './child_process-sync.ts';
import { NodeProcess, setProcessCwd } from './process.ts';

type Coi = { crossOriginIsolated?: boolean };
type ProcessGlobal = { process?: unknown };

afterEach(() => {
  Reflect.deleteProperty(globalThis, KERNEL_SYNC_CALL_KEY);
  (globalThis as Coi).crossOriginIsolated = false;
  setProcessCwd('/workspace');
  vi.restoreAllMocks();
});

describe('execSync calling-process options', () => {
  it('snapshots omitted env and cwd from the calling Node process', () => {
    const payloads: unknown[] = [];
    installExecSyncCapture(payloads);
    const parent = new NodeProcess();
    parent.env.USER_VALUE = 'parent';
    setProcessCwd('/parent');

    withProcessGlobal(parent, () => {
      execSync('node child.js');
      parent.env.USER_VALUE = 'mutated';
      setProcessCwd('/mutated');
    });

    expect(payloads).toEqual([
      {
        cmd: 'node child.js',
        opts: { cwd: '/parent', env: { USER_VALUE: 'parent' } },
      },
    ]);
  });

  it('uses explicit env and cwd as replacements and omits undefined env entries', () => {
    const payloads: unknown[] = [];
    installExecSyncCapture(payloads);
    const parent = new NodeProcess();
    parent.env.PARENT_ONLY = 'parent';
    setProcessCwd('/parent');

    withProcessGlobal(parent, () => {
      execSync('node child.js', {
        cwd: '/explicit',
        env: { USER_VALUE: 'explicit', UNDEFINED_VALUE: undefined },
      });
    });

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as {
      cmd: string;
      opts: { cwd: string; env: Record<string, string | undefined> };
    };
    expect(payload).toEqual({
      cmd: 'node child.js',
      opts: { cwd: '/explicit', env: { USER_VALUE: 'explicit' } },
    });
    expect(Object.hasOwn(payload.opts.env, 'UNDEFINED_VALUE')).toBe(false);
  });

  it('fails loud before dispatch when the Node process context is missing', () => {
    const payloads: unknown[] = [];
    installExecSyncCapture(payloads);

    withProcessGlobal(undefined, () => {
      expect(() => execSync('node child.js')).toThrow(/execSync.*process context.*unavailable/i);
    });
    expect(payloads).toEqual([]);
  });
});

function installExecSyncCapture(payloads: unknown[]): void {
  (globalThis as Coi).crossOriginIsolated = true;
  setKernelWorkerUrl('https://host.test/kernel-worker.js');
  publishKernelSyncApi({
    call(method, payload) {
      expect(method).toBe('execSync');
      payloads.push(payload);
      return new Uint8Array();
    },
  });
}

function withProcessGlobal<T>(process: NodeProcess | undefined, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  if (process === undefined) {
    Reflect.deleteProperty(globalThis as ProcessGlobal, 'process');
  } else {
    Object.defineProperty(globalThis, 'process', {
      value: process,
      configurable: true,
      writable: true,
    });
  }
  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis as ProcessGlobal, 'process');
    } else {
      Object.defineProperty(globalThis, 'process', descriptor);
    }
  }
}
