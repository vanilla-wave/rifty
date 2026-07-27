import {
  KERNEL_PROCESS_SPEC_KEY,
  type ProcessHandle,
  type SpawnOptions,
  globalProcessManager,
  publishKernelProcessSpec,
} from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './index.ts';
import { spawn } from './child_process.ts';
import { spawnWorkerChild } from './child_process-worker.ts';
import { configureNodeEntryWorker, resetNodeEntryWorkerUrl } from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { NodeProcess, setProcessCwd } from './process.ts';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, KERNEL_PROCESS_SPEC_KEY);
  resetNodeEntryWorkerUrl();
  resetSyncMirror();
  setProcessCwd('/workspace');
});

describe('child_process Worker ancestry', () => {
  it('keeps the bootstrap parent pid when guest process fields and public spec are poisoned', () => {
    let parentPid: number | undefined;
    let spawnOptions: SpawnOptions | undefined;
    vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(
      (_command, _spec, candidate, options) => {
        parentPid = candidate;
        spawnOptions = options;
        return {} as ProcessHandle;
      },
    );
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
        stdout: channels[0]!.port1,
        stderr: channels[1]!.port1,
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
      withProcessGlobal(
        guestReplacement,
        () => {
          spawnWorkerChild('node', ['/workspace/child.mjs'], { fork: false });
        },
        parent,
      );
      expect(parentPid).toBe(41);
      expect(spawnOptions?.federated).toBe(true);
    } finally {
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
    }
  });

  it('uses the same-realm child identity when that child synchronously spawns a grandchild', async () => {
    const channels = Array.from({ length: 4 }, () => new MessageChannel());
    const outer = new NodeProcess({
      pid: 41,
      ppid: 7,
      argv: ['rifty', '/workspace/outer.mjs'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: channels[0]!.port1,
        stderr: channels[1]!.port1,
        stdin: channels[2]!.port1,
        ipc: channels[3]!.port1,
      },
    });
    writeFileSync(
      '/child.mjs',
      "require('child_process').spawn('node', ['/grandchild.mjs']);",
    );
    writeFileSync('/grandchild.mjs', '');
    const previousActive = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(outer, false);
    const spawnSpy = vi.spyOn(globalProcessManager, 'spawn');
    try {
      const child = spawn('node', ['/child.mjs']);
      await new Promise<void>((resolve) => child.once('close', () => resolve()));

      expect(spawnSpy).toHaveBeenCalledTimes(2);
      expect(spawnSpy.mock.calls[1]?.[2]).toBe(child.pid);
    } finally {
      setActiveNodeProcessBootstrap(
        previousActive?.process ?? null,
        previousActive?.federated ?? false,
      );
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
    }
  });
});

function withProcessGlobal<T>(process: unknown, run: () => T, trustedProcess: NodeProcess): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousActive = readActiveNodeProcessBootstrap();
  setActiveNodeProcessBootstrap(trustedProcess, true);
  Object.defineProperty(globalThis, 'process', {
    value: process,
    configurable: true,
    writable: true,
  });
  try {
    return run();
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
