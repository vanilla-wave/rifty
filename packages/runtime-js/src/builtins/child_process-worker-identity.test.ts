import {
  KERNEL_PROCESS_SPEC_KEY,
  type ProcessHandle,
  type SpawnOptions,
  globalProcessManager,
  publishKernelProcessSpec,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events.ts';
import './index.ts';
import { spawnWorkerChild } from './child_process-worker.ts';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { configureNodeEntryWorker, resetNodeEntryWorkerUrl } from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess, setProcessCwd } from './process.ts';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, KERNEL_PROCESS_SPEC_KEY);
  resetNodeEntryWorkerUrl();
  resetSyncMirror();
  setProcessCwd('/workspace');
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = false;
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

  it.each([
    {
      label: 'synchronously',
      source: "require('child_process').spawn('node', ['/grandchild.mjs']);",
    },
    {
      label: 'from a Promise microtask',
      source:
        "Promise.resolve().then(() => require('child_process').spawn('node', ['/grandchild.mjs']));",
    },
  ])(
    'uses the same-realm child identity when it spawns a grandchild $label',
    async ({ source }) => {
      const channels = Array.from({ length: 4 }, () => new MessageChannel());
      const outer = new NodeProcess({
        pid: 41,
        ppid: 7,
        argv: ['rifty', '/workspace/outer.mjs'],
        env: {},
        cwd: '/workspace',
        stdio: {
          stdout: { write: (bytes: Uint8Array) => channels[0]!.port1.postMessage(bytes) },
          stderr: { write: (bytes: Uint8Array) => channels[1]!.port1.postMessage(bytes) },
          stdin: channels[2]!.port1,
          ipc: channels[3]!.port1,
        },
      });
      writeFileSync('/child.mjs', source);
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
    },
  );

  it('gives a same-realm child its canonical process builtin for both Node aliases', async () => {
    const fixture = seededProcess(41, 7);
    writeFileSync(
      '/child.mjs',
      `
const plain = require('process');
const nodeAlias = require('node:process');
process.stdout.write(JSON.stringify({
  plainSame: plain === process,
  nodeSame: nodeAlias === process,
  pid: plain.pid,
  ppid: nodeAlias.ppid,
}));
`,
    );
    const previousActive = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(fixture.process, false);
    try {
      const child = spawn('node', ['/child.mjs']);
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      await new Promise<void>((resolve) => child.once('close', () => resolve()));

      expect(JSON.parse(stdout)).toEqual({
        plainSame: true,
        nodeSame: true,
        pid: child.pid,
        ppid: fixture.process.pid,
      });
    } finally {
      setActiveNodeProcessBootstrap(
        previousActive?.process ?? null,
        previousActive?.federated ?? false,
      );
      fixture.close();
    }
  });

  it('uses the same-realm child identity when it constructs a kernel worker thread', async () => {
    const fixture = seededProcess(41, 7);
    let identity: { readonly pid: number; readonly ppid: number } | undefined;
    vi.spyOn(globalProcessManager, 'spawnWorkerThread').mockImplementation((_spec, candidate) => {
      identity = candidate;
      const handle = fakeWorkerHandle();
      queueMicrotask(() => handle.emit('exit', 0, null));
      return handle;
    });
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    configureNodeEntryWorker('https://rifty.test/node-entry.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
    });
    writeFileSync(
      '/child.mjs',
      `
const worker = new (require('worker_threads').Worker)('/thread.mjs');
worker.on('error', () => {});
`,
    );
    writeFileSync('/thread.mjs', '');
    const previousActive = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(fixture.process, false);
    try {
      // Select same-realm child_process synchronously, then let the child's
      // Worker construction use the real kernel lane in its queued execution.
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = false;
      const child = spawn('node', ['/child.mjs']);
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
      await new Promise<void>((resolve) => child.once('close', () => resolve()));

      expect(identity).toEqual({ pid: child.pid, ppid: fixture.process.pid });
    } finally {
      setActiveNodeProcessBootstrap(
        previousActive?.process ?? null,
        previousActive?.federated ?? false,
      );
      fixture.close();
    }
  });

  it('restores the same-realm child process around worker parent callbacks', async () => {
    const fixture = seededProcess(41, 7);
    writeFileSync('/thread.js', 'parentPort.postMessage("ready");');
    writeFileSync(
      '/child.mjs',
      `
const worker = new (require('worker_threads').Worker)('/thread.js');
worker.on('message', () => process.stdout.write(String(globalThis.process.pid)));
`,
    );

    try {
      await withProcessGlobalAsync(
        fixture.process,
        async () => {
          const child = spawn('node', ['/child.mjs']);
          let stdout = '';
          child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
          });
          await new Promise<void>((resolve) => child.once('close', () => resolve()));

          expect(stdout).toBe(String(child.pid));
        },
        fixture.process,
      );
    } finally {
      fixture.close();
    }
  });

  it.each([
    {
      label: 'setImmediate',
      source: "setImmediate(() => globalThis.__RIFTY_TIMER_ORDER__.push('timer'));",
    },
    {
      label: "require('timers').setTimeout",
      source:
        "require('timers').setTimeout(() => globalThis.__RIFTY_TIMER_ORDER__.push('timer'), 0);",
    },
  ])('keeps a same-realm child live for a pending $label callback', async ({ source }) => {
    const fixture = seededProcess(41, 7);
    const timerRealm = globalThis as typeof globalThis & {
      __RIFTY_TIMER_ORDER__?: string[];
    };
    const order: string[] = [];
    timerRealm.__RIFTY_TIMER_ORDER__ = order;
    writeFileSync('/child.mjs', source);
    const previousActive = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(fixture.process, false);
    try {
      const child = spawn('node', ['/child.mjs']);
      await new Promise<void>((resolve) => {
        child.once('close', () => {
          order.push('close');
          resolve();
        });
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(order).toEqual(['timer', 'close']);
    } finally {
      Reflect.deleteProperty(timerRealm, '__RIFTY_TIMER_ORDER__');
      setActiveNodeProcessBootstrap(
        previousActive?.process ?? null,
        previousActive?.federated ?? false,
      );
      fixture.close();
    }
  });

  it('keeps a same-realm parent live until its spawned grandchild exits naturally', async () => {
    const fixture = seededProcess(41, 7);
    const childRealm = globalThis as typeof globalThis & {
      __RIFTY_CHILD_ORDER__?: string[];
    };
    const order: string[] = [];
    childRealm.__RIFTY_CHILD_ORDER__ = order;
    writeFileSync(
      '/child.mjs',
      `
const child = require('child_process').spawn('node', ['/grandchild.mjs']);
child.on('exit', (code, signal) => {
  globalThis.__RIFTY_CHILD_ORDER__.push('grandchild:' + String(code) + ':' + String(signal));
  if (signal === null) process.stdout.write('done');
});
`,
    );
    writeFileSync('/grandchild.mjs', 'setTimeout(() => {}, 10);');
    const previousActive = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(fixture.process, false);
    try {
      const child = spawn('node', ['/child.mjs']);
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      await new Promise<void>((resolve) => {
        child.once('close', () => {
          order.push('parent-close');
          resolve();
        });
      });

      expect(order).toEqual(['grandchild:0:null', 'parent-close']);
      expect(stdout).toBe('done');
    } finally {
      Reflect.deleteProperty(childRealm, '__RIFTY_CHILD_ORDER__');
      setActiveNodeProcessBootstrap(
        previousActive?.process ?? null,
        previousActive?.federated ?? false,
      );
      fixture.close();
    }
  });

  it('restores the trusted owner identity before an exit callback spawns a sibling', async () => {
    const channels = Array.from({ length: 4 }, () => new MessageChannel());
    const outer = new NodeProcess({
      pid: 41,
      ppid: 7,
      argv: ['rifty', '/workspace/outer.mjs'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: { write: (bytes: Uint8Array) => channels[0]!.port1.postMessage(bytes) },
        stderr: { write: (bytes: Uint8Array) => channels[1]!.port1.postMessage(bytes) },
        stdin: channels[2]!.port1,
        ipc: channels[3]!.port1,
      },
    });
    writeFileSync('/child.mjs', 'process.exit(0);');
    writeFileSync('/sibling.mjs', '');
    const previousActive = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(outer, false);
    const spawnSpy = vi.spyOn(globalProcessManager, 'spawn');
    try {
      const child = spawn('node', ['/child.mjs']);
      child.once('exit', () => spawn('node', ['/sibling.mjs']));
      await new Promise<void>((resolve) => child.once('close', () => resolve()));

      expect(spawnSpy).toHaveBeenCalledTimes(2);
      expect(spawnSpy.mock.calls[1]?.[2]).toBe(outer.pid);
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

async function withProcessGlobalAsync<T>(
  process: unknown,
  run: () => Promise<T>,
  trustedProcess: NodeProcess,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousActive = readActiveNodeProcessBootstrap();
  setActiveNodeProcessBootstrap(trustedProcess, false);
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

function seededProcess(
  pid: number,
  ppid: number,
): {
  readonly process: NodeProcess;
  close(): void;
} {
  const channels = Array.from({ length: 4 }, () => new MessageChannel());
  const process = new NodeProcess({
    pid,
    ppid,
    argv: ['rifty', '/workspace/outer.mjs'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: { write: (bytes: Uint8Array) => channels[0]!.port1.postMessage(bytes) },
      stderr: { write: (bytes: Uint8Array) => channels[1]!.port1.postMessage(bytes) },
      stdin: channels[2]!.port1,
      ipc: channels[3]!.port1,
    },
  });
  return {
    process,
    close() {
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
    },
  };
}

function fakeWorkerHandle(): ProcessHandle & EventEmitter {
  const handle = new EventEmitter();
  return Object.assign(handle, {
    kind: 'worker' as const,
    pid: 99,
    ppid: 1,
    command: 'worker_threads',
    exitCode: null,
    signalCode: null,
    cwd: '/workspace',
    stdout: () => new EventEmitter(),
    stderr: () => new EventEmitter(),
    send: () => true,
    kill: () => true,
  }) as unknown as ProcessHandle & EventEmitter;
}
